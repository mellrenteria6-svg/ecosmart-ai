// Notificaciones push (RF23). Cuando una acción crea notificaciones, el servidor las envía
// a los dispositivos suscritos de cada usuario. Si falla el envío, el aviso sigue disponible
// dentro de la aplicación: el push nunca bloquea ni deshace una acción.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import webpush from 'web-push'
import type { Db } from '../src/data/types'
import { pool } from './db'

export interface SuscripcionPush {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface AvisoPush {
  titulo: string
  mensaje: string
  url: string
}

type Enviar = (s: SuscripcionPush, aviso: AvisoPush) => Promise<unknown>

// ---------------------------------------------------------------------------
// Claves VAPID: de server/.env si existen; si no, se generan una vez y se guardan
// en server/.vapid.json (no se sube a git)
// ---------------------------------------------------------------------------
const ARCHIVO_CLAVES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.vapid.json')
let claves: { publica: string; privada: string } | null = null

export function clavesVapid() {
  if (claves) return claves
  if (process.env.VAPID_PUBLICA && process.env.VAPID_PRIVADA) {
    claves = { publica: process.env.VAPID_PUBLICA, privada: process.env.VAPID_PRIVADA }
  } else if (existsSync(ARCHIVO_CLAVES)) {
    claves = JSON.parse(readFileSync(ARCHIVO_CLAVES, 'utf8'))
  } else {
    const g = webpush.generateVAPIDKeys()
    claves = { publica: g.publicKey, privada: g.privateKey }
    writeFileSync(ARCHIVO_CLAVES, JSON.stringify(claves, null, 2))
  }
  webpush.setVapidDetails(process.env.VAPID_CONTACTO ?? 'mailto:gestion.ambiental@universidad.edu.ec', claves!.publica, claves!.privada)
  return claves!
}

let enviar: Enviar = (s, aviso) => {
  clavesVapid()
  return webpush.sendNotification(s, JSON.stringify(aviso), { TTL: 24 * 3600, urgency: 'normal' })
}

/** Solo para pruebas: reemplaza el envío real por uno simulado. */
export function configurarEnvio(fn: Enviar) {
  enviar = fn
}

// ---------------------------------------------------------------------------
// Suscripciones
// ---------------------------------------------------------------------------
function validar(s: unknown): SuscripcionPush {
  const x = s as SuscripcionPush
  if (!x || typeof x.endpoint !== 'string' || !x.endpoint.startsWith('https://') || typeof x.keys?.p256dh !== 'string' || typeof x.keys?.auth !== 'string') {
    throw new Error('Suscripción inválida')
  }
  return x
}

export async function guardarSuscripcion(usuarioId: string, s: unknown, agente?: string) {
  const x = validar(s)
  // El mismo dispositivo pasa a ser del usuario que inició sesión en él
  await pool.query(
    `INSERT INTO suscripcion_push (usuario_id, endpoint, p256dh, auth, agente) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET usuario_id = EXCLUDED.usuario_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, agente = EXCLUDED.agente`,
    [usuarioId, x.endpoint, x.keys.p256dh, x.keys.auth, (agente ?? '').slice(0, 200)],
  )
}

export async function borrarSuscripcion(usuarioId: string, endpoint: string) {
  await pool.query('DELETE FROM suscripcion_push WHERE usuario_id = $1 AND endpoint = $2', [usuarioId, String(endpoint ?? '')])
}

export async function borrarSuscripcionesDe(usuarioId: string) {
  await pool.query('DELETE FROM suscripcion_push WHERE usuario_id = $1', [usuarioId])
}

/** Envía un aviso a todos los dispositivos del usuario. Devuelve cuántos lo recibieron. */
export async function enviarA(usuarioId: string, aviso: AvisoPush) {
  const { rows } = await pool.query(
    `SELECT s.endpoint, s.p256dh, s.auth FROM suscripcion_push s JOIN usuario u ON u.id = s.usuario_id
     WHERE s.usuario_id = $1 AND NOT u.bloqueado AND u.eliminado_en IS NULL`,
    [usuarioId],
  )
  let entregados = 0
  for (const r of rows) {
    try {
      await enviar({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, aviso)
      entregados += 1
    } catch (e) {
      const estado = (e as { statusCode?: number }).statusCode
      // 404/410: el navegador anuló la suscripción; se borra para no reintentar
      if (estado === 404 || estado === 410) await pool.query('DELETE FROM suscripcion_push WHERE endpoint = $1', [r.endpoint])
      else console.warn('[push] no se pudo enviar:', estado ?? (e as Error).message)
    }
  }
  return entregados
}

const RUTA_POR_ROL: Record<string, string> = { usuario: '#/app/notificaciones', recolector: '#/rec', admin: '#/admin', aliado: '#/aliado' }

const enCurso = new Set<Promise<unknown>>()

/** Lanza el envío sin hacer esperar la respuesta de la acción. */
export function enviarNuevasEnSegundoPlano(antes: Db, despues: Db) {
  const p = enviarNuevas(antes, despues).finally(() => enCurso.delete(p))
  enCurso.add(p)
}

/** Espera a que terminen los envíos en curso (pruebas y apagado ordenado). */
export async function esperarEnvios() {
  await Promise.all([...enCurso])
}

/** Tras una acción confirmada: envía las notificaciones nuevas. Nunca lanza errores. */
export async function enviarNuevas(antes: Db, despues: Db) {
  const previas = new Set(antes.notificaciones.map((n) => n.id))
  const nuevas = despues.notificaciones.filter((n) => !previas.has(n.id))
  for (const n of nuevas) {
    const rol = despues.usuarios.find((u) => u.id === n.usuarioId)?.rol ?? 'usuario'
    try {
      await enviarA(n.usuarioId, { titulo: n.titulo, mensaje: n.mensaje, url: RUTA_POR_ROL[rol] })
    } catch (e) {
      console.warn('[push] error:', (e as Error).message)
    }
  }
  return nuevas.length
}
