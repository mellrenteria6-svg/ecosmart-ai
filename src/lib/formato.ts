import type { EstadoCanje, EstadoCola, EstadoPunto, EstadoReciclaje, Rol } from '../data/types'

const fechaHora = new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium', timeStyle: 'short' })
const fecha = new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium' })
const numero = new Intl.NumberFormat('es-EC')

export const fmtFechaHora = (ts: number) => fechaHora.format(ts)
export const fmtFecha = (ts: number | string) =>
  fecha.format(typeof ts === 'string' ? new Date(ts + 'T12:00:00') : ts)
export const fmtNumero = (n: number) => numero.format(n)
export const fmtPct = (n: number) => `${Math.round(n * 100)} %`

export function hace(ts: number) {
  const seg = Math.round((Date.now() - ts) / 1000)
  if (seg < 60) return 'hace un momento'
  const min = Math.round(seg / 60)
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`
}

export function tiempoRestante(ts: number) {
  const ms = ts - Date.now()
  if (ms <= 0) return 'vencido'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h} h ${m} min` : `${m} min`
}

export const ETIQUETA_RECICLAJE: Record<EstadoReciclaje, string> = {
  pendiente: 'Pendiente',
  en_revision: 'En revisión',
  validado: 'Validado',
  rechazado: 'Rechazado',
}

export const ETIQUETA_CANJE: Record<EstadoCanje, string> = {
  pendiente: 'Pendiente',
  entregado: 'Entregado',
  vencido: 'Vencido',
  cancelado: 'Cancelado',
}

export const ETIQUETA_COLA: Record<EstadoCola, string> = {
  en_cola: 'En cola',
  sincronizando: 'Sincronizando',
  requiere_accion: 'Requiere acción',
}

export const ETIQUETA_PUNTO: Record<EstadoPunto, string> = {
  activo: 'Activo',
  inactivo: 'Inactivo',
  mantenimiento: 'En mantenimiento',
}

export const ETIQUETA_ROL: Record<Rol, string> = {
  usuario: 'Usuario',
  recolector: 'Recolector',
  admin: 'Administrador',
  aliado: 'Aliado',
}

export type Tono = 'ok' | 'warn' | 'error' | 'info' | 'neutral'

export const TONO_ESTADO: Record<string, Tono> = {
  pendiente: 'info',
  en_revision: 'warn',
  validado: 'ok',
  rechazado: 'error',
  entregado: 'ok',
  vencido: 'neutral',
  cancelado: 'neutral',
  en_cola: 'info',
  sincronizando: 'info',
  requiere_accion: 'error',
  activo: 'ok',
  inactivo: 'neutral',
  mantenimiento: 'warn',
}
