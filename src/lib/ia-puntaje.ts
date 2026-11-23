// Puntaje "zero-shot" de CLIP (RF09, RNF11): compara el vector de la foto con el vector de la
// descripción de cada material y convierte las similitudes en probabilidades (softmax).
// Es código puro: lo usan la aplicación (ia.ts) y la evaluación formal (scripts/evaluar-ia.ts),
// así lo que se mide es exactamente lo que se usa.

/** Versión del clasificador: modelo, cuantización, método y descripciones. Se guarda en cada reciclaje (RNF11). */
export const VERSION_MODELO = 'clip-vit-b32-q8-zs-1.0'
export const ESCALA_CLIP = 100 // logit_scale de CLIP
export const CLASE_NINGUNO = 'ninguno'

export interface Puntaje {
  /** Categorías reales ordenadas de mayor a menor probabilidad. */
  reales: { categoriaId: string; confianza: number }[]
  /** Probabilidad de que la foto no muestre un residuo ("otra cosa"). */
  ninguno: number
}

/** `embedding` y los vectores de `clases` deben estar normalizados (largo 1). */
export function puntuar(embedding: ArrayLike<number>, clases: Record<string, number[]>, categorias: string[]): Puntaje {
  const ids = [...categorias.filter((id) => clases[id]), ...(clases[CLASE_NINGUNO] ? [CLASE_NINGUNO] : [])]
  const logits = ids.map((id) => {
    const t = clases[id]
    let s = 0
    for (let i = 0; i < t.length; i++) s += t[i] * embedding[i]
    return ESCALA_CLIP * s
  })
  const max = Math.max(...logits)
  const exp = logits.map((l) => Math.exp(l - max))
  const z = exp.reduce((s, x) => s + x, 0)
  const probs = ids.map((categoriaId, i) => ({ categoriaId, confianza: exp[i] / z }))
  return {
    reales: probs.filter((p) => p.categoriaId !== CLASE_NINGUNO).sort((a, b) => b.confianza - a.confianza),
    ninguno: probs.find((p) => p.categoriaId === CLASE_NINGUNO)?.confianza ?? 0,
  }
}

/** Normaliza un vector a largo 1. */
export function normalizar(v: ArrayLike<number>): number[] {
  const arr = Array.from(v)
  const n = Math.hypot(...arr)
  return n ? arr.map((x) => x / n) : arr
}
