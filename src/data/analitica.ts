// Cálculos de lectura: EcoRanking (RF07/RF21), impacto ambiental (RF22) e insignias.
import type { Db, RankingsPrecalculados, Usuario } from './types'

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

const PERIODOS: Periodo[] = ['semana', 'mes', 'siempre']
export const claveRanking = (periodo: Periodo, institucionId?: string) => `${periodo}|${institucionId ?? 'todas'}`

const usuarioDesconocido = (id: string): Usuario => ({
  id, nombre: 'Reciclador', correo: '', institucionId: '', facultad: '', rol: 'usuario', passwordHash: '',
  verificado: true, bloqueado: false, intentosFallidos: 0, sesionVersion: 0, creadoEn: 0, consentimientoPrivacidad: true,
})

/** Suma de movimientos de reciclaje por usuario desde una fecha (una sola pasada por el libro). */
function sumasPorUsuario(db: Db, inicio: number) {
  const sumas = new Map<string, { puntos: number; reciclajes: number; ultimo: number }>()
  for (const m of db.movimientos) {
    if (m.tipo !== 'reciclaje' || m.creadoEn < inicio) continue
    const s = sumas.get(m.usuarioId) ?? { puntos: 0, reciclajes: 0, ultimo: 0 }
    s.puntos += m.puntos
    s.reciclajes += 1
    s.ultimo = Math.max(s.ultimo, m.creadoEn)
    sumas.set(m.usuarioId, s)
  }
  return sumas
}

/**
 * Suma solo los EcoPoints ganados por reciclaje (no canjes ni ajustes) en el periodo.
 * Desempate: más reciclajes validados y luego quien llegó primero al puntaje (último movimiento más antiguo).
 * En modo base de datos usa el ranking que calculó el servidor (primeros puestos y la fila propia).
 */
export function rankingUsuarios(db: Db, periodo: Periodo, institucionId?: string): FilaRanking[] {
  if (db.rankings) {
    const porId = new Map(db.usuarios.map((u) => [u.id, u]))
    return (db.rankings.usuarios[claveRanking(periodo, institucionId)] ?? []).map((f) => ({ ...f, usuario: porId.get(f.usuarioId) ?? usuarioDesconocido(f.usuarioId) }))
  }
  const sumas = sumasPorUsuario(db, desde(periodo))
  const filas = db.usuarios
    .filter((u) => u.rol === 'usuario' && !u.bloqueado && (!institucionId || u.institucionId === institucionId) && sumas.has(u.id))
    .map((u) => {
      const s = sumas.get(u.id)!
      return {
        usuario: u,
        puntos: s.puntos,
        reciclajes: s.reciclajes,
        ultimo: s.ultimo,
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
  if (db.rankings) {
    return (db.rankings.universidades[periodo] ?? [])
      .map((x) => ({ institucion: db.instituciones.find((i) => i.id === x.institucionId)!, puntos: x.puntos, participantes: x.participantes }))
      .filter((x) => x.institucion)
  }
  return db.instituciones
    .map((i) => {
      const filas = rankingUsuarios(db, periodo, i.id)
      return { institucion: i, puntos: filas.reduce((t, f) => t + f.puntos, 0), participantes: filas.length }
    })
    .filter((x) => x.participantes > 0)
    .sort((a, b) => b.puntos - a.puntos || b.participantes - a.participantes)
}

export function rankingFacultades(db: Db, periodo: Periodo, institucionId?: string) {
  if (db.rankings) return db.rankings.facultades[claveRanking(periodo, institucionId)] ?? []
  const mapa = new Map<string, { facultad: string; puntos: number; participantes: number }>()
  for (const f of rankingUsuarios(db, periodo, institucionId)) {
    const actual = mapa.get(f.usuario.facultad) ?? { facultad: f.usuario.facultad, puntos: 0, participantes: 0 }
    actual.puntos += f.puntos
    actual.participantes += 1
    mapa.set(f.usuario.facultad, actual)
  }
  return [...mapa.values()].sort((a, b) => b.puntos - a.puntos || b.participantes - a.participantes)
}

/** Servidor: rankings completos de todos los periodos y alcances (se calculan una vez por versión de la base). */
export function calcularRankingsCompletos(db: Db) {
  const usuarios: Record<string, FilaRanking[]> = {}
  const facultades: RankingsPrecalculados['facultades'] = {}
  const universidades: RankingsPrecalculados['universidades'] = {}
  for (const periodo of PERIODOS) {
    for (const inst of [undefined, ...db.instituciones.map((i) => i.id)]) {
      const clave = claveRanking(periodo, inst)
      usuarios[clave] = rankingUsuarios(db, periodo, inst)
      facultades[clave] = rankingFacultades(db, periodo, inst)
    }
    universidades[periodo] = rankingUniversidades(db, periodo).map((x) => ({ institucionId: x.institucion.id, puntos: x.puntos, participantes: x.participantes }))
  }
  return { usuarios, facultades, universidades }
}

/** Servidor: recorta los rankings a los primeros puestos más la fila de quien consulta. */
/**
 * Lo que recibe cada persona: los primeros puestos y su propia fila, solo de su universidad y de
 * "todas" (las dos opciones que ofrece la pantalla), y la tabla de universidades completa.
 */
export function recortarRankings(completos: ReturnType<typeof calcularRankingsCompletos>, yoId: string | undefined, institucionId?: string, mostrados = 50): RankingsPrecalculados {
  const alcances = new Set(['todas', ...(institucionId ? [institucionId] : [])])
  const sirve = (clave: string) => alcances.has(clave.slice(clave.indexOf('|') + 1))
  const usuarios: RankingsPrecalculados['usuarios'] = {}
  const facultades: RankingsPrecalculados['facultades'] = {}
  for (const [clave, filas] of Object.entries(completos.usuarios)) {
    if (!sirve(clave)) continue
    const top = filas.slice(0, mostrados)
    const posicion = yoId ? posicionDe(filas, yoId) : -1
    const propia = posicion >= mostrados ? filas[posicion] : undefined
    usuarios[clave] = [...top, ...(propia ? [propia] : [])].map(({ usuario, ...resto }) => ({ ...resto, usuarioId: usuario.id }))
  }
  for (const [clave, filas] of Object.entries(completos.facultades)) if (sirve(clave)) facultades[clave] = filas
  return { usuarios, facultades, universidades: completos.universidades, mostrados }
}

// Índice usuario → posición de cada lista completa: evita recorrer 5000 filas en cada consulta
const posiciones = new WeakMap<FilaRanking[], Map<string, number>>()
function posicionDe(filas: FilaRanking[], usuarioId: string) {
  let indice = posiciones.get(filas)
  if (!indice) {
    indice = new Map(filas.map((f, i) => [f.usuario.id, i]))
    posiciones.set(filas, indice)
  }
  return indice.get(usuarioId) ?? -1
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
