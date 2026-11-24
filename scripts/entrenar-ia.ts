// Entrena la sonda de la IA (RNF11) con las fotos de práctica etiquetadas y la guarda en
// src/lib/ia-embeddings.json. Las fotos van en una carpeta por categoría:
//   ia/entrenamiento/cat-pet/*.jpg, ia/entrenamiento/cat-vidrio/*.jpg, …
// Estas fotos NO sirven para la evaluación formal (ia/evaluacion): esa necesita fotos nuevas.
//
// Además estima la calidad "dejando una fuera": aprende con todas menos una, prueba con esa, y
// repite con cada foto. Es una estimación honesta con pocas fotos, pero no reemplaza la evaluación.
//
// Uso: npm run ia:entrenar
import { AutoProcessor, CLIPVisionModelWithProjection, RawImage, env } from '@huggingface/transformers'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CLASE_NINGUNO, VERSION_MODELO, normalizar, puntuar } from '../src/lib/ia-puntaje'
import { calcularMetricas } from '../src/lib/ia-metricas'
import { entrenarSonda } from '../src/lib/ia-sonda'
import type { Sonda } from '../src/lib/ia-sonda'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
const carpeta = path.resolve(args.datos ?? path.join('ia', 'entrenamiento'))
const archivoModelo = path.join('src', 'lib', 'ia-embeddings.json')
const salida = args.salida ?? path.join('docs', 'evidencias', 'entrenamiento-ia.json')
env.cacheDir = process.env.IA_CACHE ?? path.join(os.homedir(), '.cache', 'ecosmart-ia')

const MODELO = JSON.parse(readFileSync(archivoModelo, 'utf8'))
const CLASES = MODELO.clases as Record<string, number[]>
const CATEGORIAS = Object.keys(CLASES).filter((c) => c !== CLASE_NINGUNO)

// 1. Fotos de práctica. Una misma foto guardada en dos categorías distintas no se usa:
//    tiene dos respuestas a la vez y confundiría al modelo.
const fotos: { archivo: string; clase: string; huella: string }[] = []
for (const clase of CATEGORIAS) {
  const dir = path.join(carpeta, clase)
  if (!existsSync(dir)) continue
  for (const nombre of readdirSync(dir).sort()) {
    if (!/\.(jpe?g|png|webp)$/i.test(nombre)) continue
    const archivo = path.join(dir, nombre)
    fotos.push({ archivo, clase, huella: createHash('sha256').update(readFileSync(archivo)).digest('hex') })
  }
}
const clasesPorHuella = new Map<string, Set<string>>()
for (const f of fotos) clasesPorHuella.set(f.huella, (clasesPorHuella.get(f.huella) ?? new Set()).add(f.clase))
const conflicto = (f: (typeof fotos)[number]) => clasesPorHuella.get(f.huella)!.size > 1
const omitidas = fotos.filter(conflicto)
// Copias idénticas dentro de la misma categoría cuentan una sola vez
const vistas = new Set<string>()
const usables = fotos.filter((f) => !conflicto(f) && !vistas.has(f.huella) && vistas.add(f.huella))
if (usables.length < CATEGORIAS.length * 3) {
  console.error(`Muy pocas fotos en ${carpeta} (${usables.length}). Pon al menos 3 por categoría: ${CATEGORIAS.join(', ')}.`)
  process.exit(2)
}

// 2. Vectores de imagen con el mismo modelo que usa el navegador
console.log(`Calculando ${usables.length} fotos de práctica…`)
const procesador = await AutoProcessor.from_pretrained(MODELO.modelo)
const vision = await CLIPVisionModelWithProjection.from_pretrained(MODELO.modelo, { dtype: MODELO.dtype as 'q8' })
const ejemplos: { v: number[]; clase: string; archivo: string }[] = []
for (const f of usables) {
  const { image_embeds } = await vision(await procesador(await RawImage.read(f.archivo)))
  ejemplos.push({ v: normalizar(image_embeds.data as Float32Array), clase: f.clase, archivo: path.relative(carpeta, f.archivo).replace(/\\/g, '/') })
}

// 3. Estimación dejando una fuera: con descripciones solas y con descripciones + sonda
console.log('Estimando la calidad (dejando una foto fuera cada vez)…')
const soloTexto = ejemplos.map((x) => ({ real: x.clase, predicha: puntuar(x.v, CLASES, CATEGORIAS).reales[0].categoriaId }))
const conSonda = ejemplos.map((x, i) => {
  const sonda = entrenarSonda(ejemplos.filter((_, j) => j !== i), CATEGORIAS)
  return { real: x.clase, predicha: puntuar(x.v, CLASES, CATEGORIAS, sonda).reales[0].categoriaId, archivo: x.archivo }
})
const mTexto = calcularMetricas(soloTexto, CATEGORIAS)
const mSonda = calcularMetricas(conSonda, CATEGORIAS)
const pct = (x: number) => `${(x * 100).toFixed(1)} %`
console.log('\nCategoría       Fotos  Recall (texto)  Recall (texto + fotos)')
for (const c of CATEGORIAS) console.log(`${c.padEnd(15)} ${String(mSonda.porClase[c].soporte).padStart(5)}  ${pct(mTexto.porClase[c].recall).padStart(14)}  ${pct(mSonda.porClase[c].recall).padStart(22)}`)
console.log(`\nF1 macro: ${pct(mTexto.f1Macro)} solo texto → ${pct(mSonda.f1Macro)} con lo aprendido de las fotos`)
if (omitidas.length) console.log(`Omitidas (misma foto en dos categorías): ${omitidas.map((f) => path.relative(carpeta, f.archivo)).join(', ')}`)

// 4. Modelo final con todas las fotos de práctica
const final = entrenarSonda(ejemplos, CATEGORIAS)
const redondear = (s: Sonda): Sonda => ({ ...s, W: s.W.map((w) => w.map((x) => +x.toFixed(5))), b: s.b.map((x) => +x.toFixed(5)) })
const huellaConjunto = createHash('sha256').update(usables.map((f) => f.huella).sort().join('\n')).digest('hex')
writeFileSync(archivoModelo, JSON.stringify({ ...MODELO, version: VERSION_MODELO, sonda: { ...redondear(final), fotos: ejemplos.length, huellaSha256: huellaConjunto } }))

mkdirSync(path.dirname(salida), { recursive: true })
writeFileSync(
  salida,
  JSON.stringify(
    {
      fecha: new Date().toISOString(),
      version: VERSION_MODELO,
      nota: 'Estimación con las fotos de práctica dejando una fuera. No es la evaluación formal de RNF11, que requiere fotos nuevas en ia/evaluacion.',
      fotos: { usadas: ejemplos.length, omitidas: omitidas.map((f) => path.relative(carpeta, f.archivo).replace(/\\/g, '/')), huellaSha256: huellaConjunto },
      soloTexto: { f1Macro: +mTexto.f1Macro.toFixed(4), recall: Object.fromEntries(CATEGORIAS.map((c) => [c, +mTexto.porClase[c].recall.toFixed(4)])) },
      textoMasFotos: { f1Macro: +mSonda.f1Macro.toFixed(4), recall: Object.fromEntries(CATEGORIAS.map((c) => [c, +mSonda.porClase[c].recall.toFixed(4)])), matrizConfusion: mSonda.matriz },
      errores: conSonda.filter((r) => r.real !== r.predicha),
    },
    null,
    2,
  ),
)
console.log(`\nModelo ${VERSION_MODELO} guardado en ${archivoModelo}. Estimación en ${salida}.`)
