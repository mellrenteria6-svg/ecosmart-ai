// Servidor de EcoSmart AI: arranca la API sobre PostgreSQL (configuración en server/.env).
import { app, pool } from './app'

const PUERTO = Number(process.env.PUERTO ?? 3001)

app.listen(PUERTO, async () => {
  try {
    const { rows } = await pool.query('SELECT current_database() AS bd, version() AS v')
    console.log(`EcoSmart AI API en http://localhost:${PUERTO}/api  ·  base "${rows[0].bd}"  ·  ${String(rows[0].v).split(',')[0]}`)
  } catch (e) {
    console.error('No se pudo conectar a PostgreSQL. Revisa server/.env', (e as Error).message)
  }
})
