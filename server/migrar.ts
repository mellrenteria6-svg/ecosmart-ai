// Prepara la base de datos: si está vacía (por ejemplo, recién creada en la nube) carga el
// esquema y los datos iniciales; después aplica las migraciones pendientes de db/migraciones.
// Con BLOQUEAR_DEMO=1 deja bloqueadas las cuentas de demostración (su clave es pública en GitHub).
// Uso: npm run db:migrar   (en la nube corre solo al arrancar: npm start)
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './db'

const RAIZ_BD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'db')
const DIR = path.join(RAIZ_BD, 'migraciones')

const c = await pool.connect()
try {
  await c.query("SET client_min_messages = warning")
  // Base vacía: esquema y datos iniciales (lo mismo que hace db/instalar.ps1 en la PC)
  if (!(await c.query("SELECT to_regclass('public.usuario') IS NOT NULL AS ok")).rows[0].ok) {
    console.log('Base vacía: cargando esquema y datos iniciales...')
    for (const archivo of ['schema.sql', 'seed.sql']) await c.query(readFileSync(path.join(RAIZ_BD, archivo), 'utf8'))
  }
  await c.query('CREATE TABLE IF NOT EXISTS migracion_aplicada (nombre TEXT PRIMARY KEY, aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now())')
  // Bases creadas antes del registro de migraciones
  const existe = async (tabla: string) => (await c.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`public.${tabla}`])).rows[0].ok
  if (await existe('institucion')) await c.query("INSERT INTO migracion_aplicada (nombre) VALUES ('002_instituciones.sql') ON CONFLICT DO NOTHING")
  if (await existe('correo_simulado')) await c.query("INSERT INTO migracion_aplicada (nombre) VALUES ('003_servidor.sql') ON CONFLICT DO NOTHING")

  const hechas = new Set((await c.query('SELECT nombre FROM migracion_aplicada')).rows.map((r) => r.nombre))
  let n = 0
  for (const archivo of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
    if (hechas.has(archivo)) continue
    console.log(`Aplicando ${archivo}...`)
    await c.query(readFileSync(path.join(DIR, archivo), 'utf8'))
    await c.query('INSERT INTO migracion_aplicada (nombre) VALUES ($1)', [archivo])
    n += 1
  }
  console.log(n ? `Listo: ${n} migraciones aplicadas.` : 'La base ya estaba al día.')
  if (process.env.BLOQUEAR_DEMO === '1') {
    const { rowCount } = await c.query("UPDATE usuario SET bloqueado = true WHERE correo LIKE '%@universidad.edu.ec' AND NOT bloqueado")
    if (rowCount) console.log(`Cuentas de demostración bloqueadas: ${rowCount}.`)
  }
} catch (e) {
  console.error('No se pudo migrar:', (e as Error).message)
  process.exitCode = 1
} finally {
  c.release()
  await pool.end()
}
