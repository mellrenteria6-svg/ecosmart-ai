// "API" simulada de EcoSmart AI. Aplica las reglas de negocio RN01–RN16 sobre
// datos guardados en el navegador (localStorage). Cada operación que modifica
// datos se ejecuta dentro de `transaccion`, que confirma todo o nada (RF14).

import { useSyncExternalStore } from 'react'
import { CATEGORIAS_SEMILLA, INSTITUCIONES_SEMILLA, crearDbSemilla } from './seed'
import type {
  AlertaFraude,
  Auditoria,
  Canje,
  CategoriaResiduo,
  Configuracion,
  Db,
  EstadoAlerta,
  Institucion,
  ElementoCola,
  MovimientoPuntos,
  PuntoReciclaje,
  Reciclaje,
  Recompensa,
  Rol,
  Sesion,
  Token,
  Usuario,
} from './types'

const MODO = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_URL ? 'srv' : 'v1'
const CLAVE_DB = `ecosmart.db.${MODO}`
const CLAVE_SESION = `ecosmart.sesion.${MODO}`
const CLAVE_COLA = `ecosmart.cola.${MODO}`
const CLAVE_OFFLINE = 'ecosmart.offline-simulado'
const HORA = 60 * 60 * 1000

export class ApiError extends Error {}

// ---------------------------------------------------------------------------
// Modo de datos
//  - local: todo vive en el navegador (demo publicada sin servidor)
//  - servidor: las acciones se ejecutan en el servidor Node contra PostgreSQL.
//    Se activa con VITE_API_URL (por ejemplo /api en desarrollo).
// ---------------------------------------------------------------------------
const API_URL: string | undefined = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_URL
export const MODO_SERVIDOR = !!API_URL

async function llamarApi<T>(ruta: string, cuerpo?: unknown, metodo = cuerpo === undefined ? 'GET' : 'POST'): Promise<T> {
  const token = snapshot.sesion?.token
  let res: Response
  try {
    res = await fetch(`${API_URL}${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    })
  } catch {
    throw new ApiError('No hay conexión con el servidor de EcoSmart AI.')
  }
  const datos = (await res.json().catch(() => ({}))) as { error?: string; db?: Db } & Record<string, unknown>
  if (res.status === 401 && snapshot.sesion) emitir({ sesion: null })
  if (!res.ok) throw new ApiError(datos.error ?? `Error del servidor (${res.status}).`)
  if (datos.db) emitir({ db: datos.db })
  return datos as T
}

/** En modo servidor, la acción se ejecuta en el servidor; en modo local, aquí mismo. */
function remoto<A extends unknown[], R>(nombre: string, local: (...args: A) => R) {
  return async (...args: A): Promise<Awaited<R>> => {
    if (!MODO_SERVIDOR) return await local(...args)
    const r = await llamarApi<{ resultado: Awaited<R> }>(`/accion/${nombre}`, { args })
    return r.resultado
  }
}

/** Descarga del servidor la vista de datos que corresponde al usuario. */
export async function refrescarDesdeServidor() {
  if (!MODO_SERVIDOR) return
  try {
    await llamarApi('/estado')
  } catch {
    // sin conexión: se sigue mostrando la copia local
  }
}

/** Uso exclusivo del servidor: carga la base leída de PostgreSQL y la devuelve tras la acción. */
export const motorServidor = {
  cargar(db: Db) {
    snapshot = { ...snapshot, db }
  },
  db: () => snapshot.db,
}

// ---------------------------------------------------------------------------
// Estado y persistencia
// ---------------------------------------------------------------------------

export interface Snapshot {
  db: Db
  sesion: Sesion | null
  cola: ElementoCola[]
  offlineSimulado: boolean
  online: boolean
}

function leer<T>(clave: string, defecto: T): T {
  try {
    const crudo = localStorage.getItem(clave)
    return crudo ? (JSON.parse(crudo) as T) : defecto
  } catch {
    return defecto
  }
}

function escribir(clave: string, valor: unknown) {
  try {
    if (valor === null) localStorage.removeItem(clave)
    else localStorage.setItem(clave, JSON.stringify(valor))
  } catch {
    // Almacenamiento lleno o bloqueado: el prototipo sigue funcionando en memoria.
  }
}

function cargarDb(): Db {
  const db = leer<Db | null>(CLAVE_DB, null)
  if (db && db.version === 2) {
    // Migración: el clasificador simulado se reemplazó por el modelo CLIP
    if (db.config.modeloVersion === 'eco-clf-1.0-sim') db.config.modeloVersion = 'clip-vit-b32-q8-zs-1.0'
    // Migración: categoría "Otros plásticos" y descripción de cada categoría
    const semilla = CATEGORIAS_SEMILLA
    semilla.forEach((c) => {
      const existente = db.categorias.find((x) => x.id === c.id)
      if (!existente) {
        db.categorias.push({ ...c })
        db.historialCategorias.push({ ...c })
        db.puntos.forEach((p) => {
          if (['p-biblioteca', 'p-cafeteria', 'p-ingenieria'].includes(p.id) && !p.categorias.includes(c.id)) p.categorias.splice(1, 0, c.id)
        })
      } else if (!existente.descripcion) existente.descripcion = c.descripcion
    })
    // Migración: varias universidades con sus dominios de correo
    if (!db.instituciones) db.instituciones = []
    INSTITUCIONES_SEMILLA.forEach((i) => {
      if (!db.instituciones.some((x) => x.id === i.id)) db.instituciones.push({ ...i, dominios: [...i.dominios] })
    })
    db.usuarios.forEach((u) => {
      if (!u.institucionId) u.institucionId = institucionPorCorreo(db, u.correo)?.id ?? db.instituciones[0].id
    })
    return db
  }
  const nueva = crearDbSemilla()
  escribir(CLAVE_DB, nueva)
  return nueva
}

const navegadorOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine)

let snapshot: Snapshot = {
  db: cargarDb(),
  sesion: leer<Sesion | null>(CLAVE_SESION, null),
  cola: leer<ElementoCola[]>(CLAVE_COLA, []),
  offlineSimulado: leer<boolean>(CLAVE_OFFLINE, false),
  online: navegadorOnline(),
}
snapshot.online = navegadorOnline() && !snapshot.offlineSimulado

const oyentes = new Set<() => void>()

function emitir(parcial: Partial<Snapshot>, dbYaGuardada = false) {
  snapshot = { ...snapshot, ...parcial }
  snapshot.online = navegadorOnline() && !snapshot.offlineSimulado
  if ('db' in parcial && !dbYaGuardada) escribir(CLAVE_DB, snapshot.db)
  if ('sesion' in parcial) escribir(CLAVE_SESION, snapshot.sesion)
  if ('cola' in parcial) escribir(CLAVE_COLA, snapshot.cola)
  if ('offlineSimulado' in parcial) escribir(CLAVE_OFFLINE, snapshot.offlineSimulado)
  oyentes.forEach((fn) => fn())
}

export function suscribir(fn: () => void) {
  oyentes.add(fn)
  return () => {
    oyentes.delete(fn)
  }
}

export function obtenerSnapshot() {
  return snapshot
}

export function useStore(): Snapshot {
  return useSyncExternalStore(suscribir, obtenerSnapshot)
}

/** Ejecuta cambios sobre una copia; si algo falla no se confirma nada. */
function transaccion<T>(fn: (d: Db) => T): T {
  const borrador = structuredClone(snapshot.db)
  const resultado = fn(borrador)
  // Se guarda antes de confirmar: si el almacenamiento está lleno no se pierde nada en silencio
  try {
    localStorage.setItem(CLAVE_DB, JSON.stringify(borrador))
  } catch (e) {
    if (e instanceof DOMException && /quota/i.test(e.name + e.message)) {
      throw new ApiError('El almacenamiento del navegador está lleno (las fotos ocupan espacio). Restablece los datos de demostración desde la pantalla de ingreso.')
    }
  }
  emitir({ db: borrador }, true)
  return resultado
}

// Otras pestañas del navegador
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === CLAVE_DB || e.key === CLAVE_SESION || e.key === CLAVE_COLA) {
      snapshot = {
        ...snapshot,
        db: cargarDb(),
        sesion: leer<Sesion | null>(CLAVE_SESION, null),
        cola: leer<ElementoCola[]>(CLAVE_COLA, []),
      }
      oyentes.forEach((fn) => fn())
    }
  })
  window.addEventListener('online', () => {
    emitir({})
    void sincronizarCola()
  })
  window.addEventListener('offline', () => emitir({}))
}

// Desarrollo: si cambia este archivo, se recarga la página completa en vez de reemplazar el
// módulo en caliente; así no quedan dos copias del estado y la sesión se conserva.
;(import.meta as { hot?: { accept: (cb: () => void) => void } }).hot?.accept(() => location.reload())

export function restablecerDemo() {
  if (MODO_SERVIDOR) return
  const nueva = crearDbSemilla()
  emitir({ db: nueva, sesion: null, cola: [] })
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Identificador único (UUID, compatible con las llaves de PostgreSQL). */
export function nuevoId(prefijo: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${prefijo}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export function nuevaClaveIdempotencia() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : nuevoId('idem')
}

function codigoAleatorio(longitud: number) {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(longitud)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join('')
}

async function hashPassword(correo: string, password: string) {
  const datos = new TextEncoder().encode(`${correo.toLowerCase()}:${password}`)
  const digest = await crypto.subtle.digest('SHA-256', datos)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function hoyIso() {
  const d = new Date()
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}

function inicioDelDia(ts = Date.now()) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function actor(d: Db, actorId: string) {
  const u = d.usuarios.find((x) => x.id === actorId)
  if (!u) throw new ApiError('Usuario no encontrado.')
  return u
}

function auditar(
  d: Db,
  actorId: string,
  accion: string,
  entidad: string,
  entidadId: string,
  detalle: string,
) {
  const u = d.usuarios.find((x) => x.id === actorId)
  const evento: Auditoria = {
    id: nuevoId('au'),
    actorId,
    actorNombre: u?.nombre ?? 'Sistema',
    accion,
    entidad,
    entidadId,
    detalle,
    creadoEn: Date.now(),
  }
  d.auditoria.push(evento) // solo se agrega, nunca se edita ni borra (RN10, RNF07)
}

function notificar(d: Db, usuarioId: string, titulo: string, mensaje: string) {
  d.notificaciones.push({
    id: nuevoId('n'),
    usuarioId,
    titulo,
    mensaje,
    leida: false,
    creadoEn: Date.now(),
  })
}

function enviarCorreo(d: Db, para: string, asunto: string, cuerpo: string, enlace?: string) {
  d.correos.push({ id: nuevoId('mail'), para, asunto, cuerpo, enlace, creadoEn: Date.now() })
}

function crearAlerta(d: Db, alerta: Omit<AlertaFraude, 'id' | 'estado' | 'creadoEn'>) {
  // RF26: la alerta solo informa; nunca sanciona automáticamente al usuario
  d.alertas.push({ ...alerta, id: nuevoId('al'), estado: 'abierta', creadoEn: Date.now() })
}

function registrarMovimiento(d: Db, mov: Omit<MovimientoPuntos, 'id' | 'creadoEn'>) {
  // Los movimientos son inmutables; las correcciones se hacen con ajustes (RN07)
  d.movimientos.push({ ...mov, id: nuevoId('m'), creadoEn: Date.now() })
}

function requiereRol(d: Db, usuarioId: string, ...roles: Rol[]) {
  const u = actor(d, usuarioId)
  if (!roles.includes(u.rol)) throw new ApiError('No tienes permiso para realizar esta acción.')
  if (u.bloqueado) throw new ApiError('Tu cuenta está bloqueada.')
  return u
}

// ---------------------------------------------------------------------------
// Saldo y consultas (RF03, RF15)
// ---------------------------------------------------------------------------

export function saldoConfirmado(d: Db, usuarioId: string) {
  return d.movimientos
    .filter((m) => m.usuarioId === usuarioId)
    .reduce((total, m) => total + m.puntos, 0)
}

export function puntosPendientes(d: Db, usuarioId: string) {
  return d.reciclajes
    .filter((r) => r.usuarioId === usuarioId && (r.estado === 'pendiente' || r.estado === 'en_revision'))
    .reduce((total, r) => total + r.puntosEstimados, 0)
}

export function registrosHoy(d: Db, usuarioId: string) {
  const inicio = inicioDelDia()
  return d.reciclajes.filter(
    (r) => r.usuarioId === usuarioId && r.creadoEn >= inicio && r.estado !== 'rechazado',
  ).length
}

export function asignacionVigente(d: Db, recolectorId: string, puntoId: string) {
  const hoy = hoyIso()
  return d.asignaciones.find(
    (a) =>
      a.recolectorId === recolectorId &&
      a.puntoId === puntoId &&
      a.activa &&
      a.desde <= hoy &&
      a.hasta >= hoy,
  )
}

export function puntosAsignados(d: Db, recolectorId: string) {
  return d.puntos.filter((p) => asignacionVigente(d, recolectorId, p.id))
}

/** Universidad a la que pertenece un correo, según su dominio exacto. */
export function institucionPorCorreo(d: Db, correo: string): Institucion | undefined {
  const dominio = correo.trim().toLowerCase().split('@')[1]
  if (!dominio) return undefined
  return d.instituciones.find((i) => i.activa && i.dominios.includes(dominio))
}

export function nombreInstitucion(d: Db, id: string) {
  return d.instituciones.find((i) => i.id === id)?.siglas ?? '—'
}

export function usuarioActual(s: Snapshot): Usuario | null {
  if (!s.sesion) return null
  const u = s.db.usuarios.find((x) => x.id === s.sesion!.usuarioId)
  if (!u || u.bloqueado || u.sesionVersion !== s.sesion.sesionVersion) return null
  return u
}

// ---------------------------------------------------------------------------
// Autenticación (RF01, RF02, RNF13)
// ---------------------------------------------------------------------------

function validarPassword(password: string) {
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new ApiError('La contraseña debe tener al menos 8 caracteres e incluir letras y números.')
  }
}

function crearToken(d: Db, usuarioId: string, tipo: Token['tipo'], minutos: number, token?: string) {
  // Un token nuevo invalida los anteriores del mismo tipo
  d.tokens.forEach((t) => {
    if (t.usuarioId === usuarioId && t.tipo === tipo) t.usado = true
  })
  const valor = token ?? codigoAleatorio(24)
  d.tokens.push({ token: valor, usuarioId, tipo, venceEn: Date.now() + minutos * 60 * 1000, usado: false })
  return valor
}

function consumirToken(d: Db, valor: string, tipo: Token['tipo'], usuarioId?: string) {
  const t = d.tokens.find((x) => x.token === valor && x.tipo === tipo && (!usuarioId || x.usuarioId === usuarioId))
  if (!t || t.usado) throw new ApiError('El enlace o código no es válido o ya fue utilizado.')
  if (t.venceEn < Date.now()) throw new ApiError('El enlace o código venció. Solicita uno nuevo.')
  t.usado = true
  return t
}

export async function registrar(datos: {
  nombre: string
  correo: string
  facultad: string
  password: string
  consentimiento: boolean
}) {
  if (MODO_SERVIDOR) return (await llamarApi<{ usuario: Usuario }>('/auth/registro', datos)).usuario
  const correo = datos.correo.trim().toLowerCase()
  if (!datos.nombre.trim()) throw new ApiError('Ingresa tu nombre.')
  // RN01 (ajustada): el correo debe pertenecer a una universidad autorizada
  const institucion = institucionPorCorreo(snapshot.db, correo)
  if (!institucion) {
    throw new ApiError('Usa el correo de una universidad participante. Si tu universidad no aparece, pide al administrador que la agregue.')
  }
  if (!datos.consentimiento) throw new ApiError('Debes aceptar el aviso de privacidad para continuar.')
  validarPassword(datos.password)
  const passwordHash = await hashPassword(correo, datos.password)
  return transaccion((d) => {
    if (d.usuarios.some((u) => u.correo === correo)) {
      throw new ApiError('Ya existe una cuenta con este correo. Inicia sesión o recupera tu contraseña.')
    }
    const usuario: Usuario = {
      id: nuevoId('u'),
      nombre: datos.nombre.trim(),
      correo,
      institucionId: institucion.id,
      facultad: datos.facultad,
      rol: 'usuario',
      passwordHash,
      verificado: false,
      bloqueado: false,
      intentosFallidos: 0,
      sesionVersion: 1,
      creadoEn: Date.now(),
      consentimientoPrivacidad: true,
    }
    d.usuarios.push(usuario)
    const token = crearToken(d, usuario.id, 'verificacion', 24 * 60)
    enviarCorreo(
      d,
      correo,
      'Verifica tu cuenta de EcoSmart AI',
      `Hola ${usuario.nombre}, confirma tu correo para empezar a reciclar. El enlace vence en 24 horas y solo puede usarse una vez.`,
      `#/verificar?token=${token}`,
    )
    return usuario
  })
}

export function reenviarVerificacion(correo: string) {
  if (MODO_SERVIDOR) return void llamarApi('/auth/reenviar', { correo }).catch(() => {})
  transaccion((d) => {
    const u = d.usuarios.find((x) => x.correo === correo.trim().toLowerCase())
    if (!u || u.verificado) return
    const token = crearToken(d, u.id, 'verificacion', 24 * 60)
    enviarCorreo(d, u.correo, 'Nuevo enlace de verificación', 'Usa este enlace para verificar tu cuenta.', `#/verificar?token=${token}`)
  })
}

export async function verificarCorreo(token: string): Promise<Usuario> {
  if (MODO_SERVIDOR) return (await llamarApi<{ usuario: Usuario }>('/auth/verificar', { token })).usuario
  return transaccion((d) => {
    const t = consumirToken(d, token, 'verificacion')
    const u = actor(d, t.usuarioId)
    u.verificado = true
    auditar(d, u.id, 'Verificar correo', 'USUARIO', u.id, u.correo)
    return u
  })
}

export type ResultadoLogin = { tipo: 'ok'; usuario: Usuario } | { tipo: 'segundo_factor'; usuarioId: string }

export async function iniciarSesion(correoIn: string, password: string): Promise<ResultadoLogin> {
  if (MODO_SERVIDOR) {
    const r = await llamarApi<ResultadoLogin & { sesion?: Sesion }>('/auth/login', { correo: correoIn, password })
    if (r.sesion) {
      emitir({ sesion: r.sesion })
      await refrescarDesdeServidor()
    }
    return r.tipo === 'ok' ? { tipo: 'ok', usuario: snapshot.db.usuarios.find((u) => u.id === r.sesion!.usuarioId)! } : r
  }
  const correo = correoIn.trim().toLowerCase()
  const hash = await hashPassword(correo, password)
  // Los intentos fallidos se guardan aunque el login falle, por eso el error se devuelve y no se lanza.
  const resultado = transaccion<ResultadoLogin | { error: string }>((d) => {
    const u = d.usuarios.find((x) => x.correo === correo)
    if (!u) return { error: 'Correo o contraseña incorrectos.' }
    if (u.bloqueoTemporalHasta && u.bloqueoTemporalHasta > Date.now()) {
      const min = Math.ceil((u.bloqueoTemporalHasta - Date.now()) / 60000)
      return { error: `Cuenta bloqueada temporalmente por intentos fallidos. Intenta en ${min} min.` }
    }
    if (u.passwordHash !== hash) {
      u.intentosFallidos += 1
      if (u.intentosFallidos >= 5) {
        u.bloqueoTemporalHasta = Date.now() + 15 * 60 * 1000
        u.intentosFallidos = 0
        auditar(d, u.id, 'Bloqueo temporal por intentos fallidos', 'USUARIO', u.id, '5 intentos fallidos')
        return { error: 'Cinco intentos fallidos: la cuenta queda bloqueada 15 minutos.' }
      }
      return { error: 'Correo o contraseña incorrectos.' }
    }
    if (u.bloqueado) return { error: 'Tu cuenta está bloqueada. Comunícate con el administrador.' }
    if (!u.verificado) return { error: 'Verifica tu correo institucional antes de iniciar sesión.' }
    u.intentosFallidos = 0
    u.bloqueoTemporalHasta = undefined
    if (u.rol === 'admin' || u.rol === 'aliado') {
      const codigo = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000))
      crearToken(d, u.id, 'segundo_factor', 10, codigo)
      enviarCorreo(d, u.correo, 'Código de acceso EcoSmart AI', `Tu código de segundo factor es ${codigo}. Vence en 10 minutos.`)
      return { tipo: 'segundo_factor', usuarioId: u.id }
    }
    return { tipo: 'ok', usuario: u }
  })
  if ('error' in resultado) throw new ApiError(resultado.error)
  if (resultado.tipo === 'ok') {
    emitir({ sesion: { usuarioId: resultado.usuario.id, sesionVersion: resultado.usuario.sesionVersion, creadaEn: Date.now() } })
  }
  return resultado
}

export async function verificarSegundoFactor(usuarioId: string, codigo: string): Promise<Usuario> {
  if (MODO_SERVIDOR) {
    const r = await llamarApi<{ sesion: Sesion }>('/auth/segundo-factor', { usuarioId, codigo })
    emitir({ sesion: r.sesion })
    await refrescarDesdeServidor()
    return snapshot.db.usuarios.find((u) => u.id === r.sesion.usuarioId)!
  }
  const u = transaccion((d) => {
    consumirToken(d, codigo.trim(), 'segundo_factor', usuarioId)
    const usuario = actor(d, usuarioId)
    auditar(d, usuario.id, 'Inicio de sesión con segundo factor', 'USUARIO', usuario.id, '')
    return usuario
  })
  emitir({ sesion: { usuarioId: u.id, sesionVersion: u.sesionVersion, creadaEn: Date.now() } })
  return u
}

export function cerrarSesion() {
  const s = snapshot.sesion
  if (MODO_SERVIDOR) {
    if (s) void llamarApi('/auth/logout', {}).catch(() => {})
    emitir({ sesion: null })
    void refrescarDesdeServidor()
    return
  }
  if (s) {
    transaccion((d) => {
      const u = d.usuarios.find((x) => x.id === s.usuarioId)
      if (u) u.sesionVersion += 1 // revoca los tokens anteriores
    })
  }
  emitir({ sesion: null })
}

export function solicitarRestablecimiento(correoIn: string) {
  if (MODO_SERVIDOR) return void llamarApi('/auth/recuperar', { correo: correoIn }).catch(() => {})
  const correo = correoIn.trim().toLowerCase()
  transaccion((d) => {
    const u = d.usuarios.find((x) => x.correo === correo)
    if (!u) return // respuesta genérica: no revela si el correo existe
    const token = crearToken(d, u.id, 'restablecer', 60)
    enviarCorreo(d, u.correo, 'Restablece tu contraseña', 'Recibimos una solicitud para cambiar tu contraseña. El enlace vence en 60 minutos.', `#/restablecer?token=${token}`)
  })
}

export async function restablecerPassword(token: string, password: string) {
  validarPassword(password)
  if (MODO_SERVIDOR) {
    await llamarApi('/auth/restablecer', { token, password })
    emitir({ sesion: null })
    return
  }
  const t = snapshot.db.tokens.find((x) => x.token === token && x.tipo === 'restablecer')
  const u = t && snapshot.db.usuarios.find((x) => x.id === t.usuarioId)
  if (!t || !u) throw new ApiError('El enlace no es válido.')
  const hash = await hashPassword(u.correo, password)
  transaccion((d) => {
    consumirToken(d, token, 'restablecer')
    const usuario = actor(d, u.id)
    usuario.passwordHash = hash
    usuario.sesionVersion += 1
    usuario.intentosFallidos = 0
    usuario.bloqueoTemporalHasta = undefined
    auditar(d, usuario.id, 'Restablecer contraseña', 'USUARIO', usuario.id, 'Sesiones anteriores revocadas')
  })
  if (snapshot.sesion?.usuarioId === u.id) emitir({ sesion: null })
}

// ---------------------------------------------------------------------------
// Puntos de reciclaje (RF04–RF07)
// ---------------------------------------------------------------------------

export function puntoPorCodigo(codigoIn: string) {
  const codigo = codigoIn.trim().toUpperCase()
  if (!codigo) throw new ApiError('Ingresa el código impreso en el punto de reciclaje.')
  const p = snapshot.db.puntos.find((x) => x.codigoQr === codigo)
  if (!p || !p.visible) {
    throw new ApiError('El código no corresponde a ningún punto. Revisa que esté escrito como aparece bajo el QR (por ejemplo ECO-BIB-01).')
  }
  if (p.estado !== 'activo') {
    const estado = p.estado === 'mantenimiento' ? 'en mantenimiento' : 'inactivo'
    throw new ApiError(`El punto "${p.nombre}" está ${estado} y no recibe reciclajes. Consulta el mapa para encontrar otro punto activo.`)
  }
  return p
}

function guardarPunto__local(adminId: string, datos: Omit<PuntoReciclaje, 'id' | 'codigoQr'> & { id?: string }) {
  return transaccion((d) => {
    requiereRol(d, adminId, 'admin')
    if (!datos.nombre.trim()) throw new ApiError('El punto necesita un nombre.')
    if (datos.categorias.length === 0) throw new ApiError('Selecciona al menos una categoría aceptada.')
    if (datos.id) {
      const p = d.puntos.find((x) => x.id === datos.id)
      if (!p) throw new ApiError('Punto no encontrado.')
      const antes = `${p.estado}, ${p.categorias.length} categorías`
      Object.assign(p, { ...datos, id: p.id, codigoQr: p.codigoQr })
      auditar(d, adminId, 'Actualizar punto de reciclaje', 'PUNTO_RECICLAJE', p.id, `${p.nombre}: ${antes} → ${p.estado}, ${p.categorias.length} categorías`)
      return p
    }
    const prefijo = datos.nombre
      .normalize('NFD')
      .replace(/[^A-Za-z]/g, '')
      .slice(0, 3)
      .toUpperCase()
      .padEnd(3, 'X')
    let codigo: string
    let n = d.puntos.length + 1
    do {
      codigo = `ECO-${prefijo}-${String(n).padStart(2, '0')}`
      n += 1
    } while (d.puntos.some((x) => x.codigoQr === codigo))
    const punto: PuntoReciclaje = { ...datos, id: nuevoId('p'), codigoQr: codigo }
    d.puntos.push(punto)
    auditar(d, adminId, 'Crear punto de reciclaje', 'PUNTO_RECICLAJE', punto.id, `${punto.nombre} (${codigo})`)
    return punto
  })
}

// ---------------------------------------------------------------------------
// Categorías y configuración (RF16, RF29)
// ---------------------------------------------------------------------------

function actualizarCategoria__local(adminId: string, id: string, cambiosIn: Pick<CategoriaResiduo, 'unidad' | 'puntosPorUnidad' | 'minimo' | 'maximo' | 'descripcion'>) {
  const { unidad, puntosPorUnidad, minimo, maximo, descripcion } = cambiosIn
  const cambios = { unidad, puntosPorUnidad, minimo, maximo, descripcion: descripcion?.trim() || undefined }
  return transaccion((d) => {
    requiereRol(d, adminId, 'admin')
    const c = d.categorias.find((x) => x.id === id)
    if (!c) throw new ApiError('Categoría no encontrada.')
    if (!cambios.unidad.trim()) throw new ApiError('Define la unidad de medida.')
    if (!(cambios.puntosPorUnidad > 0)) throw new ApiError('Los puntos por unidad deben ser mayores que cero.')
    if (!(cambios.minimo > 0) || cambios.maximo < cambios.minimo) throw new ApiError('Los límites no son coherentes.')
    const antes = `${c.puntosPorUnidad} pts/${c.unidad}, ${c.minimo}-${c.maximo}`
    Object.assign(c, cambios, { version: c.version + 1 })
    d.historialCategorias.push({ ...c })
    auditar(d, adminId, `Versionar categoría (v${c.version})`, 'CATEGORIA_RESIDUO', c.id, `${c.nombre}: ${antes} → ${c.puntosPorUnidad} pts/${c.unidad}, ${c.minimo}-${c.maximo}`)
    return c
  })
}

function actualizarConfig__local(adminId: string, cambios: Partial<Configuracion>) {
  return transaccion((d) => {
    requiereRol(d, adminId, 'admin')
    if (cambios.topeDiario !== undefined && !(cambios.topeDiario >= 1)) throw new ApiError('El tope diario debe ser al menos 1.')
    if (cambios.umbralConfianza !== undefined && !(cambios.umbralConfianza > 0 && cambios.umbralConfianza < 1)) throw new ApiError('El umbral debe estar entre 1 % y 99 %.')
    if (cambios.horasVencimientoCanje !== undefined && !(cambios.horasVencimientoCanje >= 1)) throw new ApiError('El vencimiento debe ser al menos 1 hora.')
    const detalle = Object.entries(cambios)
      .map(([k, v]) => `${k}: ${String(d.config[k as keyof Configuracion])} → ${String(v)}`)
      .join('; ')
    Object.assign(d.config, cambios)
    auditar(d, adminId, 'Actualizar configuración', 'CONFIGURACION', 'config', detalle)
  })
}

// ---------------------------------------------------------------------------
// Reciclaje (RF08–RF11, RF30)
// ---------------------------------------------------------------------------

function distanciaHamming(a: string, b: string) {
  if (a.length !== 16 || b.length !== 16) return 64
  let dist = 0
  for (let i = 0; i < 16; i += 1) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) {
      dist += x & 1
      x >>= 1
    }
  }
  return dist
}

export interface DatosReciclaje {
  idempotencyKey: string
  usuarioId: string
  codigoPunto: string
  categoriaId: string
  categoriaIa: string
  confianzaIa: number
  modeloVersion: string
  cantidad: number
  foto: string
  fotoHash: string
  creadoEn?: number
}

function registrarReciclaje__local(datos: DatosReciclaje): { reciclaje: Reciclaje; repetido: boolean } {
  // Idempotencia: la misma clave devuelve el mismo resultado (RNF03, RN16)
  const existente = snapshot.db.reciclajes.find((r) => r.idempotencyKey === datos.idempotencyKey)
  if (existente) return { reciclaje: existente, repetido: true }

  // Fotos duplicadas o casi idénticas (RN05). Se revisa antes para poder dejar la alerta (RF26).
  const limiteFotos = Date.now() - snapshot.db.config.diasRetencionFotos * 24 * HORA
  const repetida = snapshot.db.reciclajes.find(
    (r) => r.creadoEn >= limiteFotos && distanciaHamming(r.fotoHash, datos.fotoHash) <= 5,
  )
  if (repetida) {
    transaccion((d) =>
      crearAlerta(d, {
        regla: 'Foto duplicada',
        evidencia: `Intentó registrar una foto igual o casi idéntica a la de un reciclaje ${repetida.usuarioId === datos.usuarioId ? 'suyo' : 'de otro usuario'} del ${new Date(repetida.creadoEn).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' })} en ${d.puntos.find((p) => p.id === repetida.puntoId)?.nombre ?? 'otro punto'}.`,
        usuarioId: datos.usuarioId,
        reciclajeId: repetida.id,
      }),
    )
    throw new ApiError('Esta foto es igual o casi idéntica a una ya registrada. Toma una nueva fotografía del residuo.')
  }

  return transaccion((d) => {
    const u = requiereRol(d, datos.usuarioId, 'usuario')
    if (!u.verificado) throw new ApiError('Verifica tu correo antes de reciclar.')
    const punto = d.puntos.find((p) => p.codigoQr === datos.codigoPunto.trim().toUpperCase())
    if (!punto || !punto.visible) throw new ApiError('El punto de reciclaje ya no existe.')
    if (punto.estado !== 'activo') throw new ApiError(`El punto "${punto.nombre}" no está activo en este momento.`)
    const cat = d.categorias.find((c) => c.id === datos.categoriaId)
    if (!cat || !cat.activa) throw new ApiError('Categoría no válida o desactivada.')
    if (!punto.categorias.includes(cat.id)) {
      throw new ApiError(`El punto "${punto.nombre}" no acepta ${cat.nombre}.`)
    }
    if (!(datos.cantidad >= cat.minimo && datos.cantidad <= cat.maximo)) {
      throw new ApiError(`La cantidad de ${cat.nombre} debe estar entre ${cat.minimo} y ${cat.maximo} ${cat.unidad}.`)
    }
    // Tope diario (RN05)
    const inicio = inicioDelDia()
    const hoy = d.reciclajes.filter((r) => r.usuarioId === u.id && r.creadoEn >= inicio && r.estado !== 'rechazado').length
    if (hoy >= d.config.topeDiario) {
      throw new ApiError(`Alcanzaste el tope diario de ${d.config.topeDiario} registros. Podrás reciclar de nuevo mañana.`)
    }
    const corregido = datos.categoriaId !== datos.categoriaIa
    const baja = datos.confianzaIa < d.config.umbralConfianza
    const motivos = [corregido && 'categoría corregida por el usuario', baja && `confianza de la IA menor a ${Math.round(d.config.umbralConfianza * 100)} %`].filter(Boolean)

    const reciclaje: Reciclaje = {
      id: nuevoId('r'),
      idempotencyKey: datos.idempotencyKey,
      usuarioId: u.id,
      puntoId: punto.id,
      categoriaId: cat.id,
      categoriaIa: datos.categoriaIa,
      confianzaIa: datos.confianzaIa,
      modeloVersion: datos.modeloVersion,
      corregidoPorUsuario: corregido,
      cantidadReportada: datos.cantidad,
      unidad: cat.unidad,
      puntosPorUnidad: cat.puntosPorUnidad,
      categoriaVersion: cat.version,
      puntosEstimados: Math.round(datos.cantidad * cat.puntosPorUnidad),
      estado: motivos.length ? 'en_revision' : 'pendiente',
      motivoRevision: motivos.length ? motivos.join(' y ') : undefined,
      foto: datos.foto,
      fotoHash: datos.fotoHash,
      creadoEn: datos.creadoEn ?? Date.now(),
    }
    d.reciclajes.push(reciclaje)
    // Reglas antifraude (RF26)
    const recientes = d.reciclajes.filter((r) => r.usuarioId === u.id && r.creadoEn >= Date.now() - 10 * 60 * 1000)
    if (recientes.length >= 3) {
      crearAlerta(d, { regla: 'Ráfaga de registros', evidencia: `${recientes.length} registros en menos de 10 minutos en ${punto.nombre}.`, usuarioId: u.id, reciclajeId: reciclaje.id })
    }
    if (datos.cantidad >= cat.maximo) {
      crearAlerta(d, { regla: 'Cantidad en el máximo permitido', evidencia: `Reportó ${datos.cantidad} ${cat.unidad} de ${cat.nombre}, el máximo de la categoría.`, usuarioId: u.id, reciclajeId: reciclaje.id })
    }
    return { reciclaje, repetido: false }
  })
}

// ---------------------------------------------------------------------------
// Modo sin conexión (RF30)
// ---------------------------------------------------------------------------

export function alternarOfflineSimulado() {
  const nuevo = !snapshot.offlineSimulado
  emitir({ offlineSimulado: nuevo })
  if (!nuevo) void sincronizarCola()
}

export function encolar(elemento: ElementoCola) {
  if (snapshot.cola.some((c) => c.idempotencyKey === elemento.idempotencyKey)) return
  emitir({ cola: [...snapshot.cola, elemento] })
}

export function descartarDeCola(clave: string) {
  emitir({ cola: snapshot.cola.filter((c) => c.idempotencyKey !== clave) })
}

export function reintentarElemento(clave: string) {
  emitir({ cola: snapshot.cola.map((c) => (c.idempotencyKey === clave ? { ...c, estado: 'en_cola' as const, motivo: undefined } : c)) })
  void sincronizarCola()
}

let sincronizando = false
export async function sincronizarCola() {
  if (sincronizando || !snapshot.online) return
  const pendientes = snapshot.cola.filter((c) => c.estado === 'en_cola')
  if (!pendientes.length) return
  sincronizando = true
  try {
    for (const item of pendientes) {
      if (!snapshot.online) break
      emitir({ cola: snapshot.cola.map((c) => (c.idempotencyKey === item.idempotencyKey ? { ...c, estado: 'sincronizando' as const } : c)) })
      await new Promise((r) => setTimeout(r, 700))
      try {
        // El servidor vuelve a validar punto, categoría, tope e idempotencia (RN16)
        const { reciclaje } = await registrarReciclaje({ ...item, creadoEn: item.creadoEn })
        if (!MODO_SERVIDOR) transaccion((d) => notificar(d, item.usuarioId, 'Reciclaje sincronizado', `Tu registro guardado sin conexión quedó ${reciclaje.estado === 'en_revision' ? 'en revisión' : 'pendiente de validación'}.`))
        emitir({ cola: snapshot.cola.filter((c) => c.idempotencyKey !== item.idempotencyKey) })
      } catch (e) {
        const motivo = e instanceof Error ? e.message : 'Error desconocido'
        emitir({ cola: snapshot.cola.map((c) => (c.idempotencyKey === item.idempotencyKey ? { ...c, estado: 'requiere_accion' as const, motivo } : c)) })
      }
    }
  } finally {
    sincronizando = false
  }
}

// ---------------------------------------------------------------------------
// Validación por el recolector (RF12–RF14, RF29, RN09, RN13, RN14)
// ---------------------------------------------------------------------------

export interface Decision {
  reciclajeId: string
  accion: 'validar' | 'rechazar'
  cantidadFinal?: number
  motivoCantidad?: string
  motivoRechazo?: string
}

function cerrarLote__local(recolectorId: string, puntoId: string, decisiones: Decision[], individual = false) {
  if (!decisiones.length) throw new ApiError('Selecciona al menos un registro.')
  return transaccion((d) => {
    const rec = actor(d, recolectorId)
    if (rec.bloqueado) throw new ApiError('Tu cuenta está bloqueada.')
    const esAdmin = rec.rol === 'admin' // excepción documentada en la matriz de permisos
    if (!esAdmin) {
      if (rec.rol !== 'recolector') throw new ApiError('No tienes permiso para validar reciclajes.')
      if (!asignacionVigente(d, recolectorId, puntoId)) throw new ApiError('No tienes una asignación vigente en este punto.')
    }
    const lote = { id: nuevoId('l'), puntoId, recolectorId, reciclajes: [] as string[], validados: 0, rechazados: 0, creadoEn: Date.now() }

    for (const dec of decisiones) {
      const r = d.reciclajes.find((x) => x.id === dec.reciclajeId)
      if (!r || r.puntoId !== puntoId) throw new ApiError('Un registro no pertenece a este punto.')
      if (r.estado !== 'pendiente' && r.estado !== 'en_revision') throw new ApiError('Solo un registro pendiente puede validarse o rechazarse.')
      if (r.estado === 'en_revision' && !individual) throw new ApiError('Los registros en revisión deben revisarse individualmente.')
      const cat = d.categorias.find((c) => c.id === r.categoriaId)!
      const dueno = actor(d, r.usuarioId)

      if (dec.accion === 'rechazar') {
        if (!dec.motivoRechazo?.trim()) throw new ApiError('El rechazo exige un motivo.')
        r.estado = 'rechazado'
        r.motivoRechazo = dec.motivoRechazo.trim()
        lote.rechazados += 1
        notificar(d, r.usuarioId, 'Reciclaje rechazado', `Tu registro de ${cat.nombre} fue rechazado. Motivo: ${r.motivoRechazo}`)
        auditar(d, recolectorId, 'Rechazar reciclaje', 'RECICLAJE', r.id, `Motivo: ${r.motivoRechazo}`)
      } else {
        const final = dec.cantidadFinal ?? r.cantidadReportada
        if (final !== r.cantidadReportada) {
          if (!dec.motivoCantidad?.trim()) throw new ApiError('Corregir la cantidad exige un motivo.')
          if (!(final >= cat.minimo && final <= cat.maximo)) throw new ApiError(`La cantidad debe estar entre ${cat.minimo} y ${cat.maximo} ${r.unidad}.`)
          r.motivoCantidad = dec.motivoCantidad.trim()
        }
        if (dueno.bloqueado) throw new ApiError(`La cuenta de ${dueno.nombre} está bloqueada; no se pueden acreditar puntos.`)
        r.cantidadFinal = final
        // Se recalcula con la tarifa congelada (RN04, RN13)
        r.puntosEstimados = Math.round(final * r.puntosPorUnidad)
        r.estado = 'validado'
        lote.validados += 1
        registrarMovimiento(d, {
          usuarioId: r.usuarioId,
          tipo: 'reciclaje',
          puntos: r.puntosEstimados,
          referenciaId: r.id,
          descripcion: `Reciclaje validado: ${final} ${r.unidad} de ${cat.nombre}`,
        })
        notificar(d, r.usuarioId, 'Reciclaje validado', `Tu reciclaje de ${cat.nombre} sumó ${r.puntosEstimados} EcoPoints.`)
        auditar(d, recolectorId, 'Validar reciclaje', 'RECICLAJE', r.id, `${final} ${r.unidad} → ${r.puntosEstimados} pts${r.motivoCantidad ? ` (cantidad corregida: ${r.motivoCantidad})` : ''}`)
      }
      r.validadoEn = Date.now()
      r.validadoPor = recolectorId
      r.loteId = lote.id
      lote.reciclajes.push(r.id)
    }
    d.lotes.push(lote)
    auditar(d, recolectorId, individual ? 'Revisión individual' : 'Cerrar lote', 'LOTE_VALIDACION', lote.id, `${lote.validados} validados, ${lote.rechazados} rechazados`)
    return lote
  })
}

// ---------------------------------------------------------------------------
// Recompensas y canjes (RF17–RF20, RN08, RN15)
// ---------------------------------------------------------------------------

export function recompensaDisponible(r: Recompensa) {
  const hoy = hoyIso()
  return r.activa && r.stock > 0 && r.vigenciaDesde <= hoy && r.vigenciaHasta >= hoy
}

function guardarRecompensa__local(adminId: string, datosIn: Omit<Recompensa, 'id'> & { id?: string }) {
  return transaccion((d) => {
    const quien = requiereRol(d, adminId, 'admin', 'aliado')
    const datos = { ...datosIn }
    if (quien.rol === 'aliado') {
      // Un aliado solo gestiona sus propias recompensas (Fase 2)
      if (datos.id && d.recompensas.find((x) => x.id === datos.id)?.aliadoId !== quien.id) throw new ApiError('Solo puedes editar tus recompensas.')
      datos.aliadoId = quien.id
      datos.responsable = quien.nombre
      datos.procedencia = `Aliado: ${quien.nombre}`
      datos.tipo = 'beneficio'
    }
    if (!datos.procedencia?.trim()) throw new ApiError('Indica la procedencia de la recompensa.')
    if (!datos.nombre.trim()) throw new ApiError('La recompensa necesita un nombre.')
    if (datos.activa) {
      if (!(datos.costo > 0) || !Number.isInteger(datos.costo)) throw new ApiError('Para activar la recompensa el costo debe ser un entero positivo.')
      if (!(datos.stock >= 0) || !Number.isInteger(datos.stock)) throw new ApiError('El stock debe ser un entero mayor o igual a cero.')
      if (!datos.vigenciaDesde || !datos.vigenciaHasta || datos.vigenciaDesde > datos.vigenciaHasta) throw new ApiError('La vigencia no es coherente: la fecha final debe ser posterior a la inicial.')
    }
    if (datos.id) {
      const r = d.recompensas.find((x) => x.id === datos.id)
      if (!r) throw new ApiError('Recompensa no encontrada.')
      Object.assign(r, datos)
      auditar(d, adminId, 'Actualizar recompensa', 'RECOMPENSA', r.id, `${r.nombre}: ${r.costo} pts, stock ${r.stock}, ${r.activa ? 'activa' : 'inactiva'}`)
      return r
    }
    const nueva: Recompensa = { ...datos, id: nuevoId('rw') }
    d.recompensas.push(nueva)
    auditar(d, adminId, 'Crear recompensa', 'RECOMPENSA', nueva.id, `${nueva.nombre}: ${nueva.costo} pts, stock ${nueva.stock}`)
    return nueva
  })
}

function devolverCanje(d: Db, c: Canje, estado: 'vencido' | 'cancelado', actorId: string) {
  c.estado = estado
  if (c.devuelto) return // la devolución ocurre una sola vez (RN15)
  c.devuelto = true
  const rw = d.recompensas.find((x) => x.id === c.recompensaId)
  if (rw) rw.stock += 1
  registrarMovimiento(d, {
    usuarioId: c.usuarioId,
    tipo: 'devolucion',
    puntos: c.costo,
    referenciaId: c.id,
    descripcion: `Devolución por canje ${estado}: ${rw?.nombre ?? 'recompensa'}`,
  })
  notificar(d, c.usuarioId, `Canje ${estado}`, `Se devolvieron ${c.costo} EcoPoints del canje ${c.codigo}.`)
  auditar(d, actorId, estado === 'vencido' ? 'Vencer canje' : 'Cancelar canje', 'CANJE', c.id, `${c.codigo}: devueltos ${c.costo} pts y 1 unidad de stock`)
}

function esSorteo(d: Db, c: Canje) {
  return d.recompensas.find((r) => r.id === c.recompensaId)?.tipo === 'sorteo'
}

// ---------------------------------------------------------------------------
// Privacidad (RNF05): retención de fotos y eliminación de cuenta
// ---------------------------------------------------------------------------

const DIA_MS = 24 * HORA

/**
 * Borra las fotos de los reciclajes ya decididos (validados o rechazados) con más días que la
 * retención configurada. La huella perceptual se conserva: no es un dato personal y sigue
 * sirviendo para detectar fotos repetidas dentro del periodo.
 */
export function aplicarRetencionFotos() {
  if (MODO_SERVIDOR) return // el servidor aplica la retención en cada consulta
  const limite = Date.now() - snapshot.db.config.diasRetencionFotos * DIA_MS
  const vencida = (r: Reciclaje) => r.foto !== '' && r.creadoEn < limite && (r.estado === 'validado' || r.estado === 'rechazado')
  if (!snapshot.db.reciclajes.some(vencida)) return
  transaccion((d) => {
    const afectados = d.reciclajes.filter(vencida)
    afectados.forEach((r) => (r.foto = ''))
    auditar(d, 'sistema', 'Retención de fotos', 'RECICLAJE', '*', `${afectados.length} fotos eliminadas por superar ${d.config.diasRetencionFotos} días`)
  })
}

/** Anonimiza la cuenta del titular. El historial de puntos y la auditoría se conservan sin datos personales. */
function eliminarCuenta__local(usuarioId: string) {
  return transaccion((d) => {
    const u = actor(d, usuarioId)
    if (u.eliminadoEn) throw new ApiError('Esta cuenta ya fue eliminada.')
    if (u.rol !== 'usuario') throw new ApiError('Las cuentas de recolector, aliado o administrador las da de baja la administración.')
    // Registros que aún no se deciden: se cierran sin acreditar puntos
    d.reciclajes
      .filter((r) => r.usuarioId === u.id && (r.estado === 'pendiente' || r.estado === 'en_revision'))
      .forEach((r) => {
        r.estado = 'rechazado'
        r.motivoRechazo = 'Cuenta eliminada por su titular'
        r.validadoEn = Date.now()
      })
    // Sus fotos se borran; los canjes pendientes se cancelan y devuelven el stock
    d.reciclajes.filter((r) => r.usuarioId === u.id).forEach((r) => (r.foto = ''))
    d.canjes.filter((c) => c.usuarioId === u.id && c.estado === 'pendiente').forEach((c) => devolverCanje(d, c, 'cancelado', u.id))
    d.tokens.filter((t) => t.usuarioId === u.id).forEach((t) => (t.usado = true))
    const corto = u.id.replace(/-/g, '').slice(0, 10)
    u.nombre = 'Cuenta eliminada'
    u.correo = `eliminada-${corto}@anonimo.invalid`
    u.facultad = ''
    u.passwordHash = ''
    u.verificado = false
    u.bloqueado = true
    u.rankingAnonimo = true
    u.consentimientoPrivacidad = false
    u.sesionVersion += 1
    u.eliminadoEn = Date.now()
    auditar(d, u.id, 'Eliminar cuenta (anonimizada)', 'USUARIO', u.id, 'Datos personales y fotos eliminados; historial conservado sin identificar')
    return { eliminada: true }
  })
}
export const eliminarCuentaLocal = eliminarCuenta__local

/** El titular elimina su cuenta confirmando su contraseña. */
export async function eliminarMiCuenta(password: string) {
  const s = snapshot.sesion
  if (!s) throw new ApiError('Inicia sesión para continuar.')
  if (MODO_SERVIDOR) {
    await llamarApi('/cuenta/eliminar', { password })
  } else {
    const u = snapshot.db.usuarios.find((x) => x.id === s.usuarioId)
    if (!u || (await hashPassword(u.correo, password)) !== u.passwordHash) throw new ApiError('La contraseña no es correcta.')
    eliminarCuenta__local(u.id)
  }
  emitir({ sesion: null })
  if (MODO_SERVIDOR) await refrescarDesdeServidor()
}

export function procesarVencimientos() {
  if (MODO_SERVIDOR) return // el servidor vence los canjes en cada consulta
  const ahora = Date.now()
  const vence = (d: Db, c: Canje) => c.estado === 'pendiente' && c.venceEn <= ahora && !esSorteo(d, c)
  if (!snapshot.db.canjes.some((c) => vence(snapshot.db, c))) return
  transaccion((d) => {
    d.canjes
      .filter((c) => vence(d, c))
      .forEach((c) => devolverCanje(d, c, 'vencido', 'sistema'))
  })
}

function crearCanje__local(usuarioId: string, recompensaId: string, idempotencyKey: string) {
  const existente = snapshot.db.canjes.find((c) => c.idempotencyKey === idempotencyKey)
  if (existente) return existente // una petición repetida no crea dos canjes
  return transaccion((d) => {
    const u = requiereRol(d, usuarioId, 'usuario')
    const rw = d.recompensas.find((x) => x.id === recompensaId)
    if (!rw) throw new ApiError('Recompensa no encontrada.')
    const hoy = hoyIso()
    if (!rw.activa || rw.vigenciaDesde > hoy || rw.vigenciaHasta < hoy) throw new ApiError('Esta recompensa no está vigente.')
    if (rw.stock <= 0) throw new ApiError('Esta recompensa está agotada.')
    const saldo = saldoConfirmado(d, u.id)
    if (saldo < rw.costo) throw new ApiError(`Saldo insuficiente: tienes ${saldo} EcoPoints confirmados y necesitas ${rw.costo}.`)
    let codigo: string
    do {
      codigo = `ECO-${codigoAleatorio(4)}-${codigoAleatorio(4)}`
    } while (d.canjes.some((c) => c.codigo === codigo))
    const canje: Canje = {
      id: nuevoId('c'),
      idempotencyKey,
      usuarioId: u.id,
      recompensaId: rw.id,
      codigo,
      costo: rw.costo,
      estado: 'pendiente',
      creadoEn: Date.now(),
      venceEn: rw.tipo === 'sorteo' ? new Date(rw.vigenciaHasta + 'T23:59:59').getTime() : Date.now() + d.config.horasVencimientoCanje * HORA,
      devuelto: false,
    }
    if (rw.tipo === 'sorteo' && rw.sorteoRealizado) throw new ApiError('Este sorteo ya se realizó.')
    if (rw.tipo === 'donacion') {
      // La donación no requiere entrega física: queda confirmada al instante
      canje.estado = 'entregado'
      canje.entregadoEn = Date.now()
      notificar(d, u.id, 'Gracias por tu donación', `Donaste ${rw.costo} EcoPoints a: ${rw.nombre}.`)
    }
    rw.stock -= 1
    d.canjes.push(canje)
    registrarMovimiento(d, { usuarioId: u.id, tipo: 'canje', puntos: -rw.costo, referenciaId: canje.id, descripcion: `${rw.tipo === 'donacion' ? 'Donación' : rw.tipo === 'sorteo' ? 'Boleto de sorteo' : 'Canje'}: ${rw.nombre}` })
    auditar(d, u.id, 'Crear canje', 'CANJE', canje.id, `${rw.nombre} por ${rw.costo} pts, código ${codigo}`)
    return canje
  })
}

function cancelarCanje__local(usuarioId: string, canjeId: string) {
  transaccion((d) => {
    const c = d.canjes.find((x) => x.id === canjeId)
    if (!c || c.usuarioId !== usuarioId) throw new ApiError('Canje no encontrado.')
    if (c.estado !== 'pendiente') throw new ApiError('Solo un canje pendiente puede cancelarse.')
    devolverCanje(d, c, 'cancelado', usuarioId)
  })
}

export function buscarCanje(codigo: string) {
  procesarVencimientos()
  const c = snapshot.db.canjes.find((x) => x.codigo === codigo.trim().toUpperCase())
  if (!c) throw new ApiError('No existe un canje con ese código.')
  return c
}

function entregarCanje__local(entregaId: string, codigo: string) {
  procesarVencimientos()
  return transaccion((d) => {
    requiereRol(d, entregaId, 'admin', 'aliado')
    const c = d.canjes.find((x) => x.codigo === codigo.trim().toUpperCase())
    if (!c) throw new ApiError('No existe un canje con ese código.')
    if (c.estado === 'entregado') throw new ApiError('Este código ya fue utilizado: la recompensa ya se entregó.')
    if (c.estado !== 'pendiente') throw new ApiError(`Este canje está ${c.estado} y no puede entregarse.`)
    const recompensa = d.recompensas.find((x) => x.id === c.recompensaId)
    if (recompensa?.tipo === 'sorteo') throw new ApiError('Los boletos de sorteo no se entregan con código: se resuelven al realizar el sorteo.')
    const quien = actor(d, entregaId)
    if (quien.rol === 'aliado' && recompensa?.aliadoId !== quien.id) throw new ApiError('Este canje corresponde a otro responsable de entrega.')
    c.estado = 'entregado'
    c.entregadoEn = Date.now()
    c.entregadoPor = entregaId
    const rw = d.recompensas.find((x) => x.id === c.recompensaId)
    notificar(d, c.usuarioId, 'Recompensa entregada', `Recibiste: ${rw?.nombre ?? 'tu recompensa'}.`)
    auditar(d, entregaId, 'Entregar canje', 'CANJE', c.id, `${c.codigo}: ${rw?.nombre ?? ''}`)
    return c
  })
}

// ---------------------------------------------------------------------------
// Administración de usuarios y asignaciones (RF25, RF28)
// ---------------------------------------------------------------------------

function cambiarRol__local(adminId: string, usuarioId: string, rol: Rol) {
  transaccion((d) => {
    requiereRol(d, adminId, 'admin')
    if (adminId === usuarioId) throw new ApiError('No puedes cambiar tu propio rol.')
    const u = actor(d, usuarioId)
    if (u.eliminadoEn) throw new ApiError('Esta cuenta fue eliminada por su titular y ya no se puede modificar.')
    const antes = u.rol
    u.rol = rol
    u.sesionVersion += 1 // un cambio de rol revoca sesiones (RNF13)
    if (rol !== 'recolector') {
      d.asignaciones.forEach((a) => {
        if (a.recolectorId === u.id) a.activa = false
      })
    }
    auditar(d, adminId, 'Cambiar rol', 'USUARIO', u.id, `${u.correo}: ${antes} → ${rol}. Sesiones revocadas.`)
  })
}

function cambiarBloqueo__local(adminId: string, usuarioId: string, bloquear: boolean, motivo: string) {
  transaccion((d) => {
    requiereRol(d, adminId, 'admin')
    if (adminId === usuarioId) throw new ApiError('No puedes bloquear tu propia cuenta.')
    if (!motivo.trim()) throw new ApiError('Indica el motivo.')
    const u = actor(d, usuarioId)
    if (u.eliminadoEn) throw new ApiError('Esta cuenta fue eliminada por su titular y ya no se puede modificar.')
    u.bloqueado = bloquear
    u.sesionVersion += 1
    if (bloquear) {
      // El historial no se elimina (RN11)
      d.asignaciones.forEach((a) => {
        if (a.recolectorId === u.id) a.activa = false
      })
    }
    auditar(d, adminId, bloquear ? 'Bloquear cuenta' : 'Desbloquear cuenta', 'USUARIO', u.id, `${u.correo}. Motivo: ${motivo.trim()}`)
  })
}

function crearAjuste__local(adminId: string, usuarioId: string, puntos: number, motivo: string) {
  transaccion((d) => {
    requiereRol(d, adminId, 'admin')
    if (!Number.isInteger(puntos) || puntos === 0) throw new ApiError('El ajuste debe ser un número entero distinto de cero.')
    if (!motivo.trim()) throw new ApiError('El ajuste exige un motivo.')
    const u = actor(d, usuarioId)
    if (u.eliminadoEn) throw new ApiError('Esta cuenta fue eliminada por su titular y ya no se puede modificar.')
    if (saldoConfirmado(d, u.id) + puntos < 0) throw new ApiError('El ajuste dejaría el saldo en negativo.')
    registrarMovimiento(d, { usuarioId: u.id, tipo: 'ajuste', puntos, referenciaId: 'ajuste-admin', descripcion: `Ajuste: ${motivo.trim()}` })
    notificar(d, u.id, 'Ajuste de EcoPoints', `${puntos > 0 ? '+' : ''}${puntos} EcoPoints. Motivo: ${motivo.trim()}`)
    auditar(d, adminId, 'Crear ajuste', 'MOVIMIENTO_PUNTOS', u.id, `${puntos} pts. Motivo: ${motivo.trim()}`)
  })
}

function crearAsignacion__local(adminId: string, datos: { recolectorId: string; puntoId: string; desde: string; hasta: string; horario: string }) {
  transaccion((d) => {
    requiereRol(d, adminId, 'admin')
    const rec = actor(d, datos.recolectorId)
    if (rec.rol !== 'recolector') throw new ApiError('Solo puedes asignar cuentas con rol de recolector.')
    if (rec.bloqueado) throw new ApiError('El recolector está bloqueado.')
    if (!datos.desde || !datos.hasta || datos.desde > datos.hasta) throw new ApiError('La vigencia de la asignación no es coherente.')
    if (!datos.horario.trim()) throw new ApiError('Indica el horario.')
    const punto = d.puntos.find((p) => p.id === datos.puntoId)
    if (!punto) throw new ApiError('Punto no encontrado.')
    const reemplazos = d.asignaciones.filter((a) => a.recolectorId === rec.id && a.puntoId === punto.id && a.activa)
    reemplazos.forEach((a) => (a.activa = false))
    const a = { id: nuevoId('a'), ...datos, activa: true }
    d.asignaciones.push(a)
    auditar(d, adminId, reemplazos.length ? 'Reemplazar asignación' : 'Crear asignación', 'ASIGNACION_RECOLECTOR', a.id, `${rec.nombre} → ${punto.nombre} (${datos.desde} a ${datos.hasta}, ${datos.horario})`)
  })
}

function desactivarAsignacion__local(adminId: string, asignacionId: string) {
  transaccion((d) => {
    requiereRol(d, adminId, 'admin')
    const a = d.asignaciones.find((x) => x.id === asignacionId)
    if (!a) throw new ApiError('Asignación no encontrada.')
    a.activa = false
    auditar(d, adminId, 'Finalizar asignación', 'ASIGNACION_RECOLECTOR', a.id, '')
  })
}

// ---------------------------------------------------------------------------
// Notificaciones
// ---------------------------------------------------------------------------

function marcarNotificacionesLeidas__local(usuarioId: string) {
  if (!snapshot.db.notificaciones.some((n) => n.usuarioId === usuarioId && !n.leida)) return
  transaccion((d) => {
    d.notificaciones.forEach((n) => {
      if (n.usuarioId === usuarioId) n.leida = true
    })
  })
}

// ---------------------------------------------------------------------------
// Sorteos (recompensas no comerciales)
// ---------------------------------------------------------------------------

function realizarSorteo__local(adminId: string, recompensaId: string) {
  return transaccion((d) => {
    requiereRol(d, adminId, 'admin')
    const rw = d.recompensas.find((x) => x.id === recompensaId)
    if (!rw || rw.tipo !== 'sorteo') throw new ApiError('La recompensa no es un sorteo.')
    if (rw.sorteoRealizado) throw new ApiError('Este sorteo ya se realizó.')
    const boletos = d.canjes.filter((c) => c.recompensaId === rw.id && c.estado === 'pendiente')
    if (!boletos.length) throw new ApiError('No hay boletos participando.')
    const indice = crypto.getRandomValues(new Uint32Array(1))[0] % boletos.length
    const ganador = boletos[indice]
    boletos.forEach((b) => {
      b.estado = 'entregado'
      b.entregadoEn = Date.now()
      b.entregadoPor = adminId
      b.ganador = b.id === ganador.id
      notificar(d, b.usuarioId, b.ganador ? '¡Ganaste el sorteo!' : 'Resultado del sorteo', b.ganador ? `Tu boleto ${b.codigo} ganó: ${rw.nombre}. Acércate a Gestión Ambiental.` : `El sorteo de ${rw.nombre} ya se realizó. ¡Gracias por participar!`)
    })
    rw.sorteoRealizado = true
    rw.activa = false
    const persona = actor(d, ganador.usuarioId)
    auditar(d, adminId, 'Realizar sorteo', 'RECOMPENSA', rw.id, `${boletos.length} boletos. Ganador: ${persona.nombre} (${ganador.codigo})`)
    return { ganador: persona, boleto: ganador, participantes: boletos.length }
  })
}

// ---------------------------------------------------------------------------
// Categorías: crear y eliminar (RF09)
// ---------------------------------------------------------------------------

function crearCategoria__local(adminId: string, datos: Omit<CategoriaResiduo, 'id' | 'version' | 'activa'>) {
  return transaccion((d) => {
    requiereRol(d, adminId, 'admin')
    if (!datos.nombre.trim()) throw new ApiError('La categoría necesita un nombre.')
    if (d.categorias.some((c) => c.nombre.toLowerCase() === datos.nombre.trim().toLowerCase())) throw new ApiError('Ya existe una categoría con ese nombre.')
    if (!datos.unidad.trim()) throw new ApiError('Define la unidad de medida.')
    if (!(datos.puntosPorUnidad > 0)) throw new ApiError('Los puntos por unidad deben ser mayores que cero.')
    if (!(datos.minimo > 0) || datos.maximo < datos.minimo) throw new ApiError('Los límites no son coherentes.')
    const c: CategoriaResiduo = { ...datos, nombre: datos.nombre.trim(), id: nuevoId('cat'), version: 1, activa: true }
    d.categorias.push(c)
    d.historialCategorias.push({ ...c })
    auditar(d, adminId, 'Crear categoría', 'CATEGORIA_RESIDUO', c.id, `${c.nombre}: ${c.puntosPorUnidad} pts/${c.unidad}`)
    return c
  })
}

/**
 * "Eliminar" una categoría la retira del sistema: se desactiva, sale de todos los puntos y deja
 * de aceptarse en nuevos reciclajes. No se borra para conservar el historial y la auditoría (RN10).
 */
function eliminarCategoria__local(adminId: string, id: string) {
  return transaccion((d) => {
    requiereRol(d, adminId, 'admin')
    const c = d.categorias.find((x) => x.id === id)
    if (!c) throw new ApiError('Categoría no encontrada.')
    if (!c.activa) throw new ApiError('La categoría ya está eliminada.')
    if (d.categorias.filter((x) => x.activa).length <= 1) throw new ApiError('Debe quedar al menos una categoría activa.')
    const enPuntos = d.puntos.filter((p) => p.categorias.includes(id)).length
    d.puntos.forEach((p) => (p.categorias = p.categorias.filter((x) => x !== id)))
    c.activa = false
    auditar(d, adminId, 'Eliminar categoría', 'CATEGORIA_RESIDUO', c.id, `${c.nombre}: retirada de ${enPuntos} puntos; el historial se conserva.`)
    return { puntosAfectados: enPuntos }
  })
}

function reactivarCategoria__local(adminId: string, id: string) {
  transaccion((d) => {
    requiereRol(d, adminId, 'admin')
    const c = d.categorias.find((x) => x.id === id)
    if (!c) throw new ApiError('Categoría no encontrada.')
    c.activa = true
    auditar(d, adminId, 'Reactivar categoría', 'CATEGORIA_RESIDUO', c.id, c.nombre)
  })
}

// ---------------------------------------------------------------------------
// Alertas antifraude (RF26) y preferencias del ranking (RF07)
// ---------------------------------------------------------------------------

function resolverAlerta__local(adminId: string, id: string, estado: Exclude<EstadoAlerta, 'abierta'>, resolucion: string) {
  transaccion((d) => {
    requiereRol(d, adminId, 'admin')
    const a = d.alertas.find((x) => x.id === id)
    if (!a) throw new ApiError('Alerta no encontrada.')
    if (a.estado !== 'abierta') throw new ApiError('La alerta ya fue resuelta.')
    if (!resolucion.trim()) throw new ApiError('Describe la resolución.')
    a.estado = estado
    a.resolucion = resolucion.trim()
    a.resueltoPor = adminId
    a.resueltoEn = Date.now()
    auditar(d, adminId, estado === 'resuelta' ? 'Resolver alerta' : 'Descartar alerta', 'ALERTA_FRAUDE', a.id, `${a.regla}: ${a.resolucion}`)
  })
}

function cambiarAnonimatoRanking__local(usuarioId: string, anonimo: boolean) {
  transaccion((d) => {
    const u = actor(d, usuarioId)
    u.rankingAnonimo = anonimo
  })
}

// ---------------------------------------------------------------------------
// Universidades participantes (RN01 ajustada: varios dominios autorizados)
// ---------------------------------------------------------------------------

const DOMINIO_VALIDO = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/

function guardarInstitucion__local(adminId: string, datos: Omit<Institucion, 'id'> & { id?: string }) {
  return transaccion((d) => {
    requiereRol(d, adminId, 'admin')
    const nombre = datos.nombre.trim()
    const siglas = datos.siglas.trim().toUpperCase()
    if (!nombre || !siglas) throw new ApiError('Indica el nombre y las siglas de la universidad.')
    const dominios = [...new Set(datos.dominios.map((x) => x.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))]
    if (!dominios.length) throw new ApiError('Agrega al menos un dominio de correo.')
    const invalido = dominios.find((x) => !DOMINIO_VALIDO.test(x))
    if (invalido) throw new ApiError(`"${invalido}" no es un dominio válido. Ejemplo: espol.edu.ec`)
    for (const dom of dominios) {
      const otra = d.instituciones.find((i) => i.id !== datos.id && i.dominios.includes(dom))
      if (otra) throw new ApiError(`El dominio ${dom} ya pertenece a ${otra.siglas}.`)
    }
    if (d.instituciones.some((i) => i.id !== datos.id && i.siglas === siglas)) throw new ApiError(`Ya existe una universidad con las siglas ${siglas}.`)
    if (datos.id) {
      const i = d.instituciones.find((x) => x.id === datos.id)
      if (!i) throw new ApiError('Universidad no encontrada.')
      const antes = `${i.dominios.join(', ')}${i.activa ? '' : ' (inactiva)'}`
      Object.assign(i, { nombre, siglas, dominios, activa: datos.activa })
      auditar(d, adminId, 'Actualizar universidad', 'INSTITUCION', i.id, `${siglas}: ${antes} → ${dominios.join(', ')}${datos.activa ? '' : ' (inactiva)'}`)
      return i
    }
    const nueva: Institucion = { id: nuevoId('inst'), nombre, siglas, dominios, activa: datos.activa }
    d.instituciones.push(nueva)
    auditar(d, adminId, 'Agregar universidad', 'INSTITUCION', nueva.id, `${siglas}: ${dominios.join(', ')}`)
    return nueva
  })
}

// ---------------------------------------------------------------------------
// Acciones públicas: locales o remotas según el modo
// ---------------------------------------------------------------------------
export const guardarPunto = remoto('guardarPunto', guardarPunto__local)
export const actualizarCategoria = remoto('actualizarCategoria', actualizarCategoria__local)
export const actualizarConfig = remoto('actualizarConfig', actualizarConfig__local)
export const registrarReciclaje = remoto('registrarReciclaje', registrarReciclaje__local)
export const cerrarLote = remoto('cerrarLote', cerrarLote__local)
export const guardarRecompensa = remoto('guardarRecompensa', guardarRecompensa__local)
export const crearCanje = remoto('crearCanje', crearCanje__local)
export const cancelarCanje = remoto('cancelarCanje', cancelarCanje__local)
export const entregarCanje = remoto('entregarCanje', entregarCanje__local)
export const cambiarRol = remoto('cambiarRol', cambiarRol__local)
export const cambiarBloqueo = remoto('cambiarBloqueo', cambiarBloqueo__local)
export const crearAjuste = remoto('crearAjuste', crearAjuste__local)
export const crearAsignacion = remoto('crearAsignacion', crearAsignacion__local)
export const desactivarAsignacion = remoto('desactivarAsignacion', desactivarAsignacion__local)
export const marcarNotificacionesLeidas = remoto('marcarNotificacionesLeidas', marcarNotificacionesLeidas__local)
export const realizarSorteo = remoto('realizarSorteo', realizarSorteo__local)
export const crearCategoria = remoto('crearCategoria', crearCategoria__local)
export const eliminarCategoria = remoto('eliminarCategoria', eliminarCategoria__local)
export const reactivarCategoria = remoto('reactivarCategoria', reactivarCategoria__local)
export const resolverAlerta = remoto('resolverAlerta', resolverAlerta__local)
export const cambiarAnonimatoRanking = remoto('cambiarAnonimatoRanking', cambiarAnonimatoRanking__local)
export const guardarInstitucion = remoto('guardarInstitucion', guardarInstitucion__local)

/** Implementaciones locales, usadas por el servidor para aplicar las mismas reglas. */
export const accionesLocales = {
  guardarPunto: guardarPunto__local,
  actualizarCategoria: actualizarCategoria__local,
  actualizarConfig: actualizarConfig__local,
  registrarReciclaje: registrarReciclaje__local,
  cerrarLote: cerrarLote__local,
  guardarRecompensa: guardarRecompensa__local,
  crearCanje: crearCanje__local,
  cancelarCanje: cancelarCanje__local,
  entregarCanje: entregarCanje__local,
  cambiarRol: cambiarRol__local,
  cambiarBloqueo: cambiarBloqueo__local,
  crearAjuste: crearAjuste__local,
  crearAsignacion: crearAsignacion__local,
  desactivarAsignacion: desactivarAsignacion__local,
  marcarNotificacionesLeidas: marcarNotificacionesLeidas__local,
  realizarSorteo: realizarSorteo__local,
  crearCategoria: crearCategoria__local,
  eliminarCategoria: eliminarCategoria__local,
  reactivarCategoria: reactivarCategoria__local,
  resolverAlerta: resolverAlerta__local,
  cambiarAnonimatoRanking: cambiarAnonimatoRanking__local,
  guardarInstitucion: guardarInstitucion__local,
}
export type NombreAccion = keyof typeof accionesLocales
