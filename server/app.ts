// Aplicación Express de EcoSmart AI (API REST sobre PostgreSQL). La arranca server/index.ts
// y la usan las pruebas de integración.
// Las reglas de negocio son las mismas de la aplicación (src/data/store.ts): el servidor
// carga la base, ejecuta la acción y guarda las diferencias en una sola transacción.
import compression from 'compression'
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { accionesLocales, ApiError, aplicarRetencionFotos, eliminarCuentaLocal, motorServidor, procesarVencimientos } from '../src/data/store'
import { calcularRankingsCompletos } from '../src/data/analitica'
import type { NombreAccion } from '../src/data/store'
import type { Db, Usuario } from '../src/data/types'
import { FOTO_EN_BASE, cargarDb, cargarUsuarios, guardarCambios, leerFoto, pool } from './db'
export { pool }
import { FOTO_REMOTA, indicesPorUsuario, puedeVerFoto, resumenPublico, vistaPara } from './vista'
import * as auth from './auth'
import * as push from './push'
import { ErrorHttp } from './auth'
import { datosReciclaje } from './validacion'
import { avisarCartero, correoActivo, destinoDemostracion, esCorreoDeDemostracion } from './correo'

const BANDEJA_DEMO = process.env.BANDEJA_DEMO !== '0' // bandeja de correo simulada (solo para demostración)

const llegadas = new WeakMap<object, number>()
const inicioSolicitud = (req: object) => llegadas.get(req) ?? performance.now()

export const app = express()
app.disable('x-powered-by')
// Detrás de un proxy con HTTPS (Nginx, Render, Railway…): se confía en su cabecera X-Forwarded-*
// para saber la IP real (límite de peticiones) y si la conexión fue segura.
if (process.env.CONFIAR_PROXY === '1') app.set('trust proxy', 1)
const FORZAR_HTTPS = process.env.FORZAR_HTTPS === '1'

// Cabeceras de seguridad (RNF04)
app.use((req, res, next) => {
  // La revisión de salud del alojamiento llega por dentro, sin HTTPS: no se redirige
  if (FORZAR_HTTPS && !req.secure && req.path !== '/api/salud') {
    // Todo acceso usa HTTPS: lo que llegue por HTTP se redirige (308 conserva el método y el cuerpo)
    return void res.redirect(308, `https://${req.headers.host ?? 'localhost'}${req.originalUrl}`)
  }
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  })
  next()
})
app.use((req, _res, next) => {
  llegadas.set(req, performance.now()) // para Server-Timing
  next()
})
app.use(compression()) // respuestas JSON comprimidas (RNF02)
app.use(express.json({ limit: '1mb' })) // las fotos viajan como JPEG comprimido (máx. ~700 KB en base64)

// ---------------------------------------------------------------------------
// Límite de peticiones por IP (RNF04)
// ---------------------------------------------------------------------------
export function limite(maximo: number, ventanaMs: number) {
  const golpes = new Map<string, number[]>()
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip ?? 'local'
    const ahora = Date.now()
    const lista = (golpes.get(ip) ?? []).filter((t) => ahora - t < ventanaMs)
    lista.push(ahora)
    golpes.set(ip, lista)
    if (lista.length > maximo) return void res.status(429).json({ error: 'Demasiadas peticiones. Espera un momento e inténtalo de nuevo.' })
    next()
  }
}

const tokenDe = (req: Request) => req.headers.authorization?.replace(/^Bearer\s+/i, '') || undefined

// ---------------------------------------------------------------------------
// Memoria intermedia (RNF02, RNF09): las consultas leen una copia en memoria de la base y
// no esperan a las escrituras. Cada escritura confirmada reemplaza la copia; además se
// vuelve a leer de PostgreSQL cada VIGENCIA_MS por si alguien cambió datos desde fuera
// (pgAdmin, migraciones). Pensado para un solo servidor; con varios, bajar la vigencia.
// ---------------------------------------------------------------------------
const VIGENCIA_MS = Number(process.env.CACHE_MS ?? 15_000)
interface Memoria {
  db: Db
  leidaEn: number
  rankings?: ReturnType<typeof calcularRankingsCompletos>
  resumen?: ReturnType<typeof resumenPublico>
  indices?: ReturnType<typeof indicesPorUsuario>
}
let memoria: Memoria | null = null
let leyendo: Promise<Memoria> | null = null
// El EcoRanking y el resumen público pueden tener hasta unos segundos de atraso: recalcularlos
// en cada escritura frenaría al servidor cuando muchos usuarios reciclan a la vez
const VIGENCIA_RANKING_MS = Number(process.env.RANKING_MS ?? 10_000)
let rankingCalculadoEn = 0

function firmaRanking(db: Db) {
  let anonimos = 0
  for (const u of db.usuarios) if (u.rankingAnonimo) anonimos += 1
  return `${db.movimientos.length}:${db.usuarios.length}:${anonimos}`
}

const vigente = (m: Memoria | null): m is Memoria => !!m && Date.now() - m.leidaEn < VIGENCIA_MS
function recordar(db: Db) {
  // Las fotos recién subidas ya quedaron guardadas en PostgreSQL: en memoria solo se deja la marca
  // (los registros están congelados: se reemplaza la fila por una copia con la marca)
  db.reciclajes.forEach((r, i) => {
    if (r.foto && r.foto !== FOTO_EN_BASE) db.reciclajes[i] = Object.freeze({ ...r, foto: FOTO_EN_BASE })
  })
  const anterior = memoria
  memoria = { db, leidaEn: Date.now() }
  // Solo se reutilizan si ningún EcoPoint cambió: los puntos y el resumen salen de los movimientos
  // (que solo se agregan, nunca se editan); también se recalcula si alguien cambió su anonimato
  const mismosPuntos = !!anterior && firmaRanking(anterior.db) === firmaRanking(db)
  if (anterior && mismosPuntos && Date.now() - rankingCalculadoEn < VIGENCIA_RANKING_MS) {
    memoria.rankings = anterior.rankings
    memoria.resumen = anterior.resumen
  }
}
/** Olvida la copia en memoria (por ejemplo, tras crear una cuenta). */
export function olvidarMemoria() {
  memoria = null
}

async function leerParaConsulta(): Promise<Memoria> {
  if (vigente(memoria)) return memoria
  // Una sola lectura aunque lleguen muchas consultas a la vez
  leyendo ??= (async () => {
    const c = await pool.connect()
    try {
      recordar(await cargarDb(c))
      return memoria!
    } finally {
      c.release()
      leyendo = null
    }
  })()
  return leyendo
}

/** Ranking y resumen se calculan una vez por versión de la base, no en cada consulta. */
function derivados(m: Memoria) {
  if (!m.rankings) {
    m.rankings = calcularRankingsCompletos(m.db)
    rankingCalculadoEn = Date.now()
  }
  m.resumen ??= resumenPublico(m.db)
  m.indices ??= indicesPorUsuario(m.db)
  return { rankings: m.rankings, resumen: m.resumen, indices: m.indices }
}

// ---------------------------------------------------------------------------
// Ejecución de acciones: una a la vez y dentro de una transacción
// ---------------------------------------------------------------------------
// Commit en grupo (RNF02, RNF09): las acciones que llegan mientras se guarda otra esperan juntas
// y luego se aplican una tras otra en memoria, cada una con sus reglas y su propio resultado, y se
// guardan en UNA sola transacción. Con 100 personas a la vez esto evita una fila de segundos.
const LOTE_MAXIMO = Number(process.env.LOTE_MAXIMO ?? 50)
interface Trabajo {
  usuarioId: string | null
  fn: (actual: Usuario | null) => unknown
  tiempos?: Record<string, number>
  llegada: number
  resolver: (r: { resultado: unknown; db: Db }) => void
  rechazar: (e: unknown) => void
}
const pendientes: Trabajo[] = []
let procesando = false

function conBase<T>(usuarioId: string | null, fn: (actual: Usuario | null) => T, tiempos?: Record<string, number>): Promise<{ resultado: Awaited<T>; db: Db }> {
  return new Promise((resolver, rechazar) => {
    pendientes.push({ usuarioId, fn, tiempos, llegada: performance.now(), resolver: resolver as Trabajo['resolver'], rechazar })
    if (!procesando) void procesarPendientes()
  })
}

async function procesarPendientes() {
  procesando = true
  try {
    while (pendientes.length) await ejecutarLote(pendientes.splice(0, LOTE_MAXIMO))
  } finally {
    procesando = false
  }
}

async function ejecutarLote(lote: Trabajo[]) {
  const inicio = performance.now()
  for (const t of lote) if (t.tiempos) t.tiempos.cola = inicio - t.llegada
  const salidas: ({ ok: true; resultado: unknown } | { ok: false; error: unknown })[] = []
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    await c.query('SELECT pg_advisory_xact_lock(4242)') // también serializa varios servidores
    // Con la copia vigente no se relee nada; solo las cuentas si alguien que actúa aún no está (cuenta recién creada).
    // Es seguro: al guardar solo se escriben las columnas que cada acción cambió.
    let antes: Db = vigente(memoria) ? memoria.db : await cargarDb(c)
    if (lote.some((t) => t.usuarioId && !antes.usuarios.some((u) => u.id === t.usuarioId))) antes = { ...antes, usuarios: await cargarUsuarios(c) }
    // Sin copiar: cada transacción del motor trabaja sobre su propia copia y "antes" no se modifica
    motorServidor.cargar(antes, { congelar: true })
    procesarVencimientos() // vence canjes y devuelve puntos (RN15)
    aplicarRetencionFotos() // borra fotos con más días que la retención (RNF05)
    for (const t of lote) {
      const previo = motorServidor.db()
      const actual = t.usuarioId ? (previo.usuarios.find((u) => u.id === t.usuarioId) ?? null) : null
      try {
        salidas.push({ ok: true, resultado: await t.fn(actual) })
      } catch (e) {
        // Una regla de negocio (ApiError) rechazó la acción: no se aplicó nada de ella, pero sí se guardan
        // los efectos previos que la regla registra a propósito (por ejemplo, alertas antifraude).
        // Cualquier otro error deshace por completo esa acción, sin afectar a las demás del lote.
        if (!(e instanceof ApiError)) motorServidor.cargar(previo, { congelar: true })
        salidas.push({ ok: false, error: e })
      }
    }
    const despues = motorServidor.db()
    await guardarCambios(c, antes, despues)
    // RNF13: un cambio de rol o un bloqueo revoca los equipos de confianza de esa cuenta
    if (despues.usuarios !== antes.usuarios) {
      const previos = new Map(antes.usuarios.map((u) => [u.id, u]))
      const afectados = despues.usuarios.filter((u) => {
        const p = previos.get(u.id)
        return p && (p.rol !== u.rol || (!p.bloqueado && u.bloqueado))
      })
      await auth.olvidarEquipos(c, afectados.map((u) => u.id))
    }
    await c.query('COMMIT')
    recordar(despues)
    // RF23: las notificaciones nuevas salen también como push (sin hacer esperar la respuesta)
    push.enviarNuevasEnSegundoPlano(antes, despues)
    if (despues.correos.length > antes.correos.length) avisarCartero()
    const fin = performance.now()
    lote.forEach((t, i) => {
      if (t.tiempos) t.tiempos.base = fin - inicio
      const s = salidas[i]
      if (s.ok) t.resolver({ resultado: s.resultado, db: despues })
      else t.rechazar(s.error)
    })
  } catch (e) {
    // Falló el guardado: no se confirmó nada del lote y la copia en memoria sigue igual a la base
    await c.query('ROLLBACK').catch(() => {})
    for (const t of lote) t.rechazar(e)
  } finally {
    c.release()
  }
}

// Acciones cuyos datos se revisan antes de ejecutarlas (RNF04)
const PREPARAR: Partial<Record<NombreAccion, (args: unknown[]) => unknown[]>> = {
  registrarReciclaje: ([d]) => [datosReciclaje(d)],
}

// Quién ejecuta la acción lo decide la sesión, nunca el navegador
const ACCIONES: Record<NombreAccion, (yo: Usuario, args: unknown[]) => unknown> = {
  guardarPunto: (yo, [, d]) => accionesLocales.guardarPunto(yo.id, d as never),
  actualizarCategoria: (yo, [, id, c]) => accionesLocales.actualizarCategoria(yo.id, id as string, c as never),
  actualizarConfig: (yo, [, c]) => accionesLocales.actualizarConfig(yo.id, c as never),
  // Los datos ya llegan validados por PREPARAR (fuera de la fila de escrituras)
  registrarReciclaje: (yo, [d]) => accionesLocales.registrarReciclaje({ ...(d as ReturnType<typeof datosReciclaje>), usuarioId: yo.id }),
  cerrarLote: (yo, [, p, dec, ind]) => accionesLocales.cerrarLote(yo.id, p as string, dec as never, !!ind),
  guardarRecompensa: (yo, [, d]) => accionesLocales.guardarRecompensa(yo.id, d as never),
  crearCanje: (yo, [, rw, k]) => accionesLocales.crearCanje(yo.id, rw as string, k as string),
  cancelarCanje: (yo, [, id]) => accionesLocales.cancelarCanje(yo.id, id as string),
  entregarCanje: (yo, [, codigo]) => accionesLocales.entregarCanje(yo.id, codigo as string),
  cambiarRol: (yo, [, u, rol]) => accionesLocales.cambiarRol(yo.id, u as string, rol as never),
  cambiarBloqueo: (yo, [, u, b, m]) => accionesLocales.cambiarBloqueo(yo.id, u as string, !!b, m as string),
  crearAjuste: (yo, [, u, p, m]) => accionesLocales.crearAjuste(yo.id, u as string, Number(p), m as string),
  crearAsignacion: (yo, [, d]) => accionesLocales.crearAsignacion(yo.id, d as never),
  desactivarAsignacion: (yo, [, id]) => accionesLocales.desactivarAsignacion(yo.id, id as string),
  marcarNotificacionesLeidas: (yo) => accionesLocales.marcarNotificacionesLeidas(yo.id),
  realizarSorteo: (yo, [, id]) => accionesLocales.realizarSorteo(yo.id, id as string),
  crearCategoria: (yo, [, d]) => accionesLocales.crearCategoria(yo.id, d as never),
  eliminarCategoria: (yo, [, id]) => accionesLocales.eliminarCategoria(yo.id, id as string),
  reactivarCategoria: (yo, [, id]) => accionesLocales.reactivarCategoria(yo.id, id as string),
  resolverAlerta: (yo, [, id, e, r]) => accionesLocales.resolverAlerta(yo.id, id as string, e as never, r as string),
  cambiarAnonimatoRanking: (yo, [, b]) => accionesLocales.cambiarAnonimatoRanking(yo.id, !!b),
  guardarInstitucion: (yo, [, d]) => accionesLocales.guardarInstitucion(yo.id, d as never),
}
// El primer argumento que manda el navegador (el id de quien actúa) se ignora: se usa el de la sesión.
// registrarReciclaje lleva el usuario dentro de los datos y también se reemplaza.

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------
const api = express.Router()

api.get('/salud', async (_req, res) => {
  const { rows } = await pool.query('SELECT version() AS v')
  res.json({ ok: true, postgres: String(rows[0].v).split(',')[0], correoReal: correoActivo(), correoDemoReal: correoActivo() && destinoDemostracion() !== null })
})

// Datos de la página: lectura sin bloqueo desde la copia en memoria
api.get('/estado', async (req, res) => {
  const id = await auth.usuarioDeToken(tokenDe(req))
  if (tokenDe(req) && !id) return void res.status(401).json({ error: 'Tu sesión expiró. Vuelve a iniciar sesión.' })
  let m = await leerParaConsulta()
  if (id && !derivados(m).indices.usuarios.has(id)) {
    // Cuenta recién creada o verificada: se relee la base
    olvidarMemoria()
    m = await leerParaConsulta()
  }
  const { rankings, resumen, indices } = derivados(m)
  const yo = id ? (indices.usuarios.get(id) ?? null) : null
  res.json({ db: vistaPara(m.db, yo, rankings, resumen, indices) })
})

// Foto de un reciclaje, solo para quien tiene permiso de verla (RNF05)
api.get('/foto/:id', async (req, res) => {
  const id = await auth.usuarioDeToken(tokenDe(req))
  if (!id) return void res.status(401).json({ error: 'Inicia sesión para continuar.' })
  const m = await leerParaConsulta()
  const yo = m.db.usuarios.find((u) => u.id === id)
  const r = m.db.reciclajes.find((x) => x.id === req.params.id)
  if (!yo || !r) return void res.status(404).json({ error: 'No encontrado.' })
  if (!puedeVerFoto(m.db, yo, r)) return void res.status(403).json({ error: 'No tienes permiso para ver esta foto.' })
  const foto = r.foto ? await leerFoto(r.id) : ''
  if (!foto || foto === FOTO_REMOTA)
    return void res.status(404).json({
      error: 'La foto ya fue eliminada por la política de privacidad.',
    })
  res.set('Cache-Control', 'private, max-age=3600')
  res.json({ foto })
})

// Acciones por IP y minuto (RNF04). Configurable para pruebas de carga, donde todos los usuarios salen de una sola IP.
const LIMITE_ACCIONES = Number(process.env.LIMITE_ACCIONES ?? 120)
api.post('/accion/:nombre', limite(LIMITE_ACCIONES, 60_000), async (req, res) => {
  const nombre = req.params.nombre as NombreAccion
  const accion = ACCIONES[nombre]
  if (!accion) return void res.status(404).json({ error: 'Acción desconocida.' })
  const id = await auth.usuarioDeToken(tokenDe(req))
  if (!id) return void res.status(401).json({ error: 'Inicia sesión para continuar.' })
  const crudos = Array.isArray(req.body?.args) ? (req.body.args as unknown[]) : []
  // Validación de tipos, largos y archivos antes de entrar a la fila de escrituras (RNF04)
  const args = PREPARAR[nombre]?.(crudos) ?? crudos
  const t = { inicio: performance.now() } as Record<string, number>
  const { resultado, db } = await conBase(
    id,
    (yo) => {
      if (!yo) throw new ErrorHttp(401, 'Inicia sesión para continuar.')
      return accion(yo, args)
    },
    t,
  )
  const antesVista = performance.now()
  // Se responde con la copia en memoria más reciente: ya incluye esta acción y, si mientras tanto
  // se guardaron otras, también esas. Así no se recalcula el ranking en cada respuesta (RNF09).
  const m = memoria ?? { db, leidaEn: Date.now() }
  const { rankings, resumen, indices } = derivados(m)
  const yo = indices.usuarios.get(id) ?? null
  const vista = vistaPara(m.db, yo, rankings, resumen, indices)
  // Server-Timing: el navegador (y la prueba de carga) ven en qué se fue el tiempo (RNF02)
  const ms = (n = 0) => n.toFixed(1)
  res.set('Server-Timing', `auth;dur=${ms(t.inicio - inicioSolicitud(req))}, cola;dur=${ms(t.cola)}, base;dur=${ms(t.base)}, vista;dur=${ms(performance.now() - antesVista)}`)
  res.json({ resultado, db: vista })
})

// RNF05: el titular elimina su cuenta confirmando su contraseña; los datos se anonimizan
// RF23 – Notificaciones push: clave pública, suscribir y cancelar este dispositivo
api.get('/push/clave', (_req, res) => void res.json({ clave: push.clavesVapid().publica }))
api.post('/push/suscribir', limite(30, 60_000), async (req, res) => {
  const id = await auth.usuarioDeToken(tokenDe(req))
  if (!id) return void res.status(401).json({ error: 'Inicia sesión para continuar.' })
  try {
    await push.guardarSuscripcion(id, req.body?.suscripcion, req.headers['user-agent'])
  } catch {
    return void res.status(400).json({ error: 'La suscripción del navegador no es válida.' })
  }
  res.json({ activo: true })
})
api.post('/push/cancelar', async (req, res) => {
  const id = await auth.usuarioDeToken(tokenDe(req))
  if (id) await push.borrarSuscripcion(id, req.body?.endpoint)
  res.json({ activo: false })
})
api.post('/push/prueba', limite(5, 60_000), async (req, res) => {
  const id = await auth.usuarioDeToken(tokenDe(req))
  if (!id) return void res.status(401).json({ error: 'Inicia sesión para continuar.' })
  const entregados = await push.enviarA(id, { titulo: 'EcoSmart AI', mensaje: '¡Listo! Así te llegarán los avisos de tus reciclajes y canjes.', url: '#/' })
  res.json({ entregados })
})

api.post('/cuenta/eliminar', limite(10, 60_000), async (req, res) => {
  const id = await auth.usuarioDeToken(tokenDe(req))
  if (!id) return void res.status(401).json({ error: 'Inicia sesión para continuar.' })
  await auth.comprobarPassword(id, req.body?.password)
  await conBase(id, (yo) => {
    if (!yo) throw new ErrorHttp(401, 'Inicia sesión para continuar.')
    return eliminarCuentaLocal(yo.id)
  })
  await auth.invalidarCredenciales(id)
  await push.borrarSuscripcionesDe(id)
  res.json({ eliminada: true })
})

// Límite de intentos solo en las rutas que se pueden usar para adivinar claves o códigos.
// Cerrar sesión nunca se limita.
const LIMITE_AUTH = Number(process.env.LIMITE_AUTH ?? 20)
const limiteAuth = limite(LIMITE_AUTH, 60_000)
const rutasAuth = express.Router()
rutasAuth.use((req, res, next) => (req.path === '/logout' ? next() : limiteAuth(req, res, next)))
rutasAuth.post('/registro', async (req, res) => void res.json(await auth.registrar(req.body)))
rutasAuth.post('/reenviar', async (req, res) => void res.json(await auth.reenviarVerificacion(req.body?.correo)))
rutasAuth.post('/verificar', async (req, res) => void res.json(await auth.verificarCorreo(req.body?.token)))
rutasAuth.post('/login', async (req, res) => void res.json(await auth.iniciarSesion(req.body?.correo, req.body?.password, req.body?.equipo)))
rutasAuth.post('/segundo-factor', async (req, res) => void res.json(await auth.verificarSegundoFactor(req.body?.usuarioId, req.body?.codigo, req.headers['user-agent'])))
rutasAuth.post('/recuperar', async (req, res) => void res.json(await auth.solicitarRestablecimiento(req.body?.correo)))
rutasAuth.post('/restablecer', async (req, res) => void res.json(await auth.restablecerPassword(req.body?.correo, req.body?.codigo, req.body?.password)))
rutasAuth.post('/logout', async (req, res) => {
  const id = await auth.usuarioDeToken(tokenDe(req))
  if (id) await auth.cerrarSesion(id)
  res.json({})
})
api.use('/auth', rutasAuth)

// Bandeja de demostración. Con correo real activo solo muestra los correos de las cuentas de
// demostración (sin buzón real): los de personas reales llevan códigos y enlaces personales.
if (BANDEJA_DEMO)
  api.get('/correos', async (_req, res) => {
    const correos = await auth.bandejaSimulada()
    // Si además los de demostración van al buzón del proyecto, la bandeja queda vacía
    const visibles = !correoActivo() ? correos : destinoDemostracion() ? [] : correos.filter((c: { para: string }) => esCorreoDeDemostracion(c.para))
    res.json({ correos: visibles })
  })

// Las respuestas de la API son personales: no se guardan en cachés intermedias ni se muestran dentro de otra página
app.use('/api', (_req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" })
  next()
})
app.use('/api', api)

// Errores: mensajes de negocio para el usuario; detalles técnicos solo en la consola.
// Nunca se imprime el error completo: el de JSON mal formado trae el cuerpo de la petición,
// que puede contener contraseñas o tokens (RNF04: "no registran secretos en logs").
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  void _next
  if (err instanceof ErrorHttp) return void res.status(err.estado).json({ error: err.message })
  const tipo = (err as { type?: string })?.type
  if (tipo === 'entity.parse.failed') return void res.status(400).json({ error: 'La solicitud no tiene un formato válido.' })
  if (tipo === 'entity.too.large') return void res.status(413).json({ error: 'La solicitud es demasiado grande (la foto supera el tamaño permitido).' })
  if (err instanceof ApiError) return void res.status(400).json({ error: err.message })
  const pgErr = err as { code?: string; message?: string }
  if (pgErr?.code === 'P0001' || pgErr?.code === '23505' || pgErr?.code === '23514') {
    // Reglas que hace cumplir la propia base de datos (triggers, únicos, checks)
    console.warn('[regla de BD]', pgErr.message)
    return void res.status(409).json({ error: 'La operación no cumple una regla de la base de datos: ' + pgErr.message })
  }
  console.error('[error]', err instanceof Error ? (err.stack ?? err.message) : 'error desconocido')
  res.status(500).json({ error: 'Error interno del servidor.' })
})

// En producción, el mismo servidor entrega la página compilada (npm run build:bd)
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
// Política de contenido de la página (RNF04): solo código propio; la IA descarga su motor
// WebAssembly de jsDelivr y el modelo CLIP de Hugging Face (que redirige a *.hf.co).
export const POLITICA_CONTENIDO = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net",
  "worker-src 'self' blob:",
  "connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')
if (existsSync(raiz)) {
  app.use((_req, res, next) => {
    res.set('Content-Security-Policy', POLITICA_CONTENIDO)
    next()
  })
  app.use(express.static(raiz))
}

// ---------------------------------------------------------------------------
// Mantenimiento periódico: vence canjes y aplica la retención de fotos aunque nadie
// haga acciones (antes ocurría en cada consulta, lo que las obligaba a esperar en fila)
// ---------------------------------------------------------------------------
const MANTENIMIENTO_MS = Number(process.env.MANTENIMIENTO_MS ?? 60_000)
if (MANTENIMIENTO_MS > 0) {
  setInterval(() => {
    conBase(null, () => null).catch((e) => console.warn('[mantenimiento]', (e as Error).message))
  }, MANTENIMIENTO_MS).unref()
}
