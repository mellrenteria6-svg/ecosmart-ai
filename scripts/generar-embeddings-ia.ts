// Genera src/lib/ia-embeddings.json: el vector de texto de CLIP de cada categoría (RF09, RNF11).
// Cada categoría se describe con varias frases; el vector final es el promedio normalizado.
// Si se cambia una frase o el modelo, hay que subir VERSION_MODELO (src/lib/ia-puntaje.ts) y
// volver a correr la evaluación formal (npm run ia:evaluar) antes de publicar.
//
// Uso: npm run ia:embeddings            (descarga el modelo la primera vez, ~150 MB, a ~/.cache/ecosmart-ia)
import { AutoTokenizer, CLIPTextModelWithProjection, env } from '@huggingface/transformers'
import { writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { VERSION_MODELO } from '../src/lib/ia-puntaje'

const MODELO = 'Xenova/clip-vit-base-patch32'
const DTYPE = 'q8'
env.cacheDir = process.env.IA_CACHE ?? path.join(os.homedir(), '.cache', 'ecosmart-ia')

/** Descripciones de la versión clip-vit-b32-q8-zs-1.0. */
export const DESCRIPCIONES: Record<string, string[]> = {
  'cat-pet': ['a photo of a plastic bottle', 'a photo of a plastic water bottle', 'a photo of a plastic soda bottle', 'a photo of a crushed plastic bottle', 'a photo of a transparent PET bottle', 'a photo of a light flexible plastic bottle with a plastic cap'],
  'cat-papel': ['a photo of cardboard', 'a photo of a brown corrugated cardboard box', 'a photo of an open cardboard box', 'a photo of sheets of paper', 'a photo of newspaper', 'a photo of a crumpled piece of paper', 'a photo of flattened cardboard'],
  'cat-vidrio': ['a photo of a glass bottle', 'a photo of a glass jar', 'a photo of a green glass beer bottle', 'a photo of a brown glass bottle', 'a photo of a wine bottle', 'a photo of a classic coca-cola glass bottle', 'a photo of a heavy glass bottle with a metal cap', 'a photo of a transparent glass container'],
  'cat-lata': ['a photo of an aluminum can', 'a photo of a soda can', 'a photo of a crushed aluminum can', 'a photo of a beer can', 'a photo of a metal drink can', 'a photo of a cylindrical drink can with a pull tab', 'a photo of a red soda can'],
  'cat-tetra': ['a photo of a tetra pak carton', 'a photo of a milk carton', 'a photo of a juice box', 'a photo of a beverage carton box', 'a photo of a small rectangular drink carton with a straw', 'a photo of a paperboard drink carton with a printed label', 'a photo of a gable-top milk carton'],
  'cat-plastico': ['a photo of an empty transparent plastic food container', 'a photo of a plastic yogurt cup', 'a photo of a disposable plastic cup', 'a photo of a plastic takeout box', 'a photo of a plastic detergent bottle', 'a photo of a plastic shampoo bottle', 'a photo of plastic bottle caps'],
  // "Otra cosa": si la foto se parece más a esto que a un residuo, la app avisa que no lo reconoce
  ninguno: ['a photo of a person', 'a photo of a face', 'a photo of a room', 'a photo of a desk', 'a photo of food', 'a photo of a plastic bag', 'a photo of a cell phone', 'a photo of a computer keyboard', 'a blurry photo', 'a photo of a hand', 'a photo of a wall', 'a photo of clothes', 'a photo of a street', 'a photo of a building'],
}

const tokenizador = await AutoTokenizer.from_pretrained(MODELO)
const modelo = await CLIPTextModelWithProjection.from_pretrained(MODELO, { dtype: DTYPE })
const clases: Record<string, number[]> = {}
for (const [categoria, frases] of Object.entries(DESCRIPCIONES)) {
  const { text_embeds } = await modelo(tokenizador(frases, { padding: true, truncation: true }))
  const dim = text_embeds.dims[1] as number
  const datos = text_embeds.data as Float32Array
  const media = new Array<number>(dim).fill(0)
  for (let i = 0; i < frases.length; i++) {
    let n = 0
    for (let j = 0; j < dim; j++) n += datos[i * dim + j] ** 2
    n = Math.sqrt(n)
    for (let j = 0; j < dim; j++) media[j] += datos[i * dim + j] / n
  }
  const norma = Math.sqrt(media.reduce((t, x) => t + x * x, 0))
  clases[categoria] = media.map((x) => +(x / norma).toFixed(5))
}

const destino = process.argv[2] ?? path.join('src', 'lib', 'ia-embeddings.json')
writeFileSync(destino, JSON.stringify({ modelo: MODELO, dtype: DTYPE, version: VERSION_MODELO, clases }))
console.log(`Listo: ${Object.keys(clases).length} clases (${VERSION_MODELO}) → ${destino}`)
