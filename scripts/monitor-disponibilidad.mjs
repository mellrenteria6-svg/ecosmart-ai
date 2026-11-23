// Monitoreo de disponibilidad (RNF06: "al menos 99 % durante el horario académico";
// "el monitoreo calcula disponibilidad").
//
// Modo verificación (lo corre el Programador de tareas cada 5 minutos):
//   node scripts/monitor-disponibilidad.mjs --url=http://localhost:3001/api/salud
//   → consulta /api/salud (que también prueba PostgreSQL) y agrega una línea a monitoreo/disponibilidad.csv
//
// Modo informe:
//   node scripts/monitor-disponibilidad.mjs --informe [--desde=2026-11-01] [--hasta=2026-11-30]
//   → disponibilidad dentro del horario académico y cobertura del propio monitoreo
//
// Horario académico por defecto: lunes a viernes de 07:00 a 21:00 y sábado de 07:00 a 13:00
// (cambiar con --horario="1-5@07:00-21:00;6@07:00-13:00"; 0 = domingo).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

// "--clave=valor" o "--bandera" (sin valor = 'si')
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [clave, ...valor] = a.replace(/^--/, '').split('=')
    return [clave, valor.length ? valor.join('=') : 'si']
  }),
)
const archivo = args.archivo ?? path.join('monitoreo', 'disponibilidad.csv')
const intervaloMin = Number(args.intervalo ?? 5)
const META = 0.99

function horario(texto = '1-5@07:00-21:00;6@07:00-13:00') {
  return texto.split(';').map((tramo) => {
    const [dias, horas] = tramo.split('@')
    const [d1, d2 = d1] = dias.split('-').map(Number)
    const [h1, h2] = horas.split('-').map((h) => {
      const [hh, mm] = h.split(':').map(Number)
      return hh * 60 + mm
    })
    return { d1, d2, h1, h2 }
  })
}
const tramos = horario(args.horario)
const enHorario = (fecha) => {
  const d = fecha.getDay()
  const m = fecha.getHours() * 60 + fecha.getMinutes()
  return tramos.some((t) => d >= t.d1 && d <= t.d2 && m >= t.h1 && m < t.h2)
}

if (args.informe === undefined) {
  // --- Verificación ---
  const url = args.url ?? 'http://localhost:3001/api/salud'
  const inicio = performance.now()
  let ok = false
  let detalle = ''
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    const cuerpo = await r.json().catch(() => ({}))
    ok = r.ok && cuerpo.ok === true // la API responde y PostgreSQL contesta
    detalle = ok ? 'ok' : `HTTP ${r.status}`
  } catch (e) {
    detalle = e instanceof Error ? e.message : String(e)
  }
  const ms = Math.round(performance.now() - inicio)
  mkdirSync(path.dirname(archivo), { recursive: true })
  if (!existsSync(archivo)) appendFileSync(archivo, 'fecha;ok;ms;detalle\n')
  appendFileSync(archivo, `${new Date().toISOString()};${ok ? 1 : 0};${ms};${detalle.replace(/[;\n]/g, ' ')}\n`)
  console.log(`${ok ? 'Disponible' : 'NO disponible'} (${ms} ms) ${detalle}`)
  process.exit(ok ? 0 : 1)
}

// --- Informe ---
if (!existsSync(archivo)) {
  console.error(`No existe ${archivo}: aún no hay verificaciones registradas.`)
  process.exit(2)
}
const desde = args.desde ? new Date(`${args.desde}T00:00:00`) : new Date(0)
const hasta = args.hasta ? new Date(`${args.hasta}T23:59:59`) : new Date()
const filas = readFileSync(archivo, 'utf8')
  .trim()
  .split('\n')
  .slice(1)
  .map((l) => {
    const [fecha, ok, ms] = l.split(';')
    return { fecha: new Date(fecha), ok: ok === '1', ms: Number(ms) }
  })
  .filter((f) => f.fecha >= desde && f.fecha <= hasta && enHorario(f.fecha))
if (!filas.length) {
  console.error('No hay verificaciones dentro del horario académico en ese periodo.')
  process.exit(2)
}

// Verificaciones esperadas: minutos de horario académico en el periodo / intervalo
const primera = new Date(Math.max(desde.getTime(), filas[0].fecha.getTime()))
let minutos = 0
for (let t = new Date(primera); t <= hasta; t = new Date(t.getTime() + 60_000)) if (enHorario(t)) minutos += 1
const esperadas = Math.max(filas.length, Math.floor(minutos / intervaloMin))
const exitosas = filas.filter((f) => f.ok).length
const disponibilidad = exitosas / filas.length
const cobertura = filas.length / esperadas
// Caídas: tramos seguidos de verificaciones fallidas
const caidas = []
for (const f of filas) {
  const ultima = caidas.at(-1)
  if (!f.ok) {
    if (ultima && !ultima.cerrada) ultima.hasta = f.fecha
    else caidas.push({ desde: f.fecha, hasta: f.fecha, cerrada: false })
  } else if (ultima) ultima.cerrada = true
}
const pct = (x) => `${(x * 100).toFixed(2)} %`
console.log(`Periodo: ${primera.toLocaleString('es-EC')} – ${hasta.toLocaleString('es-EC')} (solo horario académico)`)
console.log(`Disponibilidad: ${pct(disponibilidad)} (${exitosas} de ${filas.length} verificaciones) · meta ${pct(META)} → ${disponibilidad >= META ? 'CUMPLE' : 'NO CUMPLE'}`)
console.log(`Cobertura del monitoreo: ${pct(Math.min(1, cobertura))} (${filas.length} de ~${esperadas} verificaciones esperadas cada ${intervaloMin} min)`)
if (cobertura < 0.9) console.log('Aviso: faltan verificaciones (el equipo estuvo apagado o la tarea no corrió); la cifra de disponibilidad no cubre esos tramos.')
for (const c of caidas) console.log(`  Caída: ${c.desde.toLocaleString('es-EC')} → ${c.hasta.toLocaleString('es-EC')}`)
process.exit(disponibilidad >= META ? 0 : 1)
