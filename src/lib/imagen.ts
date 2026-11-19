// Procesamiento de imágenes en el navegador: reducción, calidad básica (RF08),
// huella perceptual para detectar duplicados (RN05) y clasificador simulado (RF09).

import type { CategoriaResiduo } from '../data/types'

export interface FotoProcesada {
  dataUrl: string
  hash: string
  ancho: number
  alto: number
  promedio: { r: number; g: number; b: number }
  nitidez: number // varianza del laplaciano: valores bajos = foto borrosa
}

// Resolución con la que se guarda la foto (suficiente para que el recolector la revise
// y para la IA, que trabaja a 224 px).
const LADO_MAXIMO = 960
export const UMBRAL_NITIDEZ = 60

export function canvasDesdeFuente(fuente: CanvasImageSource, ancho: number, alto: number) {
  const escala = Math.min(1, LADO_MAXIMO / Math.max(ancho, alto))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(ancho * escala)
  canvas.height = Math.round(alto * escala)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(fuente, 0, 0, canvas.width, canvas.height)
  return canvas
}

/** Nitidez: varianza del laplaciano sobre una copia en grises de 320 px. */
function medirNitidez(canvas: HTMLCanvasElement) {
  const w = 320
  const h = Math.max(1, Math.round((w * canvas.height) / canvas.width))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(canvas, 0, 0, w, h)
  const px = ctx.getImageData(0, 0, w, h).data
  const g = new Float32Array(w * h)
  for (let i = 0; i < w * h; i += 1) g[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114
  let suma = 0
  let suma2 = 0
  let n = 0
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x
      const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w]
      suma += l
      suma2 += l * l
      n += 1
    }
  }
  const media = suma / n
  return Math.round(suma2 / n - media * media)
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

  let dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  if (dataUrl.length > 450_000) dataUrl = canvas.toDataURL('image/jpeg', 0.72)
  if (dataUrl.length > 700_000) throw new FotoInvalida('La imagen supera el tamaño permitido.')
  return {
    dataUrl,
    hash: dHash(canvas),
    ancho: canvas.width,
    alto: canvas.height,
    promedio: { r: r / n, g: g / n, b: b / n },
    nitidez: medirNitidez(canvas),
  }
}

interface ResultadoColor {
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
 * Respaldo sin conexión: si el modelo de IA no puede cargarse, estima la categoría
 * por el color dominante. Es poco preciso, por eso su confianza queda acotada y el
 * registro suele pasar a revisión del recolector.
 */
export async function clasificarPorColor(foto: FotoProcesada, categorias: CategoriaResiduo[], version: string): Promise<ResultadoColor> {
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
  const confianza = Math.min(0.65, Math.max(0.35, 0.4 + margen * 1.6))
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
