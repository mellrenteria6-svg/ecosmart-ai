// Conexión a PostgreSQL y conversión entre las tablas y el modelo de la aplicación (Db).
import pg from 'pg'
import type { PoolClient } from 'pg'
import type {
  AlertaFraude,
  AsignacionRecolector,
  Auditoria,
  Canje,
  CategoriaResiduo,
  CorreoSimulado,
  Db,
  Institucion,
  LoteValidacion,
  MovimientoPuntos,
  Notificacion,
  PuntoReciclaje,
  Reciclaje,
  Recompensa,
  Usuario,
} from '../src/data/types'

// Tipos de PostgreSQL → JavaScript
pg.types.setTypeParser(1700, (v) => parseFloat(v)) // NUMERIC
pg.types.setTypeParser(20, (v) => parseInt(v, 10)) // BIGINT
pg.types.setTypeParser(1082, (v) => v) // DATE como 'YYYY-MM-DD'

// Usa PGHOST, PGPORT, PGDATABASE, PGUSER y PGPASSWORD del archivo server/.env
export const pool = new pg.Pool({ max: 10 })

type Fila = Record<string, unknown>
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : v == null ? undefined : new Date(v as string).getTime())
const fecha = (v: number | undefined) => (v == null ? null : new Date(v))
const opt = <T,>(v: T | null) => (v == null ? undefined : v)

// ---------------------------------------------------------------------------
// Lectura: PostgreSQL → Db
// ---------------------------------------------------------------------------
export async function cargarDb(c: PoolClient): Promise<Db> {
  const q = async (sql: string) => (await c.query(sql)).rows as Fila[]
  const [cfg] = await q('SELECT * FROM configuracion WHERE campus_id = 1')
  const instituciones = await q(`SELECT i.*, COALESCE(array_agg(d.dominio::text ORDER BY d.dominio) FILTER (WHERE d.dominio IS NOT NULL), '{}') AS dominios
                                 FROM institucion i LEFT JOIN institucion_dominio d ON d.institucion_id = i.id GROUP BY i.id ORDER BY i.siglas = 'DEMO' DESC, i.siglas`)
  const usuarios = await q('SELECT * FROM usuario ORDER BY creado_en')
  const categorias = await q('SELECT * FROM categoria_residuo ORDER BY nombre = \'Plástico PET\' DESC, nombre')
  const puntos = await q(`SELECT p.*, COALESCE(array_agg(pc.categoria_id) FILTER (WHERE pc.categoria_id IS NOT NULL), '{}') AS categorias
                          FROM punto_reciclaje p LEFT JOIN punto_categoria pc ON pc.punto_id = p.id GROUP BY p.id ORDER BY p.codigo_qr`)
  const reciclajes = await q('SELECT * FROM reciclaje ORDER BY creado_en')
  const movimientos = await q('SELECT * FROM movimiento_puntos ORDER BY creado_en')
  const asignaciones = await q('SELECT * FROM asignacion_recolector ORDER BY creado_en')
  const lotes = await q('SELECT l.*, COALESCE((SELECT array_agg(r.id::text) FROM reciclaje r WHERE r.lote_id = l.id), \'{}\') AS reciclajes FROM lote_validacion l ORDER BY creado_en')
  const recompensas = await q('SELECT * FROM recompensa ORDER BY costo')
  const canjes = await q('SELECT * FROM canje ORDER BY creado_en')
  const notificaciones = await q('SELECT * FROM notificacion ORDER BY creado_en')
  const auditoria = await q('SELECT a.*, u.nombre AS actor_nombre FROM auditoria a LEFT JOIN usuario u ON u.id = a.actor_id ORDER BY a.id')
  const alertas = await q('SELECT * FROM alerta_fraude ORDER BY creado_en')
  const correos = await q('SELECT * FROM correo_simulado ORDER BY creado_en')

  return {
    version: 2,
    config: {
      topeDiario: cfg.tope_diario as number,
      umbralConfianza: cfg.umbral_confianza as number,
      horasVencimientoCanje: cfg.horas_vencimiento_canje as number,
      diasRetencionFotos: cfg.dias_retencion_fotos as number,
      modeloVersion: cfg.modelo_version as string,
      factorImpactoVersion: cfg.factor_impacto_version as string,
    },
    instituciones: instituciones.map((r): Institucion => ({ id: r.id as string, nombre: r.nombre as string, siglas: r.siglas as string, dominios: r.dominios as string[], activa: r.activa as boolean })),
    usuarios: usuarios.map((r): Usuario => ({
      id: r.id as string,
      nombre: r.nombre as string,
      correo: r.correo as string,
      institucionId: r.institucion_id as string,
      facultad: r.facultad as string,
      rol: r.rol as Usuario['rol'],
      passwordHash: '', // las contraseñas nunca salen de PostgreSQL
      verificado: r.verificado as boolean,
      bloqueado: r.bloqueado as boolean,
      intentosFallidos: r.intentos_fallidos as number,
      bloqueoTemporalHasta: ms(r.bloqueo_temporal_hasta),
      sesionVersion: r.sesion_version as number,
      creadoEn: ms(r.creado_en)!,
      consentimientoPrivacidad: r.consentimiento_privacidad as boolean,
      rankingAnonimo: r.ranking_anonimo as boolean,
    })),
    puntos: puntos.map((r): PuntoReciclaje => ({
      id: r.id as string,
      nombre: r.nombre as string,
      ubicacion: r.ubicacion as string,
      codigoQr: r.codigo_qr as string,
      categorias: r.categorias as string[],
      estado: r.estado as PuntoReciclaje['estado'],
      visible: r.visible as boolean,
      mapa: { x: (r.mapa_x as number) ?? 50, y: (r.mapa_y as number) ?? 50 },
    })),
    categorias: categorias.map((r): CategoriaResiduo => ({
      id: r.id as string,
      nombre: r.nombre as string,
      descripcion: opt(r.descripcion as string | null),
      unidad: r.unidad as string,
      puntosPorUnidad: r.puntos_por_unidad as number,
      minimo: r.minimo as number,
      maximo: r.maximo as number,
      version: r.version as number,
      color: r.color as string,
      activa: r.activa as boolean,
      impacto: { co2Kg: r.co2_kg_por_unidad as number, aguaL: r.agua_l_por_unidad as number, energiaKwh: r.energia_kwh_por_unidad as number },
    })),
    historialCategorias: [], // la tabla categoria_version la mantiene un trigger
    reciclajes: reciclajes.map((r): Reciclaje => ({
      id: r.id as string,
      idempotencyKey: r.idempotency_key as string,
      usuarioId: r.usuario_id as string,
      puntoId: r.punto_id as string,
      categoriaId: r.categoria_id as string,
      categoriaIa: r.categoria_ia as string,
      confianzaIa: r.confianza_ia as number,
      modeloVersion: r.modelo_version as string,
      corregidoPorUsuario: r.corregido_por_usuario as boolean,
      cantidadReportada: r.cantidad_reportada as number,
      cantidadFinal: opt(r.cantidad_final as number | null),
      motivoCantidad: opt(r.motivo_cantidad as string | null),
      unidad: r.unidad as string,
      puntosPorUnidad: r.puntos_por_unidad as number,
      categoriaVersion: r.categoria_version as number,
      puntosEstimados: r.puntos_estimados as number,
      estado: r.estado as Reciclaje['estado'],
      motivoRevision: opt(r.motivo_revision as string | null),
      motivoRechazo: opt(r.motivo_rechazo as string | null),
      foto: r.foto_url as string,
      fotoHash: (r.foto_hash as string).trim(),
      creadoEn: ms(r.creado_en)!,
      validadoEn: ms(r.validado_en),
      validadoPor: opt(r.validado_por as string | null),
      loteId: opt(r.lote_id as string | null),
    })),
    movimientos: movimientos.map((r): MovimientoPuntos => ({ id: r.id as string, usuarioId: r.usuario_id as string, tipo: r.tipo as MovimientoPuntos['tipo'], puntos: r.puntos as number, referenciaId: r.referencia_id as string, descripcion: r.descripcion as string, creadoEn: ms(r.creado_en)! })),
    asignaciones: asignaciones.map((r): AsignacionRecolector => ({ id: r.id as string, recolectorId: r.recolector_id as string, puntoId: r.punto_id as string, desde: r.desde as string, hasta: r.hasta as string, horario: r.horario as string, activa: r.activa as boolean })),
    lotes: lotes.map((r): LoteValidacion => ({ id: r.id as string, puntoId: r.punto_id as string, recolectorId: r.recolector_id as string, reciclajes: r.reciclajes as string[], validados: r.validados as number, rechazados: r.rechazados as number, creadoEn: ms(r.creado_en)! })),
    recompensas: recompensas.map((r): Recompensa => ({
      id: r.id as string,
      nombre: r.nombre as string,
      descripcion: r.descripcion as string,
      costo: r.costo as number,
      stock: r.stock as number,
      vigenciaDesde: r.vigencia_desde as string,
      vigenciaHasta: r.vigencia_hasta as string,
      responsable: r.responsable as string,
      activa: r.activa as boolean,
      emoji: r.emoji as string,
      procedencia: r.procedencia as string,
      tipo: r.tipo as Recompensa['tipo'],
      aliadoId: opt(r.aliado_id as string | null),
      sorteoRealizado: r.sorteo_realizado as boolean,
    })),
    canjes: canjes.map((r): Canje => ({
      id: r.id as string,
      idempotencyKey: r.idempotency_key as string,
      usuarioId: r.usuario_id as string,
      recompensaId: r.recompensa_id as string,
      codigo: r.codigo as string,
      costo: r.costo as number,
      estado: r.estado as Canje['estado'],
      creadoEn: ms(r.creado_en)!,
      venceEn: ms(r.vence_en)!,
      entregadoEn: ms(r.entregado_en),
      entregadoPor: opt(r.entregado_por as string | null),
      devuelto: r.devuelto as boolean,
      ganador: opt(r.ganador as boolean | null),
    })),
    notificaciones: notificaciones.map((r): Notificacion => ({ id: r.id as string, usuarioId: r.usuario_id as string, titulo: r.titulo as string, mensaje: r.mensaje as string, leida: r.leida as boolean, creadoEn: ms(r.creado_en)! })),
    auditoria: auditoria.map((r): Auditoria => ({ id: String(r.id), actorId: (r.actor_id as string) ?? 'sistema', actorNombre: (r.actor_nombre as string) ?? 'Sistema', accion: r.accion as string, entidad: r.entidad as string, entidadId: r.entidad_id as string, detalle: r.detalle as string, creadoEn: ms(r.creado_en)! })),
    correos: correos.map((r): CorreoSimulado => ({ id: r.id as string, para: r.para as string, asunto: r.asunto as string, cuerpo: r.cuerpo as string, enlace: opt(r.enlace as string | null), creadoEn: ms(r.creado_en)! })),
    tokens: [], // los tokens los gestiona el módulo de autenticación del servidor
    alertas: alertas.map((r): AlertaFraude => ({
      id: r.id as string,
      regla: r.regla as string,
      evidencia: r.evidencia as string,
      usuarioId: r.usuario_id as string,
      reciclajeId: opt(r.reciclaje_id as string | null),
      estado: r.estado as AlertaFraude['estado'],
      resolucion: opt(r.resolucion as string | null),
      resueltoPor: opt(r.resuelto_por as string | null),
      creadoEn: ms(r.creado_en)!,
      resueltoEn: ms(r.resuelto_en),
    })),
  }
}

// ---------------------------------------------------------------------------
// Escritura: compara la base antes y después de la acción y guarda solo las diferencias
// ---------------------------------------------------------------------------
type Mapeo<T> = (x: T) => Fila

const filaUsuario: Mapeo<Usuario> = (u) => ({
  id: u.id,
  campus_id: 1,
  nombre: u.nombre,
  correo: u.correo,
  institucion_id: u.institucionId,
  facultad: u.facultad,
  rol: u.rol,
  verificado: u.verificado,
  bloqueado: u.bloqueado,
  intentos_fallidos: u.intentosFallidos,
  bloqueo_temporal_hasta: fecha(u.bloqueoTemporalHasta),
  sesion_version: u.sesionVersion,
  ranking_anonimo: !!u.rankingAnonimo,
  consentimiento_privacidad: u.consentimientoPrivacidad,
})
const filaCategoria: Mapeo<CategoriaResiduo> = (c) => ({
  id: c.id,
  nombre: c.nombre,
  descripcion: c.descripcion ?? null,
  unidad: c.unidad,
  puntos_por_unidad: c.puntosPorUnidad,
  minimo: c.minimo,
  maximo: c.maximo,
  color: c.color,
  activa: c.activa,
  co2_kg_por_unidad: c.impacto.co2Kg,
  agua_l_por_unidad: c.impacto.aguaL,
  energia_kwh_por_unidad: c.impacto.energiaKwh,
})
const filaPunto: Mapeo<PuntoReciclaje> = (p) => ({ id: p.id, campus_id: 1, nombre: p.nombre, ubicacion: p.ubicacion, codigo_qr: p.codigoQr, estado: p.estado, visible: p.visible, mapa_x: p.mapa.x, mapa_y: p.mapa.y })
const filaAsignacion: Mapeo<AsignacionRecolector> = (a) => ({ id: a.id, recolector_id: a.recolectorId, punto_id: a.puntoId, desde: a.desde, hasta: a.hasta, horario: a.horario, activa: a.activa })
const filaLote: Mapeo<LoteValidacion> = (l) => ({ id: l.id, punto_id: l.puntoId, recolector_id: l.recolectorId, validados: l.validados, rechazados: l.rechazados, creado_en: fecha(l.creadoEn) })
const filaReciclaje: Mapeo<Reciclaje> = (r) => ({
  id: r.id,
  idempotency_key: r.idempotencyKey,
  usuario_id: r.usuarioId,
  punto_id: r.puntoId,
  categoria_id: r.categoriaId,
  categoria_ia: r.categoriaIa,
  confianza_ia: r.confianzaIa,
  modelo_version: r.modeloVersion,
  corregido_por_usuario: r.corregidoPorUsuario,
  cantidad_reportada: r.cantidadReportada,
  cantidad_final: r.cantidadFinal ?? null,
  motivo_cantidad: r.motivoCantidad ?? null,
  unidad: r.unidad,
  puntos_por_unidad: r.puntosPorUnidad,
  categoria_version: r.categoriaVersion,
  puntos_estimados: r.puntosEstimados,
  estado: r.estado,
  motivo_revision: r.motivoRevision ?? null,
  motivo_rechazo: r.motivoRechazo ?? null,
  foto_url: r.foto,
  foto_hash: r.fotoHash,
  creado_en: fecha(r.creadoEn),
  validado_en: fecha(r.validadoEn),
  validado_por: r.validadoPor ?? null,
  lote_id: r.loteId ?? null,
})
const filaMovimiento: Mapeo<MovimientoPuntos> = (m) => ({ id: m.id, usuario_id: m.usuarioId, tipo: m.tipo, puntos: m.puntos, referencia_id: m.referenciaId, descripcion: m.descripcion, creado_en: fecha(m.creadoEn) })
const filaRecompensa: Mapeo<Recompensa> = (r) => ({
  id: r.id,
  nombre: r.nombre,
  descripcion: r.descripcion,
  costo: r.costo,
  stock: r.stock,
  vigencia_desde: r.vigenciaDesde,
  vigencia_hasta: r.vigenciaHasta,
  responsable: r.responsable,
  procedencia: r.procedencia,
  tipo: r.tipo,
  aliado_id: r.aliadoId ?? null,
  activa: r.activa,
  sorteo_realizado: !!r.sorteoRealizado,
  emoji: r.emoji,
})
const filaCanje: Mapeo<Canje> = (c) => ({
  id: c.id,
  idempotency_key: c.idempotencyKey,
  usuario_id: c.usuarioId,
  recompensa_id: c.recompensaId,
  codigo: c.codigo,
  costo: c.costo,
  estado: c.estado,
  creado_en: fecha(c.creadoEn),
  vence_en: fecha(c.venceEn),
  entregado_en: fecha(c.entregadoEn),
  entregado_por: c.entregadoPor ?? null,
  devuelto: c.devuelto,
  ganador: c.ganador ?? null,
})
const filaNotificacion: Mapeo<Notificacion> = (n) => ({ id: n.id, usuario_id: n.usuarioId, titulo: n.titulo, mensaje: n.mensaje, leida: n.leida, creado_en: fecha(n.creadoEn) })
const filaAuditoria: Mapeo<Auditoria> = (a) => ({ actor_id: a.actorId === 'sistema' ? null : a.actorId, accion: a.accion, entidad: a.entidad, entidad_id: a.entidadId, detalle: a.detalle, creado_en: fecha(a.creadoEn) })
const filaAlerta: Mapeo<AlertaFraude> = (a) => ({
  id: a.id,
  regla: a.regla,
  evidencia: a.evidencia,
  usuario_id: a.usuarioId,
  reciclaje_id: a.reciclajeId ?? null,
  estado: a.estado,
  resolucion: a.resolucion ?? null,
  resuelto_por: a.resueltoPor ?? null,
  creado_en: fecha(a.creadoEn),
  resuelto_en: fecha(a.resueltoEn),
})
const filaCorreo: Mapeo<CorreoSimulado> = (m) => ({ id: m.id, para: m.para, asunto: m.asunto, cuerpo: m.cuerpo, enlace: m.enlace ?? null, creado_en: fecha(m.creadoEn) })
const filaInstitucion: Mapeo<Institucion> = (i) => ({ id: i.id, nombre: i.nombre, siglas: i.siglas, activa: i.activa })

async function insertar(c: PoolClient, tabla: string, fila: Fila) {
  const cols = Object.keys(fila)
  await c.query(`INSERT INTO ${tabla} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(fila))
}

async function actualizar(c: PoolClient, tabla: string, fila: Fila, antes: Fila, excluir: string[] = []) {
  const cols = Object.keys(fila).filter((k) => k !== 'id' && !excluir.includes(k) && JSON.stringify(fila[k]) !== JSON.stringify(antes[k]))
  if (!cols.length) return
  await c.query(`UPDATE ${tabla} SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [fila.id, ...cols.map((k) => fila[k])])
}

/** Inserta lo nuevo y actualiza lo modificado (comparando por id). */
async function sincronizar<T extends { id: string }>(c: PoolClient, tabla: string, antes: T[], despues: T[], mapa: Mapeo<T>, opciones: { soloInsertar?: boolean; excluir?: string[] } = {}) {
  const previos = new Map(antes.map((x) => [x.id, x]))
  for (const x of despues) {
    const previo = previos.get(x.id)
    if (!previo) await insertar(c, tabla, mapa(x))
    else if (!opciones.soloInsertar) await actualizar(c, tabla, mapa(x), mapa(previo), opciones.excluir)
  }
}

/** Sincroniza una tabla de relación (pares) borrando e insertando lo necesario. */
async function sincronizarPares(c: PoolClient, tabla: string, colA: string, colB: string, antes: [string, string][], despues: [string, string][]) {
  const clave = (p: [string, string]) => p.join('\u0000')
  const a = new Set(antes.map(clave))
  const d = new Set(despues.map(clave))
  for (const p of antes) if (!d.has(clave(p))) await c.query(`DELETE FROM ${tabla} WHERE ${colA} = $1 AND ${colB} = $2`, p)
  for (const p of despues) if (!a.has(clave(p))) await c.query(`INSERT INTO ${tabla} (${colA}, ${colB}) VALUES ($1, $2)`, p)
}

export async function guardarCambios(c: PoolClient, antes: Db, despues: Db) {
  // Configuración
  const cfg = (d: Db) => ({ tope_diario: d.config.topeDiario, umbral_confianza: d.config.umbralConfianza, horas_vencimiento_canje: d.config.horasVencimientoCanje, dias_retencion_fotos: d.config.diasRetencionFotos, modelo_version: d.config.modeloVersion, factor_impacto_version: d.config.factorImpactoVersion })
  const cAntes = cfg(antes)
  const cDespues = cfg(despues)
  const cambios = (Object.keys(cDespues) as (keyof typeof cDespues)[]).filter((k) => cDespues[k] !== cAntes[k])
  if (cambios.length) {
    await c.query(`UPDATE configuracion SET ${cambios.map((k, i) => `${k} = $${i + 1}`).join(', ')}, actualizado_en = now() WHERE campus_id = 1`, cambios.map((k) => cDespues[k]))
  }

  // En orden, respetando las llaves foráneas
  await sincronizar(c, 'institucion', antes.instituciones, despues.instituciones, filaInstitucion)
  await sincronizarPares(c, 'institucion_dominio', 'dominio', 'institucion_id', antes.instituciones.flatMap((i) => i.dominios.map((d): [string, string] => [d, i.id])), despues.instituciones.flatMap((i) => i.dominios.map((d): [string, string] => [d, i.id])))
  await sincronizar(c, 'usuario', antes.usuarios, despues.usuarios, filaUsuario)
  // Una categoría con historial no se borra: se desactiva
  const borradas = antes.categorias.filter((x) => !despues.categorias.some((y) => y.id === x.id)).map((x) => ({ ...x, activa: false }))
  await sincronizar(c, 'categoria_residuo', antes.categorias, [...despues.categorias, ...borradas], filaCategoria, { excluir: ['version'] })
  await sincronizar(c, 'punto_reciclaje', antes.puntos, despues.puntos, filaPunto)
  await sincronizarPares(c, 'punto_categoria', 'punto_id', 'categoria_id', antes.puntos.flatMap((p) => p.categorias.map((x): [string, string] => [p.id, x])), despues.puntos.flatMap((p) => p.categorias.map((x): [string, string] => [p.id, x])))
  await sincronizar(c, 'asignacion_recolector', antes.asignaciones, despues.asignaciones, filaAsignacion)
  await sincronizar(c, 'lote_validacion', antes.lotes, despues.lotes, filaLote)
  await sincronizar(c, 'reciclaje', antes.reciclajes, despues.reciclajes, filaReciclaje)
  await sincronizar(c, 'movimiento_puntos', antes.movimientos, despues.movimientos, filaMovimiento, { soloInsertar: true })
  await sincronizar(c, 'recompensa', antes.recompensas, despues.recompensas, filaRecompensa)
  await sincronizar(c, 'canje', antes.canjes, despues.canjes, filaCanje)
  await sincronizar(c, 'notificacion', antes.notificaciones, despues.notificaciones, filaNotificacion)
  await sincronizar(c, 'alerta_fraude', antes.alertas, despues.alertas, filaAlerta)
  await sincronizar(c, 'correo_simulado', antes.correos, despues.correos, filaCorreo, { soloInsertar: true })
  // La auditoría solo crece; el id lo asigna PostgreSQL
  const previos = new Set(antes.auditoria.map((a) => a.id))
  for (const a of despues.auditoria) if (!previos.has(a.id)) await insertar(c, 'auditoria', filaAuditoria(a))
}
