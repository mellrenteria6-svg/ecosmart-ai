// Enrutador mínimo basado en el hash de la URL (#/ruta?parametro=valor).
// Funciona en hosting estático sin configuración del servidor.

import { useSyncExternalStore } from 'react'

function suscribir(fn: () => void) {
  window.addEventListener('hashchange', fn)
  return () => window.removeEventListener('hashchange', fn)
}

const leerHash = () => window.location.hash || '#/'

export interface Ruta {
  path: string
  partes: string[]
  query: URLSearchParams
}

export function parsearRuta(hash: string): Ruta {
  const sinNumeral = hash.replace(/^#/, '') || '/'
  const [path, qs = ''] = sinNumeral.split('?')
  return { path, partes: path.split('/').filter(Boolean), query: new URLSearchParams(qs) }
}

export function useRuta(): Ruta {
  const hash = useSyncExternalStore(suscribir, leerHash)
  return parsearRuta(hash)
}

export function navegar(destino: string) {
  window.location.hash = destino.startsWith('#') ? destino : '#' + destino
}
