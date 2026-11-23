import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { TONO_ESTADO } from '../lib/formato'
import type { Tono } from '../lib/formato'

export function Badge({ tono = 'neutral', children }: { tono?: Tono; children: ReactNode }) {
  return <span className={`badge badge-${tono}`}>{children}</span>
}

export function EstadoBadge({ estado, etiqueta }: { estado: string; etiqueta: string }) {
  return <Badge tono={TONO_ESTADO[estado] ?? 'neutral'}>{etiqueta}</Badge>
}

export function Alerta({ tono = 'info', titulo, children }: { tono?: Tono; titulo?: string; children?: ReactNode }) {
  return (
    <div className={`alerta alerta-${tono}`} role={tono === 'error' ? 'alert' : 'status'}>
      {titulo && <strong>{titulo}</strong>}
      {children && <div>{children}</div>}
    </div>
  )
}

export function Vacio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="vacio">
      <div className="vacio-icono" aria-hidden="true">○</div>
      <p className="vacio-titulo">{titulo}</p>
      {children && <div className="vacio-texto">{children}</div>}
    </div>
  )
}

export function Encabezado({ titulo, descripcion, acciones, volver }: { titulo: string; descripcion?: ReactNode; acciones?: ReactNode; volver?: string }) {
  return (
    <div className="encabezado">
      <div>
        {volver && (
          <a className="enlace-volver" href={volver}>
            ← Volver
          </a>
        )}
        <h1>{titulo}</h1>
        {descripcion && <p className="encabezado-desc">{descripcion}</p>}
      </div>
      {acciones && <div className="encabezado-acciones">{acciones}</div>}
    </div>
  )
}

export function Stat({ etiqueta, valor, nota, tono }: { etiqueta: string; valor: ReactNode; nota?: ReactNode; tono?: 'acento' }) {
  return (
    <div className={`stat ${tono === 'acento' ? 'stat-acento' : ''}`}>
      <span className="stat-etiqueta">{etiqueta}</span>
      <strong className="stat-valor">{valor}</strong>
      {nota && <span className="stat-nota">{nota}</span>}
    </div>
  )
}

type CampoProps = {
  etiqueta: string
  ayuda?: ReactNode
  children: (id: string, describedBy: string | undefined) => ReactNode
}

export function Campo({ etiqueta, ayuda, children }: CampoProps) {
  const id = useId()
  const ayudaId = ayuda ? `${id}-ayuda` : undefined
  return (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      {children(id, ayudaId)}
      {ayuda && (
        <small id={ayudaId} className="campo-ayuda">
          {ayuda}
        </small>
      )}
    </div>
  )
}

type EntradaContrasenaProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

/** Campo de contraseña con botón para verla u ocultarla (el estado se anuncia con aria-pressed). */
export function EntradaContrasena(props: EntradaContrasenaProps) {
  const [visible, setVisible] = useState(false)
  const controlId = typeof props.id === 'string' ? props.id : undefined

  return (
    <div className="entrada-contrasena">
      <input {...props} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="entrada-contrasena-toggle"
        aria-label="Mostrar contraseña"
        aria-controls={controlId}
        aria-pressed={visible}
        title={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        onClick={() => setVisible((valor) => !valor)}
      >
        {visible ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 3l18 18M10.6 10.7a2 2 0 002.7 2.7M9.9 4.2A10.7 10.7 0 0112 4c5.5 0 9 5.5 9 8a11.7 11.7 0 01-2.2 3.6M6.6 6.6C4.3 8 3 10.3 3 12c0 2.5 3.5 8 9 8a10.6 10.6 0 004.1-.8" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 12c0-2.5 3.5-8 9-8s9 5.5 9 8-3.5 8-9 8-9-5.5-9-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  )
}

export function Modal({ abierto, titulo, onCerrar, children }: { abierto: boolean; titulo: string; onCerrar: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (abierto && !d.open) d.showModal()
    if (!abierto && d.open) d.close()
  }, [abierto])
  return (
    <dialog ref={ref} className="modal" onClose={onCerrar} aria-label={titulo}>
      <div className="modal-cabecera">
        <h2>{titulo}</h2>
        <button type="button" className="btn-icono" onClick={onCerrar} aria-label="Cerrar">
          ✕
        </button>
      </div>
      <div className="modal-cuerpo">{abierto && children}</div>
    </dialog>
  )
}

/** Ejecuta una acción y guarda el mensaje de error para mostrarlo. */
export function useAccion() {
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const ejecutar = useCallback(async <T,>(fn: () => T | Promise<T>): Promise<T | undefined> => {
    setError(null)
    setCargando(true)
    try {
      return await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ocurrió un error inesperado.')
      return undefined
    } finally {
      setCargando(false)
    }
  }, [])
  return { error, setError, cargando, ejecutar }
}

export function Puntos({ valor, signo = false }: { valor: number; signo?: boolean }) {
  const texto = new Intl.NumberFormat('es-EC').format(Math.abs(valor))
  return (
    <span className={`puntos ${signo ? (valor >= 0 ? 'puntos-pos' : 'puntos-neg') : ''}`}>
      {signo ? (valor >= 0 ? '+' : '−') : valor < 0 ? '−' : ''}
      {texto} <small>pts</small>
    </span>
  )
}
