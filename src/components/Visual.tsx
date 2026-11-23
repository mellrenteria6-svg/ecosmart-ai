import { useEffect, useState } from 'react'
import type { ImgHTMLAttributes } from 'react'
import { obtenerSnapshot } from '../data/store'
import QRCode from 'qrcode'
import type { PuntoReciclaje } from '../data/types'

/** Imagen QR generada en el navegador. */
export function Qr({ valor, tamano = 180, etiqueta }: { valor: string; tamano?: number; etiqueta: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    QRCode.toDataURL(valor, { margin: 1, width: tamano * 2, color: { dark: '#1c2a22', light: '#fbf8f2' } }).then((url) => {
      if (vivo) setSrc(url)
    })
    return () => {
      vivo = false
    }
  }, [valor, tamano])
  return src ? <img src={src} width={tamano} height={tamano} alt={etiqueta} className="qr-img" /> : <div style={{ width: tamano, height: tamano }} className="qr-img qr-cargando" />
}

export function enlaceQr(codigo: string) {
  return `${window.location.origin}${window.location.pathname}#/app/reciclar?codigo=${encodeURIComponent(codigo)}`
}

/** Mapa esquemático del campus con los puntos de reciclaje. */
export function MapaCampus({ puntos, seleccionado, onSeleccionar }: { puntos: PuntoReciclaje[]; seleccionado?: string; onSeleccionar?: (id: string) => void }) {
  return (
    <div className="mapa">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="mapa-fondo" aria-hidden="true">
        <path d="M0 52 C 20 48, 35 58, 50 50 S 80 44, 100 50" className="mapa-camino" />
        <path d="M46 0 C 48 20, 42 40, 50 50 S 54 80, 50 100" className="mapa-camino" />
        <rect x="14" y="20" width="22" height="18" rx="2" className="mapa-edificio" />
        <rect x="56" y="14" width="18" height="20" rx="2" className="mapa-edificio" />
        <rect x="64" y="58" width="22" height="20" rx="2" className="mapa-edificio" />
        <rect x="10" y="64" width="24" height="22" rx="10" className="mapa-verde" />
        <circle cx="82" cy="24" r="8" className="mapa-verde" />
      </svg>
      <span className="mapa-rotulo" style={{ left: '16%', top: '14%' }}>Biblioteca</span>
      <span className="mapa-rotulo" style={{ left: '56%', top: '8%' }}>Cafetería</span>
      <span className="mapa-rotulo" style={{ left: '64%', top: '80%' }}>Ingeniería</span>
      <span className="mapa-rotulo" style={{ left: '10%', top: '88%' }}>Deportes</span>
      {puntos.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`pin pin-${p.estado} ${seleccionado === p.id ? 'pin-sel' : ''}`}
          style={{ left: `${p.mapa.x}%`, top: `${p.mapa.y}%` }}
          onClick={() => onSeleccionar?.(p.id)}
          aria-label={`${p.nombre}, ${p.estado}`}
          aria-pressed={seleccionado === p.id}
        >
          <span />
        </button>
      ))}
    </div>
  )
}

export function ChipCategoria({ nombre, color, titulo }: { nombre: string; color: string; titulo?: string }) {
  return (
    <span className="chip-cat" title={titulo}>
      <i style={{ background: color }} />
      {nombre}
    </span>
  )
}

const FOTO_ELIMINADA =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#ebe3d4"/><path d="M130 95h60l8 14h18v60h-112v-60h18z" fill="none" stroke="#9a907f" stroke-width="5"/><path d="M110 70l100 110" stroke="#9a907f" stroke-width="5"/><text x="160" y="212" font-family="sans-serif" font-size="15" fill="#6b6a5e" text-anchor="middle">Foto eliminada (privacidad)</text></svg>',
  )

/** Las fotos se borran por retención o al eliminar la cuenta (RNF05). */
export const fotoVisible = (foto: string) => foto || FOTO_ELIMINADA

const FOTO_CARGANDO =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#ebe3d4"/><text x="160" y="126" font-family="sans-serif" font-size="15" fill="#626155" text-anchor="middle">Cargando foto…</text></svg>')

// Modo base de datos: las fotos llegan marcadas como "remota" y se piden una por una (RNF02, RNF05)
const fotosPedidas = new Map<string, Promise<string>>()
function pedirFoto(id: string) {
  let p = fotosPedidas.get(id)
  if (!p) {
    const token = obtenerSnapshot().sesion?.token
    p = fetch(`/api/foto/${encodeURIComponent(id)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.json() : { foto: '' }))
      .then((d: { foto?: string }) => d.foto || '')
      .catch(() => '')
    fotosPedidas.set(id, p)
    // Si falló, se puede volver a intentar más tarde
    void p.then((f) => f || fotosPedidas.delete(id))
  }
  return p
}

/** Foto de un reciclaje: local, borrada por privacidad o pedida al servidor solo cuando se muestra. */
export function ImagenReciclaje({ reciclaje, ...img }: { reciclaje: { id: string; foto: string } } & ImgHTMLAttributes<HTMLImageElement>) {
  const remota = reciclaje.foto === 'remota'
  const [cargada, setCargada] = useState<{ id: string; src: string } | null>(null)
  useEffect(() => {
    if (!remota) return
    let vivo = true
    void pedirFoto(reciclaje.id).then((f) => vivo && setCargada({ id: reciclaje.id, src: fotoVisible(f) }))
    return () => {
      vivo = false
    }
  }, [remota, reciclaje.id])
  const src = !remota ? fotoVisible(reciclaje.foto) : cargada?.id === reciclaje.id ? cargada.src : FOTO_CARGANDO
  return <img {...img} src={src} />
}
