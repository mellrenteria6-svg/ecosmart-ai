// R01–R04: puntos asignados, pendientes, revisión individual y lotes cerrados.
import { useMemo, useState } from 'react'
import { asignacionVigente, cerrarLote, puntosAsignados, useStore } from '../data/store'
import type { Decision } from '../data/store'
import type { Db, Reciclaje, Usuario } from '../data/types'
import { fotoVisible } from '../components/Visual'
import { Alerta, Campo, Encabezado, EstadoBadge, Stat, Vacio, useAccion } from '../components/ui'
import { ETIQUETA_RECICLAJE, fmtFechaHora, fmtPct, hace } from '../lib/formato'
import { navegar } from '../lib/router'

export function PuntosRecolector({ usuario }: { usuario: Usuario }) {
  const { db } = useStore()
  const puntos = puntosAsignados(db, usuario.id)
  const total = (pid: string, estado: Reciclaje['estado']) => db.reciclajes.filter((r) => r.puntoId === pid && r.estado === estado).length
  const totalPend = puntos.reduce((t, p) => t + total(p.id, 'pendiente'), 0)
  const totalRev = puntos.reduce((t, p) => t + total(p.id, 'en_revision'), 0)
  const hoy = new Date().setHours(0, 0, 0, 0)
  const validadosHoy = db.reciclajes.filter((r) => r.validadoPor === usuario.id && (r.validadoEn ?? 0) >= hoy).length

  return (
    <div className="pagina">
      <Encabezado titulo={`Hola, ${usuario.nombre.split(' ')[0]}`} descripcion="Estos son los puntos con asignación vigente para ti." />
      <div className="stats">
        <Stat etiqueta="Pendientes para lote" valor={totalPend} tono="acento" />
        <Stat etiqueta="En revisión individual" valor={totalRev} />
        <Stat etiqueta="Procesados hoy" valor={validadosHoy} />
      </div>
      {puntos.length === 0 ? (
        <Vacio titulo="No tienes puntos asignados">El administrador debe asignarte un punto con vigencia y horario para validar reciclajes.</Vacio>
      ) : (
        <div className="tarjetas-puntos">
          {puntos.map((p) => {
            const a = asignacionVigente(db, usuario.id, p.id)!
            const pend = total(p.id, 'pendiente')
            const rev = total(p.id, 'en_revision')
            return (
              <a key={p.id} href={`#/rec/punto/${p.id}`} className="tarjeta-punto">
                <div className="tp-cab">
                  <span className="codigo-mono">{p.codigoQr}</span>
                  <EstadoBadge estado={p.estado} etiqueta={p.estado === 'activo' ? 'Activo' : p.estado} />
                </div>
                <h3>{p.nombre}</h3>
                <p>{p.ubicacion}</p>
                <div className="tp-nums">
                  <div>
                    <b>{pend}</b>
                    <small>pendientes</small>
                  </div>
                  <div className={rev ? 'tp-alerta' : ''}>
                    <b>{rev}</b>
                    <small>en revisión</small>
                  </div>
                </div>
                <small className="tp-horario">
                  {a.horario} · hasta {a.hasta}
                </small>
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface Fila {
  incluir: boolean
  accion: 'validar' | 'rechazar'
  cantidad: number
  motivo: string
}

export function PendientesPunto({ usuario, puntoId }: { usuario: Usuario; puntoId: string }) {
  const { db } = useStore()
  const punto = db.puntos.find((p) => p.id === puntoId)
  const vigente = punto && (usuario.rol === 'admin' || asignacionVigente(db, usuario.id, puntoId))
  const pendientes = useMemo(() => db.reciclajes.filter((r) => r.puntoId === puntoId && r.estado === 'pendiente').sort((a, b) => a.creadoEn - b.creadoEn), [db, puntoId])
  const revision = db.reciclajes.filter((r) => r.puntoId === puntoId && r.estado === 'en_revision')
  const [filas, setFilas] = useState<Record<string, Fila>>({})
  const [mensaje, setMensaje] = useState<string | null>(null)
  const { error, cargando, ejecutar } = useAccion()

  if (!punto || !vigente) {
    return (
      <div className="pagina">
        <Alerta tono="error" titulo="Sin asignación vigente">Solo puedes ver y validar los puntos que tienes asignados.</Alerta>
        <a href="#/rec">← Volver a mis puntos</a>
      </div>
    )
  }

  const fila = (r: Reciclaje): Fila => filas[r.id] ?? { incluir: true, accion: 'validar', cantidad: r.cantidadReportada, motivo: '' }
  const actualizar = (r: Reciclaje, cambios: Partial<Fila>) => setFilas((f) => ({ ...f, [r.id]: { ...fila(r), ...cambios } }))
  const incluidas = pendientes.filter((r) => fila(r).incluir)
  const nVal = incluidas.filter((r) => fila(r).accion === 'validar').length
  const nRec = incluidas.length - nVal
  const puntosLote = incluidas.filter((r) => fila(r).accion === 'validar').reduce((t, r) => t + Math.round(fila(r).cantidad * r.puntosPorUnidad), 0)

  async function cerrar() {
    const decisiones: Decision[] = incluidas.map((r) => {
      const f = fila(r)
      return f.accion === 'rechazar'
        ? { reciclajeId: r.id, accion: 'rechazar', motivoRechazo: f.motivo }
        : { reciclajeId: r.id, accion: 'validar', cantidadFinal: f.cantidad, motivoCantidad: f.motivo }
    })
    const lote = await ejecutar(() => cerrarLote(usuario.id, puntoId, decisiones))
    if (lote) {
      setFilas({})
      setMensaje(`Lote cerrado: ${lote.validados} validados y ${lote.rechazados} rechazados. Los usuarios ya fueron notificados.`)
    }
  }

  return (
    <div className="pagina">
      <Encabezado volver={usuario.rol === 'admin' ? '#/admin' : '#/rec'} titulo={punto.nombre} descripcion={`${punto.ubicacion} · ${punto.codigoQr}`} />
      {mensaje && <Alerta tono="ok">{mensaje}</Alerta>}

      {revision.length > 0 && (
        <section className="bloque bloque-alerta">
          <div className="bloque-cab">
            <h2>Requieren revisión individual</h2>
            <small>Categoría corregida o baja confianza de la IA</small>
          </div>
          <ul className="lista-reciclajes">
            {revision.map((r) => (
              <li key={r.id}>
                <a href={`#/rec/reciclaje/${r.id}`} className="fila-reciclaje fila-boton">
                  <img src={fotoVisible(r.foto)} alt="" className="miniatura" />
                  <div className="fila-info">
                    <b>
                      {r.cantidadReportada} {r.unidad} · {nombreCat(db, r.categoriaId)}
                    </b>
                    <small>{r.motivoRevision}</small>
                  </div>
                  <div className="fila-fin">
                    <EstadoBadge estado={r.estado} etiqueta="En revisión" />
                    <span className="cta-flecha">→</span>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="bloque">
        <div className="bloque-cab">
          <h2>Lote de pendientes</h2>
          <small>{pendientes.length} registros</small>
        </div>
        {pendientes.length === 0 ? (
          <Vacio titulo="No hay registros pendientes en este punto" />
        ) : (
          <>
            <ul className="lote">
              {pendientes.map((r) => {
                const f = fila(r)
                const cambiada = f.cantidad !== r.cantidadReportada
                const dueno = db.usuarios.find((u) => u.id === r.usuarioId)
                return (
                  <li key={r.id} className={`lote-fila ${!f.incluir ? 'excluida' : ''} ${f.accion === 'rechazar' ? 'rechazo' : ''}`}>
                    <label className="lote-check">
                      <input type="checkbox" checked={f.incluir} onChange={(e) => actualizar(r, { incluir: e.target.checked })} aria-label="Incluir en el lote" />
                    </label>
                    <img src={fotoVisible(r.foto)} alt={`Foto de ${nombreCat(db, r.categoriaId)}`} className="miniatura miniatura-lg" />
                    <div className="lote-info">
                      <b>{nombreCat(db, r.categoriaId)}</b>
                      <small>
                        {dueno?.nombre} · {hace(r.creadoEn)} · IA {fmtPct(r.confianzaIa)}
                      </small>
                      <small>
                        Reportado: {r.cantidadReportada} {r.unidad}
                      </small>
                    </div>
                    <div className="lote-controles">
                      <div className="segmento" role="group" aria-label="Decisión">
                        <button type="button" className={f.accion === 'validar' ? 'activo' : ''} onClick={() => actualizar(r, { accion: 'validar', motivo: '' })}>Validar</button>
                        <button type="button" className={f.accion === 'rechazar' ? 'activo rechazo' : ''} onClick={() => actualizar(r, { accion: 'rechazar', motivo: '' })}>Rechazar</button>
                      </div>
                      {f.accion === 'validar' ? (
                        <>
                          <label className="mini-campo">
                            <span>Cantidad final ({r.unidad})</span>
                            <input className="input input-sm" type="number" step={r.unidad === 'kg' ? 0.5 : 1} value={f.cantidad} onChange={(e) => actualizar(r, { cantidad: Number(e.target.value) })} />
                          </label>
                          {cambiada && <input className="input input-sm" placeholder="Motivo de la corrección" value={f.motivo} onChange={(e) => actualizar(r, { motivo: e.target.value })} aria-label="Motivo de la corrección de cantidad" />}
                        </>
                      ) : (
                        <input className="input input-sm" placeholder="Motivo del rechazo (obligatorio)" value={f.motivo} onChange={(e) => actualizar(r, { motivo: e.target.value })} aria-label="Motivo del rechazo" />
                      )}
                    </div>
                    <span className="lote-pts">{f.accion === 'validar' ? `+${Math.round(f.cantidad * r.puntosPorUnidad)}` : '0'} pts</span>
                  </li>
                )
              })}
            </ul>
            <div className="barra-lote">
              <div>
                <b>
                  {nVal} validar · {nRec} rechazar
                </b>
                <small>Se acreditarán {puntosLote} EcoPoints en una sola transacción</small>
              </div>
              <button type="button" className="btn btn-acento" disabled={cargando || incluidas.length === 0} onClick={cerrar}>
                Cerrar lote
              </button>
            </div>
            {error && <Alerta tono="error">{error}</Alerta>}
          </>
        )}
      </section>
    </div>
  )
}

function nombreCat(db: Db, id: string) {
  return db.categorias.find((c) => c.id === id)?.nombre ?? id
}

export function RevisionIndividual({ usuario, reciclajeId }: { usuario: Usuario; reciclajeId: string }) {
  const { db } = useStore()
  const r = db.reciclajes.find((x) => x.id === reciclajeId)
  const [cantidad, setCantidad] = useState(r?.cantidadReportada ?? 0)
  const [motivo, setMotivo] = useState('')
  const [motivoRechazo, setMotivoRechazo] = useState('')
  const { error, cargando, ejecutar } = useAccion()

  if (!r) return <Vacio titulo="Registro no encontrado" />
  const autorizado = usuario.rol === 'admin' || asignacionVigente(db, usuario.id, r.puntoId)
  if (!autorizado) return <Alerta tono="error">No tienes una asignación vigente en este punto.</Alerta>
  const dueno = db.usuarios.find((u) => u.id === r.usuarioId)
  const abierto = r.estado === 'pendiente' || r.estado === 'en_revision'
  const volver = `#/rec/punto/${r.puntoId}`

  async function decidir(accion: 'validar' | 'rechazar') {
    const ok = await ejecutar(() =>
      cerrarLote(usuario.id, r!.puntoId, [accion === 'validar' ? { reciclajeId: r!.id, accion, cantidadFinal: cantidad, motivoCantidad: motivo } : { reciclajeId: r!.id, accion, motivoRechazo }], true),
    )
    if (ok) navegar(volver.slice(1))
  }

  return (
    <div className="pagina">
      <Encabezado volver={volver} titulo="Revisión individual" descripcion={r.motivoRevision ?? 'Revisa la foto antes de decidir.'} />
      <div className="revision-grid">
        <figure className="revision-foto">
          <img src={fotoVisible(r.foto)} alt="Foto del residuo enviada por el usuario" />
          <figcaption>Foto privada · visible solo para recolector asignado y administración</figcaption>
        </figure>
        <div className="bloque">
          <EstadoBadge estado={r.estado} etiqueta={ETIQUETA_RECICLAJE[r.estado]} />
          <dl className="dl">
            <dt>Usuario</dt>
            <dd>{dueno?.nombre}</dd>
            <dt>Registrado</dt>
            <dd>{fmtFechaHora(r.creadoEn)}</dd>
            <dt>Propuesta IA</dt>
            <dd>
              {nombreCat(db, r.categoriaIa)} · {fmtPct(r.confianzaIa)} · <span className="mono">{r.modeloVersion}</span>
            </dd>
            <dt>Categoría elegida</dt>
            <dd>
              {nombreCat(db, r.categoriaId)} {r.corregidoPorUsuario && <span className="badge badge-warn">corregida</span>}
            </dd>
            <dt>Reportado</dt>
            <dd>
              {r.cantidadReportada} {r.unidad}
            </dd>
            <dt>Tarifa congelada</dt>
            <dd>
              {r.puntosPorUnidad} pts/{r.unidad} · v{r.categoriaVersion}
            </dd>
          </dl>
          {abierto ? (
            <div className="form">
              <Campo etiqueta={`Cantidad confirmada (${r.unidad})`}>
                {(id) => <input id={id} className="input" type="number" step={r.unidad === 'kg' ? 0.5 : 1} value={cantidad} onChange={(e) => setCantidad(Number(e.target.value))} />}
              </Campo>
              {cantidad !== r.cantidadReportada && (
                <Campo etiqueta="Motivo de la corrección">
                  {(id) => <input id={id} className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
                </Campo>
              )}
              <button type="button" className="btn btn-acento btn-bloque" disabled={cargando} onClick={() => decidir('validar')}>
                Validar y acreditar {Math.round(cantidad * r.puntosPorUnidad)} pts
              </button>
              <div className="separador"><span>o rechazar</span></div>
              <Campo etiqueta="Motivo del rechazo">
                {(id) => <input id={id} className="input" value={motivoRechazo} onChange={(e) => setMotivoRechazo(e.target.value)} placeholder="Ej.: el residuo no corresponde a la categoría" />}
              </Campo>
              <button type="button" className="btn btn-peligro btn-bloque" disabled={cargando} onClick={() => decidir('rechazar')}>
                Rechazar registro
              </button>
              {error && <Alerta tono="error">{error}</Alerta>}
            </div>
          ) : (
            <Alerta tono="info">Este registro ya fue procesado y su estado es final.</Alerta>
          )}
        </div>
      </div>
    </div>
  )
}

export function LotesCerrados({ usuario }: { usuario: Usuario }) {
  const { db } = useStore()
  const lotes = db.lotes.filter((l) => l.recolectorId === usuario.id).sort((a, b) => b.creadoEn - a.creadoEn)
  return (
    <div className="pagina">
      <Encabezado titulo="Lotes cerrados" descripcion="Cada lote confirma reciclajes, movimientos, saldo y auditoría en una sola transacción." />
      {lotes.length === 0 ? (
        <Vacio titulo="Todavía no cierras lotes" />
      ) : (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Punto</th>
                <th className="num">Validados</th>
                <th className="num">Rechazados</th>
                <th className="num">EcoPoints</th>
              </tr>
            </thead>
            <tbody>
              {lotes.map((l) => (
                <tr key={l.id}>
                  <td>{fmtFechaHora(l.creadoEn)}</td>
                  <td>{db.puntos.find((p) => p.id === l.puntoId)?.nombre}</td>
                  <td className="num">{l.validados}</td>
                  <td className="num">{l.rechazados}</td>
                  <td className="num">
                    {db.reciclajes.filter((r) => l.reciclajes.includes(r.id) && r.estado === 'validado').reduce((t, r) => t + r.puntosEstimados, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
