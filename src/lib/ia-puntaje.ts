// Puntaje del clasificador (RF09, RNF11):
// 1. Zero-shot: compara el vector de la foto con el de la descripción de cada material.
// 2. Sonda (desde 1.1): un clasificador aprendido con fotos reales etiquetadas suma su opinión.
// Es código puro: lo usan la aplicación (ia.ts) y la evaluación formal (scripts/evaluar-ia.ts),
// así lo que se mide es exactamente lo que se usa.
import { logitsSonda } from './ia-sonda'
import type { Sonda } from './ia-sonda'

/** Versión del clasificador: modelo, cuantización, método y datos. Se guarda en cada reciclaje (RNF11). */
export const VERSION_MODELO = 'clip-vit-b32-q8-sonda-1.1'
export const ESCALA_CLIP = 100 // logit_scale de CLIP
export const CLASE_NINGUNO = 'ninguno'

export interface Puntaje {
  /** Categorías reales ordenadas de mayor a menor probabilidad. */
  reales: { categoriaId: string; confianza: number }[]
  /** Probabilidad (según las descripciones) de que la foto no muestre un residuo ("otra cosa"). */
  ninguno: number
  /** La foto se parece más a "otra cosa" que a cualquier residuo. */
  noReconocido: boolean
}

const softmax = (l: number[]) => {
  const max = Math.max(...l)
  const e = l.map((x) => Math.exp(x - max))
  const z = e.reduce((s, x) => s + x, 0)
  return e.map((x) => x / z)
}

/** `embedding` y los vectores de `clases` deben estar normalizados (largo 1). */
export function puntuar(embedding: ArrayLike<number>, clases: Record<string, number[]>, categorias: string[], sonda?: Sonda | null): Puntaje {
  const reales = categorias.filter((id) => clases[id])
  const texto = (id: string) => {
    const t = clases[id]
    let s = 0
    for (let i = 0; i < t.length; i++) s += t[i] * embedding[i]
    return ESCALA_CLIP * s
  }
  // "Otra cosa" se decide solo con las descripciones, como en la versión 1.0
  const conNinguno = clases[CLASE_NINGUNO] ? [...reales, CLASE_NINGUNO] : reales
  const pTexto = softmax(conNinguno.map(texto))
  const ninguno = clases[CLASE_NINGUNO] ? pTexto[pTexto.length - 1] : 0
  const noReconocido = ninguno > Math.max(...pTexto.slice(0, reales.length))
  // La categoría: descripciones + lo aprendido de las fotos (si la sonda conoce esa categoría)
  const ls = sonda ? logitsSonda(sonda, embedding) : null
  const extra = (id: string) => {
    const k = sonda ? sonda.clases.indexOf(id) : -1
    return ls && k >= 0 ? ls[k] : 0
  }
  const p = softmax(reales.map((id) => texto(id) + extra(id)))
  return {
    reales: reales.map((categoriaId, i) => ({ categoriaId, confianza: p[i] })).sort((a, b) => b.confianza - a.confianza),
    ninguno,
    noReconocido,
  }
}

/** Normaliza un vector a largo 1. */
export function normalizar(v: ArrayLike<number>): number[] {
  const arr = Array.from(v)
  const n = Math.hypot(...arr)
  return n ? arr.map((x) => x / n) : arr
}
