// Envío real de correos (RF01 verificación, RF02 recuperación, RNF13 segundo factor).
// Cada correo se guarda primero en correo_simulado (bandeja de demostración) dentro de la misma
// transacción que lo origina; este "cartero" envía por SMTP los que ya quedaron confirmados y
// anota el resultado. Así un correo nunca sale si la operación se deshizo, y si el servidor de
// correo falla se reintenta. Sin SMTP configurado (server/.env) no hace nada.
import nodemailer from 'nodemailer'
import { pool } from './db'

export interface Transporte {
  sendMail(m: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown>
}

const MAX_INTENTOS = 5
const POR_VUELTA = 20
// Solo se envían correos recientes: un código o enlace viejo ya venció y confundiría al usuario
const ANTIGUEDAD_MAXIMA = '1 hour'

function transporteDesdeEntorno(): Transporte | null {
  const usuario = process.env.SMTP_USUARIO
  const clave = process.env.SMTP_CLAVE
  if (!usuario || !clave) return null
  const puerto = Number(process.env.SMTP_PUERTO ?? 465)
  return nodemailer.createTransport({ host: process.env.SMTP_HOST ?? 'smtp.gmail.com', port: puerto, secure: puerto === 465, auth: { user: usuario, pass: clave } })
}

let transporte: Transporte | null = transporteDesdeEntorno()
/** Para las pruebas: un transporte falso que registra los envíos. */
export function usarTransporte(t: Transporte | null) {
  transporte = t
}
export const correoActivo = () => transporte !== null

const remitente = () => process.env.CORREO_REMITENTE ?? `EcoSmart AI <${process.env.SMTP_USUARIO ?? 'no-responder@ecosmart.local'}>`
/**
 * Buzón real que recibe los correos de las cuentas de demostración (que no tienen buzón propio).
 * Por defecto, el mismo correo remitente del proyecto.
 */
export function destinoDemostracion(): string | null {
  const explicito = process.env.CORREO_DEMO_DESTINO?.trim()
  if (explicito) return explicito
  const deRemitente = process.env.CORREO_REMITENTE?.match(/<([^>]+@[^>]+)>/)?.[1] ?? process.env.CORREO_REMITENTE
  return deRemitente && /^[^@\s<>]+@[^@\s<>]+$/.test(deRemitente.trim()) ? deRemitente.trim() : null
}
/** Dominios sin buzón real (cuentas de demostración): sus correos quedan solo en la bandeja simulada. */
const dominiosSinEnvio = () => (process.env.CORREO_NO_ENVIAR ?? 'universidad.edu.ec').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean)

/** ¿Es una cuenta de demostración (sin buzón real)? */
export const esCorreoDeDemostracion = (para: string) => dominiosSinEnvio().some((d) => para.toLowerCase().endsWith('@' + d))

/** Los enlaces se guardan como ruta de la app ("#/verificar?token=…"); en el correo van completos. */
export function enlaceCompleto(enlace: string) {
  if (/^https?:\/\//.test(enlace)) return enlace
  const base = (process.env.URL_PUBLICA ?? 'http://localhost:5173/').replace(/\/*$/, '/')
  return base + enlace.replace(/^\/+/, '')
}

const html = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export function armarCorreo(fila: { para: string; asunto: string; cuerpo: string; enlace: string | null }) {
  const enlace = fila.enlace ? enlaceCompleto(fila.enlace) : null
  const pie = 'Si no fuiste tú, ignora este mensaje. EcoSmart AI nunca te pedirá tu contraseña por correo.'
  return {
    from: remitente(),
    to: fila.para,
    subject: fila.asunto,
    text: [fila.cuerpo, enlace, '', pie].filter((x) => x !== null).join('\n'),
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;color:#1c2a22">
<h2 style="color:#2f6b3f;margin:0 0 12px">EcoSmart AI</h2>
<p style="font-size:15px;line-height:1.5">${html(fila.cuerpo)}</p>
${enlace ? `<p><a href="${html(enlace)}" style="display:inline-block;background:#2f6b3f;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Abrir EcoSmart AI</a></p><p style="font-size:12px;color:#666">O copia este enlace: ${html(enlace)}</p>` : ''}
<p style="font-size:12px;color:#666;border-top:1px solid #ddd;padding-top:8px">${html(pie)}</p>
</div>`,
  }
}

let repartiendo: Promise<number> | null = null

/** Envía los correos pendientes. Devuelve cuántos salieron. Nunca lanza errores. */
export function repartir(): Promise<number> {
  if (!transporte) return Promise.resolve(0)
  repartiendo ??= vuelta().finally(() => (repartiendo = null))
  return repartiendo
}

async function vuelta(): Promise<number> {
  let enviados = 0
  try {
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      // SKIP LOCKED: si hubiera varios servidores, cada correo lo toma uno solo
      const { rows } = await c.query(
        `SELECT id, para::text AS para, asunto, cuerpo, enlace FROM correo_simulado
         WHERE enviado_en IS NULL AND intentos < $1 AND creado_en > now() - $2::interval
         ORDER BY creado_en LIMIT $3 FOR UPDATE SKIP LOCKED`,
        [MAX_INTENTOS, ANTIGUEDAD_MAXIMA, POR_VUELTA],
      )
      for (const fila of rows) {
        // Cuentas de demostración: el correo va al buzón del proyecto, indicando para quién era
        const demo = esCorreoDeDemostracion(fila.para)
        const destino = demo ? destinoDemostracion() : fila.para
        if (!destino) {
          await c.query("UPDATE correo_simulado SET enviado_en = now(), error = 'Cuenta de demostración sin buzón configurado: solo bandeja simulada' WHERE id = $1", [fila.id])
          continue
        }
        const mensaje = armarCorreo(demo ? { ...fila, asunto: `[Demo: ${fila.para}] ${fila.asunto}`, cuerpo: `(Para la cuenta de demostración ${fila.para}) ${fila.cuerpo}` } : fila)
        try {
          await transporte!.sendMail({ ...mensaje, to: destino })
          await c.query('UPDATE correo_simulado SET enviado_en = now(), intentos = intentos + 1, error = NULL WHERE id = $1', [fila.id])
          enviados += 1
        } catch (e) {
          // El mensaje del servidor de correo no incluye la clave; se guarda para revisar
          const motivo = (e instanceof Error ? e.message : String(e)).slice(0, 300)
          await c.query('UPDATE correo_simulado SET intentos = intentos + 1, error = $2 WHERE id = $1', [fila.id, motivo])
          console.warn('[correo] no se pudo enviar:', motivo)
        }
      }
      await c.query('COMMIT')
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      c.release()
    }
  } catch (e) {
    console.warn('[correo] error:', (e as Error).message)
  }
  return enviados
}

// Tras cada operación que pudo crear correos se avisa al cartero; además revisa cada 15 s
// (reintentos y correos creados por otros servidores).
let aviso: NodeJS.Timeout | null = null
export function avisarCartero() {
  if (!transporte || aviso) return
  aviso = setTimeout(() => {
    aviso = null
    void repartir()
  }, 200)
  aviso.unref()
}
const INTERVALO_MS = Number(process.env.CORREO_INTERVALO_MS ?? 15_000)
if (INTERVALO_MS > 0) setInterval(() => void repartir(), INTERVALO_MS).unref()
