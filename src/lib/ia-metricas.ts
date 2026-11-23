// Métricas de clasificación para la evaluación formal del modelo (RNF11):
// matriz de confusión, precisión, recall y F1 por categoría, F1 macro y exactitud.

export interface MetricasClase {
  precision: number
  recall: number
  f1: number
  soporte: number // fotos reales de la categoría
}

export interface ResultadoMetricas {
  clases: string[]
  /** matriz[real][predicha] = cantidad de fotos */
  matriz: Record<string, Record<string, number>>
  porClase: Record<string, MetricasClase>
  f1Macro: number
  exactitud: number
  total: number
}

export const UMBRALES_RNF11 = { f1Macro: 0.85, recallMinimo: 0.8 }

export function calcularMetricas(pares: { real: string; predicha: string }[], clases: string[]): ResultadoMetricas {
  const matriz: ResultadoMetricas['matriz'] = Object.fromEntries(clases.map((r) => [r, Object.fromEntries(clases.map((p) => [p, 0]))]))
  for (const { real, predicha } of pares) {
    if (!matriz[real]) throw new Error(`Categoría real desconocida: ${real}`)
    // Una predicción fuera de la lista (no debería ocurrir) cuenta como error en su propia columna
    matriz[real][predicha] = (matriz[real][predicha] ?? 0) + 1
  }
  const div = (a: number, b: number) => (b === 0 ? 0 : a / b)
  const porClase: ResultadoMetricas['porClase'] = {}
  for (const c of clases) {
    const vp = matriz[c][c]
    const soporte = Object.values(matriz[c]).reduce((t, x) => t + x, 0)
    const predichas = clases.reduce((t, r) => t + (matriz[r][c] ?? 0), 0)
    const precision = div(vp, predichas)
    const recall = div(vp, soporte)
    porClase[c] = { precision, recall, f1: div(2 * precision * recall, precision + recall), soporte }
  }
  const conSoporte = clases.filter((c) => porClase[c].soporte > 0)
  const aciertos = clases.reduce((t, c) => t + matriz[c][c], 0)
  return {
    clases,
    matriz,
    porClase,
    f1Macro: div(
      conSoporte.reduce((t, c) => t + porClase[c].f1, 0),
      conSoporte.length,
    ),
    exactitud: div(aciertos, pares.length),
    total: pares.length,
  }
}

/** Qué criterios del RNF11 no se cumplen (lista vacía = aprobado). */
export function incumplimientosRnf11(r: ResultadoMetricas, umbrales = UMBRALES_RNF11): string[] {
  const fallas: string[] = []
  const pct = (x: number) => `${(x * 100).toFixed(2)} %`
  if (r.f1Macro < umbrales.f1Macro) fallas.push(`F1 macro ${pct(r.f1Macro)} < ${pct(umbrales.f1Macro)}`)
  for (const c of r.clases) {
    const m = r.porClase[c]
    if (m.soporte === 0) fallas.push(`${c}: sin fotos en el conjunto de prueba`)
    else if (m.recall < umbrales.recallMinimo) fallas.push(`${c}: recall ${pct(m.recall)} < ${pct(umbrales.recallMinimo)}`)
  }
  return fallas
}
