// Cálculos de lectura: EcoRanking (RF07/RF21), impacto ambiental (RF22) e insignias.
import type { Db, Usuario } from './types'

const DIA = 86_400_000

export type Periodo = 'semana' | 'mes' | 'siempre'
export const ETIQUETA_PERIODO: Record<Periodo, string> = { semana: 'Últimos 7 días', mes: 'Últimos 30 días', siempre: 'Histórico' }

function desde(periodo: Periodo) {
  return periodo === 'semana' ? Date.now() - 7 * DIA : periodo === 'mes' ? Date.now() - 30 * DIA : 0
}

export interface FilaRanking {
  usuario: Usuario
  puntos: number
  reciclajes: number
  ultimo: number
  posicion: number
  nombrePublico: string
}

/**
 * Suma solo los EcoPoints ganados por reciclaje (no canjes ni ajustes) en el periodo.
 * Desempate: más reciclajes validados y luego quien llegó primero al puntaje (último movimiento más antiguo).
 */
export function rankingUsuarios(db: Db, periodo: Periodo, institucionId?: string): FilaRanking[] {
  const inicio = desde(periodo)
  const filas = db.usuarios
    .filter((u) => u.rol === 'usuario' && !u.bloqueado && (!institucionId || u.institucionId === institucionId))
    .map((u) => {
      const movs = db.movimientos.filter((m) => m.usuarioId === u.id && m.tipo === 'reciclaje' && m.creadoEn >= inicio)
      return {
        usuario: u,
        puntos: movs.reduce((t, m) => t + m.puntos, 0),
        reciclajes: movs.length,
        ultimo: Math.max(0, ...movs.map((m) => m.creadoEn)),
        posicion: 0,
        nombrePublico: u.rankingAnonimo ? `Reciclador anónimo #${u.id.slice(-3).toUpperCase()}` : u.nombre,
      }
    })
    .filter((f) => f.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos || b.reciclajes - a.reciclajes || a.ultimo - b.ultimo)
  filas.forEach((f, i) => (f.posicion = i + 1))
  return filas
}

export function rankingUniversidades(db: Db, periodo: Periodo) {
  return db.instituciones
    .map((i) => {
      const filas = rankingUsuarios(db, periodo, i.id)
      return { institucion: i, puntos: filas.reduce((t, f) => t + f.puntos, 0), participantes: filas.length }
    })
    .filter((x) => x.participantes > 0)
    .sort((a, b) => b.puntos - a.puntos || b.participantes - a.participantes)
}

export function rankingFacultades(db: Db, periodo: Periodo, institucionId?: string) {
  const mapa = new Map<string, { facultad: string; puntos: number; participantes: number }>()
  for (const f of rankingUsuarios(db, periodo, institucionId)) {
    const actual = mapa.get(f.usuario.facultad) ?? { facultad: f.usuario.facultad, puntos: 0, participantes: 0 }
    actual.puntos += f.puntos
    actual.participantes += 1
    mapa.set(f.usuario.facultad, actual)
  }
  return [...mapa.values()].sort((a, b) => b.puntos - a.puntos || b.participantes - a.participantes)
}

export interface ImpactoCategoria {
  categoriaId: string
  nombre: string
  color: string
  unidad: string
  cantidad: number
  co2Kg: number
  aguaL: number
  energiaKwh: number
}

export function impactoUsuario(db: Db, usuarioId: string, periodo: Periodo) {
  const inicio = desde(periodo)
  const validados = db.reciclajes.filter((r) => r.usuarioId === usuarioId && r.estado === 'validado' && (r.validadoEn ?? r.creadoEn) >= inicio)
  const porCategoria: ImpactoCategoria[] = db.categorias
    .map((c) => {
      const cantidad = validados.filter((r) => r.categoriaId === c.id).reduce((t, r) => t + (r.cantidadFinal ?? r.cantidadReportada), 0)
      return {
        categoriaId: c.id,
        nombre: c.nombre,
        color: c.color,
        unidad: c.unidad,
        cantidad,
        co2Kg: cantidad * c.impacto.co2Kg,
        aguaL: cantidad * c.impacto.aguaL,
        energiaKwh: cantidad * c.impacto.energiaKwh,
      }
    })
    .filter((x) => x.cantidad > 0)
  const total = porCategoria.reduce(
    (t, x) => ({ co2Kg: t.co2Kg + x.co2Kg, aguaL: t.aguaL + x.aguaL, energiaKwh: t.energiaKwh + x.energiaKwh }),
    { co2Kg: 0, aguaL: 0, energiaKwh: 0 },
  )
  return { porCategoria, total, version: db.config.factorImpactoVersion }
}

export interface Insignia {
  id: string
  nombre: string
  descripcion: string
  icono: string
  obtenida: boolean
  progreso: string
}

export function insigniasUsuario(db: Db, usuarioId: string): Insignia[] {
  const validados = db.reciclajes.filter((r) => r.usuarioId === usuarioId && r.estado === 'validado')
  const categorias = new Set(validados.map((r) => r.categoriaId))
  const pet = validados.filter((r) => r.categoriaId === 'cat-pet').reduce((t, r) => t + (r.cantidadFinal ?? 0), 0)
  const donaciones = db.canjes.filter((c) => c.usuarioId === usuarioId && db.recompensas.find((r) => r.id === c.recompensaId)?.tipo === 'donacion').length
  const posicion = rankingUsuarios(db, 'mes').find((f) => f.usuario.id === usuarioId)?.posicion
  const ins = (id: string, nombre: string, descripcion: string, icono: string, actual: number, meta: number): Insignia => ({
    id,
    nombre,
    descripcion,
    icono,
    obtenida: actual >= meta,
    progreso: `${Math.min(actual, meta)}/${meta}`,
  })
  return [
    ins('primero', 'Primer paso', 'Tu primer reciclaje validado', '🌱', validados.length, 1),
    ins('constante', 'Constante', '10 reciclajes validados', '🔁', validados.length, 10),
    ins('pet', 'Cazador de PET', '20 botellas PET validadas', '🧴', pet, 20),
    ins('multi', 'Multimaterial', 'Recicla 3 categorías distintas', '🎨', categorias.size, 3),
    ins('donante', 'Corazón verde', 'Haz una donación con tus EcoPoints', '💚', donaciones, 1),
    { id: 'top', nombre: 'Top 3 del mes', descripcion: 'Entra al podio del EcoRanking mensual', icono: '🏆', obtenida: !!posicion && posicion <= 3, progreso: posicion ? `Puesto ${posicion}` : 'Sin puesto' },
  ]
}
