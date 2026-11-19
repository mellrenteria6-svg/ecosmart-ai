// Clasificación de residuos con IA (RF09, RNF11).
// Usa CLIP ViT-B/32 cuantizado en el navegador con clasificación "zero-shot":
// la foto se compara contra descripciones de cada material calculadas de antemano
// (ia-embeddings.json). Si el modelo no puede cargarse, se usa la heurística de color.
import { useSyncExternalStore } from 'react'
import EMBEDDINGS from './ia-embeddings.json'
import type { CategoriaResiduo } from '../data/types'
import { clasificarPorColor } from './imagen'
import type { FotoProcesada } from './imagen'

export const VERSION_MODELO = 'clip-vit-b32-q8-zs-1.0'
export const VERSION_RESPALDO = 'color-heuristica-0.1'

export type EstadoIa =
  | { fase: 'inactivo' }
  | { fase: 'cargando'; progreso: number }
  | { fase: 'listo' }
  | { fase: 'error'; mensaje: string }

export interface ResultadoIa {
  categoriaId: string
  confianza: number
  version: string
  alternativas: { categoriaId: string; confianza: number }[]
  noReconocido: boolean // la foto se parece más a "otra cosa" que a un residuo
  respaldo: boolean // se usó la heurística de color
  ms: number
}

let estado: EstadoIa = { fase: 'inactivo' }
const oyentes = new Set<() => void>()
const fijar = (e: EstadoIa) => {
  estado = e
  oyentes.forEach((f) => f())
}

export function useEstadoIa() {
  return useSyncExternalStore(
    (f) => {
      oyentes.add(f)
      return () => {
        oyentes.delete(f)
      }
    },
    () => estado,
  )
}

let worker: Worker | null = null
let siguienteId = 1
const pendientes = new Map<number, { ok: (v: number[]) => void; error: (e: Error) => void }>()

function obtenerWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./ia.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e) => {
    const m = e.data
    if (m.tipo === 'progreso') fijar({ fase: 'cargando', progreso: m.valor })
    else if (m.tipo === 'listo') fijar({ fase: 'listo' })
    else if (m.tipo === 'error') {
      fijar({ fase: 'error', mensaje: m.mensaje })
      // Las clasificaciones en espera pasan a la heurística de respaldo
      pendientes.forEach((p) => p.error(new Error(m.mensaje)))
      pendientes.clear()
    }
    else if (m.tipo === 'resultado') {
      pendientes.get(m.id)?.ok(m.embedding)
      pendientes.delete(m.id)
    } else if (m.tipo === 'fallo') {
      pendientes.get(m.id)?.error(new Error(m.mensaje))
      pendientes.delete(m.id)
    }
  }
  worker.onerror = () => fijar({ fase: 'error', mensaje: 'No se pudo iniciar el modelo de IA.' })
  return worker
}

/** Empieza a descargar el modelo (≈ 90 MB la primera vez; luego queda en caché). */
export function precargarIa() {
  if (estado.fase === 'listo' || estado.fase === 'cargando') return
  if (typeof Worker === 'undefined') {
    fijar({ fase: 'error', mensaje: 'El navegador no admite Web Workers.' })
    return
  }
  fijar({ fase: 'cargando', progreso: 0 })
  obtenerWorker().postMessage({ tipo: 'precargar' })
}

function embeddingDe(imagen: string, limiteMs: number) {
  return new Promise<number[]>((ok, error) => {
    const id = siguienteId++
    pendientes.set(id, { ok, error })
    obtenerWorker().postMessage({ tipo: 'clasificar', id, imagen })
    setTimeout(() => {
      if (pendientes.has(id)) {
        pendientes.delete(id)
        error(new Error('La IA tardó demasiado.'))
      }
    }, limiteMs)
  })
}

const CLASES = EMBEDDINGS.clases as Record<string, number[]>
const ESCALA = 100 // logit_scale de CLIP

export async function clasificar(foto: FotoProcesada, categorias: CategoriaResiduo[]): Promise<ResultadoIa> {
  const t0 = performance.now()
  const conocidas = categorias.filter((c) => c.activa && CLASES[c.id])
  try {
    if (!conocidas.length) throw new Error('Sin categorías entrenadas')
    precargarIa()
    // La primera vez incluye la descarga del modelo; después responde en < 1 s
    const e = await embeddingDe(foto.dataUrl, estado.fase === 'listo' ? 15000 : 180000)
    const ids = [...conocidas.map((c) => c.id), 'ninguno']
    const logits = ids.map((id) => ESCALA * CLASES[id].reduce((s, x, i) => s + x * e[i], 0))
    const max = Math.max(...logits)
    const exp = logits.map((l) => Math.exp(l - max))
    const z = exp.reduce((s, x) => s + x, 0)
    const probs = ids.map((id, i) => ({ categoriaId: id, confianza: exp[i] / z }))
    const ninguno = probs.find((p) => p.categoriaId === 'ninguno')!.confianza
    const reales = probs.filter((p) => p.categoriaId !== 'ninguno').sort((a, b) => b.confianza - a.confianza)
    const r2 = (n: number) => Math.round(n * 100) / 100
    return {
      categoriaId: reales[0].categoriaId,
      confianza: r2(reales[0].confianza),
      version: VERSION_MODELO,
      alternativas: reales.slice(1, 3).map((a) => ({ ...a, confianza: r2(a.confianza) })),
      noReconocido: ninguno > reales[0].confianza,
      respaldo: false,
      ms: Math.round(performance.now() - t0),
    }
  } catch {
    const r = await clasificarPorColor(foto, categorias.filter((c) => c.activa), VERSION_RESPALDO)
    return { ...r, noReconocido: false, respaldo: true, ms: Math.round(performance.now() - t0) }
  }
}
