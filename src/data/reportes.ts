// Definición de los 8 reportes administrativos. Cada reporte respeta los filtros de
// fecha, punto y categoría, y sus totales se calculan desde los registros de origen.
import type { Db } from './types'
import { rankingUsuarios } from './analitica'

export interface Filtros {
  desde: string // YYYY-MM-DD
  hasta: string // YYYY-MM-DD
  puntoId: string // 'todos' o id
  categoriaId: string // 'todas' o id
  institucionId: string // 'todas' o id
}

export interface Columna {
  clave: string
  titulo: string
  num?: boolean
}

export type Fila = Record<string, string | number>

export interface ResultadoReporte {
  columnas: Columna[]
  filas: Fila[]
  totales?: Fila
  resumen: { etiqueta: string; valor: string }[]
}

export interface DefReporte {
  id: string
  numero: number
  titulo: string
  descripcion: string
  usaPunto: boolean
  usaCategoria: boolean
  usaInstitucion: boolean
  generar: (db: Db, f: Filtros) => ResultadoReporte
}

const ZONA = 'America/Guayaquil'
const fechaHora = new Intl.DateTimeFormat('es-EC', { dateStyle: 'short', timeStyle: 'short', timeZone: ZONA })
const fh = (ts?: number) => (ts ? fechaHora.format(ts) : '')
const r1 = (n: number) => Math.round(n * 10) / 10
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : '—')

function rango(f: Filtros) {
  const ini = new Date(f.desde + 'T00:00:00').getTime()
  const fin = new Date(f.hasta + 'T23:59:59.999').getTime()
  return { ini, fin }
}

/** Usuarios de la universidad filtrada (o todos). */
function deInstitucion(db: Db, f: Filtros) {
  return (usuarioId: string) => f.institucionId === 'todas' || db.usuarios.find((u) => u.id === usuarioId)?.institucionId === f.institucionId
}

function reciclajesFiltrados(db: Db, f: Filtros) {
  const { ini, fin } = rango(f)
  const inst = deInstitucion(db, f)
  return db.reciclajes.filter(
    (r) =>
      inst(r.usuarioId) &&
      r.creadoEn >= ini &&
      r.creadoEn <= fin &&
      (f.puntoId === 'todos' || r.puntoId === f.puntoId) &&
      (f.categoriaId === 'todas' || r.categoriaId === f.categoriaId),
  )
}

const nombreCat = (db: Db, id: string) => db.categorias.find((c) => c.id === id)?.nombre ?? id
const nombrePunto = (db: Db, id: string) => db.puntos.find((p) => p.id === id)?.nombre ?? id
const nombreUsuario = (db: Db, id: string) => db.usuarios.find((u) => u.id === id)?.nombre ?? id
const ESTADO: Record<string, string> = { pendiente: 'Pendiente', en_revision: 'En revisión', validado: 'Validado', rechazado: 'Rechazado', entregado: 'Entregado', vencido: 'Vencido', cancelado: 'Cancelado' }

export const REPORTES: DefReporte[] = [
  {
    id: 'reciclajes',
    numero: 1,
    titulo: 'Reciclajes registrados',
    descripcion: 'Detalle de cada registro con usuario, punto, categoría, cantidad, estado y EcoPoints.',
    usaPunto: true,
    usaCategoria: true,
    usaInstitucion: true,
    generar(db, f) {
      const rs = reciclajesFiltrados(db, f).sort((a, b) => a.creadoEn - b.creadoEn)
      const filas = rs.map((r) => ({
        fecha: fh(r.creadoEn),
        usuario: nombreUsuario(db, r.usuarioId),
        punto: nombrePunto(db, r.puntoId),
        categoria: nombreCat(db, r.categoriaId),
        cantidad: r.cantidadFinal ?? r.cantidadReportada,
        unidad: r.unidad,
        estado: ESTADO[r.estado],
        puntos: r.estado === 'validado' ? r.puntosEstimados : 0,
      }))
      const val = rs.filter((r) => r.estado === 'validado')
      return {
        columnas: [
          { clave: 'fecha', titulo: 'Fecha' },
          { clave: 'usuario', titulo: 'Usuario' },
          { clave: 'punto', titulo: 'Punto' },
          { clave: 'categoria', titulo: 'Categoría' },
          { clave: 'cantidad', titulo: 'Cantidad', num: true },
          { clave: 'unidad', titulo: 'Unidad' },
          { clave: 'estado', titulo: 'Estado' },
          { clave: 'puntos', titulo: 'EcoPoints acreditados', num: true },
        ],
        filas,
        totales: { fecha: 'Total', puntos: val.reduce((t, r) => t + r.puntosEstimados, 0) },
        resumen: [
          { etiqueta: 'Registros', valor: String(rs.length) },
          { etiqueta: 'Validados', valor: String(val.length) },
          { etiqueta: 'Rechazados', valor: String(rs.filter((r) => r.estado === 'rechazado').length) },
          { etiqueta: 'Por validar', valor: String(rs.filter((r) => r.estado === 'pendiente' || r.estado === 'en_revision').length) },
        ],
      }
    },
  },
  {
    id: 'materiales',
    numero: 2,
    titulo: 'Material recuperado por categoría',
    descripcion: 'Cantidad validada de cada material y su participación sobre el total de registros.',
    usaPunto: true,
    usaCategoria: true,
    usaInstitucion: true,
    generar(db, f) {
      const rs = reciclajesFiltrados(db, f)
      const filas = db.categorias
        .map((c) => {
          const deCat = rs.filter((r) => r.categoriaId === c.id)
          const val = deCat.filter((r) => r.estado === 'validado')
          return {
            categoria: c.nombre,
            registros: deCat.length,
            validados: val.length,
            cantidad: r1(val.reduce((t, r) => t + (r.cantidadFinal ?? 0), 0)),
            unidad: c.unidad,
            puntos: val.reduce((t, r) => t + r.puntosEstimados, 0),
            participacion: pct(deCat.length, rs.length),
          }
        })
        .filter((x) => x.registros > 0)
        .sort((a, b) => b.registros - a.registros)
      const top = filas[0]
      return {
        columnas: [
          { clave: 'categoria', titulo: 'Categoría' },
          { clave: 'registros', titulo: 'Registros', num: true },
          { clave: 'validados', titulo: 'Validados', num: true },
          { clave: 'cantidad', titulo: 'Cantidad validada', num: true },
          { clave: 'unidad', titulo: 'Unidad' },
          { clave: 'puntos', titulo: 'EcoPoints', num: true },
          { clave: 'participacion', titulo: '% de registros', num: true },
        ],
        filas,
        totales: { categoria: 'Total', registros: rs.length, validados: filas.reduce((t, x) => t + x.validados, 0), puntos: filas.reduce((t, x) => t + x.puntos, 0) },
        resumen: [
          { etiqueta: 'Material más recuperado', valor: top ? top.categoria : '—' },
          { etiqueta: 'Categorías con registros', valor: String(filas.length) },
        ],
      }
    },
  },
  {
    id: 'puntos',
    numero: 3,
    titulo: 'Actividad por punto de reciclaje',
    descripcion: 'Registros, validaciones, rechazos y pendientes de cada punto del campus.',
    usaPunto: true,
    usaCategoria: true,
    usaInstitucion: true,
    generar(db, f) {
      const rs = reciclajesFiltrados(db, f)
      const filas = db.puntos
        .filter((p) => f.puntoId === 'todos' || p.id === f.puntoId)
        .map((p) => {
          const dp = rs.filter((r) => r.puntoId === p.id)
          const val = dp.filter((r) => r.estado === 'validado').length
          const rec = dp.filter((r) => r.estado === 'rechazado').length
          return {
            punto: p.nombre,
            codigo: p.codigoQr,
            estado: p.estado === 'activo' ? 'Activo' : p.estado === 'mantenimiento' ? 'Mantenimiento' : 'Inactivo',
            registros: dp.length,
            validados: val,
            rechazados: rec,
            pendientes: dp.filter((r) => r.estado === 'pendiente' || r.estado === 'en_revision').length,
            rechazo: pct(rec, val + rec),
          }
        })
        .sort((a, b) => b.registros - a.registros)
      return {
        columnas: [
          { clave: 'punto', titulo: 'Punto' },
          { clave: 'codigo', titulo: 'Código QR' },
          { clave: 'estado', titulo: 'Estado' },
          { clave: 'registros', titulo: 'Registros', num: true },
          { clave: 'validados', titulo: 'Validados', num: true },
          { clave: 'rechazados', titulo: 'Rechazados', num: true },
          { clave: 'pendientes', titulo: 'Pendientes', num: true },
          { clave: 'rechazo', titulo: 'Tasa de rechazo', num: true },
        ],
        filas,
        totales: { punto: 'Total', registros: rs.length, validados: filas.reduce((t, x) => t + x.validados, 0), rechazados: filas.reduce((t, x) => t + x.rechazados, 0), pendientes: filas.reduce((t, x) => t + x.pendientes, 0) },
        resumen: [
          { etiqueta: 'Punto con más actividad', valor: filas[0]?.registros ? filas[0].punto : '—' },
          { etiqueta: 'Puntos activos', valor: String(db.puntos.filter((p) => p.estado === 'activo').length) },
        ],
      }
    },
  },
  {
    id: 'usuarios',
    numero: 4,
    titulo: 'Usuarios participantes (EcoRanking)',
    descripcion: 'Usuarios que reciclaron en el periodo, ordenados por EcoPoints ganados por reciclaje.',
    usaPunto: true,
    usaCategoria: true,
    usaInstitucion: true,
    generar(db, f) {
      const rs = reciclajesFiltrados(db, f)
      const ids = [...new Set(rs.map((r) => r.usuarioId))]
      const filas = ids
        .map((id) => {
          const u = db.usuarios.find((x) => x.id === id)!
          const propios = rs.filter((r) => r.usuarioId === id)
          const val = propios.filter((r) => r.estado === 'validado')
          return {
            usuario: u.nombre,
            correo: u.correo,
            universidad: db.instituciones.find((i) => i.id === u.institucionId)?.siglas ?? '—',
            facultad: u.facultad,
            registros: propios.length,
            validados: val.length,
            puntos: val.reduce((t, r) => t + r.puntosEstimados, 0),
          }
        })
        .sort((a, b) => b.puntos - a.puntos || b.validados - a.validados)
        .map((x, i) => ({ puesto: i + 1, ...x }))
      const historico = rankingUsuarios(db, 'siempre')
      return {
        columnas: [
          { clave: 'puesto', titulo: 'Puesto', num: true },
          { clave: 'usuario', titulo: 'Usuario' },
          { clave: 'correo', titulo: 'Correo' },
          { clave: 'universidad', titulo: 'Universidad' },
          { clave: 'facultad', titulo: 'Facultad' },
          { clave: 'registros', titulo: 'Registros', num: true },
          { clave: 'validados', titulo: 'Validados', num: true },
          { clave: 'puntos', titulo: 'EcoPoints ganados', num: true },
        ],
        filas,
        resumen: [
          { etiqueta: 'Usuarios activos', valor: String(filas.length) },
          { etiqueta: 'Usuarios registrados', valor: String(db.usuarios.filter((u) => u.rol === 'usuario' && deInstitucion(db, f)(u.id)).length) },
          { etiqueta: 'Líder histórico', valor: historico[0] ? historico[0].nombrePublico : '—' },
        ],
      }
    },
  },
  {
    id: 'ecopoints',
    numero: 5,
    titulo: 'Movimientos de EcoPoints',
    descripcion: 'Libro de movimientos: puntos otorgados, canjeados, devueltos y ajustes.',
    usaPunto: false,
    usaCategoria: false,
    usaInstitucion: true,
    generar(db, f) {
      const { ini, fin } = rango(f)
      const inst = deInstitucion(db, f)
      const movs = db.movimientos.filter((m) => inst(m.usuarioId) && m.creadoEn >= ini && m.creadoEn <= fin).sort((a, b) => a.creadoEn - b.creadoEn)
      const suma = (tipo: string) => movs.filter((m) => m.tipo === tipo).reduce((t, m) => t + m.puntos, 0)
      const TIPO: Record<string, string> = { reciclaje: 'Reciclaje', canje: 'Canje', devolucion: 'Devolución', ajuste: 'Ajuste' }
      const enCirculacion = db.movimientos.filter((m) => inst(m.usuarioId)).reduce((t, m) => t + m.puntos, 0)
      return {
        columnas: [
          { clave: 'fecha', titulo: 'Fecha' },
          { clave: 'usuario', titulo: 'Usuario' },
          { clave: 'tipo', titulo: 'Tipo' },
          { clave: 'descripcion', titulo: 'Descripción' },
          { clave: 'puntos', titulo: 'Puntos', num: true },
        ],
        filas: movs.map((m) => ({ fecha: fh(m.creadoEn), usuario: nombreUsuario(db, m.usuarioId), tipo: TIPO[m.tipo], descripcion: m.descripcion, puntos: m.puntos })),
        totales: { fecha: 'Neto del periodo', puntos: movs.reduce((t, m) => t + m.puntos, 0) },
        resumen: [
          { etiqueta: 'Otorgados', valor: `+${suma('reciclaje')}` },
          { etiqueta: 'Canjeados', valor: String(suma('canje')) },
          { etiqueta: 'Devoluciones', valor: `+${suma('devolucion')}` },
          { etiqueta: 'Ajustes', valor: String(suma('ajuste')) },
          { etiqueta: 'En circulación (hoy)', valor: String(enCirculacion) },
        ],
      }
    },
  },
  {
    id: 'canjes',
    numero: 6,
    titulo: 'Canjes y recompensas',
    descripcion: 'Por recompensa: canjes creados, entregados, pendientes, vencidos o cancelados y stock restante.',
    usaPunto: false,
    usaCategoria: false,
    usaInstitucion: true,
    generar(db, f) {
      const { ini, fin } = rango(f)
      const inst = deInstitucion(db, f)
      const cs = db.canjes.filter((c) => inst(c.usuarioId) && c.creadoEn >= ini && c.creadoEn <= fin)
      const filas = db.recompensas
        .map((rw) => {
          const dr = cs.filter((c) => c.recompensaId === rw.id)
          const por = (e: string) => dr.filter((c) => c.estado === e).length
          return {
            recompensa: rw.nombre,
            procedencia: rw.procedencia,
            costo: rw.costo,
            canjes: dr.length,
            entregados: por('entregado'),
            pendientes: por('pendiente'),
            anulados: por('vencido') + por('cancelado'),
            puntos: dr.filter((c) => !c.devuelto).reduce((t, c) => t + c.costo, 0),
            stock: rw.stock,
          }
        })
        .sort((a, b) => b.canjes - a.canjes)
      return {
        columnas: [
          { clave: 'recompensa', titulo: 'Recompensa' },
          { clave: 'procedencia', titulo: 'Procedencia' },
          { clave: 'costo', titulo: 'Costo', num: true },
          { clave: 'canjes', titulo: 'Canjes', num: true },
          { clave: 'entregados', titulo: 'Entregados', num: true },
          { clave: 'pendientes', titulo: 'Pendientes', num: true },
          { clave: 'anulados', titulo: 'Vencidos/cancelados', num: true },
          { clave: 'puntos', titulo: 'Puntos canjeados', num: true },
          { clave: 'stock', titulo: 'Stock actual', num: true },
        ],
        filas,
        totales: { recompensa: 'Total', canjes: cs.length, entregados: filas.reduce((t, x) => t + x.entregados, 0), pendientes: filas.reduce((t, x) => t + x.pendientes, 0), anulados: filas.reduce((t, x) => t + x.anulados, 0), puntos: filas.reduce((t, x) => t + x.puntos, 0) },
        resumen: [
          { etiqueta: 'Canjes en el periodo', valor: String(cs.length) },
          { etiqueta: 'Más canjeada', valor: filas[0]?.canjes ? filas[0].recompensa : '—' },
          { etiqueta: 'Agotadas', valor: String(db.recompensas.filter((r) => r.activa && r.stock === 0).length) },
        ],
      }
    },
  },
  {
    id: 'recolectores',
    numero: 7,
    titulo: 'Desempeño de recolectores',
    descripcion: 'Lotes cerrados, registros validados y rechazados, cantidades corregidas y tiempo promedio de validación.',
    usaPunto: true,
    usaCategoria: false,
    usaInstitucion: false,
    generar(db, f) {
      const { ini, fin } = rango(f)
      const filas = db.usuarios
        .filter((u) => u.rol === 'recolector')
        .map((u) => {
          const procesados = db.reciclajes.filter(
            (r) => r.validadoPor === u.id && (r.validadoEn ?? 0) >= ini && (r.validadoEn ?? 0) <= fin && (f.puntoId === 'todos' || r.puntoId === f.puntoId),
          )
          const lotes = new Set(procesados.map((r) => r.loteId)).size
          const horas = procesados.length ? procesados.reduce((t, r) => t + ((r.validadoEn ?? 0) - r.creadoEn), 0) / procesados.length / 3_600_000 : 0
          const puntosAsig = db.asignaciones.filter((a) => a.recolectorId === u.id && a.activa).length
          return {
            recolector: u.nombre,
            puntos: puntosAsig,
            lotes,
            validados: procesados.filter((r) => r.estado === 'validado').length,
            rechazados: procesados.filter((r) => r.estado === 'rechazado').length,
            corregidos: procesados.filter((r) => r.motivoCantidad).length,
            horas: procesados.length ? r1(horas) : '—',
          }
        })
      return {
        columnas: [
          { clave: 'recolector', titulo: 'Recolector' },
          { clave: 'puntos', titulo: 'Puntos asignados', num: true },
          { clave: 'lotes', titulo: 'Lotes', num: true },
          { clave: 'validados', titulo: 'Validados', num: true },
          { clave: 'rechazados', titulo: 'Rechazados', num: true },
          { clave: 'corregidos', titulo: 'Cantidad corregida', num: true },
          { clave: 'horas', titulo: 'Horas prom. hasta validar', num: true },
        ],
        filas,
        resumen: [
          { etiqueta: 'Recolectores', valor: String(filas.length) },
          { etiqueta: 'Registros procesados', valor: String(filas.reduce((t, x) => t + x.validados + x.rechazados, 0)) },
        ],
      }
    },
  },
  {
    id: 'ia',
    numero: 8,
    titulo: 'Precisión de la IA',
    descripcion: 'Por categoría: coincidencia entre la propuesta de la IA y lo validado, correcciones y confianza promedio.',
    usaPunto: true,
    usaCategoria: true,
    usaInstitucion: true,
    generar(db, f) {
      const rs = reciclajesFiltrados(db, f)
      const filas = db.categorias
        .map((c) => {
          const propuestos = rs.filter((r) => r.categoriaIa === c.id)
          const decididos = propuestos.filter((r) => r.estado === 'validado' || r.estado === 'rechazado')
          const aciertos = decididos.filter((r) => r.estado === 'validado' && r.categoriaId === c.id).length
          const conf = propuestos.length ? propuestos.reduce((t, r) => t + r.confianzaIa, 0) / propuestos.length : 0
          return {
            categoria: c.nombre,
            propuestas: propuestos.length,
            corregidas: propuestos.filter((r) => r.corregidoPorUsuario).length,
            revision: propuestos.filter((r) => r.motivoRevision).length,
            aciertos,
            decididos: decididos.length,
            precision: pct(aciertos, decididos.length),
            confianza: propuestos.length ? `${Math.round(conf * 100)} %` : '—',
          }
        })
        .filter((x) => x.propuestas > 0)
      const dec = filas.reduce((t, x) => t + x.decididos, 0)
      const ac = filas.reduce((t, x) => t + x.aciertos, 0)
      return {
        columnas: [
          { clave: 'categoria', titulo: 'Categoría propuesta' },
          { clave: 'propuestas', titulo: 'Propuestas', num: true },
          { clave: 'corregidas', titulo: 'Corregidas por usuario', num: true },
          { clave: 'revision', titulo: 'Enviadas a revisión', num: true },
          { clave: 'aciertos', titulo: 'Confirmadas', num: true },
          { clave: 'precision', titulo: 'Precisión', num: true },
          { clave: 'confianza', titulo: 'Confianza prom.', num: true },
        ],
        filas,
        resumen: [
          { etiqueta: 'Precisión global', valor: pct(ac, dec) },
          { etiqueta: 'Modelo', valor: db.config.modeloVersion },
          { etiqueta: 'Meta (RNF11)', valor: 'F1 ≥ 85 %' },
        ],
      }
    },
  },
]

// ---------------------------------------------------------------------------
// Exportación
// ---------------------------------------------------------------------------

function celdaCsv(v: string | number | undefined) {
  const t = v === undefined ? '' : String(v)
  return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

/** CSV separado por punto y coma (Excel en español) con BOM para respetar tildes. */
export function aCsv(def: DefReporte, res: ResultadoReporte, filtros: Filtros, descripcionFiltros: string) {
  const lineas = [
    `EcoSmart AI - Reporte ${def.numero}: ${def.titulo}`,
    `Filtros: ${descripcionFiltros}`,
    `Generado: ${fh(Date.now())} (zona horaria ${ZONA})`,
    '',
    res.columnas.map((c) => celdaCsv(c.titulo)).join(';'),
    ...res.filas.map((f) => res.columnas.map((c) => celdaCsv(f[c.clave])).join(';')),
  ]
  if (res.totales) lineas.push(res.columnas.map((c) => celdaCsv(res.totales![c.clave])).join(';'))
  const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ecosmart-reporte-${def.numero}-${def.id}-${filtros.desde}_a_${filtros.hasta}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const ZONA_HORARIA = ZONA
