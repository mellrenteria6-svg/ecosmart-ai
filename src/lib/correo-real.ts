// ¿El servidor envía correos reales? (RF01, RF02, RNF13). Si es así, la página deja de mencionar
// la bandeja simulada: los correos llegan al buzón de cada persona. Las cuentas de demostración
// (@universidad.edu.ec) no tienen buzón propio: sus correos van al buzón del proyecto si está
// configurado, y si no, siguen en la bandeja simulada.
import { useSyncExternalStore } from 'react'
import { MODO_SERVIDOR } from '../data/store'

export const DOMINIO_DEMO = 'universidad.edu.ec'
export const esCorreoDemo = (correo: string) => correo.trim().toLowerCase().endsWith('@' + DOMINIO_DEMO)

let estado = { correoReal: false, demoReal: false }
const oyentes = new Set<() => void>()

if (MODO_SERVIDOR && typeof fetch !== 'undefined') {
  fetch('/api/salud')
    .then((r) => r.json())
    .then((d: { correoReal?: boolean; correoDemoReal?: boolean }) => {
      estado = { correoReal: d.correoReal === true, demoReal: d.correoDemoReal === true }
      oyentes.forEach((f) => f())
    })
    .catch(() => {})
}

const suscribir = (f: () => void) => {
  oyentes.add(f)
  return () => {
    oyentes.delete(f)
  }
}

export function useCorreoReal() {
  return useSyncExternalStore(suscribir, () => estado.correoReal)
}

/** Para un correo concreto: ¿su mensaje queda en la bandeja simulada? ¿es una cuenta de demostración? */
export function useAvisoCorreo(correo: string) {
  const correoReal = useCorreoReal()
  const demoReal = useSyncExternalStore(suscribir, () => estado.demoReal)
  const demo = esCorreoDemo(correo)
  return { usaBandeja: !correoReal || (demo && !demoReal), demo }
}
