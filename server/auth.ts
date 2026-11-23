// Autenticación contra PostgreSQL (RF01, RF02, RNF04, RNF13).
// Contraseñas con bcrypt (pgcrypto), sesiones con token aleatorio guardado como hash.
import { createHash, randomBytes, randomInt } from 'node:crypto'
import type { PoolClient } from 'pg'
import { avisarCartero } from './correo'
import { pool } from './db'

export class ErrorHttp extends Error {
  readonly estado: number
  constructor(estado: number, mensaje: string) {
    super(mensaje)
    this.estado = estado
  }
}

const sha256 = (t: string) => createHash('sha256').update(t).digest('hex')
// Los códigos de 6 dígitos se guardan junto al usuario para que no choquen entre cuentas
const claveToken = (valor: string, tipo: string, usuarioId?: string) => sha256(tipo === 'segundo_factor' ? `${usuarioId}:${valor}` : valor)
const tokenAleatorio = (bytes = 18) => randomBytes(bytes).toString('base64url')
const DIAS_SESION = 7

export interface SesionCliente {
  usuarioId: string
  sesionVersion: number
  creadaEn: number
  token: string
}

async function enTransaccion<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    const r = await fn(c)
    await c.query('COMMIT')
    avisarCartero() // si la operación dejó correos (verificación, código, recuperación), salen ya
    return r
  } catch (e) {
    await c.query('ROLLBACK')
    throw e
  } finally {
    c.release()
  }
}

async function correo(c: PoolClient, para: string, asunto: string, cuerpo: string, enlace?: string) {
  await c.query('INSERT INTO correo_simulado (para, asunto, cuerpo, enlace) VALUES ($1, $2, $3, $4)', [para, asunto, cuerpo, enlace ?? null])
}

async function auditar(c: PoolClient, actorId: string | null, accion: string, entidadId: string, detalle = '') {
  await c.query('INSERT INTO auditoria (actor_id, accion, entidad, entidad_id, detalle) VALUES ($1, $2, $3, $4, $5)', [actorId, accion, 'USUARIO', entidadId, detalle])
}

async function crearToken(c: PoolClient, usuarioId: string, tipo: string, minutos: number, valor = tokenAleatorio()) {
  // Un token nuevo invalida los anteriores del mismo tipo
  await c.query('UPDATE token SET usado = true WHERE usuario_id = $1 AND tipo = $2 AND NOT usado', [usuarioId, tipo])
  await c.query(`INSERT INTO token (token, usuario_id, tipo, vence_en) VALUES ($1, $2, $3, now() + make_interval(mins => $4))`, [claveToken(valor, tipo, usuarioId), usuarioId, tipo, minutos])
  return valor
}

async function consumirToken(c: PoolClient, valor: string, tipo: string, usuarioId?: string) {
  const clave = claveToken(valor, tipo, usuarioId)
  const { rows } = await c.query('SELECT usuario_id, usado, vence_en < now() AS vencido FROM token WHERE token = $1 AND tipo = $2 FOR UPDATE', [clave, tipo])
  const t = rows[0]
  if (!t || t.usado || (usuarioId && t.usuario_id !== usuarioId)) throw new ErrorHttp(400, 'El enlace o código no es válido o ya fue utilizado.')
  if (t.vencido) throw new ErrorHttp(400, 'El enlace o código venció. Solicita uno nuevo.')
  await c.query('UPDATE token SET usado = true WHERE token = $1', [clave])
  return t.usuario_id as string
}

function validarPassword(p: string) {
  if (typeof p !== 'string' || p.length < 8 || !/[A-Za-z]/.test(p) || !/\d/.test(p)) {
    throw new ErrorHttp(400, 'La contraseña debe tener al menos 8 caracteres e incluir letras y números.')
  }
}

async function abrirSesion(c: PoolClient, usuarioId: string): Promise<SesionCliente> {
  const token = tokenAleatorio(32)
  const { rows } = await c.query(
    `INSERT INTO sesion (usuario_id, sesion_version, expira_en, token_hash)
     SELECT id, sesion_version, now() + make_interval(days => $3), $2 FROM usuario WHERE id = $1
     RETURNING sesion_version, creada_en`,
    [usuarioId, sha256(token), DIAS_SESION],
  )
  return { usuarioId, sesionVersion: rows[0].sesion_version, creadaEn: new Date(rows[0].creada_en).getTime(), token }
}

/** Usuario dueño del token, si la sesión sigue vigente y no fue revocada. */
export async function usuarioDeToken(token: string | undefined): Promise<string | null> {
  if (!token) return null
  const { rows } = await pool.query(
    `SELECT u.id FROM sesion s JOIN usuario u ON u.id = s.usuario_id
     WHERE s.token_hash = $1 AND s.expira_en > now() AND s.sesion_version = u.sesion_version AND NOT u.bloqueado`,
    [sha256(token)],
  )
  return rows[0]?.id ?? null
}

export function registrar(d: { nombre: string; correo: string; facultad: string; password: string; consentimiento: boolean }) {
  return enTransaccion(async (c) => {
    const correoN = String(d.correo ?? '').trim().toLowerCase()
    if (!String(d.nombre ?? '').trim()) throw new ErrorHttp(400, 'Ingresa tu nombre.')
    const { rows: inst } = await c.query('SELECT institucion_por_correo($1) AS id', [correoN])
    if (!inst[0].id) throw new ErrorHttp(400, 'Usa el correo de una universidad participante. Si tu universidad no aparece, pide al administrador que la agregue.')
    if (!d.consentimiento) throw new ErrorHttp(400, 'Debes aceptar el aviso de privacidad para continuar.')
    validarPassword(d.password)
    const existe = await c.query('SELECT 1 FROM usuario WHERE correo = $1', [correoN])
    if (existe.rowCount) throw new ErrorHttp(409, 'Ya existe una cuenta con este correo. Inicia sesión o recupera tu contraseña.')
    const { rows } = await c.query(
      `INSERT INTO usuario (campus_id, nombre, correo, facultad, password_hash, consentimiento_privacidad, institucion_id)
       VALUES (1, $1, $2, $3, crypt($4, gen_salt('bf')), true, $5) RETURNING id, nombre, correo`,
      [d.nombre.trim(), correoN, d.facultad, d.password, inst[0].id],
    )
    const u = rows[0]
    const token = await crearToken(c, u.id, 'verificacion', 24 * 60)
    await correo(c, correoN, 'Verifica tu cuenta de EcoSmart AI', `Hola ${u.nombre}, confirma tu correo para empezar a reciclar. El enlace vence en 24 horas y solo puede usarse una vez.`, `#/verificar?token=${token}`)
    await auditar(c, u.id, 'Registrar cuenta', u.id, correoN)
    return { usuario: { id: u.id, nombre: u.nombre, correo: u.correo } }
  })
}

export function reenviarVerificacion(correoIn: string) {
  return enTransaccion(async (c) => {
    const { rows } = await c.query('SELECT id, correo FROM usuario WHERE correo = $1 AND NOT verificado', [String(correoIn ?? '').trim()])
    if (!rows[0]) return {}
    const token = await crearToken(c, rows[0].id, 'verificacion', 24 * 60)
    await correo(c, rows[0].correo, 'Nuevo enlace de verificación', 'Usa este enlace para verificar tu cuenta.', `#/verificar?token=${token}`)
    return {}
  })
}

export function verificarCorreo(token: string) {
  return enTransaccion(async (c) => {
    const id = await consumirToken(c, String(token ?? ''), 'verificacion')
    const { rows } = await c.query('UPDATE usuario SET verificado = true WHERE id = $1 RETURNING id, nombre, correo', [id])
    await auditar(c, id, 'Verificar correo', id, rows[0].correo)
    return { usuario: rows[0] }
  })
}

export function iniciarSesion(correoIn: string, password: string) {
  return enTransaccion(async (c) => {
    const { rows } = await c.query(
      `SELECT id, correo, rol, verificado, bloqueado, intentos_fallidos,
              bloqueo_temporal_hasta > now() AS temporal, ceil(extract(epoch FROM bloqueo_temporal_hasta - now()) / 60) AS minutos,
              password_hash = crypt($2, password_hash) AS clave_ok
       FROM usuario WHERE correo = $1 FOR UPDATE`,
      [String(correoIn ?? '').trim(), String(password ?? '')],
    )
    const u = rows[0]
    if (!u) throw new ErrorHttp(401, 'Correo o contraseña incorrectos.')
    if (u.temporal) throw new ErrorHttp(423, `Cuenta bloqueada temporalmente por intentos fallidos. Intenta en ${u.minutos} min.`)
    if (!u.clave_ok) {
      // Cinco intentos fallidos bloquean la cuenta 15 minutos (RNF13)
      if (u.intentos_fallidos + 1 >= 5) {
        await c.query("UPDATE usuario SET intentos_fallidos = 0, bloqueo_temporal_hasta = now() + interval '15 minutes' WHERE id = $1", [u.id])
        await auditar(c, u.id, 'Bloqueo temporal por intentos fallidos', u.id, '5 intentos fallidos')
        return { error: 'Cinco intentos fallidos: la cuenta queda bloqueada 15 minutos.' }
      }
      await c.query('UPDATE usuario SET intentos_fallidos = intentos_fallidos + 1 WHERE id = $1', [u.id])
      return { error: 'Correo o contraseña incorrectos.' }
    }
    if (u.bloqueado) throw new ErrorHttp(403, 'Tu cuenta está bloqueada. Comunícate con el administrador.')
    if (!u.verificado) throw new ErrorHttp(403, 'Verifica tu correo institucional antes de iniciar sesión.')
    await c.query('UPDATE usuario SET intentos_fallidos = 0, bloqueo_temporal_hasta = NULL WHERE id = $1', [u.id])
    if (u.rol === 'admin' || u.rol === 'aliado') {
      const codigo = String(randomInt(100000, 1000000))
      await crearToken(c, u.id, 'segundo_factor', 10, codigo)
      await correo(c, u.correo, 'Código de acceso EcoSmart AI', `Tu código de segundo factor es ${codigo}. Vence en 10 minutos.`)
      return { tipo: 'segundo_factor', usuarioId: u.id }
    }
    return { tipo: 'ok', sesion: await abrirSesion(c, u.id) }
  }).then((r) => {
    // El conteo de intentos se guarda aunque el inicio de sesión falle
    if ('error' in r && r.error) throw new ErrorHttp(401, r.error)
    return r
  })
}

export function verificarSegundoFactor(usuarioId: string, codigo: string) {
  return enTransaccion(async (c) => {
    await consumirToken(c, String(codigo ?? '').trim(), 'segundo_factor', String(usuarioId ?? ''))
    await auditar(c, usuarioId, 'Inicio de sesión con segundo factor', usuarioId)
    return { sesion: await abrirSesion(c, usuarioId) }
  })
}

export function cerrarSesion(usuarioId: string) {
  return enTransaccion(async (c) => {
    // Cerrar sesión revoca los tokens anteriores (RF02)
    await c.query('UPDATE usuario SET sesion_version = sesion_version + 1 WHERE id = $1', [usuarioId])
    await c.query('DELETE FROM sesion WHERE usuario_id = $1', [usuarioId])
    return {}
  })
}

export function solicitarRestablecimiento(correoIn: string) {
  return enTransaccion(async (c) => {
    const { rows } = await c.query('SELECT id, correo FROM usuario WHERE correo = $1', [String(correoIn ?? '').trim()])
    if (rows[0]) {
      const token = await crearToken(c, rows[0].id, 'restablecer', 60)
      await correo(c, rows[0].correo, 'Restablece tu contraseña', 'Recibimos una solicitud para cambiar tu contraseña. El enlace vence en 60 minutos.', `#/restablecer?token=${token}`)
    }
    return {} // respuesta genérica: no revela si el correo existe
  })
}

export function restablecerPassword(token: string, password: string) {
  validarPassword(password)
  return enTransaccion(async (c) => {
    const id = await consumirToken(c, String(token ?? ''), 'restablecer')
    await c.query("UPDATE usuario SET password_hash = crypt($2, gen_salt('bf')), sesion_version = sesion_version + 1, intentos_fallidos = 0, bloqueo_temporal_hasta = NULL WHERE id = $1", [id, password])
    await c.query('DELETE FROM sesion WHERE usuario_id = $1', [id])
    await auditar(c, id, 'Restablecer contraseña', id, 'Sesiones anteriores revocadas')
    return {}
  })
}

export async function bandejaSimulada() {
  const { rows } = await pool.query('SELECT id, para, asunto, cuerpo, enlace, creado_en FROM correo_simulado ORDER BY creado_en DESC LIMIT 50')
  return rows.map((r) => ({ id: r.id, para: r.para, asunto: r.asunto, cuerpo: r.cuerpo, enlace: r.enlace ?? undefined, creadoEn: new Date(r.creado_en).getTime() }))
}

/** Confirma la contraseña del titular antes de una acción sensible. */
export async function comprobarPassword(usuarioId: string, password: unknown) {
  const { rows } = await pool.query('SELECT password_hash = crypt($2, password_hash) AS ok FROM usuario WHERE id = $1', [usuarioId, String(password ?? '')])
  if (!rows[0]?.ok) throw new ErrorHttp(403, 'La contraseña no es correcta.')
}

/** Tras eliminar una cuenta: la contraseña deja de servir y se cierran todas sus sesiones. */
export async function invalidarCredenciales(usuarioId: string) {
  await pool.query("UPDATE usuario SET password_hash = 'cuenta-eliminada' WHERE id = $1", [usuarioId])
  await pool.query('DELETE FROM sesion WHERE usuario_id = $1', [usuarioId])
}
