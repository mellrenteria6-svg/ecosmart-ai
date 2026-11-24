// Notificaciones push en el navegador (RF23).
// - Modo base de datos: suscripción Web Push real; el servidor envía los avisos aunque la app esté cerrada.
// - Modo demostración: sin servidor, se muestran avisos del navegador mientras la app está abierta.
// Si el usuario no da permiso, nada se bloquea: los avisos siguen en la sección Notificaciones.
import { MODO_SERVIDOR, obtenerSnapshot, suscribir } from '../data/store'

export type EstadoPush = 'no-soportado' | 'denegado' | 'activo' | 'inactivo'

const CLAVE_LOCAL = 'ecosmart.push-local'
const API = '/api'

export function soportado() {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && (!MODO_SERVIDOR || 'PushManager' in window)
}

export async function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return null
  // BASE_URL: "/" en la PC; "/ecosmart-ai/" en GitHub Pages
  const base = import.meta.env.BASE_URL
  const url = import.meta.env.PROD ? `${base}sw.js` : `${base}sw.js?modo=dev`
  try {
    await navigator.serviceWorker.register(url)
    return await navigator.serviceWorker.ready
  } catch {
    return null
  }
}

async function llamar(ruta: string, cuerpo?: unknown) {
  const token = obtenerSnapshot().sesion?.token
  const r = await fetch(API + ruta, {
    method: cuerpo === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error ?? 'No se pudo conectar con el servidor.')
  return d
}

function claveABytes(base64: string) {
  const relleno = '='.repeat((4 - (base64.length % 4)) % 4)
  const b = atob((base64 + relleno).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(b, (c) => c.charCodeAt(0))
}

function leerLocal() {
  try {
    return localStorage.getItem(CLAVE_LOCAL) === '1'
  } catch {
    return false
  }
}

function escribirLocal(v: boolean) {
  try {
    if (v) localStorage.setItem(CLAVE_LOCAL, '1')
    else localStorage.removeItem(CLAVE_LOCAL)
  } catch {
    // sin almacenamiento: el aviso solo dura esta visita
  }
}

export async function estadoActual(): Promise<EstadoPush> {
  if (!soportado()) return 'no-soportado'
  if (Notification.permission === 'denied') return 'denegado'
  if (Notification.permission !== 'granted') return 'inactivo'
  if (!MODO_SERVIDOR) return leerLocal() ? 'activo' : 'inactivo'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? 'activo' : 'inactivo'
}

/** Pide permiso y suscribe este dispositivo. */
export async function activar(): Promise<EstadoPush> {
  if (!soportado()) return 'no-soportado'
  const permiso = await Notification.requestPermission()
  if (permiso !== 'granted') return permiso === 'denied' ? 'denegado' : 'inactivo'
  if (!MODO_SERVIDOR) {
    escribirLocal(true)
    return 'activo'
  }
  const reg = await registrarServiceWorker()
  if (!reg) throw new Error('El navegador no permitió registrar el servicio de avisos.')
  const { clave } = await llamar('/push/clave')
  const existente = await reg.pushManager.getSubscription()
  const sub = existente ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveABytes(clave) }))
  await llamar('/push/suscribir', { suscripcion: sub.toJSON() })
  return 'activo'
}

/** Deja de recibir avisos en este dispositivo (también al cerrar sesión). */
export async function desactivar(): Promise<EstadoPush> {
  escribirLocal(false)
  if (MODO_SERVIDOR && 'serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (sub) {
      await llamar('/push/cancelar', { endpoint: sub.endpoint }).catch(() => {})
      await sub.unsubscribe().catch(() => false)
    }
  }
  return soportado() ? (Notification.permission === 'denied' ? 'denegado' : 'inactivo') : 'no-soportado'
}

/** Envía un aviso de prueba a este dispositivo. */
export async function probar() {
  if (!MODO_SERVIDOR) {
    mostrarLocal('EcoSmart AI', '¡Listo! Así te llegarán los avisos de tus reciclajes y canjes.')
    return 1
  }
  const { entregados } = await llamar('/push/prueba', {})
  return entregados as number
}

function mostrarLocal(titulo: string, mensaje: string) {
  if (Notification.permission !== 'granted') return
  void navigator.serviceWorker?.getRegistration().then((reg) => {
    const icono = `${import.meta.env.BASE_URL}favicon.svg`
    if (reg) void reg.showNotification(titulo, { body: mensaje, icon: icono, data: { url: '#/app/notificaciones' } })
    else new Notification(titulo, { body: mensaje, icon: icono })
  })
}

/** Modo demostración: muestra como aviso del navegador cada notificación nueva del usuario. */
export function vigilarAvisosLocales() {
  if (MODO_SERVIDOR || typeof window === 'undefined') return () => {}
  let vistas = new Set(obtenerSnapshot().db.notificaciones.map((n) => n.id))
  return suscribir(() => {
    const s = obtenerSnapshot()
    const actuales = s.db.notificaciones
    const yo = s.sesion?.usuarioId
    if (yo && leerLocal() && soportado()) {
      actuales.filter((n) => !vistas.has(n.id) && n.usuarioId === yo).forEach((n) => mostrarLocal(n.titulo, n.mensaje))
    }
    vistas = new Set(actuales.map((n) => n.id))
  })
}
