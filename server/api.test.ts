// Pruebas de integración de la API (RNF10): el servidor real contra un PostgreSQL de prueba.
// Recorre el flujo completo: registro, verificación, reciclaje, validación, canje, entrega,
// permisos, eliminación de cuenta y cierre de sesión.
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import webpush from 'web-push'
import { crearBasePrueba } from '../db/base-prueba'
import { jpegDePrueba } from './jpeg-prueba'
import type { AvisoPush, SuscripcionPush } from './push'

let db: PGlite
let socket: PGLiteSocketServer
let servidor: Server
let base = ''
let token: string | null = null
let cerrarPool: () => Promise<void> = async () => {}
let esperarEnvios: () => Promise<void> = async () => {}

// Push simulado: registra cada aviso en vez de enviarlo; un endpoint "caducado" responde 410
const enviados: { endpoint: string; aviso: AvisoPush }[] = []
const CADUCADA = 'https://push.example.org/caducada'
const suscripcionDe = (nombre: string): SuscripcionPush => ({ endpoint: `https://push.example.org/${nombre}`, keys: { p256dh: 'clave-p256dh', auth: 'clave-auth' } })

type Respuesta = { status: number } & Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function api(ruta: string, cuerpo?: unknown): Promise<Respuesta> {
  const r = await fetch(base + ruta, {
    method: cuerpo === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  return { status: r.status, ...((await r.json().catch(() => ({}))) as object) }
}

const correoPara = async (para: string) => (await api('/correos')).correos.find((c: { para: string }) => c.para.toLowerCase() === para.toLowerCase())

async function entrar(correo: string, password = 'EcoSmart2026') {
  token = null
  const r = await api('/auth/login', { correo, password })
  if (r.tipo === 'segundo_factor') {
    const codigo = (await correoPara(correo)).cuerpo.match(/\d{6}/)[0]
    token = (await api('/auth/segundo-factor', { usuarioId: r.usuarioId, codigo })).sesion.token
  } else token = r.sesion.token
}

const foto = jpegDePrueba()
const saldo = (db: { movimientos: { usuarioId: string; puntos: number }[] }, id: string) => db.movimientos.filter((m) => m.usuarioId === id).reduce((t, m) => t + m.puntos, 0)

beforeAll(async () => {
  db = await crearBasePrueba()
  const puerto = 46000 + Math.floor(Math.random() * 1000)
  socket = new PGLiteSocketServer({ db, port: puerto, host: '127.0.0.1' })
  await socket.start()
  Object.assign(process.env, { PGHOST: '127.0.0.1', PGPORT: String(puerto), PGUSER: 'postgres', PGPASSWORD: 'prueba', PGDATABASE: 'postgres', PG_POOL_MAX: '1', BANDEJA_DEMO: '1', LIMITE_AUTH: '1000', CORREO_INTERVALO_MS: '0', URL_PUBLICA: 'https://ecosmart.test/' })
  const vapid = webpush.generateVAPIDKeys()
  Object.assign(process.env, { VAPID_PUBLICA: vapid.publicKey, VAPID_PRIVADA: vapid.privateKey })
  const { app, pool } = await import('./app')
  const push = await import('./push')
  push.configurarEnvio(async (s, aviso) => {
    if (s.endpoint === CADUCADA) throw Object.assign(new Error('Gone'), { statusCode: 410 })
    enviados.push({ endpoint: s.endpoint, aviso })
  })
  esperarEnvios = push.esperarEnvios
  cerrarPool = () => pool.end()
  servidor = app.listen(0)
  await new Promise((r) => servidor.once('listening', r))
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api`
})

afterAll(async () => {
  servidor?.close()
  await cerrarPool()
  await socket?.stop()
  await db?.close()
})

describe('Límite de peticiones (CP-RNF04)', () => {
  it('bloquea con 429 al superar el máximo por IP dentro de la ventana', async () => {
    const { limite } = await import('./app')
    const mw = limite(3, 60_000)
    const estados: number[] = []
    for (let i = 0; i < 5; i += 1) {
      let estado = 200
      const res = { status: (s: number) => ((estado = s), { json: () => undefined }) }
      mw({ ip: '10.0.0.1' } as never, res as never, () => undefined)
      estados.push(estado)
    }
    expect(estados).toEqual([200, 200, 200, 429, 429])
  })
})

describe('API sobre PostgreSQL', () => {
  let ana = ''
  let fotoDeAna = ''
  let codigoCanje = ''

  it('responde la salud con la versión de PostgreSQL', async () => {
    expect((await api('/salud')).postgres).toMatch(/PostgreSQL/)
  })

  it('CP-RF01: registra y entra de inmediato, sin código ni enlace de verificación', async () => {
    expect((await api('/auth/registro', { nombre: 'X', correo: 'no-es-un-correo', facultad: 'F', password: 'Clave2026x', consentimiento: true })).error).toMatch(/correo válido/)
    const antes = (await db.query('SELECT count(*)::int AS n FROM correo_simulado')).rows[0] as { n: number }
    const r = await api('/auth/registro', { nombre: 'Ana Torres', correo: 'ana.torres@espol.edu.ec', facultad: 'Ingeniería', password: 'Clave2026x', consentimiento: true })
    expect(r.status).toBe(200)
    expect(r.sesion.token).toMatch(/^[\w-]{20,}$/)
    expect(((await db.query('SELECT count(*)::int AS n FROM correo_simulado')).rows[0] as { n: number }).n).toBe(antes.n) // no se envía ningún correo
    expect((await api('/auth/login', { correo: 'ana.torres@espol.edu.ec', password: 'Clave2026x' })).tipo).toBe('ok')
    expect((await api('/auth/registro', { nombre: 'Ana', correo: 'ana.torres@espol.edu.ec', facultad: 'F', password: 'Clave2026x', consentimiento: true })).status).toBe(409)
  })

  it('CP-RF01: cualquier correo se registra como Invitado y entra de inmediato', async () => {
    const r = await api('/auth/registro', { nombre: 'Visitante', correo: 'visitante.prueba@gmail.com', facultad: 'Otra', password: 'Clave2026x', consentimiento: true })
    expect(r.status).toBe(200)
    const fila = await db.query("SELECT institucion_id, verificado FROM usuario WHERE correo = 'visitante.prueba@gmail.com'")
    expect(fila.rows[0]).toEqual({ institucion_id: 'inst-invitados', verificado: true })
    expect((await api('/auth/login', { correo: 'visitante.prueba@gmail.com', password: 'Clave2026x' })).tipo).toBe('ok')
    // Si la administración desactiva "Invitados", vuelve a exigirse correo universitario
    await db.query("UPDATE institucion SET activa = false WHERE id = 'inst-invitados'")
    try {
      expect((await api('/auth/registro', { nombre: 'Otro', correo: 'otro.visitante@gmail.com', facultad: 'Otra', password: 'Clave2026x', consentimiento: true })).error).toMatch(/universidad participante/)
    } finally {
      await db.query("UPDATE institucion SET activa = true WHERE id = 'inst-invitados'")
    }
  })

  it('CP-RNF04: no envía contraseñas y cada rol ve solo lo suyo', async () => {
    await entrar('ana.torres@espol.edu.ec', 'Clave2026x')
    const e = await api('/estado')
    ana = e.db.usuarios.find((u: { correo: string }) => u.correo === 'ana.torres@espol.edu.ec').id
    expect(e.db.usuarios.every((u: { passwordHash: string }) => !u.passwordHash)).toBe(true)
    expect(e.db.auditoria).toHaveLength(0)
    expect((await api('/accion/crearAjuste', { args: ['x', ana, 500, 'trampa'] })).error).toMatch(/permiso/)
  })

  it('CP-RF10: registra el reciclaje a nombre de la sesión, no del que diga el navegador', async () => {
    const r = await api('/accion/registrarReciclaje', {
      args: [{ idempotencyKey: 'api-1', usuarioId: 'otro', codigoPunto: 'ECO-BIB-01', categoriaId: 'cat-pet', categoriaIa: 'cat-pet', confianzaIa: 0.9, modeloVersion: 'clip', cantidad: 3, foto, fotoHash: '0f0f0f0f0f0f0f0f' }],
    })
    expect(r.resultado.reciclaje.usuarioId).toBe(ana)
    expect(r.resultado.reciclaje.estado).toBe('pendiente')
  })

  it('CP-RNF04: rechaza fotos que no son JPEG, dañadas, enormes o con datos inválidos', async () => {
    const intento = (cambios: Record<string, unknown>) =>
      api('/accion/registrarReciclaje', {
        args: [{ idempotencyKey: 'api-invalida', codigoPunto: 'ECO-BIB-01', categoriaId: 'cat-pet', categoriaIa: 'cat-pet', confianzaIa: 0.9, modeloVersion: 'clip', cantidad: 1, foto, fotoHash: '1234567890abcdef', ...cambios }],
      })
    const png = await intento({ foto: 'data:image/png;base64,' + Buffer.from('x'.repeat(300)).toString('base64') })
    expect([png.status, png.error]).toEqual([400, 'La foto debe ser una imagen JPEG.'])
    const disfrazada = await intento({ foto: 'data:image/jpeg;base64,' + Buffer.from('esto no es una imagen '.repeat(20)).toString('base64') })
    expect([disfrazada.status, disfrazada.error]).toEqual([400, 'La foto está dañada o no es una imagen válida.'])
    expect((await intento({ foto: 'data:image/jpeg;base64,@@no-es-base64@@' })).status).toBe(400)
    const enorme = await intento({ foto: jpegDePrueba(64, 48, 700_000) })
    expect([enorme.status, enorme.error]).toEqual([413, 'La imagen supera el tamaño permitido.'])
    expect((await intento({ foto: jpegDePrueba(9000, 100) })).error).toMatch(/píxeles/)
    expect((await intento({ fotoHash: 'no-hex' })).error).toBe('Dato inválido: huella de la foto.')
    expect((await intento({ cantidad: 'muchas' })).error).toBe('Dato inválido: cantidad.')
    const guardados = await db.query("SELECT 1 FROM reciclaje WHERE idempotency_key = 'api-invalida'")
    expect(guardados.rows).toHaveLength(0)
  })

  it('CP-RN05: la fecha del registro la pone el servidor, no el navegador', async () => {
    const antes = Date.now()
    const r = await api('/accion/registrarReciclaje', {
      args: [{ idempotencyKey: 'api-fecha', codigoPunto: 'ECO-BIB-01', categoriaId: 'cat-pet', categoriaIa: 'cat-pet', confianzaIa: 0.9, modeloVersion: 'clip', cantidad: 1, foto, fotoHash: 'abcdef0123456789', creadoEn: antes - 3 * 86_400_000 }],
    })
    expect(r.resultado.reciclaje.creadoEn).toBeGreaterThanOrEqual(antes)
  })

  it('CP-RNF04: JSON mal formado responde 400 sin escribir la contraseña en el registro', async () => {
    const espias = [vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {}), vi.spyOn(console, 'log').mockImplementation(() => {})]
    const r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"correo":"ana.torres@espol.edu.ec","password":"ClaveSecreta-99"' })
    const escrito = espias.flatMap((e) => e.mock.calls.flat().map(String)).join(' ')
    espias.forEach((e) => e.mockRestore())
    expect(r.status).toBe(400)
    expect(escrito).not.toContain('ClaveSecreta-99')
  })

  it('CP-RNF04: las respuestas llevan cabeceras de seguridad y la API no se guarda en caché', async () => {
    const r = await fetch(base + '/salud')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('x-frame-options')).toBe('DENY')
    expect(r.headers.get('referrer-policy')).toBe('no-referrer')
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(r.headers.get('x-powered-by')).toBeNull()
  })

  it('CP-RF23: el usuario suscribe su dispositivo para recibir avisos push', async () => {
    expect((await api('/push/clave')).clave).toMatch(/^[A-Za-z0-9_-]{80,}$/)
    expect((await api('/push/suscribir', { suscripcion: { endpoint: 'http://inseguro', keys: {} } })).status).toBe(400)
    expect((await api('/push/suscribir', { suscripcion: suscripcionDe('ana-celular') })).activo).toBe(true)
    expect((await api('/push/suscribir', { suscripcion: { endpoint: CADUCADA, keys: { p256dh: 'x', auth: 'y' } } })).activo).toBe(true)
    const guardadas = await db.query(`SELECT endpoint FROM suscripcion_push WHERE usuario_id = '${ana}' ORDER BY endpoint`)
    expect(guardadas.rows).toHaveLength(2)
    const sinSesion = token
    token = null
    expect((await api('/push/suscribir', { suscripcion: suscripcionDe('intruso') })).status).toBe(401)
    token = sinSesion
  })

  it('CP-RF14: el recolector valida y los puntos llegan al saldo', async () => {
    await entrar('recolector@universidad.edu.ec')
    const pendiente = (await api('/estado')).db.reciclajes.find((x: { idempotencyKey: string }) => x.idempotencyKey === 'api-1')
    // RNF02/RNF05: la foto no viaja en los datos de la página; se pide aparte con permiso
    expect(pendiente.foto).toBe('remota')
    expect((await api('/foto/' + pendiente.id)).foto).toBe(foto)
    fotoDeAna = pendiente.id
    const r = await api('/accion/cerrarLote', { args: ['x', 'p-biblioteca', [{ reciclajeId: pendiente.id, accion: 'validar' }]] })
    expect(r.resultado.validados).toBe(1)
  })

  it('CP-RF23: al validar, el aviso llega por push y la suscripción caducada se borra', async () => {
    await esperarEnvios()
    const aviso = enviados.find((e) => e.endpoint === suscripcionDe('ana-celular').endpoint)
    expect(aviso?.aviso.titulo).toBe('Reciclaje validado')
    expect(aviso?.aviso.mensaje).toMatch(/30 EcoPoints/)
    expect(aviso?.aviso.url).toBe('#/app/notificaciones')
    expect(enviados.some((e) => e.endpoint.includes('recolector'))).toBe(false) // nadie más recibe el aviso de Ana
    const caducada = await db.query(`SELECT 1 FROM suscripcion_push WHERE endpoint = '${CADUCADA}'`)
    expect(caducada.rows).toHaveLength(0)
  })

  it('CP-RNF05: solo el titular, el recolector asignado y la administración ven la foto', async () => {
    await entrar('estudiante@universidad.edu.ec')
    expect((await api('/foto/' + fotoDeAna)).status).toBe(403)
    await entrar('admin@universidad.edu.ec')
    expect((await api('/foto/' + fotoDeAna)).foto).toBe(foto)
    token = null
    expect((await api('/foto/' + fotoDeAna)).status).toBe(401)
  })

  it('CP-RNF02: la página del estudiante trae el ranking ya calculado, no el libro de todos', async () => {
    await entrar('estudiante@universidad.edu.ec')
    const e = await api('/estado')
    expect(e.db.rankings.mostrados).toBe(50)
    // Solo los alcances que ofrece la pantalla: su universidad y "todas", en los 3 periodos
    const suya = e.db.usuarios.find((u: { correo: string }) => u.correo === 'estudiante@universidad.edu.ec').institucionId
    expect(Object.keys(e.db.rankings.usuarios).sort()).toEqual(['semana', 'mes', 'siempre'].flatMap((p) => [`${p}|${suya}`, `${p}|todas`]).sort())
    expect(e.db.movimientos.every((m: { usuarioId: string }) => m.usuarioId === e.db.usuarios.find((u: { correo: string }) => u.correo === 'estudiante@universidad.edu.ec').id)).toBe(true)
    expect(e.db.resumenPublico.reciclajesValidados).toBeGreaterThan(0)
  })

  it('CP-RNF09: acciones simultáneas se guardan juntas sin mezclarse ni duplicarse', async () => {
    await entrar('estudiante@universidad.edu.ec')
    const datos = (clave: string, fotoHash: string, cantidad = 2) => ({
      args: [{ idempotencyKey: clave, codigoPunto: 'ECO-BIB-01', categoriaId: 'cat-pet', categoriaIa: 'cat-pet', confianzaIa: 0.9, modeloVersion: 'clip', cantidad, foto, fotoHash }],
    })
    const respuestas = await Promise.all([
      api('/accion/registrarReciclaje', datos('lote-1', '0000000000000000')),
      api('/accion/registrarReciclaje', datos('lote-2', 'ffffffffffffffff')),
      api('/accion/registrarReciclaje', datos('lote-x', '00000000ffffffff', 99999)), // fuera de rango: se rechaza sola
      api('/accion/registrarReciclaje', datos('lote-3', 'ffffffff00000000')),
      api('/accion/registrarReciclaje', datos('lote-1', '0000000000000000')), // la misma petición repetida (RNF03)
    ])
    expect(respuestas.map((r) => r.status)).toEqual([200, 200, 400, 200, 200])
    expect(respuestas[2].error).toMatch(/cantidad/i)
    const ids = [0, 1, 3].map((i) => respuestas[i].resultado.reciclaje.id)
    expect(new Set(ids).size).toBe(3)
    expect(respuestas[4].resultado.repetido).toBe(true)
    expect(respuestas[4].resultado.reciclaje.id).toBe(ids[0])
    const guardados = await db.query("SELECT idempotency_key FROM reciclaje WHERE idempotency_key LIKE 'lote-%' ORDER BY idempotency_key")
    expect(guardados.rows.map((r) => (r as { idempotency_key: string }).idempotency_key)).toEqual(['lote-1', 'lote-2', 'lote-3'])
  })

  it('administrador y aliado entran sin código (el único código es el de cambiar la contraseña)', async () => {
    token = null
    for (const correo of ['admin@universidad.edu.ec', 'aliado@universidad.edu.ec']) {
      const r = await api('/auth/login', { correo, password: 'EcoSmart2026' })
      expect(r.tipo).toBe('ok')
      expect(r.sesion.token).toBeTruthy()
    }
    expect((await api('/auth/segundo-factor', { usuarioId: 'x', codigo: '123456' })).status).toBe(404)
  })

  it('CP-RF25: la administración crea el correo interno y la persona se registra con su contraseña', async () => {
    await entrar('admin@universidad.edu.ec')
    expect((await api('/admin/dominios')).dominios).toEqual({ usuario: 'eco.smart.com', recolector: 'recolector.eco.smart.com', aliado: 'aliado.eco.smart.com', admin: 'administrador.eco.smart.com' })
    const r = await api('/admin/cuentas', { nombre: '', usuario: 'juan.aliado', rol: 'aliado', institucionId: 'inst-espol', facultad: '' })
    expect(r).toMatchObject({ correo: 'juan.aliado@aliado.eco.smart.com' })
    expect(r.password).toBeUndefined() // la contraseña la pone la persona
    expect((await api('/admin/cuentas', { usuario: 'juan.aliado', rol: 'aliado' })).status).toBe(409)
    expect((await api('/admin/cuentas', { usuario: 'con espacios', rol: 'usuario' })).status).toBe(400)
    expect((await api('/admin/cuentas', { usuario: 'x', rol: 'superadmin' })).status).toBe(400)
    token = null
    // Antes de registrarse no puede entrar con ninguna contraseña
    expect((await api('/auth/login', { correo: r.correo, password: 'Cualquiera1' })).error).toMatch(/aún no está registrada/)
    // Se registra con su nombre y su contraseña y entra de inmediato, con el rol y la universidad asignados
    const reg = await api('/auth/registro', { nombre: 'Juan Pérez', correo: r.correo, facultad: '', password: 'MiClave2026', consentimiento: true })
    expect(reg.status).toBe(200)
    const fila = await db.query(`SELECT nombre, rol, verificado, institucion_id FROM usuario WHERE correo = '${r.correo}'`)
    expect(fila.rows[0]).toEqual({ nombre: 'Juan Pérez', rol: 'aliado', verificado: true, institucion_id: 'inst-espol' })
    expect((await api('/auth/login', { correo: r.correo, password: 'MiClave2026' })).tipo).toBe('ok')
    expect((await api('/auth/registro', { nombre: 'Otro', correo: r.correo, facultad: '', password: 'OtraClave2026', consentimiento: true })).status).toBe(409)
  })

  it('CP-RF25: solo la administración ve y cambia los dominios; nadie se registra con uno que no creó', async () => {
    expect((await api('/auth/registro', { nombre: 'Intruso', correo: 'yo@administrador.eco.smart.com', facultad: 'F', password: 'Clave2026x', consentimiento: true })).error).toMatch(/aún no existe/)
    expect((await api('/auth/registro', { nombre: 'Intruso', correo: 'yo@eco.smart.com', facultad: 'F', password: 'Clave2026x', consentimiento: true })).error).toMatch(/aún no existe/)
    await entrar('estudiante@universidad.edu.ec')
    expect((await api('/admin/dominios')).status).toBe(403)
    expect((await api('/admin/cuentas', { nombre: 'X', usuario: 'yo', rol: 'admin' })).status).toBe(403)
    await entrar('admin@universidad.edu.ec')
    const actuales = (await api('/admin/dominios')).dominios
    const cambiar = (dominios: Record<string, string>) =>
      fetch(base + '/admin/dominios', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ dominios }) }).then(async (x) => ({ status: x.status, ...(await x.json()) }))
    expect((await cambiar({ ...actuales, usuario: 'no valido' })).status).toBe(400)
    expect((await cambiar({ ...actuales, usuario: actuales.aliado })).error).toMatch(/distinto/)
    expect((await cambiar({ ...actuales, usuario: 'espol.edu.ec' })).error).toMatch(/universidad/)
    expect((await cambiar({ ...actuales, usuario: 'estudiantes.eco.smart.com' })).dominios.usuario).toBe('estudiantes.eco.smart.com')
    expect((await cambiar(actuales)).status).toBe(200)
  })

  it('el administrador entrega el canje una sola vez', async () => {
    await entrar('admin@universidad.edu.ec')
    expect((await api('/accion/crearAjuste', { args: ['x', ana, 50, 'Bono'] })).status).toBe(200)
    await entrar('ana.torres@espol.edu.ec', 'Clave2026x')
    const c = await api('/accion/crearCanje', { args: ['x', 'rw-cafe', 'api-canje-1'] })
    codigoCanje = c.resultado.codigo
    expect(saldo(c.db, ana)).toBe(30 + 50 - 60)
    await entrar('admin@universidad.edu.ec')
    expect((await api('/accion/entregarCanje', { args: ['x', codigoCanje] })).resultado.estado).toBe('entregado')
    expect((await api('/accion/entregarCanje', { args: ['x', codigoCanje] })).error).toMatch(/ya fue utilizado/)
  })

  it('CP-RF19: el aliado entra con segundo factor, ve solo sus canjes y entrega el suyo', async () => {
    await entrar('admin@universidad.edu.ec')
    await api('/accion/crearAjuste', { args: ['x', ana, 200, 'Saldo para canjes'] })
    await entrar('ana.torres@espol.edu.ec', 'Clave2026x')
    const cafe = (await api('/accion/crearCanje', { args: ['x', 'rw-cafe', 'api-canje-2'] })).resultado
    const impresion = (await api('/accion/crearCanje', { args: ['x', 'rw-impresion', 'api-canje-3'] })).resultado
    await entrar('aliado@universidad.edu.ec')
    const e = await api('/estado')
    expect(e.db.canjes.every((c: { recompensaId: string }) => c.recompensaId === 'rw-cafe')).toBe(true)
    expect(e.db.auditoria).toHaveLength(0)
    expect((await api('/accion/entregarCanje', { args: ['x', cafe.codigo] })).resultado.estado).toBe('entregado')
    expect((await api('/accion/entregarCanje', { args: ['x', impresion.codigo] })).error).toMatch(/otro responsable/)
  })

  it('CP-RNF05: eliminar la cuenta exige la contraseña, anonimiza y revoca el acceso', async () => {
    await entrar('ana.torres@espol.edu.ec', 'Clave2026x')
    expect((await api('/cuenta/eliminar', { password: 'incorrecta' })).status).toBe(403)
    expect((await api('/cuenta/eliminar', { password: 'Clave2026x' })).eliminada).toBe(true)
    expect((await api('/estado')).status).toBe(401)
    token = null
    expect((await api('/auth/login', { correo: 'ana.torres@espol.edu.ec', password: 'Clave2026x' })).status).toBe(401)
    const fila = (await db.query<{ nombre: string; correo: string; fotos: number }>(
      `SELECT u.nombre, u.correo, (SELECT count(*)::int FROM reciclaje r WHERE r.usuario_id = u.id AND r.foto_url <> '') AS fotos FROM usuario u WHERE u.id = '${ana}'`,
    )).rows[0]
    expect(fila.nombre).toBe('Cuenta eliminada')
    expect(fila.correo).toMatch(/@anonimo\.invalid$/)
    expect(fila.fotos).toBe(0)
    const subs = await db.query(`SELECT 1 FROM suscripcion_push WHERE usuario_id = '${ana}'`)
    expect(subs.rows).toHaveLength(0) // un dispositivo no sigue recibiendo avisos de una cuenta eliminada
  })

  it('CP-RF02: cerrar sesión revoca el token', async () => {
    await entrar('estudiante@universidad.edu.ec')
    expect((await api('/estado')).status).toBe(200)
    await api('/auth/logout', {})
    expect((await api('/estado')).status).toBe(401)
  })
})

describe('Correos reales por SMTP (RF01, RF02, RNF13)', () => {
  type Enviado = { to: string; subject: string; text: string; html: string }
  const buzon: Enviado[] = []
  let fallar = 0
  const transporteFalso = {
    async sendMail(m: Enviado) {
      if (fallar > 0) {
        fallar -= 1
        throw new Error('Servidor de correo no disponible')
      }
      buzon.push(m)
    },
  }
  let correo: typeof import('./correo')
  const fila = async (para: string) => (await db.query(`SELECT enviado_en, intentos, error FROM correo_simulado WHERE para = '${para}' ORDER BY creado_en DESC LIMIT 1`)).rows[0] as { enviado_en: Date | null; intentos: number; error: string | null }

  beforeAll(async () => {
    correo = await import('./correo')
    correo.usarTransporte(transporteFalso)
  })
  afterAll(() => correo.usarTransporte(null))

  it('CP-RF01: registrarse ya no envía correo de verificación', async () => {
    token = null
    const antes = buzon.length
    expect((await api('/auth/registro', { nombre: 'Luis Mora', correo: 'luis.mora@espol.edu.ec', facultad: 'Ingeniería', password: 'Clave2026x', consentimiento: true })).status).toBe(200)
    await correo.repartir()
    expect(buzon.length).toBe(antes)
    expect(correo.enlaceCompleto('#/app')).toBe('https://ecosmart.test/#/app')
  })

  it('CP-RNF13: si el servidor de correo falla, se reintenta y el código llega', async () => {
    fallar = 1
    const antes = buzon.length
    await api('/auth/recuperar', { correo: 'luis.mora@espol.edu.ec' })
    await correo.repartir()
    expect(buzon.length).toBe(antes)
    expect(await fila('luis.mora@espol.edu.ec')).toMatchObject({ enviado_en: null, intentos: 1, error: 'Servidor de correo no disponible' })
    await correo.repartir()
    expect(buzon.at(-1)?.subject).toBe('Código para cambiar tu contraseña')
    expect(await fila('luis.mora@espol.edu.ec')).toMatchObject({ intentos: 2, error: null })
  })

  it('no envía a las cuentas de demostración ni correos de hace más de una hora', async () => {
    const antes = buzon.length
    await api('/auth/recuperar', { correo: 'estudiante@universidad.edu.ec' })
    await db.query("INSERT INTO correo_simulado (para, asunto, cuerpo, creado_en) VALUES ('viejo@espol.edu.ec', 'Código viejo', 'x', now() - interval '2 hours')")
    await correo.repartir()
    expect(buzon.length).toBe(antes)
    expect((await fila('estudiante@universidad.edu.ec')).error).toMatch(/demostración/)
    expect((await fila('viejo@espol.edu.ec')).enviado_en).toBeNull()
  })

  it('CP-RNF04: con correo real, la bandeja simulada solo muestra cuentas de demostración', async () => {
    const r = await api('/correos')
    expect(r.correos.length).toBeGreaterThan(0)
    expect(r.correos.every((c: { para: string }) => c.para.endsWith('@universidad.edu.ec'))).toBe(true)
    expect((await api('/salud')).correoReal).toBe(true)
  })

  it('CP-RF02: cambiar la contraseña pide el código de 6 dígitos que llega al correo', async () => {
    await api('/auth/recuperar', { correo: 'luis.mora@espol.edu.ec' })
    await correo.repartir()
    const codigo = buzon.at(-1)!.text.match(/\b(\d{6})\b/)![1]
    expect(buzon.at(-1)!.text).not.toContain('http') // un código, no un enlace
    const otro = codigo === '000000' ? '111111' : '000000'
    expect((await api('/auth/restablecer', { correo: 'luis.mora@espol.edu.ec', codigo: otro, password: 'Nueva2026x' })).status).toBe(400)
    expect((await api('/auth/restablecer', { correo: 'otra.persona@espol.edu.ec', codigo, password: 'Nueva2026x' })).status).toBe(400)
    expect((await api('/auth/restablecer', { correo: 'luis.mora@espol.edu.ec', codigo, password: 'Nueva2026x' })).status).toBe(200)
    expect((await api('/auth/restablecer', { correo: 'luis.mora@espol.edu.ec', codigo, password: 'Otra2026xx' })).status).toBe(400) // un solo uso
    expect((await api('/auth/login', { correo: 'luis.mora@espol.edu.ec', password: 'Nueva2026x' })).tipo).toBe('ok')
  })

  it('los códigos de las cuentas internas también llegan al buzón del proyecto', async () => {
    process.env.CORREO_DEMO_DESTINO = 'proyecto@ejemplo.com'
    try {
      await api('/auth/recuperar', { correo: 'juan.aliado@aliado.eco.smart.com' })
      await correo.repartir()
      expect(buzon.at(-1)).toMatchObject({ to: 'proyecto@ejemplo.com', subject: '[juan.aliado@aliado.eco.smart.com] Código para cambiar tu contraseña' })
    } finally {
      delete process.env.CORREO_DEMO_DESTINO
    }
  })

  it('los correos de las cuentas de demostración llegan al buzón del proyecto', async () => {
    process.env.CORREO_DEMO_DESTINO = 'proyecto@ejemplo.com'
    try {
      await api('/auth/recuperar', { correo: 'recolector@universidad.edu.ec' })
      await correo.repartir()
      const m = buzon.at(-1)!
      expect(m.to).toBe('proyecto@ejemplo.com')
      expect(m.subject).toBe('[recolector@universidad.edu.ec] Código para cambiar tu contraseña')
      expect((await api('/salud')).correoDemoReal).toBe(true)
      expect((await api('/correos')).correos).toEqual([]) // con todo real, la bandeja queda vacía
    } finally {
      delete process.env.CORREO_DEMO_DESTINO
    }
  })

  it('escapa el texto en la versión HTML del correo', () => {
    const m = correo.armarCorreo({ para: 'a@espol.edu.ec', asunto: 'x', cuerpo: '<script>alert(1)</script>', enlace: null })
    expect(m.html).not.toContain('<script>')
    expect(m.html).toContain('&lt;script&gt;')
  })
})
