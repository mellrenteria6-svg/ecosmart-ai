// Qué datos puede ver cada rol (RNF04, RNF05). El servidor nunca envía contraseñas,
// tokens ni datos de otros usuarios que el rol no necesite.
import type { Db, Usuario } from '../src/data/types'

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

export function vistaPara(db: Db, u: Usuario | null): Db {
  const base: Db = {
    version: db.version,
    config: db.config,
    instituciones: db.instituciones,
    categorias: db.categorias,
    historialCategorias: [],
    puntos: u?.rol === 'admin' ? db.puntos : db.puntos.filter((p) => p.visible),
    recompensas: u?.rol === 'admin' ? db.recompensas : db.recompensas.filter((r) => r.activa || (u && r.aliadoId === u.id)),
    // EcoRanking: solo los puntos ganados por reciclaje, sin descripciones
    movimientos: db.movimientos.filter((m) => m.tipo === 'reciclaje').map((m) => ({ ...m, descripcion: '' })),
    usuarios: db.usuarios.filter((x) => x.rol === 'usuario').map((x) => publico(x, x.id === u?.id)),
    reciclajes: [],
    asignaciones: [],
    lotes: [],
    canjes: [],
    notificaciones: [],
    auditoria: [],
    correos: [],
    tokens: [],
    alertas: [],
  }
  if (!u) return base

  // Siempre: su propia cuenta, sus movimientos y sus notificaciones
  const propios = new Set([u.id])
  base.usuarios = [...base.usuarios.filter((x) => x.id !== u.id), sinSecretos(u)]
  base.movimientos = [...base.movimientos.filter((m) => m.usuarioId !== u.id), ...db.movimientos.filter((m) => m.usuarioId === u.id)]
  base.notificaciones = db.notificaciones.filter((n) => n.usuarioId === u.id)

  if (u.rol === 'usuario') {
    base.reciclajes = db.reciclajes.filter((r) => r.usuarioId === u.id)
    base.canjes = db.canjes.filter((c) => c.usuarioId === u.id)
  }

  if (u.rol === 'recolector') {
    // Solo los puntos asignados y sus registros (con foto, para validar)
    base.asignaciones = db.asignaciones.filter((a) => a.recolectorId === u.id)
    const puntos = new Set(base.asignaciones.filter((a) => a.activa).map((a) => a.puntoId))
    base.reciclajes = db.reciclajes.filter((r) => puntos.has(r.puntoId) || r.validadoPor === u.id)
    base.lotes = db.lotes.filter((l) => l.recolectorId === u.id)
    base.reciclajes.forEach((r) => propios.add(r.usuarioId))
    base.usuarios = db.usuarios.filter((x) => propios.has(x.id) || x.rol === 'usuario').map((x) => (x.id === u.id ? sinSecretos(x) : publico(x, false)))
  }

  if (u.rol === 'aliado') {
    const mias = new Set(db.recompensas.filter((r) => r.aliadoId === u.id).map((r) => r.id))
    base.canjes = db.canjes.filter((c) => mias.has(c.recompensaId))
  }

  if (u.rol === 'admin') {
    return { ...db, usuarios: db.usuarios.map(sinSecretos), correos: [], tokens: [], historialCategorias: [] }
  }
  return base
}
