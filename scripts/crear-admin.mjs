// Crea (o reconfigura) la cuenta de administración principal de EcoSmart AI.
// - Genera una contraseña segura al azar que no se muestra en pantalla.
// - La guarda en una carpeta privada fuera del proyecto y de OneDrive
//   (%USERPROFILE%\EcoSmart-privado\administrador.txt), legible solo por la cuenta actual de Windows.
// - Si la cuenta ya existe, la vuelve administradora, la desbloquea y le pone una contraseña nueva.
//
// Uso: node --env-file=server/.env scripts/crear-admin.mjs
import { randomInt } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import pg from 'pg'

// Lee línea por línea (funciona escribiendo a mano o con las respuestas ya preparadas)
const lector = createInterface({ input: process.stdin })
const lineas = lector[Symbol.asyncIterator]()
const preguntar = async (texto) => {
  process.stdout.write(texto)
  const r = await lineas.next()
  return r.done ? '' : r.value
}
console.log('\nCuenta de administración de EcoSmart AI')
console.log('Usa un correo que puedas abrir: la primera vez en cada equipo te llega ahí un código.\n')
const correo = (await preguntar('Correo del administrador: ')).trim().toLowerCase()
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
  console.error('Ese no parece un correo válido.')
  process.exit(1)
}
const nombre = (await preguntar('Nombre completo: ')).trim() || 'Administración'
lector.close()

// Contraseña de 16 caracteres sin letras confusas (0/O, 1/l/I), con letras y números
const LETRAS = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'
const NUMEROS = '23456789'
const TODOS = LETRAS + NUMEROS
let clave = ''
while (!/[A-Za-z]/.test(clave) || !/\d/.test(clave)) clave = Array.from({ length: 16 }, () => TODOS[randomInt(TODOS.length)]).join('')

// En la PC usa server/.env; para la base de la nube, la dirección DATABASE_URL
const c = new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : undefined)
await c.connect()
let creada = false
try {
  await c.query('BEGIN')
  const { rows } = await c.query('SELECT id FROM usuario WHERE correo = $1', [correo])
  let id = rows[0]?.id
  if (id) {
    await c.query(
      `UPDATE usuario SET rol = 'admin', verificado = true, bloqueado = false, intentos_fallidos = 0, bloqueo_temporal_hasta = NULL,
              password_hash = crypt($2, gen_salt('bf')), sesion_version = sesion_version + 1 WHERE id = $1`,
      [id, clave],
    )
    await c.query('DELETE FROM sesion WHERE usuario_id = $1', [id])
    await c.query('DELETE FROM equipo_confianza WHERE usuario_id = $1', [id])
  } else {
    const r = await c.query(
      `INSERT INTO usuario (campus_id, nombre, correo, facultad, rol, password_hash, verificado, consentimiento_privacidad)
       VALUES (1, $1, $2, 'Administración', 'admin', crypt($3, gen_salt('bf')), true, true) RETURNING id`,
      [nombre, correo, clave],
    )
    id = r.rows[0].id
    creada = true
  }
  await c.query("INSERT INTO auditoria (actor_id, accion, entidad, entidad_id, detalle) VALUES (NULL, $1, 'USUARIO', $2, $3)", [
    creada ? 'Crear administrador principal' : 'Restablecer administrador principal',
    id,
    'Desde scripts/crear-admin.mjs; contraseña nueva generada al azar',
  ])
  await c.query('COMMIT')
} catch (e) {
  await c.query('ROLLBACK').catch(() => {})
  console.error('No se pudo crear la cuenta:', e.message)
  process.exit(1)
} finally {
  await c.end()
}

// Carpeta privada: fuera del proyecto (no va a GitHub) y fuera de OneDrive (no se sube a la nube)
const carpeta = process.env.ECOSMART_PRIVADO ?? path.join(os.homedir(), 'EcoSmart-privado')
// La cuenta de la nube se guarda aparte para no pisar la de la PC
const archivo = path.join(carpeta, process.env.DATABASE_URL ? 'administrador-nube.txt' : 'administrador.txt')
mkdirSync(carpeta, { recursive: true })
writeFileSync(
  archivo,
  [
    `EcoSmart AI - Cuenta de administracion (${process.env.DATABASE_URL ? 'pagina publicada en internet' : 'base de datos de esta PC'})`,
    '',
    `Correo:     ${correo}`,
    `Contrasena: ${clave}`,
    '',
    'Copia y pega estos datos en "Ingresar". La primera vez en cada equipo llega un codigo a ese correo.',
    'Desde el panel: Usuarios > cambia el rol de cualquier persona.',
    'Para cambiar la contrasena: Mi perfil > Cambiar contrasena (y actualiza este archivo).',
    'Si la pierdes, vuelve a correr: node --env-file=server/.env scripts/crear-admin.mjs',
    '',
  ].join('\r\n'),
  'utf8',
)
clave = ''
// Solo la cuenta actual de Windows puede abrir la carpeta y el archivo
const usuarioWindows = process.env.USERNAME
execFileSync('icacls', [carpeta, '/inheritance:r', '/grant:r', `${usuarioWindows}:(OI)(CI)F`], { stdio: 'ignore' })
execFileSync('icacls', [archivo, '/inheritance:r', '/grant:r', `${usuarioWindows}:F`], { stdio: 'ignore' })

console.log(`\nListo: cuenta ${creada ? 'creada' : 'actualizada'} como administradora.`)
console.log(`Tus datos de acceso están en: ${archivo}`)
console.log(`Solo tu usuario de Windows (${usuarioWindows}) puede abrir esa carpeta.\n`)
