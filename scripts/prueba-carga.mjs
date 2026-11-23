// Prueba de carga de la API (RNF02 y RNF09).
// Ejemplos:
//   node scripts/prueba-carga.mjs --ruta=/salud --solicitudes=1000 --concurrencia=100
//   node scripts/prueba-carga.mjs --ruta=/estado --tokens=scripts/tokens-carga.json --solicitudes=2000 --concurrencia=100
//   ... --escrituras=10   (el 10 % de las solicitudes registra un reciclaje real; requiere --tokens)
// Con --tokens, cada solicitud usa la sesión de un usuario distinto (como usuarios reales cargando su página).
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'

const argumentos = Object.fromEntries(
  process.argv.slice(2).map((valor) => {
    const [clave, ...resto] = valor.replace(/^--/, '').split('=')
    return [clave, resto.join('=')]
  }),
)

const baseUrl = argumentos.url || process.env.ECOSMART_API_URL || 'http://localhost:3001/api'
const ruta = argumentos.ruta || '/salud'
const total = Number(argumentos.solicitudes || 1000)
const concurrencia = Number(argumentos.concurrencia || 100)
const limiteMs = Number(argumentos.limite || 2000)
const tokens = argumentos.tokens ? JSON.parse(readFileSync(argumentos.tokens, 'utf8')) : []
const salida = argumentos.salida || ''
const pctEscrituras = Number(argumentos.escrituras || 0)
// JPEG mínimo bien formado (el servidor rechaza lo que no lo es, RNF04), de ~4 KB como una foto pequeña
const fotoPrueba =
  'data:image/jpeg;base64,' +
  Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, // 640 × 480
    0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00,
    ...Array.from({ length: 4000 }, (_, i) => (i * 37) % 0xfe),
    0xff, 0xd9,
  ]).toString('base64')
const tiempos = { lectura: [], escritura: [] }
let escriturasHechas = 0
const desglose = {}

if (!Number.isInteger(total) || total < 1 || !Number.isInteger(concurrencia) || concurrencia < 1) {
  throw new Error('solicitudes y concurrencia deben ser enteros positivos')
}

// La ruta se agrega a la base sin perder "/api" (una ruta que empieza con "/" la reemplazaría)
const destino = new URL(ruta.replace(/^\/+/, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString()
const bytes = []
const duraciones = []
const errores = []
let siguiente = 0

async function trabajador() {
  while (true) {
    const indice = siguiente++
    if (indice >= total) return
    const inicio = performance.now()
    try {
      const escribe = tokens.length > 0 && pctEscrituras > 0 && (indice * 7919) % 100 < pctEscrituras
      // Cada escritura usa la siguiente cuenta: así no se llega al tope diario de 10 registros (RN05)
      const token = !tokens.length ? null : escribe ? tokens[escriturasHechas++ % tokens.length] : tokens[indice % tokens.length]
      const opciones = {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(escribe ? { 'Content-Type': 'application/json' } : {}) },
        signal: AbortSignal.timeout(Math.max(5000, limiteMs * 5)),
      }
      const respuesta = escribe
        ? await fetch(new URL('accion/registrarReciclaje', destino.replace(/[^/]*$/, '')), {
            ...opciones,
            method: 'POST',
            body: JSON.stringify({
              args: [{ idempotencyKey: randomUUID(), codigoPunto: 'ECO-BIB-01', categoriaId: 'cat-pet', categoriaIa: 'cat-pet', confianzaIa: 0.9, modeloVersion: 'carga', cantidad: 2, foto: fotoPrueba, fotoHash: randomBytes(8).toString('hex') }],
            }),
          })
        : await fetch(destino, opciones)
      bytes.push((await respuesta.arrayBuffer()).byteLength)
      const ms = performance.now() - inicio
      duraciones.push(ms)
      tiempos[escribe ? 'escritura' : 'lectura'].push(ms)
      if (!respuesta.ok) errores.push(`HTTP ${respuesta.status}`)
      // Desglose que informa el servidor (cabecera Server-Timing): auth, cola, base, vista
      for (const parte of (respuesta.headers.get('server-timing') ?? '').split(',')) {
        const [nombre, dur] = parte.trim().split(';dur=')
        if (nombre && dur) (desglose[nombre] ??= []).push(Number(dur))
      }
    } catch (error) {
      duraciones.push(performance.now() - inicio)
      errores.push(error instanceof Error ? error.message : String(error))
    }
  }
}

const inicioTotal = performance.now()
await Promise.all(Array.from({ length: Math.min(concurrencia, total) }, () => trabajador()))
const tiempoTotal = performance.now() - inicioTotal

duraciones.sort((a, b) => a - b)
const percentil = (p) => duraciones[Math.min(duraciones.length - 1, Math.ceil(duraciones.length * p) - 1)] || 0
const tasaError = errores.length / total
const resultado = {
  fecha: new Date().toISOString(),
  destino,
  usuariosDistintos: tokens.length || 'sin sesión',
  solicitudes: total,
  concurrencia,
  exitosas: total - errores.length,
  errores: errores.length,
  tasaErrorPct: Number((tasaError * 100).toFixed(2)),
  p50Ms: Number(percentil(0.5).toFixed(1)),
  p95Ms: Number(percentil(0.95).toFixed(1)),
  p99Ms: Number(percentil(0.99).toFixed(1)),
  maxMs: Number((duraciones.at(-1) ?? 0).toFixed(1)),
  solicitudesPorSegundo: Number((total / (tiempoTotal / 1000)).toFixed(1)),
  kbPromedioRespuesta: Number((bytes.reduce((t, b) => t + b, 0) / Math.max(1, bytes.length) / 1024).toFixed(1)),
  primerosErrores: [...new Set(errores)].slice(0, 3),
  ...(pctEscrituras > 0
    ? Object.fromEntries(
        Object.entries(tiempos).map(([tipo, lista]) => {
          const o = [...lista].sort((a, b) => a - b)
          const p = (q) => Number((o[Math.min(o.length - 1, Math.ceil(o.length * q) - 1)] ?? 0).toFixed(1))
          return [tipo, { solicitudes: o.length, p50Ms: p(0.5), p95Ms: p(0.95) }]
        }),
      )
    : {}),
  ...(Object.keys(desglose).length
    ? {
        servidorEscrituras: Object.fromEntries(
          Object.entries(desglose).map(([nombre, lista]) => {
            const o = [...lista].sort((a, b) => a - b)
            return [nombre, { p50Ms: o[Math.floor(o.length / 2)], p95Ms: o[Math.min(o.length - 1, Math.ceil(o.length * 0.95) - 1)] }]
          }),
        ),
      }
    : {}),
  criterios: { p95MaxMs: limiteMs, tasaErrorMaxPct: 1 },
}

console.log(JSON.stringify(resultado, null, 2))
if (salida) writeFileSync(salida, JSON.stringify(resultado, null, 2))

if (resultado.p95Ms > limiteMs || tasaError >= 0.01) {
  console.error('RNF02/RNF09 no cumplen los criterios de la prueba.')
  process.exitCode = 1
} else {
  console.log('RNF02/RNF09: prueba aprobada.')
}
