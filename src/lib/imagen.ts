// Procesamiento de imágenes en el navegador: reducción, calidad básica (RF08),
// huella perceptual para detectar duplicados (RN05) y clasificador simulado (RF09).

import type { CategoriaResiduo } from '../data/types'

export interface FotoProcesada {
  dataUrl: string
  hash: string
  ancho: number
  alto: number
  promedio: { r: number; g: number; b: number }
}

const LADO_MAXIMO = 480

export function canvasDesdeFuente(fuente: CanvasImageSource, ancho: number, alto: number) {
  const escala = Math.min(1, LADO_MAXIMO / Math.max(ancho, alto))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(ancho * escala)
  canvas.height = Math.round(alto * escala)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(fuente, 0, 0, canvas.width, canvas.height)
  return canvas
}

/** Huella dHash de 64 bits en hexadecimal. */
function dHash(canvas: HTMLCanvasElement) {
  const c = document.createElement('canvas')
  c.width = 9
  c.height = 8
  const ctx = c.getContext('2d')!
  ctx.drawImage(canvas, 0, 0, 9, 8)
  const px = ctx.getImageData(0, 0, 9, 8).data
  const gris = (x: number, y: number) => {
    const i = (y * 9 + x) * 4
    return px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114
  }
  let bits = ''
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) bits += gris(x, y) > gris(x + 1, y) ? '1' : '0'
  }
  let hex = ''
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
}

export class FotoInvalida extends Error {}

export function procesarCanvas(canvas: HTMLCanvasElement): FotoProcesada {
  if (canvas.width < 160 || canvas.height < 120) {
    throw new FotoInvalida('La imagen es demasiado pequeña. Acércate al residuo y vuelve a intentarlo.')
  }
  const ctx = canvas.getContext('2d')!
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let r = 0
  let g = 0
  let b = 0
  let suma = 0
  let sumaCuadrados = 0
  const n = data.length / 4
  for (let i = 0; i < data.length; i += 4) {
    r += data[i]
    g += data[i + 1]
    b += data[i + 2]
    const l = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
    suma += l
    sumaCuadrados += l * l
  }
  const media = suma / n
  const desviacion = Math.sqrt(Math.max(0, sumaCuadrados / n - media * media))
  if (media < 25) throw new FotoInvalida('La foto está demasiado oscura. Busca más luz e inténtalo otra vez.')
  if (media > 245) throw new FotoInvalida('La foto está sobreexpuesta. Evita apuntar a una luz directa.')
  if (desviacion < 8) throw new FotoInvalida('No se distingue ningún objeto en la foto. Enfoca el residuo.')

  const dataUrl = canvas.toDataURL('image/jpeg', 0.72)
  if (dataUrl.length > 400_000) throw new FotoInvalida('La imagen supera el tamaño permitido.')
  return {
    dataUrl,
    hash: dHash(canvas),
    ancho: canvas.width,
    alto: canvas.height,
    promedio: { r: r / n, g: g / n, b: b / n },
  }
}

export interface ResultadoIa {
  categoriaId: string
  confianza: number
  version: string
  alternativas: { categoriaId: string; confianza: number }[]
}

function aHsl(r: number, g: number, b: number) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (d !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6)
    else if (max === gn) h = 60 * ((bn - rn) / d + 2)
    else h = 60 * ((rn - gn) / d + 4)
  }
  return { h: (h + 360) % 360, s, l }
}

/**
 * Clasificador simulado: el prototipo no incluye el modelo ONNX real, así que
 * estima la categoría a partir del color dominante. Respeta el contrato de la
 * API (categoría, confianza y versión) para reemplazarlo luego por el modelo.
 */
export async function clasificar(foto: FotoProcesada, categorias: CategoriaResiduo[], version: string): Promise<ResultadoIa> {
  await new Promise((r) => setTimeout(r, 900 + Math.random() * 600))
  const { h, s, l } = aHsl(foto.promedio.r, foto.promedio.g, foto.promedio.b)
  const objetivo: Record<string, { h: number; s: number }> = {
    'cat-pet': { h: 205, s: 0.35 },
    'cat-papel': { h: 32, s: 0.25 },
    'cat-vidrio': { h: 140, s: 0.3 },
    'cat-lata': { h: 220, s: 0.05 },
    'cat-tetra': { h: 45, s: 0.5 },
  }
  const puntajes = categorias.map((c) => {
    const o = objetivo[c.id] ?? { h: (parseInt(c.id.replace(/\D/g, '') || '0', 10) * 47) % 360, s: 0.3 }
    const dh = Math.min(Math.abs(h - o.h), 360 - Math.abs(h - o.h)) / 180
    const ds = Math.abs(s - o.s)
    const penalLuz = l < 0.15 || l > 0.9 ? 0.4 : 0
    return { categoriaId: c.id, puntaje: Math.max(0.01, 1 - dh * (s < 0.12 ? 0.3 : 1.2) - ds * 1.1 - penalLuz) }
  })
  // Pequeña variación determinista según la huella de la foto
  const semilla = parseInt(foto.hash.slice(0, 4), 16) / 0xffff
  puntajes.forEach((p, i) => (p.puntaje *= 0.9 + 0.2 * ((semilla * (i + 3)) % 1)))
  const total = puntajes.reduce((t, p) => t + Math.exp(p.puntaje * 4), 0)
  const ordenadas = puntajes
    .map((p) => ({ categoriaId: p.categoriaId, confianza: Math.exp(p.puntaje * 4) / total }))
    .sort((a, b) => b.confianza - a.confianza)
  // Escala la confianza a un rango realista (45 % – 97 %)
  const mejor = ordenadas[0]
  const margen = mejor.confianza - (ordenadas[1]?.confianza ?? 0)
  const confianza = Math.min(0.97, Math.max(0.45, 0.5 + margen * 1.6))
  return {
    categoriaId: mejor.categoriaId,
    confianza: Math.round(confianza * 100) / 100,
    version,
    alternativas: ordenadas.slice(1, 3),
  }
}

/** Genera una foto de demostración para equipos sin cámara. */
export function fotoDemostracion(categoria: CategoriaResiduo, variante: number) {
  const canvas = document.createElement('canvas')
  canvas.width = 480
  canvas.height = 360
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 0, 480, 360)
  grad.addColorStop(0, '#e9e4dc')
  grad.addColorStop(1, '#c9c1b4')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 480, 360)
  // ruido para que cada foto sea distinta
  for (let i = 0; i < 260; i += 1) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`
    ctx.fillRect(Math.random() * 480, Math.random() * 360, 3 + Math.random() * 20, 3 + Math.random() * 20)
  }
  ctx.fillStyle = categoria.color
  const dx = (variante % 5) * 18 - 36 + Math.random() * 40
  const dy = Math.random() * 30
  ctx.save()
  ctx.translate(240 + dx, 180 + dy)
  ctx.rotate((Math.random() - 0.5) * 0.9)
  if (categoria.unidad === 'kg') {
    ctx.fillRect(-150, -90, 300, 180)
  } else {
    ctx.beginPath()
    ctx.roundRect(-70, -140, 140, 260, 40)
    ctx.fill()
    ctx.fillRect(-28, -170, 56, 40)
  }
  ctx.fillStyle = 'rgba(255,255,255,0.3)'
  ctx.fillRect(-50, -60, 22, 140)
  ctx.restore()
  return canvas
}
