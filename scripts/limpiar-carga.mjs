// Borra los reciclajes que dejó la prueba de carga (modelo "carga") en la base de prueba, para
// repetirla sin chocar con el tope diario de 10 registros por cuenta (RN05).
// Uso: node --env-file=server/.env scripts/limpiar-carga.mjs --base=ecosmart_carga
import pg from 'pg'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
const base = args.base ?? 'ecosmart_carga'
if (base === 'ecosmart') throw new Error('Por seguridad, este script no se ejecuta sobre la base ecosmart.')

const c = new pg.Client({ database: base })
await c.connect()
await c.query('BEGIN')
const ids = "SELECT id FROM reciclaje WHERE modelo_version = 'carga'"
const alertas = await c.query(`DELETE FROM alerta_fraude WHERE reciclaje_id IN (${ids})`)
const reciclajes = await c.query("DELETE FROM reciclaje WHERE modelo_version = 'carga'")
await c.query('COMMIT')
await c.end()
console.log(`Base "${base}": ${reciclajes.rowCount} reciclajes y ${alertas.rowCount} alertas de la prueba de carga eliminados.`)
