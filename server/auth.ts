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
// Los códigos de 6 dígitos (segundo factor y cambio de contraseña) se guardan junto al usuario
// para que no choquen entre cuentas
const esCodigo = (tipo: string) => tipo === 'segundo_factor' || tipo === 'restablecer'
const claveToken = (valor: string, tipo: string, usuarioId?: string) => sha256(esCodigo(tipo) ? `${usuarioId}:${valor}` : valor)
const codigoSeisDigitos = () => String(randomInt(100000, 1000000))
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

// Registro sin código ni enlace de verificación: la cuenta queda lista y se entra de inmediato.
// Los correos internos (@eco.smart.com y sus variantes por rol) solo se registran si la
// administración ya los creó: la persona pone aquí su nombre y su propia contraseña.
export function registrar(d: { nombre: string; correo: string; facultad: string; password: string; consentimiento: boolean }) {
  return enTransaccion(async (c) => {
    const correoN = String(d.correo ?? '').trim().toLowerCase()
    const nombre = String(d.nombre ?? '').trim()
    if (!nombre) throw new ErrorHttp(400, 'Ingresa tu nombre.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correoN)) throw new ErrorHttp(400, 'Escribe un correo válido, por ejemplo nombre@gmail.com.')
    if (!d.consentimiento) throw new ErrorHttp(400, 'Debes aceptar el aviso de privacidad para continuar.')
    validarPassword(d.password)
    const { rows: previa } = await c.query('SELECT id, verificado FROM usuario WHERE correo = $1', [correoN])
    const interno = (await c.query('SELECT es_correo_interno($1) AS si', [correoN])).rows[0].si as boolean
    let id: string
    if (interno) {
      if (!previa[0]) throw new ErrorHttp(400, 'Ese correo aún no existe: pídele a la administración que lo cree.')
      if (previa[0].verificado) throw new ErrorHttp(409, 'Esta cuenta ya está registrada. Inicia sesión o recupera tu contraseña.')
      id = previa[0].id
      await c.query(
        `UPDATE usuario SET nombre = $2, facultad = COALESCE(NULLIF($3, ''), facultad), password_hash = crypt($4, gen_salt('bf')),
                verificado = true, consentimiento_privacidad = true, intentos_fallidos = 0, bloqueo_temporal_hasta = NULL WHERE id = $1`,
        [id, nombre, String(d.facultad ?? '').trim(), d.password],
      )
      await auditar(c, id, 'Activar cuenta interna', id, correoN)
    } else {
      if (previa[0]) throw new ErrorHttp(409, 'Ya existe una cuenta con este correo. Inicia sesión o recupera tu contraseña.')
      // La universidad del dominio o, si no hay, "Invitados" (si la administración la tiene activa)
      const { rows: inst } = await c.query('SELECT institucion_para_registro($1) AS id', [correoN])
      if (!inst[0].id) throw new ErrorHttp(400, 'Usa el correo de una universidad participante. Si tu universidad no aparece, pide al administrador que la agregue.')
      const { rows } = await c.query(
        `INSERT INTO usuario (campus_id, nombre, correo, facultad, password_hash, verificado, consentimiento_privacidad, institucion_id)
         VALUES (1, $1, $2, $3, crypt($4, gen_salt('bf')), true, true, $5) RETURNING id`,
        [nombre, correoN, d.facultad, d.password, inst[0].id],
      )
      id = rows[0].id
      await auditar(c, id, 'Registrar cuenta', id, correoN)
    }
    return { usuario: { id, nombre, correo: correoN }, sesion: await abrirSesion(c, id) }
  })
}

// Ya no se verifica el correo al registrarse (las cuentas quedan listas al crearlas). Se conserva
// la ruta para enlaces antiguos, pero no envía nada: así no puede "verificarse" una cuenta interna
// pendiente que aún no tiene contraseña.
export async function reenviarVerificacion(_correo: string) {
  void _correo
  return {}
}

export function verificarCorreo(token: string) {
  return enTransaccion(async (c) => {
    const id = await consumirToken(c, String(token ?? ''), 'verificacion')
    const { rows } = await c.query('UPDATE usuario SET verificado = true WHERE id = $1 RETURNING id, nombre, correo', [id])
    await auditar(c, id, 'Verificar correo', id, rows[0].correo)
    return { usuario: rows[0] }
  })
}

/** Olvida los equipos de confianza de estas cuentas (cambio de contraseña, de rol o bloqueo). */
export async function olvidarEquipos(c: PoolClient, usuarioIds: string[]) {
  if (usuarioIds.length) await c.query('DELETE FROM equipo_confianza WHERE usuario_id = ANY($1::uuid[])', [usuarioIds])
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
    // Cuenta interna creada por la administración que la persona aún no registró
    if (!u.verificado && (await c.query('SELECT es_correo_interno($1) AS si', [u.correo])).rows[0].si) {
      throw new ErrorHttp(403, 'Esta cuenta aún no está registrada: entra a "Regístrate" con este correo y crea tu contraseña.')
    }
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
    // Sin códigos al entrar: el único código es el de cambiar la contraseña (decisión del equipo)
    await c.query('UPDATE usuario SET intentos_fallidos = 0, bloqueo_temporal_hasta = NULL, verificado = true WHERE id = $1', [u.id])
    return { tipo: 'ok', sesion: await abrirSesion(c, u.id) }
  }).then((r) => {
    // El conteo de intentos se guarda aunque el inicio de sesión falle
    if ('error' in r && r.error) throw new ErrorHttp(401, r.error)
    return r
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
      // Cambiar la contraseña pide un código de 6 dígitos enviado al correo
      const codigo = codigoSeisDigitos()
      await crearToken(c, rows[0].id, 'restablecer', 15, codigo)
      await correo(c, rows[0].correo, 'Código para cambiar tu contraseña', `Tu código para cambiar la contraseña de EcoSmart AI es ${codigo}. Vence en 15 minutos.`)
    }
    return {} // respuesta genérica: no revela si el correo existe
  })
}

export function restablecerPassword(correoIn: string, codigo: string, password: string) {
  validarPassword(password)
  return enTransaccion(async (c) => {
    const { rows } = await c.query('SELECT id FROM usuario WHERE correo = $1', [String(correoIn ?? '').trim()])
    if (!rows[0]) throw new ErrorHttp(400, 'El enlace o código no es válido o ya fue utilizado.')
    const id = await consumirToken(c, String(codigo ?? '').trim(), 'restablecer', rows[0].id)
    // Con la contraseña nueva la cuenta queda lista (también una cuenta interna aún sin registrar)
    await c.query("UPDATE usuario SET password_hash = crypt($2, gen_salt('bf')), sesion_version = sesion_version + 1, intentos_fallidos = 0, bloqueo_temporal_hasta = NULL, verificado = true WHERE id = $1", [id, password])
    await c.query('DELETE FROM sesion WHERE usuario_id = $1', [id])
    await olvidarEquipos(c, [id]) // con la contraseña nueva, cada equipo vuelve a pedir el código
    await auditar(c, id, 'Restablecer contraseña', id, 'Sesiones y equipos de confianza revocados')
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

// ---------------------------------------------------------------------------
// Cuentas internas: la administración las crea con el dominio de cada rol
// ---------------------------------------------------------------------------
const ROLES = ['usuario', 'recolector', 'aliado', 'admin'] as const
type RolInterno = (typeof ROLES)[number]

async function exigirAdmin(c: PoolClient, adminId: string) {
  const { rows } = await c.query("SELECT 1 FROM usuario WHERE id = $1 AND rol = 'admin' AND NOT bloqueado", [adminId])
  if (!rows[0]) throw new ErrorHttp(403, 'Solo la administración puede hacer esto.')
}

/** Dominio interno de cada rol. */
export async function dominiosInternos(adminId: string) {
  const c = await pool.connect()
  try {
    await exigirAdmin(c, adminId)
    const { rows } = await c.query('SELECT rol::text AS rol, dominio::text AS dominio FROM dominio_interno ORDER BY rol')
    return { dominios: Object.fromEntries(rows.map((r) => [r.rol, r.dominio])) as Record<RolInterno, string> }
  } finally {
    c.release()
  }
}

export function guardarDominiosInternos(adminId: string, datos: unknown) {
  return enTransaccion(async (c) => {
    await exigirAdmin(c, adminId)
    const d = (datos ?? {}) as Record<string, unknown>
    const nuevos = ROLES.map((rol) => [rol, String(d[rol] ?? '').trim().toLowerCase().replace(/^@/, '')] as const)
    for (const [rol, dominio] of nuevos) {
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(dominio)) throw new ErrorHttp(400, `"${dominio || '(vacío)'}" no es un dominio válido para ${rol}. Ejemplo: aliado.eco.smart.com`)
    }
    if (new Set(nuevos.map(([, x]) => x)).size !== nuevos.length) throw new ErrorHttp(400, 'Cada rol necesita un dominio distinto.')
    const choca = await c.query('SELECT dominio::text AS d FROM institucion_dominio WHERE dominio = ANY($1::citext[])', [nuevos.map(([, x]) => x)])
    if (choca.rows[0]) throw new ErrorHttp(400, `El dominio ${choca.rows[0].d} ya pertenece a una universidad.`)
    // Se reemplazan todos juntos (los únicos se comprueban al final de la transacción)
    await c.query('DELETE FROM dominio_interno')
    for (const [rol, dominio] of nuevos) await c.query('INSERT INTO dominio_interno (rol, dominio) VALUES ($1, $2)', [rol, dominio])
    await c.query("INSERT INTO auditoria (actor_id, accion, entidad, entidad_id, detalle) VALUES ($1, 'Cambiar dominios internos', 'DOMINIO_INTERNO', '*', $2)", [
      adminId,
      nuevos.map(([r, x]) => `${r}: ${x}`).join(', '),
    ])
    return { dominios: Object.fromEntries(nuevos) }
  })
}

/** Reserva una cuenta con el dominio interno del rol. La persona la activa en "Regístrate" con su propia contraseña. */
export function crearCuentaInterna(adminId: string, datos: unknown) {
  return enTransaccion(async (c) => {
    await exigirAdmin(c, adminId)
    const d = (datos ?? {}) as Record<string, unknown>
    const nombre = String(d.nombre ?? '').trim()
    const usuario = String(d.usuario ?? '').trim().toLowerCase()
    const rol = String(d.rol ?? '') as RolInterno
    const facultad = String(d.facultad ?? '').trim().slice(0, 120)
    if (nombre.length > 120) throw new ErrorHttp(400, 'El nombre es demasiado largo.')
    if (!/^[a-z0-9]([a-z0-9._-]{0,38}[a-z0-9])?$/.test(usuario)) throw new ErrorHttp(400, 'El usuario solo puede tener letras, números, punto, guion o guion bajo (sin espacios ni tildes), por ejemplo: juan.perez')
    if (!ROLES.includes(rol)) throw new ErrorHttp(400, 'Elige un rol válido.')
    const { rows: dom } = await c.query('SELECT dominio::text AS dominio FROM dominio_interno WHERE rol = $1', [rol])
    if (!dom[0]) throw new ErrorHttp(400, 'Ese rol no tiene dominio interno configurado.')
    const correo = `${usuario}@${dom[0].dominio}`
    if ((await c.query('SELECT 1 FROM usuario WHERE correo = $1', [correo])).rowCount) throw new ErrorHttp(409, `Ya existe la cuenta ${correo}.`)
    const institucionId = String(d.institucionId ?? '') || 'inst-invitados'
    if (!(await c.query('SELECT 1 FROM institucion WHERE id = $1', [institucionId])).rowCount) throw new ErrorHttp(400, 'Universidad no encontrada.')
    // Sin contraseña conocida: queda pendiente hasta que la persona se registre con este correo
    const { rows } = await c.query(
      `INSERT INTO usuario (campus_id, nombre, correo, facultad, rol, password_hash, verificado, consentimiento_privacidad, institucion_id)
       VALUES (1, $1, $2, $3, $4, crypt($5, gen_salt('bf')), false, false, $6) RETURNING id`,
      [nombre || usuario, correo, facultad || 'EcoSmart AI', rol, tokenAleatorio(24), institucionId],
    )
    await auditar(c, adminId, 'Crear cuenta interna', rows[0].id, `${correo} (${rol}), pendiente de registro`)
    return { correo, usuarioId: rows[0].id as string }
  })
}
