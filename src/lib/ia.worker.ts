// Web Worker de clasificación: ejecuta el modelo de visión CLIP (ONNX cuantizado)
// fuera del hilo principal para que la interfaz no se congele.
import { AutoProcessor, CLIPVisionModelWithProjection, RawImage, env } from '@huggingface/transformers'
import type { PreTrainedModel, Processor } from '@huggingface/transformers'

const MODELO = 'Xenova/clip-vit-base-patch32'
env.allowLocalModels = false

let carga: Promise<{ proc: Processor; vis: PreTrainedModel }> | null = null

function cargar() {
  if (!carga) {
    const progreso = (p: { status: string; progress?: number; file?: string }) => {
      if (p.status === 'progress' && p.file?.endsWith('.onnx')) self.postMessage({ tipo: 'progreso', valor: Math.round(p.progress ?? 0) })
    }
    const dispositivo = 'gpu' in navigator ? 'webgpu' : 'wasm'
    carga = (async () => {
      const proc = await AutoProcessor.from_pretrained(MODELO)
      let vis: PreTrainedModel
      try {
        vis = await CLIPVisionModelWithProjection.from_pretrained(MODELO, { dtype: 'q8', device: dispositivo, progress_callback: progreso })
      } catch {
        // WebGPU no disponible o incompatible: usar WebAssembly
        vis = await CLIPVisionModelWithProjection.from_pretrained(MODELO, { dtype: 'q8', device: 'wasm', progress_callback: progreso })
      }
      self.postMessage({ tipo: 'listo' })
      return { proc, vis }
    })()
    carga.catch((e) => {
      carga = null
      self.postMessage({ tipo: 'error', mensaje: e instanceof Error ? e.message : String(e) })
    })
  }
  return carga
}

self.onmessage = async (e: MessageEvent<{ tipo: 'precargar' } | { tipo: 'clasificar'; id: number; imagen: string }>) => {
  const msg = e.data
  if (msg.tipo === 'precargar') {
    void cargar().catch(() => {})
    return
  }
  try {
    const { proc, vis } = await cargar()
    const img = await RawImage.fromURL(msg.imagen)
    const { image_embeds } = await vis(await proc(img))
    const v = Array.from(image_embeds.data as Float32Array)
    const n = Math.hypot(...v)
    self.postMessage({ tipo: 'resultado', id: msg.id, embedding: v.map((x) => x / n) })
  } catch (err) {
    self.postMessage({ tipo: 'fallo', id: msg.id, mensaje: err instanceof Error ? err.message : String(err) })
  }
}
