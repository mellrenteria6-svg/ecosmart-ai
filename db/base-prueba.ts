// PostgreSQL de prueba en memoria (PGlite) con el esquema, los datos y todas las migraciones.
// Lo usan las pruebas de integración: no toca la base real.
import { PGlite } from '@electric-sql/pglite'
import { citext } from '@electric-sql/pglite/contrib/citext'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))

export async function crearBasePrueba() {
  const db = await PGlite.create({ extensions: { pgcrypto, citext } })
  const archivos = ['schema.sql', 'seed.sql', ...readdirSync(path.join(DIR, 'migraciones')).sort().map((f) => path.join('migraciones', f))]
  for (const f of archivos) await db.exec(readFileSync(path.join(DIR, f), 'utf8'))
  return db
}
