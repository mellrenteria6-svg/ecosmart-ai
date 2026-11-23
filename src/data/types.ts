// Modelo de datos de EcoSmart AI (Fase 1).
// Los nombres siguen las entidades del documento de requisitos v1.0.

export type Rol = 'usuario' | 'recolector' | 'admin' | 'aliado'

// Universidades participantes. Cada una puede tener varios dominios de correo
// (por ejemplo uno para estudiantes y otro para personal).
export interface Institucion {
  id: string
  nombre: string
  siglas: string
  dominios: string[]
  activa: boolean
}

export interface Usuario {
  id: string
  nombre: string
  correo: string
  institucionId: string
  facultad: string
  rol: Rol
  passwordHash: string
  verificado: boolean
  bloqueado: boolean
  intentosFallidos: number
  bloqueoTemporalHasta?: number
  sesionVersion: number // incrementar revoca sesiones (RF02, RF25, RNF13)
  creadoEn: number
  consentimientoPrivacidad: boolean
  rankingAnonimo?: boolean // RF07: ocultar identidad pública en el EcoRanking
  eliminadoEn?: number // RNF05: cuenta eliminada por su titular (datos anonimizados)
}

export type EstadoPunto = 'activo' | 'inactivo' | 'mantenimiento'

export interface PuntoReciclaje {
  id: string
  nombre: string
  ubicacion: string
  codigoQr: string
  categorias: string[] // ids de CATEGORIA_RESIDUO
  estado: EstadoPunto
  visible: boolean
  mapa: { x: number; y: number } // posición en el mapa esquemático (0-100)
}

export interface CategoriaResiduo {
  id: string
  nombre: string
  descripcion?: string // qué entra en la categoría
  unidad: string
  puntosPorUnidad: number
  minimo: number
  maximo: number
  version: number
  color: string
  activa: boolean // RF09: una categoría usada no se borra, se desactiva
  // Factores de impacto ambiental por unidad (RF22)
  impacto: { co2Kg: number; aguaL: number; energiaKwh: number }
}

export type EstadoReciclaje =
  | 'pendiente'
  | 'en_revision'
  | 'validado'
  | 'rechazado'

export interface Reciclaje {
  id: string
  idempotencyKey: string
  usuarioId: string
  puntoId: string
  categoriaId: string
  categoriaIa: string
  confianzaIa: number
  modeloVersion: string
  corregidoPorUsuario: boolean
  cantidadReportada: number
  cantidadFinal?: number
  motivoCantidad?: string
  // Tarifa congelada al crear el registro (RN04)
  unidad: string
  puntosPorUnidad: number
  categoriaVersion: number
  puntosEstimados: number
  estado: EstadoReciclaje
  motivoRevision?: string
  motivoRechazo?: string
  foto: string // data URL reducida (almacenamiento privado simulado)
  fotoHash: string
  creadoEn: number
  validadoEn?: number
  validadoPor?: string
  loteId?: string
}

export type TipoMovimiento = 'reciclaje' | 'canje' | 'devolucion' | 'ajuste'

export interface MovimientoPuntos {
  id: string
  usuarioId: string
  tipo: TipoMovimiento
  puntos: number // positivo suma, negativo resta
  referenciaId: string
  descripcion: string
  creadoEn: number
}

export interface AsignacionRecolector {
  id: string
  recolectorId: string
  puntoId: string
  desde: string // YYYY-MM-DD
  hasta: string // YYYY-MM-DD
  horario: string
  activa: boolean
}

export interface LoteValidacion {
  id: string
  puntoId: string
  recolectorId: string
  reciclajes: string[]
  validados: number
  rechazados: number
  creadoEn: number
}

export interface Recompensa {
  id: string
  nombre: string
  descripcion: string
  costo: number
  stock: number
  vigenciaDesde: string
  vigenciaHasta: string
  responsable: string
  activa: boolean
  emoji: string
  procedencia: string // RF10: de dónde proviene la recompensa
  tipo: TipoRecompensa
  aliadoId?: string // Fase 2: aliado responsable de la entrega
  sorteoRealizado?: boolean
}

// Recompensas no comerciales (sección 3.3 del avance)
export type TipoRecompensa = 'beneficio' | 'sorteo' | 'donacion'

export type EstadoCanje = 'pendiente' | 'entregado' | 'vencido' | 'cancelado'

export interface Canje {
  id: string
  idempotencyKey: string
  usuarioId: string
  recompensaId: string
  codigo: string
  costo: number
  estado: EstadoCanje
  creadoEn: number
  venceEn: number
  entregadoEn?: number
  entregadoPor?: string
  devuelto: boolean
  ganador?: boolean // sorteos
}

// RF26 – Alertas antifraude
export type EstadoAlerta = 'abierta' | 'resuelta' | 'descartada'

export interface AlertaFraude {
  id: string
  regla: string
  evidencia: string
  usuarioId: string
  reciclajeId?: string
  estado: EstadoAlerta
  resolucion?: string
  resueltoPor?: string
  creadoEn: number
  resueltoEn?: number
}

export interface Notificacion {
  id: string
  usuarioId: string
  titulo: string
  mensaje: string
  leida: boolean
  creadoEn: number
}

export interface Auditoria {
  id: string
  actorId: string
  actorNombre: string
  accion: string
  entidad: string
  entidadId: string
  detalle: string
  creadoEn: number
}

export interface CorreoSimulado {
  id: string
  para: string
  asunto: string
  cuerpo: string
  enlace?: string
  creadoEn: number
}

export interface Token {
  token: string
  usuarioId: string
  tipo: 'verificacion' | 'restablecer' | 'segundo_factor'
  venceEn: number
  usado: boolean
}

export interface Configuracion {
  dominioInstitucional?: string // obsoleto: reemplazado por Db.instituciones
  topeDiario: number
  umbralConfianza: number // 0-1
  horasVencimientoCanje: number
  diasRetencionFotos: number
  modeloVersion: string
  factorImpactoVersion: string
}

export interface Sesion {
  usuarioId: string
  sesionVersion: number
  creadaEn: number
  token?: string // modo servidor: token de sesión emitido por la API
}

// Rankings calculados en el servidor (modo base de datos): el navegador recibe solo los
// primeros puestos y su propia fila, no los movimientos de todas las cuentas (RNF02, RNF09).
export interface FilaRankingDatos {
  usuarioId: string
  puntos: number
  reciclajes: number
  ultimo: number
  posicion: number
  nombrePublico: string
}

export interface RankingsPrecalculados {
  usuarios: Record<string, FilaRankingDatos[]> // clave "periodo|institucion" (o "periodo|todas")
  facultades: Record<string, { facultad: string; puntos: number; participantes: number }[]>
  universidades: Record<string, { institucionId: string; puntos: number; participantes: number }[]> // clave "periodo"
  mostrados: number
}

export interface Db {
  version: number
  config: Configuracion
  rankings?: RankingsPrecalculados
  resumenPublico?: { reciclajesValidados: number; ecopointsOtorgados: number }
  instituciones: Institucion[]
  usuarios: Usuario[]
  puntos: PuntoReciclaje[]
  categorias: CategoriaResiduo[]
  historialCategorias: CategoriaResiduo[]
  reciclajes: Reciclaje[]
  movimientos: MovimientoPuntos[]
  asignaciones: AsignacionRecolector[]
  lotes: LoteValidacion[]
  recompensas: Recompensa[]
  canjes: Canje[]
  notificaciones: Notificacion[]
  auditoria: Auditoria[]
  correos: CorreoSimulado[]
  tokens: Token[]
  alertas: AlertaFraude[]
}

// Cola local para modo sin conexión (RF30)
export type EstadoCola = 'en_cola' | 'sincronizando' | 'requiere_accion'

export interface ElementoCola {
  idempotencyKey: string
  usuarioId: string
  codigoPunto: string
  categoriaId: string
  categoriaIa: string
  confianzaIa: number
  modeloVersion: string
  cantidad: number
  foto: string
  fotoHash: string
  creadoEn: number
  estado: EstadoCola
  motivo?: string
}
