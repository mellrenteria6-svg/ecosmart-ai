// D01–D06 y entrega de canjes (Fase 1: el administrador entrega los premios).
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  actualizarCategoria,
  actualizarConfig,
  buscarCanje,
  cambiarBloqueo,
  cambiarRol,
  crearAjuste,
  crearAsignacion,
  desactivarAsignacion,
  entregarCanje,
  guardarPunto,
  guardarRecompensa,
  hoyIso,
  realizarSorteo,
  saldoConfirmado,
  useStore,
} from '../data/store'
import type { Canje, CategoriaResiduo, EstadoPunto, PuntoReciclaje, Recompensa, Rol, Usuario } from '../data/types'
import { Alerta, Badge, Campo, Encabezado, EstadoBadge, Modal, Stat, Vacio, useAccion } from '../components/ui'
import { ChipCategoria, MapaCampus, Qr, enlaceQr } from '../components/Visual'
import { ETIQUETA_CANJE, ETIQUETA_PUNTO, ETIQUETA_RECICLAJE, ETIQUETA_ROL, fmtFecha, fmtFechaHora, fmtNumero, fmtPct, hace } from '../lib/formato'

const DIA = 86_400_000

// D01 – Dashboard
export function Dashboard() {
  const { db } = useStore()
  const [dias, setDias] = useState(30)
  const [punto, setPunto] = useState('todos')
  const [categoria, setCategoria] = useState('todas')

  const datos = useMemo(() => {
    const desde = Date.now() - dias * DIA
    const rs = db.reciclajes.filter((r) => r.creadoEn >= desde && (punto === 'todos' || r.puntoId === punto) && (categoria === 'todas' || r.categoriaId === categoria))
    const por = (e: string) => rs.filter((r) => r.estado === e).length
    const validados = rs.filter((r) => r.estado === 'validado')
    const puntos = validados.reduce((t, r) => t + r.puntosEstimados, 0)
    const decididos = rs.filter((r) => r.estado === 'validado' || r.estado === 'rechazado')
    const aciertos = decididos.filter((r) => r.categoriaIa === r.categoriaId && r.estado === 'validado').length
    const porCat = db.categorias.map((c) => ({ c, n: rs.filter((r) => r.categoriaId === c.id).length, cant: validados.filter((r) => r.categoriaId === c.id).reduce((t, r) => t + (r.cantidadFinal ?? 0), 0) }))
    const canjes = db.canjes.filter((c) => c.creadoEn >= desde)
    // serie diaria de los últimos 14 días
    const serie = Array.from({ length: 14 }, (_, i) => {
      const inicio = new Date(Date.now() - (13 - i) * DIA).setHours(0, 0, 0, 0)
      return { dia: inicio, n: rs.filter((r) => r.creadoEn >= inicio && r.creadoEn < inicio + DIA).length }
    })
    return { rs, por, puntos, decididos, aciertos, porCat, canjes, serie, validados }
  }, [db, dias, punto, categoria])

  const max = Math.max(1, ...datos.porCat.map((x) => x.n))
  const maxSerie = Math.max(1, ...datos.serie.map((x) => x.n))
  const usuariosActivos = new Set(datos.rs.map((r) => r.usuarioId)).size

  return (
    <div className="pagina">
      <Encabezado titulo="Dashboard" descripcion="Indicadores conciliables con los registros de origen." />
      <div className="filtros-panel">
        <Campo etiqueta="Periodo">
          {(id) => (
            <select id={id} className="input" value={dias} onChange={(e) => setDias(Number(e.target.value))}>
              <option value={1}>Hoy</option>
              <option value={7}>Últimos 7 días</option>
              <option value={30}>Últimos 30 días</option>
              <option value={365}>Último año</option>
            </select>
          )}
        </Campo>
        <Campo etiqueta="Punto">
          {(id) => (
            <select id={id} className="input" value={punto} onChange={(e) => setPunto(e.target.value)}>
              <option value="todos">Todos</option>
              {db.puntos.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          )}
        </Campo>
        <Campo etiqueta="Categoría">
          {(id) => (
            <select id={id} className="input" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              <option value="todas">Todas</option>
              {db.categorias.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          )}
        </Campo>
      </div>

      <div className="stats stats-4">
        <Stat etiqueta="Reciclajes registrados" valor={datos.rs.length} nota={`${usuariosActivos} usuarios activos`} tono="acento" />
        <Stat etiqueta="Validados" valor={datos.por('validado')} nota={`${datos.por('rechazado')} rechazados`} />
        <Stat etiqueta="Por validar" valor={datos.por('pendiente') + datos.por('en_revision')} nota={`${datos.por('en_revision')} en revisión`} />
        <Stat etiqueta="EcoPoints otorgados" valor={fmtNumero(datos.puntos)} nota={`${datos.canjes.length} canjes en el periodo`} />
      </div>

      <div className="dash-grid">
        <section className="bloque">
          <div className="bloque-cab">
            <h2>Registros por día</h2>
            <small>Últimos 14 días</small>
          </div>
          <div className="serie" role="img" aria-label="Gráfico de registros por día">
            {datos.serie.map((d) => (
              <div key={d.dia} className="serie-col" title={`${fmtFecha(d.dia)}: ${d.n}`}>
                <span style={{ height: `${(d.n / maxSerie) * 100}%` }}>{d.n > 0 && <i>{d.n}</i>}</span>
                <small>{new Date(d.dia).getDate()}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="bloque">
          <div className="bloque-cab">
            <h2>Precisión de la IA</h2>
            <small className="mono">{db.config.modeloVersion}</small>
          </div>
          <div className="ia-dash">
            <div className="medidor medidor-lg" style={{ ['--v' as string]: datos.decididos.length ? datos.aciertos / datos.decididos.length : 0 }}>
              <span>{datos.decididos.length ? fmtPct(datos.aciertos / datos.decididos.length) : '—'}</span>
            </div>
            <p className="nota">
              Coincidencia entre la categoría propuesta por la IA y la validada por el recolector en {datos.decididos.length} registros decididos. Meta de calidad: F1 macro ≥ 85 % (RNF11).
            </p>
          </div>
        </section>

        <section className="bloque dash-ancho">
          <div className="bloque-cab">
            <h2>Por categoría</h2>
          </div>
          <ul className="barras">
            {datos.porCat.map(({ c, n, cant }) => (
              <li key={c.id}>
                <span className="barras-et">{c.nombre}</span>
                <span className="barras-pista">
                  <span style={{ width: `${(n / max) * 100}%`, background: c.color }} />
                </span>
                <span className="barras-val">
                  {n} <small>· {fmtNumero(cant)} {c.unidad} validados</small>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="bloque dash-ancho">
          <div className="bloque-cab">
            <h2>Pendientes por punto</h2>
          </div>
          <div className="tabla-envoltura">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Punto</th>
                  <th>Estado</th>
                  <th className="num">Pendientes</th>
                  <th className="num">En revisión</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {db.puntos.map((p) => (
                  <tr key={p.id}>
                    <td>{p.nombre}</td>
                    <td>
                      <EstadoBadge estado={p.estado} etiqueta={ETIQUETA_PUNTO[p.estado]} />
                    </td>
                    <td className="num">{db.reciclajes.filter((r) => r.puntoId === p.id && r.estado === 'pendiente').length}</td>
                    <td className="num">{db.reciclajes.filter((r) => r.puntoId === p.id && r.estado === 'en_revision').length}</td>
                    <td className="num">
                      <a href={`#/rec/punto/${p.id}`}>Validar (excepción)</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}

// D02 – Puntos, QR y asignaciones
const PUNTO_VACIO: Omit<PuntoReciclaje, 'id' | 'codigoQr'> = { nombre: '', ubicacion: '', categorias: [], estado: 'activo', visible: true, mapa: { x: 50, y: 50 } }

export function AdminPuntos({ usuario }: { usuario: Usuario }) {
  const { db } = useStore()
  const [editando, setEditando] = useState<(Omit<PuntoReciclaje, 'id' | 'codigoQr'> & { id?: string }) | null>(null)
  const [qr, setQr] = useState<PuntoReciclaje | null>(null)
  const [asignar, setAsignar] = useState<string | null>(null)
  const { error, setError, ejecutar } = useAccion()
  const recolectores = db.usuarios.filter((u) => u.rol === 'recolector' && !u.bloqueado)
  const [nuevaAsig, setNuevaAsig] = useState({ recolectorId: '', desde: hoyIso(), hasta: hoyIso(), horario: 'Lun a Vie, 08:00 a 16:00' })

  async function guardar(e: FormEvent) {
    e.preventDefault()
    const ok = await ejecutar(() => guardarPunto(usuario.id, editando!))
    if (ok) setEditando(null)
  }

  return (
    <div className="pagina">
      <Encabezado
        titulo="Puntos de reciclaje"
        descripcion="Cada punto tiene un QR único que no contiene datos personales."
        acciones={
          <button type="button" className="btn btn-tinta" onClick={() => { setError(null); setEditando({ ...PUNTO_VACIO }) }}>
            + Nuevo punto
          </button>
        }
      />
      <div className="admin-puntos">
        <MapaCampus puntos={db.puntos} />
        <div className="lista-admin">
          {db.puntos.map((p) => {
            const asigs = db.asignaciones.filter((a) => a.puntoId === p.id && a.activa)
            return (
              <article key={p.id} className="admin-punto">
                <div className="ap-cab">
                  <div>
                    <h3>{p.nombre}</h3>
                    <small>{p.ubicacion}</small>
                  </div>
                  <EstadoBadge estado={p.estado} etiqueta={ETIQUETA_PUNTO[p.estado]} />
                </div>
                <div className="chips">
                  {p.categorias.map((id) => {
                    const c = db.categorias.find((x) => x.id === id)!
                    return <ChipCategoria key={id} nombre={c.nombre} color={c.color} />
                  })}
                </div>
                <div className="ap-asig">
                  <small>Recolectores asignados</small>
                  {asigs.length === 0 ? (
                    <span className="txt-warn">Sin recolector: nadie puede validar aquí</span>
                  ) : (
                    asigs.map((a) => (
                      <span key={a.id} className="asig">
                        {db.usuarios.find((u) => u.id === a.recolectorId)?.nombre} · {a.horario} · hasta {fmtFecha(a.hasta)}
                        <button type="button" className="enlace-boton" onClick={() => void ejecutar(() => desactivarAsignacion(usuario.id, a.id))}>Finalizar</button>
                      </span>
                    ))
                  )}
                </div>
                <div className="ap-acciones">
                  <span className="codigo-mono">{p.codigoQr}</span>
                  <button type="button" className="btn btn-linea btn-sm" onClick={() => setQr(p)}>Ver QR</button>
                  <button type="button" className="btn btn-linea btn-sm" onClick={() => { setError(null); setAsignar(p.id); setNuevaAsig((n) => ({ ...n, recolectorId: recolectores[0]?.id ?? '' })) }}>Asignar</button>
                  <button type="button" className="btn btn-fantasma btn-sm" onClick={() => { setError(null); setEditando({ ...p }) }}>Editar</button>
                </div>
              </article>
            )
          })}
        </div>
      </div>
      {error && !editando && !asignar && <Alerta tono="error">{error}</Alerta>}

      <Modal abierto={!!editando} titulo={editando?.id ? 'Editar punto' : 'Nuevo punto'} onCerrar={() => setEditando(null)}>
        {editando && (
          <form className="form" onSubmit={guardar}>
            <Campo etiqueta="Nombre">{(id) => <input id={id} className="input" value={editando.nombre} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} required />}</Campo>
            <Campo etiqueta="Ubicación">{(id) => <input id={id} className="input" value={editando.ubicacion} onChange={(e) => setEditando({ ...editando, ubicacion: e.target.value })} />}</Campo>
            <Campo etiqueta="Estado">
              {(id) => (
                <select id={id} className="input" value={editando.estado} onChange={(e) => setEditando({ ...editando, estado: e.target.value as EstadoPunto })}>
                  <option value="activo">Activo</option>
                  <option value="mantenimiento">En mantenimiento</option>
                  <option value="inactivo">Inactivo</option>
                </select>
              )}
            </Campo>
            <fieldset className="fieldset">
              <legend>Categorías aceptadas</legend>
              <div className="opciones-cat">
                {db.categorias.map((c) => (
                  <label key={c.id} className={`opcion-cat ${editando.categorias.includes(c.id) ? 'sel' : ''}`}>
                    <input
                      type="checkbox"
                      checked={editando.categorias.includes(c.id)}
                      onChange={(e) => setEditando({ ...editando, categorias: e.target.checked ? [...editando.categorias, c.id] : editando.categorias.filter((x) => x !== c.id) })}
                    />
                    <i style={{ background: c.color }} />
                    {c.nombre}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="form-2">
              <Campo etiqueta="Posición en mapa X (0-100)">{(id) => <input id={id} className="input" type="number" min={0} max={100} value={editando.mapa.x} onChange={(e) => setEditando({ ...editando, mapa: { ...editando.mapa, x: Number(e.target.value) } })} />}</Campo>
              <Campo etiqueta="Posición en mapa Y (0-100)">{(id) => <input id={id} className="input" type="number" min={0} max={100} value={editando.mapa.y} onChange={(e) => setEditando({ ...editando, mapa: { ...editando.mapa, y: Number(e.target.value) } })} />}</Campo>
            </div>
            <label className="check">
              <input type="checkbox" checked={editando.visible} onChange={(e) => setEditando({ ...editando, visible: e.target.checked })} />
              <span>Visible para los usuarios</span>
            </label>
            {error && <Alerta tono="error">{error}</Alerta>}
            <button className="btn btn-tinta btn-bloque">Guardar</button>
          </form>
        )}
      </Modal>

      <Modal abierto={!!qr} titulo="QR del punto" onCerrar={() => setQr(null)}>
        {qr && (
          <div className="cartel-qr" id="cartel-imprimible">
            <p className="kicker">EcoSmart AI · Punto de reciclaje</p>
            <h3>{qr.nombre}</h3>
            <Qr valor={enlaceQr(qr.codigoQr)} tamano={220} etiqueta={`Código QR del punto ${qr.nombre}`} />
            <span className="codigo-mono codigo-grande">{qr.codigoQr}</span>
            <p className="nota nota-centro">Escanea con la app o ingresa el código manualmente.</p>
            <button type="button" className="btn btn-tinta no-imprimir" onClick={() => window.print()}>Imprimir cartel</button>
          </div>
        )}
      </Modal>

      <Modal abierto={!!asignar} titulo="Asignar recolector" onCerrar={() => setAsignar(null)}>
        {asignar && (
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault()
              const ok = await ejecutar(() => {
                crearAsignacion(usuario.id, { ...nuevaAsig, puntoId: asignar })
                return true
              })
              if (ok) setAsignar(null)
            }}
          >
            <p className="nota">Punto: <b>{db.puntos.find((p) => p.id === asignar)?.nombre}</b>. Solo una asignación vigente habilita la validación.</p>
            <Campo etiqueta="Recolector">
              {(id) => (
                <select id={id} className="input" value={nuevaAsig.recolectorId} onChange={(e) => setNuevaAsig({ ...nuevaAsig, recolectorId: e.target.value })}>
                  {recolectores.map((r) => (
                    <option key={r.id} value={r.id}>{r.nombre}</option>
                  ))}
                </select>
              )}
            </Campo>
            <div className="form-2">
              <Campo etiqueta="Desde">{(id) => <input id={id} className="input" type="date" value={nuevaAsig.desde} onChange={(e) => setNuevaAsig({ ...nuevaAsig, desde: e.target.value })} />}</Campo>
              <Campo etiqueta="Hasta">{(id) => <input id={id} className="input" type="date" value={nuevaAsig.hasta} onChange={(e) => setNuevaAsig({ ...nuevaAsig, hasta: e.target.value })} />}</Campo>
            </div>
            <Campo etiqueta="Horario">{(id) => <input id={id} className="input" value={nuevaAsig.horario} onChange={(e) => setNuevaAsig({ ...nuevaAsig, horario: e.target.value })} />}</Campo>
            {error && <Alerta tono="error">{error}</Alerta>}
            <button className="btn btn-tinta btn-bloque">Guardar asignación</button>
          </form>
        )}
      </Modal>
    </div>
  )
}

// D03 – Categorías y configuración
export function AdminCategorias({ usuario }: { usuario: Usuario }) {
  const { db } = useStore()
  const [sel, setSel] = useState<CategoriaResiduo | null>(null)
  const [cfg, setCfg] = useState(db.config)
  const [okCfg, setOkCfg] = useState(false)
  const { error, setError, ejecutar } = useAccion()
  const accCfg = useAccion()

  return (
    <div className="pagina">
      <Encabezado titulo="Categorías y reglas" descripcion="Los cambios aplican solo a registros nuevos; cada versión queda auditada." />
      <div className="tabla-envoltura">
        <table className="tabla">
          <thead>
            <tr>
              <th>Categoría</th>
              <th>Unidad</th>
              <th className="num">Pts / unidad</th>
              <th className="num">Límites</th>
              <th className="num">Versión</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {db.categorias.map((c) => (
              <tr key={c.id}>
                <td><ChipCategoria nombre={c.nombre} color={c.color} /></td>
                <td>{c.unidad}</td>
                <td className="num">{c.puntosPorUnidad}</td>
                <td className="num">{c.minimo} – {c.maximo}</td>
                <td className="num">v{c.version}</td>
                <td className="num">
                  <button type="button" className="btn btn-fantasma btn-sm" onClick={() => { setError(null); setSel({ ...c }) }}>Editar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="bloque">
        <h2 className="h-bloque">Parámetros de la línea base</h2>
        <form
          className="form form-grid"
          onSubmit={async (e) => {
            e.preventDefault()
            setOkCfg(false)
            const ok = await accCfg.ejecutar(() => {
              actualizarConfig(usuario.id, { topeDiario: cfg.topeDiario, umbralConfianza: cfg.umbralConfianza, horasVencimientoCanje: cfg.horasVencimientoCanje })
              return true
            })
            if (ok) setOkCfg(true)
          }}
        >
          <Campo etiqueta="Tope diario por usuario">{(id) => <input id={id} className="input" type="number" min={1} value={cfg.topeDiario} onChange={(e) => setCfg({ ...cfg, topeDiario: Number(e.target.value) })} />}</Campo>
          <Campo etiqueta="Umbral de confianza IA (%)">{(id) => <input id={id} className="input" type="number" min={1} max={99} value={Math.round(cfg.umbralConfianza * 100)} onChange={(e) => setCfg({ ...cfg, umbralConfianza: Number(e.target.value) / 100 })} />}</Campo>
          <Campo etiqueta="Vencimiento de canje (horas)">{(id) => <input id={id} className="input" type="number" min={1} value={cfg.horasVencimientoCanje} onChange={(e) => setCfg({ ...cfg, horasVencimientoCanje: Number(e.target.value) })} />}</Campo>
          <div className="form-grid-fin">
            <button className="btn btn-tinta">Guardar parámetros</button>
            {okCfg && <span className="txt-ok">Guardado y auditado</span>}
          </div>
          {accCfg.error && <Alerta tono="error">{accCfg.error}</Alerta>}
        </form>
        <p className="nota">Retención de fotos: {db.config.diasRetencionFotos} días · Dominio institucional: @{db.config.dominioInstitucional}</p>
      </section>

      <Modal abierto={!!sel} titulo={`Editar ${sel?.nombre ?? ''}`} onCerrar={() => setSel(null)}>
        {sel && (
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault()
              const ok = await ejecutar(() => actualizarCategoria(usuario.id, sel.id, sel))
              if (ok) setSel(null)
            }}
          >
            <Campo etiqueta="Unidad de medida">{(id) => <input id={id} className="input" value={sel.unidad} onChange={(e) => setSel({ ...sel, unidad: e.target.value })} />}</Campo>
            <Campo etiqueta="Puntos por unidad">{(id) => <input id={id} className="input" type="number" step="0.5" value={sel.puntosPorUnidad} onChange={(e) => setSel({ ...sel, puntosPorUnidad: Number(e.target.value) })} />}</Campo>
            <div className="form-2">
              <Campo etiqueta="Mínimo">{(id) => <input id={id} className="input" type="number" step="0.5" value={sel.minimo} onChange={(e) => setSel({ ...sel, minimo: Number(e.target.value) })} />}</Campo>
              <Campo etiqueta="Máximo">{(id) => <input id={id} className="input" type="number" step="0.5" value={sel.maximo} onChange={(e) => setSel({ ...sel, maximo: Number(e.target.value) })} />}</Campo>
            </div>
            <Alerta tono="info">Se creará la versión v{sel.version + 1}. Los registros existentes conservan la tarifa con la que se crearon.</Alerta>
            {error && <Alerta tono="error">{error}</Alerta>}
            <button className="btn btn-tinta btn-bloque">Guardar nueva versión</button>
          </form>
        )}
      </Modal>
    </div>
  )
}

// D04 / D05 – Recompensas
export function AdminRecompensas({ usuario }: { usuario: Usuario }) {
  const { db } = useStore()
  const [ed, setEd] = useState<(Omit<Recompensa, 'id'> & { id?: string }) | null>(null)
  const { error, setError, ejecutar } = useAccion()
  const vacia: Omit<Recompensa, 'id'> = { nombre: '', descripcion: '', costo: 100, stock: 10, vigenciaDesde: hoyIso(), vigenciaHasta: hoyIso(), responsable: 'Administración', activa: true, emoji: '🎁', procedencia: 'Gestión Ambiental del campus', tipo: 'beneficio' }

  return (
    <div className="pagina">
      <Encabezado titulo="Recompensas" descripcion="Una recompensa solo se activa con costo positivo, stock válido y vigencia coherente." acciones={<button type="button" className="btn btn-tinta" onClick={() => { setError(null); setEd(vacia) }}>+ Nueva recompensa</button>} />
      <div className="tabla-envoltura">
        <table className="tabla">
          <thead>
            <tr>
              <th>Recompensa</th>
              <th className="num">Costo</th>
              <th className="num">Stock</th>
              <th>Vigencia</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {db.recompensas.map((r) => (
              <tr key={r.id}>
                <td>
                  <span aria-hidden="true">{r.emoji}</span> {r.nombre}
                  <br />
                  <small className="txt-muted">{r.procedencia}{r.tipo !== 'beneficio' ? ` · ${r.tipo === 'sorteo' ? 'Sorteo' : 'Donación'}` : ''}</small>
                </td>
                <td className="num">{r.costo}</td>
                <td className="num">{r.stock === 0 ? <Badge tono="warn">Agotado</Badge> : r.stock}</td>
                <td>{fmtFecha(r.vigenciaDesde)} – {fmtFecha(r.vigenciaHasta)}</td>
                <td>{r.activa ? <Badge tono="ok">Activa</Badge> : <Badge>Inactiva</Badge>}</td>
                <td className="num">
                  {r.tipo === 'sorteo' && !r.sorteoRealizado && (
                    <button
                      type="button"
                      className="btn btn-acento btn-sm"
                      onClick={async () => {
                        if (!confirm(`¿Realizar el sorteo de "${r.nombre}" ahora?`)) return
                        const res = await ejecutar(() => realizarSorteo(usuario.id, r.id))
                        if (res) alert(`Ganador: ${res.ganador.nombre} (boleto ${res.boleto.codigo}) entre ${res.participantes} participantes.`)
                      }}
                    >
                      Sortear
                    </button>
                  )}{' '}
                  <button type="button" className="btn btn-fantasma btn-sm" onClick={() => { setError(null); setEd({ ...r }) }}>Editar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && !ed && <Alerta tono="error">{error}</Alerta>}
      <Modal abierto={!!ed} titulo={ed?.id ? 'Editar recompensa' : 'Nueva recompensa'} onCerrar={() => setEd(null)}>
        {ed && (
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault()
              const ok = await ejecutar(() => guardarRecompensa(usuario.id, ed))
              if (ok) setEd(null)
            }}
          >
            <div className="form-2 form-2-emoji">
              <Campo etiqueta="Ícono">{(id) => <input id={id} className="input" value={ed.emoji} maxLength={4} onChange={(e) => setEd({ ...ed, emoji: e.target.value })} />}</Campo>
              <Campo etiqueta="Nombre">{(id) => <input id={id} className="input" value={ed.nombre} onChange={(e) => setEd({ ...ed, nombre: e.target.value })} required />}</Campo>
            </div>
            <Campo etiqueta="Descripción">{(id) => <textarea id={id} className="input" rows={2} value={ed.descripcion} onChange={(e) => setEd({ ...ed, descripcion: e.target.value })} />}</Campo>
            <div className="form-2">
              <Campo etiqueta="Tipo">
                {(id) => (
                  <select id={id} className="input" value={ed.tipo} onChange={(e) => setEd({ ...ed, tipo: e.target.value as Recompensa['tipo'] })}>
                    <option value="beneficio">Beneficio en el campus</option>
                    <option value="sorteo">Sorteo interno</option>
                    <option value="donacion">Donación a proyecto</option>
                  </select>
                )}
              </Campo>
              <Campo etiqueta="Procedencia">{(id) => <input id={id} className="input" value={ed.procedencia} onChange={(e) => setEd({ ...ed, procedencia: e.target.value })} />}</Campo>
            </div>
            <div className="form-2">
              <Campo etiqueta="Costo (EcoPoints)">{(id) => <input id={id} className="input" type="number" value={ed.costo} onChange={(e) => setEd({ ...ed, costo: Number(e.target.value) })} />}</Campo>
              <Campo etiqueta="Stock">{(id) => <input id={id} className="input" type="number" value={ed.stock} onChange={(e) => setEd({ ...ed, stock: Number(e.target.value) })} />}</Campo>
            </div>
            <div className="form-2">
              <Campo etiqueta="Vigente desde">{(id) => <input id={id} className="input" type="date" value={ed.vigenciaDesde} onChange={(e) => setEd({ ...ed, vigenciaDesde: e.target.value })} />}</Campo>
              <Campo etiqueta="Vigente hasta">{(id) => <input id={id} className="input" type="date" value={ed.vigenciaHasta} onChange={(e) => setEd({ ...ed, vigenciaHasta: e.target.value })} />}</Campo>
            </div>
            <Campo etiqueta="Responsable de entrega" ayuda="En la Fase 1 entrega la administración; los aliados se habilitan en la Fase 2.">
              {(id, d) => <input id={id} aria-describedby={d} className="input" value={ed.responsable} onChange={(e) => setEd({ ...ed, responsable: e.target.value })} />}
            </Campo>
            <label className="check">
              <input type="checkbox" checked={ed.activa} onChange={(e) => setEd({ ...ed, activa: e.target.checked })} />
              <span>Activa en el catálogo</span>
            </label>
            {error && <Alerta tono="error">{error}</Alerta>}
            <button className="btn btn-tinta btn-bloque">Guardar</button>
          </form>
        )}
      </Modal>
    </div>
  )
}

// A01 / A02 – Validar código y entregar (administrador en Fase 1)
export function Entregas({ usuario }: { usuario: Usuario }) {
  const { db } = useStore()
  const [codigo, setCodigo] = useState('')
  const [canje, setCanje] = useState<Canje | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const { error, setError, ejecutar } = useAccion()
  const actual = canje ? db.canjes.find((c) => c.id === canje.id) ?? canje : null
  const rw = actual && db.recompensas.find((r) => r.id === actual.recompensaId)
  const dueno = actual && db.usuarios.find((u) => u.id === actual.usuarioId)
  const recientes = db.canjes.filter((c) => c.estado === 'entregado').sort((a, b) => (b.entregadoEn ?? 0) - (a.entregadoEn ?? 0)).slice(0, 6)

  return (
    <div className="pagina pagina-media">
      <Encabezado titulo="Entrega de recompensas" descripcion="Valida el código que presenta el usuario. Cada código se usa una sola vez." />
      <form
        className="bloque form form-linea"
        onSubmit={async (e) => {
          e.preventDefault()
          setOk(null)
          const c = await ejecutar(() => buscarCanje(codigo))
          setCanje(c ?? null)
        }}
      >
        <Campo etiqueta="Código de canje">{(id) => <input id={id} className="input input-mono input-codigo" placeholder="ECO-XXXX-XXXX" value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} />}</Campo>
        <button className="btn btn-tinta">Validar código</button>
      </form>
      {error && <Alerta tono="error">{error}</Alerta>}
      {ok && <Alerta tono="ok" titulo="Entregado">{ok}</Alerta>}
      {actual && rw && (
        <section className="bloque entrega">
          <span className="entrega-emoji" aria-hidden="true">{rw.emoji}</span>
          <div className="entrega-info">
            <h2>{rw.nombre}</h2>
            <dl className="dl">
              <dt>Usuario</dt>
              <dd>{dueno?.nombre} · {dueno?.correo}</dd>
              <dt>Estado</dt>
              <dd><EstadoBadge estado={actual.estado} etiqueta={ETIQUETA_CANJE[actual.estado]} /></dd>
              <dt>Vence</dt>
              <dd>{fmtFechaHora(actual.venceEn)}</dd>
            </dl>
          </div>
          {actual.estado === 'pendiente' && (
            <button
              type="button"
              className="btn btn-acento btn-lg"
              onClick={async () => {
                const c = await ejecutar(() => entregarCanje(usuario.id, actual.codigo))
                if (c) {
                  setOk(`${rw.nombre} entregado a ${dueno?.nombre}. El código ya no puede reutilizarse.`)
                  setCodigo('')
                  setError(null)
                }
              }}
            >
              Marcar como entregado
            </button>
          )}
        </section>
      )}
      <section className="bloque">
        <h2 className="h-bloque">Últimas entregas</h2>
        {recientes.length === 0 ? (
          <p className="nota">Aún no hay entregas.</p>
        ) : (
          <ul className="lista-simple">
            {recientes.map((c) => (
              <li key={c.id}>
                <span className="codigo-mono">{c.codigo}</span>
                <span>{db.recompensas.find((r) => r.id === c.recompensaId)?.nombre}</span>
                <small>{hace(c.entregadoEn ?? 0)}</small>
              </li>
            ))}
          </ul>
        )}
        <details className="ayuda-demo">
          <summary>Códigos pendientes (demo)</summary>
          <div className="chips">
            {db.canjes.filter((c) => c.estado === 'pendiente').map((c) => (
              <button key={c.id} type="button" className="chip-boton" onClick={() => setCodigo(c.codigo)}>
                <span className="codigo-mono">{c.codigo}</span>
              </button>
            ))}
            {!db.canjes.some((c) => c.estado === 'pendiente') && <small>No hay canjes pendientes.</small>}
          </div>
        </details>
      </section>
    </div>
  )
}

// D06 – Usuarios, roles y bloqueo
export function AdminUsuarios({ usuario }: { usuario: Usuario }) {
  const { db } = useStore()
  const [busqueda, setBusqueda] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [ajuste, setAjuste] = useState({ puntos: 0, motivo: '' })
  const { error, setError, ejecutar } = useAccion()
  const lista = db.usuarios.filter((u) => `${u.nombre} ${u.correo}`.toLowerCase().includes(busqueda.toLowerCase()))
  const u = db.usuarios.find((x) => x.id === sel)

  return (
    <div className="pagina">
      <Encabezado titulo="Usuarios" descripcion="Bloquear una cuenta revoca sus sesiones sin borrar el historial." />
      <input className="input buscador" placeholder="Buscar por nombre o correo" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} aria-label="Buscar usuarios" />
      <div className="tabla-envoltura">
        <table className="tabla">
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Rol</th>
              <th>Estado</th>
              <th className="num">Saldo</th>
              <th className="num">Reciclajes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lista.map((x) => (
              <tr key={x.id}>
                <td>
                  <b>{x.nombre}</b>
                  <br />
                  <small className="txt-muted">{x.correo}</small>
                </td>
                <td>{ETIQUETA_ROL[x.rol]}</td>
                <td>{x.bloqueado ? <Badge tono="error">Bloqueado</Badge> : x.verificado ? <Badge tono="ok">Activo</Badge> : <Badge tono="warn">Sin verificar</Badge>}</td>
                <td className="num">{x.rol === 'usuario' ? fmtNumero(saldoConfirmado(db, x.id)) : '—'}</td>
                <td className="num">{db.reciclajes.filter((r) => r.usuarioId === x.id).length}</td>
                <td className="num">
                  <button type="button" className="btn btn-fantasma btn-sm" onClick={() => { setError(null); setMotivo(''); setAjuste({ puntos: 0, motivo: '' }); setSel(x.id) }}>Gestionar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal abierto={!!u} titulo={u?.nombre ?? ''} onCerrar={() => setSel(null)}>
        {u && (
          <div className="form">
            <p className="nota">{u.correo} · {u.facultad}</p>
            {error && <Alerta tono="error">{error}</Alerta>}
            <Campo etiqueta="Rol" ayuda="Cambiar el rol revoca las sesiones abiertas del usuario.">
              {(id, d) => (
                <select id={id} aria-describedby={d} className="input" value={u.rol} disabled={u.id === usuario.id} onChange={(e) => void ejecutar(() => cambiarRol(usuario.id, u.id, e.target.value as Rol))}>
                  <option value="usuario">Usuario</option>
                  <option value="recolector">Recolector</option>
                  <option value="admin">Administrador</option>
                  <option value="aliado" disabled>Aliado (Fase 2)</option>
                </select>
              )}
            </Campo>
            <fieldset className="fieldset">
              <legend>{u.bloqueado ? 'Desbloquear cuenta' : 'Bloquear cuenta'}</legend>
              <div className="form-linea">
                <input className="input" placeholder="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-label="Motivo del bloqueo" />
                <button type="button" className={`btn ${u.bloqueado ? 'btn-tinta' : 'btn-peligro'}`} disabled={u.id === usuario.id} onClick={() => void ejecutar(() => cambiarBloqueo(usuario.id, u.id, !u.bloqueado, motivo))}>
                  {u.bloqueado ? 'Desbloquear' : 'Bloquear'}
                </button>
              </div>
            </fieldset>
            {u.rol === 'usuario' && (
              <fieldset className="fieldset">
                <legend>Ajuste de EcoPoints</legend>
                <p className="nota">Saldo actual: {fmtNumero(saldoConfirmado(db, u.id))} pts. El ajuste se agrega al libro; no modifica movimientos anteriores.</p>
                <div className="form-linea">
                  <input className="input input-num" type="number" value={ajuste.puntos} onChange={(e) => setAjuste({ ...ajuste, puntos: Number(e.target.value) })} aria-label="Puntos del ajuste" />
                  <input className="input" placeholder="Motivo del ajuste" value={ajuste.motivo} onChange={(e) => setAjuste({ ...ajuste, motivo: e.target.value })} aria-label="Motivo del ajuste" />
                  <button type="button" className="btn btn-tinta" onClick={async () => { const ok = await ejecutar(() => { crearAjuste(usuario.id, u.id, ajuste.puntos, ajuste.motivo); return true }); if (ok) setAjuste({ puntos: 0, motivo: '' }) }}>Aplicar</button>
                </div>
              </fieldset>
            )}
            <h3 className="h-bloque">Últimos reciclajes</h3>
            <ul className="lista-simple">
              {db.reciclajes.filter((r) => r.usuarioId === u.id).slice(-5).reverse().map((r) => (
                <li key={r.id}>
                  <span>{db.categorias.find((c) => c.id === r.categoriaId)?.nombre}</span>
                  <EstadoBadge estado={r.estado} etiqueta={ETIQUETA_RECICLAJE[r.estado]} />
                  <small>{hace(r.creadoEn)}</small>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>
    </div>
  )
}

// Auditoría – solo lectura
export function Auditoria() {
  const { db } = useStore()
  const [entidad, setEntidad] = useState('todas')
  const entidades = [...new Set(db.auditoria.map((a) => a.entidad))]
  const lista = db.auditoria.filter((a) => entidad === 'todas' || a.entidad === entidad).slice().reverse()
  return (
    <div className="pagina">
      <Encabezado titulo="Auditoría" descripcion="Registro inmutable: ningún evento se puede editar ni borrar." />
      <div className="filtros" role="group" aria-label="Filtrar por entidad">
        <button type="button" className={`filtro ${entidad === 'todas' ? 'activo' : ''}`} onClick={() => setEntidad('todas')}>Todas</button>
        {entidades.map((e) => (
          <button key={e} type="button" className={`filtro ${entidad === e ? 'activo' : ''}`} onClick={() => setEntidad(e)}>{e}</button>
        ))}
      </div>
      {lista.length === 0 ? (
        <Vacio titulo="Sin eventos" />
      ) : (
        <ol className="auditoria">
          {lista.map((a) => (
            <li key={a.id}>
              <time>{fmtFechaHora(a.creadoEn)}</time>
              <div>
                <b>{a.accion}</b> <span className="badge badge-neutral mono">{a.entidad}</span>
                <p>{a.detalle}</p>
                <small>por {a.actorNombre}</small>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
