// ¿El servidor envía correos reales? (RF01, RF02, RNF13). Si es así, la página deja de mencionar
// la bandeja simulada: los correos llegan al buzón de cada persona. Las cuentas de demostración
// (@universidad.edu.ec) no tienen buzón real y siguen usando la bandeja.
import { useSyncExternalStore } from 'react'
import { MODO_SERVIDOR } from '../data/store'

export const DOMINIO_DEMO = 'universidad.edu.ec'
export const esCorreoDemo = (correo: string) => correo.trim().toLowerCase().endsWith('@' + DOMINIO_DEMO)

let correoReal = false
const oyentes = new Set<() => void>()

if (MODO_SERVIDOR && typeof fetch !== 'undefined') {
  fetch('/api/salud')
    .then((r) => r.json())
    .then((d: { correoReal?: boolean }) => {
      correoReal = d.correoReal === true
      oyentes.forEach((f) => f())
    })
    .catch(() => {})
}

export function useCorreoReal() {
  return useSyncExternalStore(
    (f) => {
      oyentes.add(f)
      return () => {
        oyentes.delete(f)
      }
    },
    () => correoReal,
  )
}
