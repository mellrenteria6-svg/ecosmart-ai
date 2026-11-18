import { useEffect, useState } from 'react'
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

export function ChipCategoria({ nombre, color }: { nombre: string; color: string }) {
  return (
    <span className="chip-cat">
      <i style={{ background: color }} />
      {nombre}
    </span>
  )
}
