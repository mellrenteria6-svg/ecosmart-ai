// Pruebas del cálculo de la IA (RNF11): puntaje zero-shot y métricas de la evaluación formal.
import { describe, expect, it } from 'vitest'
import EMBEDDINGS from './ia-embeddings.json'
import { VERSION_MODELO, normalizar, puntuar } from './ia-puntaje'
import { calcularMetricas, incumplimientosRnf11 } from './ia-metricas'

describe('Puntaje zero-shot (RF09)', () => {
  const clases = { a: [1, 0, 0], b: [0, 1, 0], ninguno: [0, 0, 1] }

  it('elige la categoría más parecida y suma 1 entre todas las opciones', () => {
    const p = puntuar(normalizar([0.9, 0.1, 0]), clases, ['a', 'b'])
    expect(p.reales[0].categoriaId).toBe('a')
    expect(p.reales.reduce((t, x) => t + x.confianza, 0) + p.ninguno).toBeCloseTo(1, 10)
  })

  it('marca "otra cosa" cuando la foto se parece más a ninguno', () => {
    const p = puntuar(normalizar([0.1, 0.1, 0.9]), clases, ['a', 'b'])
    expect(p.ninguno).toBeGreaterThan(p.reales[0].confianza)
  })

  it('ignora categorías sin descripción (por ejemplo, una nueva aún no entrenada)', () => {
    expect(puntuar([1, 0, 0], clases, ['a', 'nueva']).reales.map((r) => r.categoriaId)).toEqual(['a'])
  })

  it('CP-RNF11: las descripciones publicadas corresponden a la versión del modelo', () => {
    expect(EMBEDDINGS.version).toBe(VERSION_MODELO)
    for (const v of Object.values(EMBEDDINGS.clases)) expect(Math.hypot(...v)).toBeCloseTo(1, 3)
  })
})

describe('Métricas de la evaluación formal (RNF11)', () => {
  // 10 fotos por clase: A acierta 9 (1 → B); B acierta 8 (2 → A)
  const pares = [
    ...Array.from({ length: 9 }, () => ({ real: 'A', predicha: 'A' })),
    { real: 'A', predicha: 'B' },
    ...Array.from({ length: 8 }, () => ({ real: 'B', predicha: 'B' })),
    { real: 'B', predicha: 'A' },
    { real: 'B', predicha: 'A' },
  ]
  // Otro caso: ambas aciertan 9 de 10
  const buenas = [
    ...Array.from({ length: 9 }, () => ({ real: 'A', predicha: 'A' })),
    { real: 'A', predicha: 'B' },
    ...Array.from({ length: 9 }, () => ({ real: 'B', predicha: 'B' })),
    { real: 'B', predicha: 'A' },
  ]
  const m = calcularMetricas(pares, ['A', 'B'])

  it('arma la matriz de confusión real × predicha', () => {
    expect(m.matriz).toEqual({ A: { A: 9, B: 1 }, B: { A: 2, B: 8 } })
  })

  it('calcula precisión, recall, F1 por categoría y F1 macro', () => {
    expect(m.porClase.A.recall).toBeCloseTo(0.9)
    expect(m.porClase.A.precision).toBeCloseTo(9 / 11)
    expect(m.porClase.B.recall).toBeCloseTo(0.8)
    expect(m.porClase.B.precision).toBeCloseTo(8 / 9)
    const f1A = (2 * (9 / 11) * 0.9) / (9 / 11 + 0.9)
    const f1B = (2 * (8 / 9) * 0.8) / (8 / 9 + 0.8)
    expect(m.f1Macro).toBeCloseTo((f1A + f1B) / 2)
    expect(m.exactitud).toBeCloseTo(17 / 20)
  })

  it('CP-RNF11: aprueba con F1 macro ≥ 85 % y recall ≥ 80 % en cada categoría', () => {
    const b = calcularMetricas(buenas, ['A', 'B'])
    expect(b.f1Macro).toBeCloseTo(0.9)
    expect(incumplimientosRnf11(b)).toEqual([])
  })

  it('CP-RNF11: rechaza un F1 macro apenas por debajo del 85 % aunque cada recall llegue al 80 %', () => {
    expect(m.f1Macro).toBeLessThan(0.85) // 84,96 %
    expect(incumplimientosRnf11(m)).toEqual(['F1 macro 84.96 % < 85.00 %'])
  })

  it('CP-RNF11: rechaza si una categoría no llega al recall o no tiene fotos', () => {
    const peor = calcularMetricas([...pares, { real: 'B', predicha: 'A' }], ['A', 'B', 'C'])
    expect(incumplimientosRnf11(peor)).toEqual(expect.arrayContaining([expect.stringMatching(/^B: recall/), 'C: sin fotos en el conjunto de prueba']))
  })
})
