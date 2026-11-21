// RF23 – Activar o desactivar los avisos push en este dispositivo
import { useEffect, useState } from 'react'
import { MODO_SERVIDOR } from '../data/store'
import { activar, desactivar, estadoActual, probar } from '../lib/push'
import type { EstadoPush } from '../lib/push'
import { Alerta, useAccion } from './ui'

export function AvisosPush() {
  const [estado, setEstado] = useState<EstadoPush | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const { error, cargando, ejecutar } = useAccion()

  useEffect(() => {
    let vivo = true
    void estadoActual().then((e) => vivo && setEstado(e))
    return () => {
      vivo = false
    }
  }, [])

  if (!estado) return null

  return (
    <section className={`bloque avisos-push avisos-${estado}`} aria-live="polite">
      <div className="avisos-cab">
        <span className="avisos-icono" aria-hidden="true">{estado === 'activo' ? '🔔' : '🔕'}</span>
        <div>
          <h2 className="h-bloque">Avisos en este dispositivo</h2>
          {estado === 'activo' && <p className="nota">Te avisaremos cuando validen tus reciclajes, cuando se entregue o venza un canje y en otros movimientos de tu cuenta{MODO_SERVIDOR ? ', aunque la página esté cerrada' : ' mientras la página esté abierta'}.</p>}
          {estado === 'inactivo' && <p className="nota">Recibe un aviso cuando validen tus reciclajes o se mueva un canje. Es opcional: sin activarlo, los verás igual en esta sección.</p>}
          {estado === 'denegado' && <p className="nota">Bloqueaste los avisos para esta página. Puedes permitirlos desde el candado de la barra de direcciones del navegador. Mientras tanto, seguirás viendo todo aquí.</p>}
          {estado === 'no-soportado' && <p className="nota">Este navegador no admite avisos. Seguirás viendo todo en esta sección.</p>}
        </div>
      </div>
      <div className="avisos-acciones">
        {estado === 'inactivo' && (
          <button
            type="button"
            className="btn btn-tinta btn-sm"
            disabled={cargando}
            onClick={async () => {
              setMensaje(null)
              const e = await ejecutar(() => activar())
              if (e) {
                setEstado(e)
                if (e === 'activo') setMensaje('Avisos activados.')
              }
            }}
          >
            Activar avisos
          </button>
        )}
        {estado === 'activo' && (
          <>
            <button
              type="button"
              className="btn btn-linea btn-sm"
              disabled={cargando}
              onClick={async () => {
                setMensaje(null)
                const n = await ejecutar(() => probar())
                if (n !== undefined) setMensaje(n > 0 ? 'Aviso de prueba enviado. Debería aparecer en unos segundos.' : 'No se encontró este dispositivo; desactiva y vuelve a activar los avisos.')
              }}
            >
              Enviar aviso de prueba
            </button>
            <button
              type="button"
              className="btn btn-fantasma btn-sm"
              disabled={cargando}
              onClick={async () => {
                setMensaje(null)
                const e = await ejecutar(() => desactivar())
                if (e) setEstado(e)
              }}
            >
              Desactivar
            </button>
          </>
        )}
      </div>
      {mensaje && <Alerta tono="ok">{mensaje}</Alerta>}
      {error && <Alerta tono="error">{error}</Alerta>}
    </section>
  )
}
