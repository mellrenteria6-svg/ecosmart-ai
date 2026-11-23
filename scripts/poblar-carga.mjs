// Llena una base de PRUEBA con datos de un campus grande para medir RNF02 y RNF09.
// Nunca se ejecuta sobre la base "ecosmart". Deja sesiones listas en scripts/tokens-carga.json.
//
// Uso (con la clave de server/.env):
//   node --env-file=server/.env scripts/poblar-carga.mjs --base=ecosmart_carga --cuentas=5000 --sesiones=100
import { createHash, randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import pg from 'pg'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
const base = args.base ?? 'ecosmart_carga'
const cuentas = Number(args.cuentas ?? 5000)
const sesiones = Number(args.sesiones ?? 100)
const reciclajesPorCuenta = Number(args.reciclajes ?? 4)

if (base === 'ecosmart') throw new Error('Por seguridad, este script no se ejecuta sobre la base ecosmart.')

const c = new pg.Client({ database: base })
await c.connect()
const t0 = Date.now()
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`)

await c.query('BEGIN')
// Una sola contraseña cifrada para todas las cuentas de prueba (bcrypt es lento a propósito)
const { rows: [{ hash }] } = await c.query("SELECT crypt('Carga2026x', gen_salt('bf')) AS hash")
const { rows: dominios } = await c.query('SELECT dominio::text, institucion_id FROM institucion_dominio ORDER BY dominio')

// 1. Cuentas de usuario repartidas entre las universidades
await c.query(
  `INSERT INTO usuario (campus_id, nombre, correo, facultad, rol, password_hash, verificado, consentimiento_privacidad, institucion_id, creado_en)
   SELECT 1, 'Estudiante de carga ' || g, 'carga' || g || '@' || d.dominio, (ARRAY['Ingeniería','Ciencias Económicas','Ciencias de la Salud','Arquitectura y Diseño','Educación'])[1 + g % 5],
          'usuario', $1, true, true, d.institucion_id, now() - (g % 200) * interval '1 day'
   FROM generate_series(1, $2) g
   JOIN LATERAL (SELECT * FROM jsonb_to_recordset($3::jsonb) AS x(dominio text, institucion_id text) OFFSET (g % $4) LIMIT 1) d ON true`,
  [hash, cuentas, JSON.stringify(dominios), dominios.length],
)
log(`${cuentas} cuentas creadas`)

// 2. Reciclajes: la mayoría validados (con su movimiento de puntos), algunos pendientes
const { rows: versiones } = await c.query(
  `SELECT cv.categoria_id, max(cv.version) AS version, c.unidad, c.puntos_por_unidad
   FROM categoria_version cv JOIN categoria_residuo c ON c.id = cv.categoria_id WHERE c.activa GROUP BY cv.categoria_id, c.unidad, c.puntos_por_unidad`,
)
await c.query(
  `INSERT INTO reciclaje (idempotency_key, usuario_id, punto_id, categoria_id, categoria_ia, confianza_ia, modelo_version,
          cantidad_reportada, cantidad_final, unidad, puntos_por_unidad, categoria_version, puntos_estimados, estado,
          foto_url, foto_hash, creado_en, validado_en)
   SELECT 'carga-' || u.n || '-' || k, u.id, (ARRAY['p-biblioteca','p-cafeteria','p-ingenieria'])[1 + (u.n + k) % 3],
          v.categoria_id, v.categoria_id, 0.8 + (k % 2) * 0.1, 'clip-vit-b32-q8-zs-1.0',
          2, CASE WHEN (u.n + k) % 5 = 0 THEN NULL ELSE 2 END, v.unidad, v.puntos_por_unidad, v.version, round(2 * v.puntos_por_unidad),
          (CASE WHEN (u.n + k) % 5 = 0 THEN 'pendiente' ELSE 'validado' END)::estado_reciclaje,
          CASE WHEN (u.n + k) % 5 = 0 THEN 'data:image/jpeg;base64,' || repeat('A', 4000) ELSE '' END,
          substr(md5(u.n || '-' || k), 1, 16), now() - (k * 3 + u.n % 7) * interval '1 day',
          CASE WHEN (u.n + k) % 5 = 0 THEN NULL ELSE now() - (k * 3 + u.n % 7 - 1) * interval '1 day' END
   FROM (SELECT id, row_number() OVER (ORDER BY creado_en) AS n FROM usuario WHERE correo LIKE 'carga%') u
   CROSS JOIN generate_series(1, $1) k
   JOIN LATERAL (SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(categoria_id text, version int, unidad text, puntos_por_unidad numeric) OFFSET ((u.n + k) % $3) LIMIT 1) v ON true`,
  [reciclajesPorCuenta, JSON.stringify(versiones), versiones.length],
)
await c.query(
  `INSERT INTO movimiento_puntos (usuario_id, tipo, puntos, referencia_id, descripcion, creado_en)
   SELECT usuario_id, 'reciclaje', puntos_estimados, id::text, 'Reciclaje validado (carga)', validado_en
   FROM reciclaje WHERE idempotency_key LIKE 'carga-%' AND estado = 'validado' AND puntos_estimados > 0`,
)
const { rows: [{ n: nRec }] } = await c.query("SELECT count(*)::int AS n FROM reciclaje WHERE idempotency_key LIKE 'carga-%'")
log(`${nRec} reciclajes y sus movimientos de puntos`)

// 3. Notificaciones (dos por cuenta)
await c.query(
  `INSERT INTO notificacion (usuario_id, titulo, mensaje, leida, creado_en)
   SELECT id, 'Reciclaje validado', 'Tu reciclaje sumó EcoPoints.', k = 1, now() - k * interval '1 day'
   FROM usuario CROSS JOIN generate_series(1, 2) k WHERE correo LIKE 'carga%'`,
)

// 4. Sesiones abiertas para la prueba: se guardan solo los hashes en la base
const { rows: elegidos } = await c.query(`SELECT id, sesion_version FROM usuario WHERE correo LIKE 'carga%' ORDER BY random() LIMIT $1`, [sesiones])
const tokens = []
for (const u of elegidos) {
  const token = randomBytes(32).toString('base64url')
  await c.query(`INSERT INTO sesion (usuario_id, sesion_version, expira_en, token_hash) VALUES ($1, $2, now() + interval '1 day', $3)`, [
    u.id,
    u.sesion_version,
    createHash('sha256').update(token).digest('hex'),
  ])
  tokens.push(token)
}
await c.query('COMMIT')
await c.query('ANALYZE')
writeFileSync(new URL('./tokens-carga.json', import.meta.url), JSON.stringify(tokens))

const { rows: [tot] } = await c.query(
  `SELECT (SELECT count(*) FROM usuario)::int AS usuarios, (SELECT count(*) FROM reciclaje)::int AS reciclajes,
          (SELECT count(*) FROM movimiento_puntos)::int AS movimientos, (SELECT count(*) FROM notificacion)::int AS notificaciones`,
)
log(`Listo en ${base}: ${JSON.stringify(tot)} · ${tokens.length} sesiones en scripts/tokens-carga.json`)
await c.end()
