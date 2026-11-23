// Evaluación formal del clasificador (RNF11): "en un conjunto de prueba separado logra F1 macro de
// al menos 85 % y recall de al menos 80 % por categoría; cada inferencia registra la versión".
//
// Usa el mismo modelo, las mismas descripciones (ia-embeddings.json) y el mismo cálculo de
// puntaje (src/lib/ia-puntaje.ts) que la aplicación. Las fotos van en una carpeta por categoría:
//   ia/evaluacion/cat-pet/*.jpg, ia/evaluacion/cat-vidrio/*.jpg, …  (y opcional ia/evaluacion/ninguno/)
// Ver ia/evaluacion/README.md para cómo armar el conjunto.
//
// Uso: npm run ia:evaluar -- [--datos=ia/evaluacion] [--salida=docs/evidencias/evaluacion-ia.json]
// Sale con 0 si cumple, 1 si no cumple y 2 si no hay fotos para evaluar.
import { AutoProcessor, CLIPVisionModelWithProjection, RawImage, env } from '@huggingface/transformers'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import EMBEDDINGS from '../src/lib/ia-embeddings.json'
import { CLASE_NINGUNO, VERSION_MODELO, normalizar, puntuar } from '../src/lib/ia-puntaje'
import { UMBRALES_RNF11, calcularMetricas, incumplimientosRnf11 } from '../src/lib/ia-metricas'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
const carpeta = path.resolve(args.datos ?? path.join('ia', 'evaluacion'))
const salida = args.salida ?? path.join('docs', 'evidencias', 'evaluacion-ia.json')
env.cacheDir = process.env.IA_CACHE ?? path.join(os.homedir(), '.cache', 'ecosmart-ia')

const CLASES = EMBEDDINGS.clases as Record<string, number[]>
const CATEGORIAS = Object.keys(CLASES).filter((c) => c !== CLASE_NINGUNO)
const EXTENSIONES = /\.(jpe?g|png|webp)$/i
const MINIMO_POR_CATEGORIA = 30

// 1. Conjunto de prueba
const fotos: { archivo: string; real: string }[] = []
for (const clase of [...CATEGORIAS, CLASE_NINGUNO]) {
  const dir = path.join(carpeta, clase)
  if (!existsSync(dir) || !statSync(dir).isDirectory()) continue
  for (const nombre of readdirSync(dir).sort()) if (EXTENSIONES.test(nombre)) fotos.push({ archivo: path.join(dir, nombre), real: clase })
}
const cuenta = (c: string) => fotos.filter((f) => f.real === c).length
if (!fotos.some((f) => f.real !== CLASE_NINGUNO)) {
  console.error(`No hay fotos en ${carpeta}.\nCrea una carpeta por categoría (${CATEGORIAS.join(', ')}) con al menos ${MINIMO_POR_CATEGORIA} fotos cada una. Ver ia/evaluacion/README.md.`)
  process.exit(2)
}
// Huella del conjunto: identifica exactamente qué fotos se evaluaron (control de versión del resultado)
const huella = createHash('sha256')
for (const f of fotos) huella.update(path.relative(carpeta, f.archivo).replace(/\\/g, '/') + '\0' + createHash('sha256').update(readFileSync(f.archivo)).digest('hex') + '\n')

// 2. Inferencia con el mismo modelo que usa el navegador
console.log(`Modelo ${VERSION_MODELO} · ${fotos.length} fotos de ${carpeta}`)
const procesador = await AutoProcessor.from_pretrained(EMBEDDINGS.modelo)
const vision = await CLIPVisionModelWithProjection.from_pretrained(EMBEDDINGS.modelo, { dtype: EMBEDDINGS.dtype as 'q8' })
const resultados: { archivo: string; real: string; predicha: string; confianza: number; noReconocido: boolean; ms: number }[] = []
for (const [i, f] of fotos.entries()) {
  const t0 = performance.now()
  const imagen = await RawImage.read(f.archivo)
  const { image_embeds } = await vision(await procesador(imagen))
  const { reales, ninguno } = puntuar(normalizar(image_embeds.data as Float32Array), CLASES, CATEGORIAS)
  resultados.push({ archivo: path.relative(carpeta, f.archivo).replace(/\\/g, '/'), real: f.real, predicha: reales[0].categoriaId, confianza: +reales[0].confianza.toFixed(3), noReconocido: ninguno > reales[0].confianza, ms: Math.round(performance.now() - t0) })
  if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${fotos.length}`)
}

// 3. Métricas (las fotos de "ninguno" no entran al F1: miden aparte si la app avisa "no reconocido")
const deResiduos = resultados.filter((r) => r.real !== CLASE_NINGUNO)
const m = calcularMetricas(deResiduos, CATEGORIAS)
const fallas = incumplimientosRnf11(m)
const pocas = CATEGORIAS.filter((c) => cuenta(c) < MINIMO_POR_CATEGORIA)
const otras = resultados.filter((r) => r.real === CLASE_NINGUNO)
const tiempos = resultados.map((r) => r.ms).sort((a, b) => a - b)
const pct = (x: number) => `${(x * 100).toFixed(1)} %`

console.log('\nCategoría       Fotos  Precisión  Recall    F1')
for (const c of CATEGORIAS) {
  const x = m.porClase[c]
  console.log(`${c.padEnd(15)} ${String(x.soporte).padStart(5)}  ${pct(x.precision).padStart(9)}  ${pct(x.recall).padStart(7)}  ${pct(x.f1).padStart(7)}`)
}
console.log(`\nF1 macro ${pct(m.f1Macro)} · exactitud ${pct(m.exactitud)} · ${m.total} fotos de residuos`)
if (otras.length) console.log(`Fotos que no son residuos: ${otras.filter((r) => r.noReconocido).length}/${otras.length} marcadas como "no reconocido"`)
if (pocas.length) console.log(`Aviso: menos de ${MINIMO_POR_CATEGORIA} fotos en ${pocas.join(', ')}; el resultado es poco confiable.`)

const informe = {
  fecha: new Date().toISOString(),
  requisito: 'RNF11',
  version: VERSION_MODELO,
  modelo: EMBEDDINGS.modelo,
  dtype: EMBEDDINGS.dtype,
  conjunto: { carpeta: path.relative(process.cwd(), carpeta).replace(/\\/g, '/'), huellaSha256: huella.digest('hex'), fotosPorCategoria: Object.fromEntries([...CATEGORIAS, CLASE_NINGUNO].map((c) => [c, cuenta(c)])) },
  umbrales: UMBRALES_RNF11,
  aprobado: fallas.length === 0 && pocas.length === 0,
  incumplimientos: [...fallas, ...pocas.map((c) => `${c}: menos de ${MINIMO_POR_CATEGORIA} fotos`)],
  metricas: { f1Macro: +m.f1Macro.toFixed(4), exactitud: +m.exactitud.toFixed(4), porCategoria: m.porClase, matrizConfusion: m.matriz },
  noResiduos: otras.length ? { fotos: otras.length, marcadasNoReconocido: otras.filter((r) => r.noReconocido).length } : null,
  latenciaMs: { p50: tiempos[Math.floor(tiempos.length / 2)], p95: tiempos[Math.min(tiempos.length - 1, Math.ceil(tiempos.length * 0.95) - 1)] },
  errores: deResiduos.filter((r) => r.real !== r.predicha),
}
mkdirSync(path.dirname(salida), { recursive: true })
writeFileSync(salida, JSON.stringify(informe, null, 2))
console.log(`\n${informe.aprobado ? 'RNF11 cumple.' : 'RNF11 NO cumple: ' + informe.incumplimientos.join('; ')}\nInforme: ${salida}`)
process.exit(informe.aprobado ? 0 : 1)
