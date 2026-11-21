// Aplicación Express de EcoSmart AI (API REST sobre PostgreSQL). La arranca server/index.ts
// y la usan las pruebas de integración.
// Las reglas de negocio son las mismas de la aplicación (src/data/store.ts): el servidor
// carga la base, ejecuta la acción y guarda las diferencias en una sola transacción.
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { accionesLocales, ApiError, aplicarRetencionFotos, eliminarCuentaLocal, motorServidor, procesarVencimientos } from '../src/data/store'
import type { NombreAccion } from '../src/data/store'
import type { Db, Usuario } from '../src/data/types'
import { cargarDb, guardarCambios, pool } from './db'
export { pool }
import { vistaPara } from './vista'
import * as auth from './auth'
import { ErrorHttp } from './auth'

const BANDEJA_DEMO = process.env.BANDEJA_DEMO !== '0' // bandeja de correo simulada (solo para demostración)

export const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '2mb' })) // las fotos viajan como imagen comprimida

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
// Ejecución de acciones: una a la vez y dentro de una transacción
// ---------------------------------------------------------------------------
let cola: Promise<unknown> = Promise.resolve()
function enSerie<T>(fn: () => Promise<T>): Promise<T> {
  const r = cola.then(fn, fn)
  cola = r.catch(() => {})
  return r
}

async function conBase<T>(usuarioId: string | null, fn: (actual: Usuario | null) => T): Promise<{ resultado: T; db: Db }> {
  return enSerie(async () => {
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      await c.query('SELECT pg_advisory_xact_lock(4242)') // también serializa varios servidores
      const antes = await cargarDb(c)
      motorServidor.cargar(structuredClone(antes))
      procesarVencimientos() // vence canjes y devuelve puntos (RN15)
      aplicarRetencionFotos() // borra fotos con más días que la retención (RNF05)
      const actual = usuarioId ? (motorServidor.db().usuarios.find((u) => u.id === usuarioId) ?? null) : null
      let resultado: T
      try {
        resultado = await fn(actual)
      } catch (e) {
        // Una regla de negocio rechazó la acción: no se aplicó nada de ella, pero sí se guardan
        // los efectos previos que la regla registra a propósito (por ejemplo, alertas antifraude).
        if (e instanceof ApiError) {
          await guardarCambios(c, antes, motorServidor.db())
          await c.query('COMMIT')
        }
        throw e
      }
      const despues = motorServidor.db()
      await guardarCambios(c, antes, despues)
      await c.query('COMMIT')
      return { resultado, db: despues }
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      c.release()
    }
  })
}

// Quién ejecuta la acción lo decide la sesión, nunca el navegador
const ACCIONES: Record<NombreAccion, (yo: Usuario, args: unknown[]) => unknown> = {
  guardarPunto: (yo, [, d]) => accionesLocales.guardarPunto(yo.id, d as never),
  actualizarCategoria: (yo, [, id, c]) => accionesLocales.actualizarCategoria(yo.id, id as string, c as never),
  actualizarConfig: (yo, [, c]) => accionesLocales.actualizarConfig(yo.id, c as never),
  registrarReciclaje: (yo, [d]) => accionesLocales.registrarReciclaje({ ...(d as object), usuarioId: yo.id } as never),
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
  res.json({ ok: true, postgres: String(rows[0].v).split(',')[0] })
})

api.get('/estado', async (req, res) => {
  const id = await auth.usuarioDeToken(tokenDe(req))
  if (tokenDe(req) && !id) return void res.status(401).json({ error: 'Tu sesión expiró. Vuelve a iniciar sesión.' })
  const { resultado: yo, db } = await conBase(id, (actual) => actual)
  res.json({ db: vistaPara(db, yo) })
})

api.post('/accion/:nombre', limite(120, 60_000), async (req, res) => {
  const nombre = req.params.nombre as NombreAccion
  const accion = ACCIONES[nombre]
  if (!accion) return void res.status(404).json({ error: 'Acción desconocida.' })
  const id = await auth.usuarioDeToken(tokenDe(req))
  if (!id) return void res.status(401).json({ error: 'Inicia sesión para continuar.' })
  const args = Array.isArray(req.body?.args) ? (req.body.args as unknown[]) : []
  const { resultado, db } = await conBase(id, (yo) => {
    if (!yo) throw new ErrorHttp(401, 'Inicia sesión para continuar.')
    return accion(yo, args)
  })
  const yo = db.usuarios.find((u) => u.id === id) ?? null
  res.json({ resultado, db: vistaPara(db, yo) })
})

// RNF05: el titular elimina su cuenta confirmando su contraseña; los datos se anonimizan
api.post('/cuenta/eliminar', limite(10, 60_000), async (req, res) => {
  const id = await auth.usuarioDeToken(tokenDe(req))
  if (!id) return void res.status(401).json({ error: 'Inicia sesión para continuar.' })
  await auth.comprobarPassword(id, req.body?.password)
  await conBase(id, (yo) => {
    if (!yo) throw new ErrorHttp(401, 'Inicia sesión para continuar.')
    return eliminarCuentaLocal(yo.id)
  })
  await auth.invalidarCredenciales(id)
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
rutasAuth.post('/login', async (req, res) => void res.json(await auth.iniciarSesion(req.body?.correo, req.body?.password)))
rutasAuth.post('/segundo-factor', async (req, res) => void res.json(await auth.verificarSegundoFactor(req.body?.usuarioId, req.body?.codigo)))
rutasAuth.post('/recuperar', async (req, res) => void res.json(await auth.solicitarRestablecimiento(req.body?.correo)))
rutasAuth.post('/restablecer', async (req, res) => void res.json(await auth.restablecerPassword(req.body?.token, req.body?.password)))
rutasAuth.post('/logout', async (req, res) => {
  const id = await auth.usuarioDeToken(tokenDe(req))
  if (id) await auth.cerrarSesion(id)
  res.json({})
})
api.use('/auth', rutasAuth)

if (BANDEJA_DEMO) api.get('/correos', async (_req, res) => void res.json({ correos: await auth.bandejaSimulada() }))

app.use('/api', api)

// Errores: mensajes de negocio para el usuario; detalles técnicos solo en la consola
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  void _next
  if (err instanceof ErrorHttp) return void res.status(err.estado).json({ error: err.message })
  if (err instanceof ApiError) return void res.status(400).json({ error: err.message })
  const pgErr = err as { code?: string; message?: string }
  if (pgErr?.code === 'P0001' || pgErr?.code === '23505' || pgErr?.code === '23514') {
    // Reglas que hace cumplir la propia base de datos (triggers, únicos, checks)
    console.warn('[regla de BD]', pgErr.message)
    return void res.status(409).json({ error: 'La operación no cumple una regla de la base de datos: ' + pgErr.message })
  }
  console.error(err)
  res.status(500).json({ error: 'Error interno del servidor.' })
})

// En producción, el mismo servidor entrega la página compilada (npm run build:bd)
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
if (existsSync(raiz)) app.use(express.static(raiz))
