// Qué datos recibe cada rol (RNF04, RNF05) y cuántos (RNF02, RNF09).
// - Nunca se envían contraseñas, tokens ni datos de otros usuarios que el rol no necesite.
// - Las fotos no viajan dentro de los datos: se marcan como "remota" y el navegador las pide
//   una por una a /api/foto/:id, que vuelve a comprobar el permiso.
// - El EcoRanking llega calculado: primeros puestos y la fila propia, no el libro de todos.
import { recortarRankings } from '../src/data/analitica'
import type { calcularRankingsCompletos } from '../src/data/analitica'
import type { Db, Reciclaje, Usuario } from '../src/data/types'

export const FOTO_REMOTA = 'remota'

/** Datos mínimos de otra persona: lo necesario para el ranking y los nombres en listas. */
function publico(u: Usuario, mismo: boolean): Usuario {
  const anonimo = !!u.rankingAnonimo && !mismo
  return {
    id: u.id,
    nombre: anonimo ? `Reciclador anónimo #${u.id.slice(-3).toUpperCase()}` : u.nombre,
    correo: '',
    institucionId: u.institucionId,
    facultad: anonimo ? '' : u.facultad,
    rol: u.rol,
    passwordHash: '',
    verificado: u.verificado,
    bloqueado: u.bloqueado,
    intentosFallidos: 0,
    sesionVersion: 0,
    creadoEn: u.creadoEn,
    consentimientoPrivacidad: true,
    rankingAnonimo: u.rankingAnonimo,
  }
}

const sinSecretos = (u: Usuario): Usuario => ({ ...u, passwordHash: '' })
const sinFoto = (r: Reciclaje): Reciclaje => (r.foto ? { ...r, foto: FOTO_REMOTA } : r)

// Cada índice se recuerda por lista: si una escritura no tocó una tabla, su índice se reutiliza
const indicesGuardados = new WeakMap<object, Map<string, unknown>>()
function agrupar<T extends { usuarioId: string }>(filas: T[]): Map<string, T[]> {
  const guardado = indicesGuardados.get(filas)
  if (guardado) return guardado as Map<string, T[]>
  const m = new Map<string, T[]>()
  for (const f of filas) {
    const lista = m.get(f.usuarioId)
    if (lista) lista.push(f)
    else m.set(f.usuarioId, [f])
  }
  indicesGuardados.set(filas, m)
  return m
}
function porId(usuarios: Usuario[]): Map<string, Usuario> {
  const guardado = indicesGuardados.get(usuarios)
  if (guardado) return guardado as Map<string, Usuario>
  const m = new Map(usuarios.map((u) => [u.id, u]))
  indicesGuardados.set(usuarios, m)
  return m
}

/** Índices por usuario: evitan recorrer todas las tablas en cada consulta. */
export function indicesPorUsuario(db: Db) {
  return {
    reciclajes: agrupar(db.reciclajes),
    movimientos: agrupar(db.movimientos),
    notificaciones: agrupar(db.notificaciones),
    canjes: agrupar(db.canjes),
    usuarios: porId(db.usuarios),
  }
}
export type IndicesPorUsuario = ReturnType<typeof indicesPorUsuario>

export function resumenPublico(db: Db) {
  let reciclajesValidados = 0
  for (const r of db.reciclajes) if (r.estado === 'validado') reciclajesValidados += 1
  let ecopointsOtorgados = 0
  for (const m of db.movimientos) if (m.tipo === 'reciclaje') ecopointsOtorgados += m.puntos
  return { reciclajesValidados, ecopointsOtorgados }
}

/** ¿Puede este usuario ver la foto de este reciclaje? (RNF05: titular, recolector asignado o administración) */
export function puedeVerFoto(db: Db, u: Usuario, r: Reciclaje) {
  if (u.rol === 'admin') return true
  if (u.rol === 'usuario') return r.usuarioId === u.id
  if (u.rol === 'recolector') {
    return r.validadoPor === u.id || db.asignaciones.some((a) => a.recolectorId === u.id && a.puntoId === r.puntoId && a.activa)
  }
  return false
}

export function vistaPara(
  db: Db,
  u: Usuario | null,
  rankings: ReturnType<typeof calcularRankingsCompletos>,
  resumen: ReturnType<typeof resumenPublico>,
  indices: IndicesPorUsuario = indicesPorUsuario(db),
): Db {
  if (u?.rol === 'admin') {
    return { ...db, usuarios: db.usuarios.map(sinSecretos), reciclajes: db.reciclajes.map(sinFoto), correos: [], tokens: [], historialCategorias: [], resumenPublico: resumen }
  }

  const recortados = recortarRankings(rankings, u?.id, u?.institucionId)
  // Personas que aparecen en el ranking (datos públicos) y quien consulta (datos completos)
  const visibles = new Set<string>()
  for (const filas of Object.values(recortados.usuarios)) for (const f of filas) visibles.add(f.usuarioId)

  const base: Db = {
    version: db.version,
    config: db.config,
    instituciones: db.instituciones,
    categorias: db.categorias,
    historialCategorias: [],
    puntos: db.puntos.filter((p) => p.visible),
    recompensas: db.recompensas.filter((r) => r.activa || (u && r.aliadoId === u.id)),
    movimientos: [],
    usuarios: [],
    reciclajes: [],
    asignaciones: [],
    lotes: [],
    canjes: [],
    notificaciones: [],
    auditoria: [],
    correos: [],
    tokens: [],
    alertas: [],
    rankings: recortados,
    resumenPublico: resumen,
  }

  if (u) {
    base.movimientos = indices.movimientos.get(u.id) ?? []
    base.notificaciones = indices.notificaciones.get(u.id) ?? []

    if (u.rol === 'usuario') {
      base.reciclajes = (indices.reciclajes.get(u.id) ?? []).map(sinFoto)
      base.canjes = indices.canjes.get(u.id) ?? []
    }

    if (u.rol === 'recolector') {
      // Sus asignaciones; de sus puntos, solo lo que falta decidir; y lo que él mismo decidió
      base.asignaciones = db.asignaciones.filter((a) => a.recolectorId === u.id)
      const puntos = new Set(base.asignaciones.filter((a) => a.activa).map((a) => a.puntoId))
      base.reciclajes = db.reciclajes
        .filter((r) => r.validadoPor === u.id || (puntos.has(r.puntoId) && (r.estado === 'pendiente' || r.estado === 'en_revision')))
        .map(sinFoto)
      base.lotes = db.lotes.filter((l) => l.recolectorId === u.id)
      base.reciclajes.forEach((r) => visibles.add(r.usuarioId))
    }

    if (u.rol === 'aliado') {
      const mias = new Set(db.recompensas.filter((r) => r.aliadoId === u.id).map((r) => r.id))
      base.canjes = db.canjes.filter((c) => mias.has(c.recompensaId))
      base.canjes.forEach((c) => visibles.add(c.usuarioId))
    }
  }

  base.usuarios = [...visibles].filter((id) => id !== u?.id).flatMap((id) => {
    const x = indices.usuarios.get(id)
    return x ? [publico(x, false)] : []
  })
  if (u) base.usuarios.push(sinSecretos(u))
  return base
}
