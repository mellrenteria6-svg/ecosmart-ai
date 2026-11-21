// Pruebas de integración de la API (RNF10): el servidor real contra un PostgreSQL de prueba.
// Recorre el flujo completo: registro, verificación, reciclaje, validación, canje, entrega,
// permisos, eliminación de cuenta y cierre de sesión.
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import webpush from 'web-push'
import { crearBasePrueba } from '../db/base-prueba'
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

const foto = 'data:image/jpeg;base64,' + Buffer.from('foto de prueba').toString('base64')
const saldo = (db: { movimientos: { usuarioId: string; puntos: number }[] }, id: string) => db.movimientos.filter((m) => m.usuarioId === id).reduce((t, m) => t + m.puntos, 0)

beforeAll(async () => {
  db = await crearBasePrueba()
  const puerto = 46000 + Math.floor(Math.random() * 1000)
  socket = new PGLiteSocketServer({ db, port: puerto, host: '127.0.0.1' })
  await socket.start()
  Object.assign(process.env, { PGHOST: '127.0.0.1', PGPORT: String(puerto), PGUSER: 'postgres', PGPASSWORD: 'prueba', PGDATABASE: 'postgres', PG_POOL_MAX: '1', BANDEJA_DEMO: '1', LIMITE_AUTH: '1000' })
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
  let codigoCanje = ''

  it('responde la salud con la versión de PostgreSQL', async () => {
    expect((await api('/salud')).postgres).toMatch(/PostgreSQL/)
  })

  it('CP-RF01: registra con correo de universidad, exige verificar y el enlace es de un solo uso', async () => {
    expect((await api('/auth/registro', { nombre: 'X', correo: 'x@gmail.com', facultad: 'F', password: 'Clave2026x', consentimiento: true })).status).toBe(400)
    const r = await api('/auth/registro', { nombre: 'Ana Torres', correo: 'ana.torres@espol.edu.ec', facultad: 'Ingeniería', password: 'Clave2026x', consentimiento: true })
    expect(r.status).toBe(200)
    expect((await api('/auth/login', { correo: 'ana.torres@espol.edu.ec', password: 'Clave2026x' })).status).toBe(403)
    const t = (await correoPara('ana.torres@espol.edu.ec')).enlace.split('token=')[1]
    expect((await api('/auth/verificar', { token: t })).usuario.nombre).toBe('Ana Torres')
    expect((await api('/auth/verificar', { token: t })).status).toBe(400)
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
    expect(pendiente.foto).toBe(foto)
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

  it('CP-RNF13: el administrador entra con segundo factor y entrega el canje una sola vez', async () => {
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
