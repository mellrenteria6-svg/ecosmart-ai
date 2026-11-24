// "Sonda lineal" (RNF11): un clasificador pequeño que aprende de fotos reales etiquetadas cómo
// se ve cada material, encima de los vectores de imagen de CLIP. Se suma a la comparación con
// las descripciones en texto (zero-shot), que sigue siendo la base.
// Entrenamiento determinista (empieza en cero, descenso de gradiente con todo el lote), así el
// mismo conjunto de fotos produce siempre el mismo modelo.

export interface Sonda {
  clases: string[]
  escala: number
  W: number[][] // un vector de pesos por clase (mismo largo que el embedding)
  b: number[]
}

export interface OpcionesSonda {
  escala?: number
  lambda?: number // regularización: evita aprenderse de memoria las pocas fotos
  pasos?: number
  tasa?: number
}

const punto = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/** Logits de la sonda para un embedding normalizado. */
export function logitsSonda(sonda: Sonda, v: ArrayLike<number>): number[] {
  return sonda.clases.map((_, k) => sonda.escala * punto(sonda.W[k], v) + sonda.b[k])
}

/** Regresión logística multiclase con regularización L2. */
export function entrenarSonda(ejemplos: { v: number[]; clase: string }[], clases: string[], opciones: OpcionesSonda = {}): Sonda {
  const { escala = 30, lambda = 0.01, pasos = 300, tasa = 0.5 } = opciones
  const dim = ejemplos[0]?.v.length ?? 0
  const W = clases.map(() => new Array<number>(dim).fill(0))
  const b = clases.map(() => 0)
  const n = ejemplos.length
  for (let t = 0; t < pasos; t++) {
    const gW = clases.map(() => new Array<number>(dim).fill(0))
    const gb = clases.map(() => 0)
    for (const x of ejemplos) {
      const z = clases.map((_, k) => escala * punto(W[k], x.v) + b[k])
      const max = Math.max(...z)
      const e = z.map((q) => Math.exp(q - max))
      const s = e.reduce((p, q) => p + q, 0)
      clases.forEach((c, k) => {
        const g = e[k] / s - (x.clase === c ? 1 : 0)
        gb[k] += g
        const gk = gW[k]
        for (let d = 0; d < dim; d++) gk[d] += escala * g * x.v[d]
      })
    }
    clases.forEach((_, k) => {
      b[k] -= (tasa * gb[k]) / n
      const wk = W[k]
      const gk = gW[k]
      for (let d = 0; d < dim; d++) wk[d] -= tasa * (gk[d] / n + lambda * wk[d])
    })
  }
  return { clases, escala, W, b }
}
