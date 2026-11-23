// Validación en el servidor de lo que llega del navegador (RNF04: "las rutas rechazan archivos
// inválidos"). El navegador ya reduce y comprime la foto, pero el servidor no confía en él:
// comprueba que sea de verdad una imagen JPEG, de tamaño y dimensiones razonables, y que cada
// dato del registro tenga el tipo y el largo esperados antes de aplicar las reglas de negocio.
import { ErrorHttp } from './auth'

/** El navegador envía como máximo ~700 000 caracteres (≈ 525 KB); se deja un margen. */
export const FOTO_MAX_BYTES = 600_000
const FOTO_MIN_BYTES = 100
const LADO_MIN = 32
const LADO_MAX = 4096
const PREFIJO = 'data:image/jpeg;base64,'

/** Ancho y alto de un JPEG leyendo sus segmentos, o null si la estructura no es válida. */
export function dimensionesJpeg(b: Buffer): { ancho: number; alto: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null // SOI
  let i = 2
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null
    const marcador = b[i + 1]
    if (marcador === 0xff) {
      i += 1 // relleno
      continue
    }
    if (marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd8)) {
      i += 2 // marcadores sin longitud
      continue
    }
    if (marcador === 0xd9 || marcador === 0xda) return null // EOI o datos de imagen antes del encabezado
    const largo = b.readUInt16BE(i + 2)
    if (largo < 2 || i + 2 + largo > b.length) return null
    // SOF0–SOF15, salvo DHT (C4), JPG (C8) y DAC (CC): ahí están las dimensiones
    if (marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc) {
      if (largo < 7) return null
      return { alto: b.readUInt16BE(i + 5), ancho: b.readUInt16BE(i + 7) }
    }
    i += 2 + largo
  }
  return null
}

/** Comprueba la foto de un reciclaje y devuelve el mismo texto si es válida. */
export function validarFoto(foto: unknown): string {
  if (typeof foto !== 'string' || !foto.startsWith(PREFIJO)) throw new ErrorHttp(400, 'La foto debe ser una imagen JPEG.')
  const base64 = foto.slice(PREFIJO.length)
  // Antes de decodificar: evita procesar textos enormes
  if (base64.length > Math.ceil(FOTO_MAX_BYTES / 3) * 4) throw new ErrorHttp(413, 'La imagen supera el tamaño permitido.')
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new ErrorHttp(400, 'La foto está dañada o no es una imagen válida.')
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.length < FOTO_MIN_BYTES) throw new ErrorHttp(400, 'La foto está dañada o no es una imagen válida.')
  const dim = dimensionesJpeg(bytes)
  if (!dim || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw new ErrorHttp(400, 'La foto está dañada o no es una imagen válida.')
  if (dim.ancho < LADO_MIN || dim.alto < LADO_MIN || dim.ancho > LADO_MAX || dim.alto > LADO_MAX) {
    throw new ErrorHttp(400, `La foto debe medir entre ${LADO_MIN} y ${LADO_MAX} píxeles por lado.`)
  }
  return foto
}

const texto = (v: unknown, campo: string, max: number, min = 1) => {
  if (typeof v !== 'string' || v.trim().length < min || v.length > max) throw new ErrorHttp(400, `Dato inválido: ${campo}.`)
  return v
}
const numero = (v: unknown, campo: string, min: number, max: number) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new ErrorHttp(400, `Dato inválido: ${campo}.`)
  return v
}

/** Datos de un registro de reciclaje, con solo los campos permitidos (el usuario lo pone la sesión, la fecha el servidor). */
export function datosReciclaje(d: unknown) {
  if (typeof d !== 'object' || d === null || Array.isArray(d)) throw new ErrorHttp(400, 'Faltan los datos del reciclaje.')
  const x = d as Record<string, unknown>
  const fotoHash = texto(x.fotoHash, 'huella de la foto', 16)
  if (!/^[0-9a-f]{16}$/i.test(fotoHash)) throw new ErrorHttp(400, 'Dato inválido: huella de la foto.')
  return {
    idempotencyKey: texto(x.idempotencyKey, 'clave de idempotencia', 100),
    codigoPunto: texto(x.codigoPunto, 'código del punto', 40),
    categoriaId: texto(x.categoriaId, 'categoría', 60),
    categoriaIa: texto(x.categoriaIa, 'categoría sugerida', 60),
    confianzaIa: numero(x.confianzaIa, 'confianza de la IA', 0, 1),
    modeloVersion: texto(x.modeloVersion, 'versión del modelo', 80),
    cantidad: numero(x.cantidad, 'cantidad', 0, 1_000_000),
    foto: validarFoto(x.foto),
    fotoHash,
    // La fecha no se toma del navegador: la pone el servidor. Si no, alguien podría fechar
    // registros en días anteriores para esquivar el tope diario (RN05). Un registro hecho sin
    // conexión (RF30) cuenta desde que se sincroniza.
  }
}
