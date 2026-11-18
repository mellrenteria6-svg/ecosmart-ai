import { useEffect, useMemo, useState } from 'react'
import {
  cancelarCanje,
  crearCanje,
  marcarNotificacionesLeidas,
  nuevaClaveIdempotencia,
  procesarVencimientos,
  puntosPendientes,
  recompensaDisponible,
  registrosHoy,
  saldoConfirmado,
  useStore,
} from '../data/store'
import type { Recompensa, Usuario } from '../data/types'
import { Alerta, Encabezado, EstadoBadge, Modal, Puntos, Vacio, useAccion } from '../components/ui'
import { ChipCategoria, MapaCampus, Qr } from '../components/Visual'
import { ColaOffline } from './Reciclar'
import { Insignias } from './Comunidad'
import { ETIQUETA_CANJE, ETIQUETA_PUNTO, ETIQUETA_RECICLAJE, fmtFecha, fmtFechaHora, fmtNumero, fmtPct, hace, tiempoRestante } from '../lib/formato'
import { navegar } from '../lib/router'

// U01 – Inicio del usuario
export function InicioUsuario({ usuario }: { usuario: Usuario }) {
  const { db } = useStore()
  const saldo = saldoConfirmado(db, usuario.id)
  const pendientes = puntosPendientes(db, usuario.id)
  const hoy = registrosHoy(db, usuario.id)
  const recientes = db.reciclajes.filter((r) => r.usuarioId === usuario.id).sort((a, b) => b.creadoEn - a.creadoEn).slice(0, 4)
  const proxima = db.recompensas.filter(recompensaDisponible).sort((a, b) => a.costo - b.costo).find((r) => r.costo > saldo)
  const validados = db.reciclajes.filter((r) => r.usuarioId === usuario.id && r.estado === 'validado').length
  const hora = new Date().getHours()
  const saludo = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches'

  return (
    <div className="pagina">
      <div className="inicio-grid">
        <section className="boleto" aria-label="Saldo de EcoPoints">
          <div className="boleto-cab">
            <span>
              {saludo}, {usuario.nombre.split(' ')[0]}
            </span>
            <span className="boleto-id">{usuario.facultad.toUpperCase()}</span>
          </div>
          <p className="boleto-etiqueta">EcoPoints confirmados</p>
          <p className="boleto-saldo">{fmtNumero(saldo)}</p>
          <div className="boleto-perforado" aria-hidden="true" />
          <div className="boleto-pie">
            <div>
              <small>Pendientes de validación</small>
              <b>+{fmtNumero(pendientes)} pts</b>
            </div>
            <div>
              <small>Registros hoy</small>
              <b>
                {hoy} / {db.config.topeDiario}
              </b>
            </div>
            <div>
              <small>Validados</small>
              <b>{validados}</b>
            </div>
          </div>
        </section>

        <a className="cta-reciclar" href="#/app/reciclar">
          <span className="cta-reciclar-icono" aria-hidden="true">
            <svg viewBox="0 0 48 48">
              <path d="M6 16V8a2 2 0 0 1 2-2h8M32 6h8a2 2 0 0 1 2 2v8M42 32v8a2 2 0 0 1-2 2h-8M16 42H8a2 2 0 0 1-2-2v-8" />
              <path d="M14 24h20" />
            </svg>
          </span>
          <span>
            <b>Reciclar ahora</b>
            <small>Escanea el QR del punto</small>
          </span>
          <span className="cta-flecha" aria-hidden="true">→</span>
        </a>

        {proxima && (
          <div className="meta-card">
            <p className="kicker">Tu próxima meta</p>
            <div className="meta-fila">
              <span className="meta-emoji" aria-hidden="true">{proxima.emoji}</span>
              <div>
                <b>{proxima.nombre}</b>
                <small>Te faltan {fmtNumero(proxima.costo - saldo)} pts</small>
              </div>
            </div>
            <div className="progreso" role="progressbar" aria-valuemin={0} aria-valuemax={proxima.costo} aria-valuenow={saldo} aria-label="Progreso hacia la recompensa">
              <span style={{ width: `${Math.min(100, (saldo / proxima.costo) * 100)}%` }} />
            </div>
          </div>
        )}
      </div>

      <ColaOffline usuarioId={usuario.id} />

      <section className="bloque">
        <div className="bloque-cab">
          <h2>Actividad reciente</h2>
          <a href="#/app/historial">Ver historial →</a>
        </div>
        {recientes.length === 0 ? (
          <Vacio titulo="Aún no tienes reciclajes">Escanea el QR de un punto para registrar el primero.</Vacio>
        ) : (
          <ul className="lista-reciclajes">
            {recientes.map((r) => {
              const cat = db.categorias.find((c) => c.id === r.categoriaId)!
              const punto = db.puntos.find((p) => p.id === r.puntoId)
              return (
                <li key={r.id} className="fila-reciclaje">
                  <img src={r.foto} alt="" className="miniatura" />
                  <div className="fila-info">
                    <b>
                      {r.cantidadFinal ?? r.cantidadReportada} {r.unidad} · {cat.nombre}
                    </b>
                    <small>
                      {punto?.nombre} · {hace(r.creadoEn)}
                    </small>
                  </div>
                  <div className="fila-fin">
                    <EstadoBadge estado={r.estado} etiqueta={ETIQUETA_RECICLAJE[r.estado]} />
                    <span className={r.estado === 'validado' ? 'pts-ok' : r.estado === 'rechazado' ? 'pts-tachado' : 'pts-pend'}>
                      {r.estado === 'validado' ? '+' : '≈'}
                      {r.puntosEstimados} pts
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

// U02 / U03 – Lista, mapa y detalle de puntos
export function PuntosCampus() {
  const { db } = useStore()
  const visibles = db.puntos.filter((p) => p.visible)
  const [sel, setSel] = useState<string>(visibles[0]?.id ?? '')
  const [filtro, setFiltro] = useState('todas')
  const lista = visibles.filter((p) => filtro === 'todas' || p.categorias.includes(filtro))
  const punto = visibles.find((p) => p.id === sel)

  return (
    <div className="pagina">
      <Encabezado titulo="Puntos de reciclaje" descripcion="Encuentra el punto más cercano y revisa qué materiales recibe." />
      <div className="filtros" role="group" aria-label="Filtrar por categoría">
        <button type="button" className={`filtro ${filtro === 'todas' ? 'activo' : ''}`} onClick={() => setFiltro('todas')}>Todas</button>
        {db.categorias.map((c) => (
          <button key={c.id} type="button" className={`filtro ${filtro === c.id ? 'activo' : ''}`} onClick={() => setFiltro(c.id)}>
            {c.nombre}
          </button>
        ))}
      </div>
      <div className="puntos-grid">
        <MapaCampus puntos={lista} seleccionado={sel} onSeleccionar={setSel} />
        <div className="puntos-lista">
          {lista.length === 0 && <Vacio titulo="Ningún punto recibe esta categoría" />}
          {lista.map((p) => (
            <button key={p.id} type="button" className={`punto-item ${sel === p.id ? 'sel' : ''}`} onClick={() => setSel(p.id)}>
              <div>
                <b>{p.nombre}</b>
                <small>{p.ubicacion}</small>
              </div>
              <EstadoBadge estado={p.estado} etiqueta={ETIQUETA_PUNTO[p.estado]} />
            </button>
          ))}
        </div>
      </div>
      {punto && (
        <section className="bloque punto-detalle" aria-live="polite">
          <div>
            <p className="kicker">Detalle del punto</p>
            <h2>{punto.nombre}</h2>
            <p className="encabezado-desc">{punto.ubicacion}</p>
            <div className="chips">
              {punto.categorias.map((id) => {
                const c = db.categorias.find((x) => x.id === id)!
                return <ChipCategoria key={id} nombre={`${c.nombre} · ${c.puntosPorUnidad} pts/${c.unidad}`} color={c.color} />
              })}
            </div>
          </div>
          <div className="punto-detalle-acc">
            <span className="codigo-mono">{punto.codigoQr}</span>
            {punto.estado === 'activo' ? (
              <button type="button" className="btn btn-acento" onClick={() => navegar(`/app/reciclar?codigo=${punto.codigoQr}`)}>
                Reciclar aquí
              </button>
            ) : (
              <Alerta tono="warn">Este punto está {ETIQUETA_PUNTO[punto.estado].toLowerCase()} y no recibe reciclajes.</Alerta>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

// U08 / U16 – Historial de reciclajes y movimientos
export function Historial({ usuario }: { usuario: Usuario }) {
  const { db } = useStore()
  const [tab, setTab] = useState<'reciclajes' | 'movimientos'>('reciclajes')
  const [detalle, setDetalle] = useState<string | null>(null)
  const reciclajes = db.reciclajes.filter((r) => r.usuarioId === usuario.id).sort((a, b) => b.creadoEn - a.creadoEn)
  const movimientos = db.movimientos.filter((m) => m.usuarioId === usuario.id).sort((a, b) => b.creadoEn - a.creadoEn)
  const saldo = saldoConfirmado(db, usuario.id)
  const r = reciclajes.find((x) => x.id === detalle)

  return (
    <div className="pagina">
      <Encabezado titulo="Historial" descripcion={<>Tu saldo de <b>{fmtNumero(saldo)} pts</b> es la suma exacta de los movimientos del libro.</>} />
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'reciclajes'} className={tab === 'reciclajes' ? 'activo' : ''} onClick={() => setTab('reciclajes')}>
          Reciclajes <span className="tab-num">{reciclajes.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'movimientos'} className={tab === 'movimientos' ? 'activo' : ''} onClick={() => setTab('movimientos')}>
          Movimientos <span className="tab-num">{movimientos.length}</span>
        </button>
      </div>

      {tab === 'reciclajes' ? (
        reciclajes.length === 0 ? (
          <Vacio titulo="Sin reciclajes todavía" />
        ) : (
          <ul className="lista-reciclajes">
            {reciclajes.map((x) => {
              const cat = db.categorias.find((c) => c.id === x.categoriaId)!
              return (
                <li key={x.id}>
                  <button type="button" className="fila-reciclaje fila-boton" onClick={() => setDetalle(x.id)}>
                    <img src={x.foto} alt="" className="miniatura" />
                    <div className="fila-info">
                      <b>
                        {x.cantidadFinal ?? x.cantidadReportada} {x.unidad} · {cat.nombre}
                      </b>
                      <small>{fmtFechaHora(x.creadoEn)}</small>
                    </div>
                    <div className="fila-fin">
                      <EstadoBadge estado={x.estado} etiqueta={ETIQUETA_RECICLAJE[x.estado]} />
                      <span className={x.estado === 'validado' ? 'pts-ok' : x.estado === 'rechazado' ? 'pts-tachado' : 'pts-pend'}>
                        {x.estado === 'validado' ? '+' : '≈'}
                        {x.puntosEstimados} pts
                      </span>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )
      ) : (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Movimiento</th>
                <th>Tipo</th>
                <th className="num">Puntos</th>
              </tr>
            </thead>
            <tbody>
              {movimientos.map((m) => (
                <tr key={m.id}>
                  <td>{fmtFechaHora(m.creadoEn)}</td>
                  <td>{m.descripcion}</td>
                  <td className="cap">{m.tipo}</td>
                  <td className="num">
                    <Puntos valor={m.puntos} signo />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Saldo confirmado</td>
                <td className="num">
                  <Puntos valor={saldo} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <Modal abierto={!!r} titulo="Detalle del reciclaje" onCerrar={() => setDetalle(null)}>
        {r && (
          <div className="detalle-reciclaje">
            <img src={r.foto} alt="Foto del residuo registrado" className="detalle-foto" />
            <dl className="dl">
              <dt>Estado</dt>
              <dd>
                <EstadoBadge estado={r.estado} etiqueta={ETIQUETA_RECICLAJE[r.estado]} />
              </dd>
              <dt>Punto</dt>
              <dd>{db.puntos.find((p) => p.id === r.puntoId)?.nombre}</dd>
              <dt>Categoría</dt>
              <dd>{db.categorias.find((c) => c.id === r.categoriaId)?.nombre}</dd>
              <dt>IA</dt>
              <dd>
                {db.categorias.find((c) => c.id === r.categoriaIa)?.nombre} · {fmtPct(r.confianzaIa)} · {r.modeloVersion}
              </dd>
              <dt>Cantidad</dt>
              <dd>
                {r.cantidadReportada} {r.unidad} reportada{r.cantidadFinal !== undefined && ` · ${r.cantidadFinal} confirmada`}
              </dd>
              <dt>Tarifa</dt>
              <dd>
                {r.puntosPorUnidad} pts/{r.unidad} (versión {r.categoriaVersion})
              </dd>
              <dt>Puntos</dt>
              <dd>{r.puntosEstimados}</dd>
              {r.motivoRevision && (
                <>
                  <dt>Revisión</dt>
                  <dd>{r.motivoRevision}</dd>
                </>
              )}
              {r.motivoCantidad && (
                <>
                  <dt>Ajuste de cantidad</dt>
                  <dd>{r.motivoCantidad}</dd>
                </>
              )}
              {r.motivoRechazo && (
                <>
                  <dt>Motivo de rechazo</dt>
                  <dd>{r.motivoRechazo}</dd>
                </>
              )}
              <dt>Registrado</dt>
              <dd>{fmtFechaHora(r.creadoEn)}</dd>
            </dl>
          </div>
        )}
      </Modal>
    </div>
  )
}

// U09 / U10 – Catálogo y detalle de recompensa
export function Catalogo({ usuario }: { usuario: Usuario }) {
  const { db } = useStore()
  const saldo = saldoConfirmado(db, usuario.id)
  const [sel, setSel] = useState<Recompensa | null>(null)
  const [clave, setClave] = useState(nuevaClaveIdempotencia)
  const { error, setError, cargando, ejecutar } = useAccion()
  const visibles = db.recompensas.filter((r) => r.activa)

  async function canjear() {
    if (!sel) return
    const c = await ejecutar(() => crearCanje(usuario.id, sel.id, clave))
    if (c) {
      setSel(null)
      setClave(nuevaClaveIdempotencia())
      navegar(`/app/canjes?nuevo=${c.id}`)
    }
  }

  return (
    <div className="pagina">
      <Encabezado titulo="Recompensas" descripcion={<>Tienes <b>{fmtNumero(saldo)} EcoPoints</b> confirmados para canjear.</>} />
      <div className="catalogo">
        {visibles.map((r) => {
          const disponible = recompensaDisponible(r)
          const alcanza = saldo >= r.costo
          return (
            <article key={r.id} className={`premio ${!disponible ? 'premio-off' : ''}`}>
              <div className="premio-arte" aria-hidden="true">
                <span>{r.emoji}</span>
              </div>
              <div className="premio-cuerpo">
                {r.tipo !== 'beneficio' && <span className={`tipo-premio tipo-${r.tipo}`}>{r.tipo === 'sorteo' ? 'Sorteo' : 'Donación'}</span>}
                <h3>{r.nombre}</h3>
                <p>{r.descripcion}</p>
                <small className="procedencia">Procedencia: {r.procedencia}</small>
                <div className="premio-meta">
                  <span className="premio-costo">{fmtNumero(r.costo)} pts</span>
                  <small>{r.stock > 0 ? `${r.stock} disponibles` : 'Agotado'}</small>
                </div>
                <button
                  type="button"
                  className="btn btn-tinta btn-bloque"
                  disabled={!disponible}
                  onClick={() => {
                    setError(null)
                    setSel(r)
                  }}
                >
                  {!disponible ? 'No disponible' : alcanza ? (r.tipo === 'sorteo' ? 'Comprar boleto' : r.tipo === 'donacion' ? 'Donar' : 'Canjear') : `Te faltan ${fmtNumero(r.costo - saldo)} pts`}
                </button>
              </div>
            </article>
          )
        })}
      </div>

      <Modal abierto={!!sel} titulo="Confirmar canje" onCerrar={() => setSel(null)}>
        {sel && (
          <div className="confirmar-canje">
            <div className="premio-arte premio-arte-sm" aria-hidden="true">
              <span>{sel.emoji}</span>
            </div>
            <h3>{sel.nombre}</h3>
            <dl className="dl">
              <dt>Costo</dt>
              <dd>{fmtNumero(sel.costo)} pts</dd>
              <dt>Saldo después</dt>
              <dd>{fmtNumero(saldo - sel.costo)} pts</dd>
              <dt>Vigencia del código</dt>
              <dd>{db.config.horasVencimientoCanje} horas</dd>
              <dt>Entrega</dt>
              <dd>{sel.responsable}</dd>
            </dl>
            {error && <Alerta tono="error">{error}</Alerta>}
            <p className="nota">Si el código vence o cancelas antes de la entrega, se devuelven tus puntos automáticamente.</p>
            <button type="button" className="btn btn-acento btn-bloque" onClick={canjear} disabled={cargando}>
              Confirmar canje
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}

// U11 / U12 – Mis canjes
export function MisCanjes({ usuario, nuevo }: { usuario: Usuario; nuevo?: string }) {
  const { db } = useStore()
  const { error, ejecutar } = useAccion()
  const [, refrescar] = useState(0)
  useEffect(() => {
    procesarVencimientos()
    const t = setInterval(() => {
      procesarVencimientos()
      refrescar((n) => n + 1)
    }, 30000)
    return () => clearInterval(t)
  }, [])
  const canjes = useMemo(() => db.canjes.filter((c) => c.usuarioId === usuario.id).sort((a, b) => b.creadoEn - a.creadoEn), [db, usuario.id])

  return (
    <div className="pagina">
      <Encabezado titulo="Mis canjes" descripcion="Presenta el código en la oficina de Gestión Ambiental para recibir tu recompensa." acciones={<a className="btn btn-linea" href="#/app/recompensas">Ver catálogo</a>} />
      {nuevo && <Alerta tono="ok" titulo="¡Canje creado!">Tus puntos fueron debitados y el stock quedó reservado.</Alerta>}
      {error && <Alerta tono="error">{error}</Alerta>}
      {canjes.length === 0 ? (
        <Vacio titulo="Aún no has canjeado recompensas">
          <a href="#/app/recompensas">Explora el catálogo</a>
        </Vacio>
      ) : (
        <div className="canjes">
          {canjes.map((c) => {
            const rw = db.recompensas.find((x) => x.id === c.recompensaId)
            return (
              <article key={c.id} className={`cupon cupon-${c.estado} ${c.id === nuevo ? 'cupon-nuevo' : ''}`}>
                <div className="cupon-izq">
                  <span className="cupon-emoji" aria-hidden="true">{rw?.emoji}</span>
                  <h3>{rw?.nombre}</h3>
                  <EstadoBadge estado={c.estado} etiqueta={ETIQUETA_CANJE[c.estado]} />
                  <dl className="dl dl-compacta">
                    <dt>Costo</dt>
                    <dd>{c.costo} pts</dd>
                    <dt>Creado</dt>
                    <dd>{fmtFechaHora(c.creadoEn)}</dd>
                    {c.estado === 'pendiente' && (
                      <>
                        <dt>Vence en</dt>
                        <dd>{tiempoRestante(c.venceEn)}</dd>
                      </>
                    )}
                    {c.entregadoEn && (
                      <>
                        <dt>Entregado</dt>
                        <dd>{fmtFechaHora(c.entregadoEn)}</dd>
                      </>
                    )}
                    {c.devuelto && (
                      <>
                        <dt>Devolución</dt>
                        <dd>+{c.costo} pts</dd>
                      </>
                    )}
                  </dl>
                </div>
                <div className="cupon-der">
                  {c.estado === 'pendiente' ? <Qr valor={c.codigo} tamano={116} etiqueta={`QR del canje ${c.codigo}`} /> : <div className="cupon-sello">{ETIQUETA_CANJE[c.estado]}</div>}
                  <span className="codigo-mono">{c.codigo}</span>
                  {c.estado === 'pendiente' && (
                    <button
                      type="button"
                      className="enlace-boton"
                      onClick={() => {
                        if (confirm('¿Cancelar este canje? Se devolverán tus puntos y el stock.')) void ejecutar(() => cancelarCanje(usuario.id, c.id))
                      }}
                    >
                      Cancelar canje
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

// U15 – Notificaciones
export function Notificaciones({ usuario }: { usuario: Usuario }) {
  const { db } = useStore()
  const lista = db.notificaciones.filter((n) => n.usuarioId === usuario.id).sort((a, b) => b.creadoEn - a.creadoEn)
  useEffect(() => {
    const t = setTimeout(() => marcarNotificacionesLeidas(usuario.id), 1200)
    return () => clearTimeout(t)
  }, [usuario.id, lista.length])
  return (
    <div className="pagina pagina-estrecha">
      <Encabezado titulo="Notificaciones" descripcion="Los avisos permanecen aquí aunque no actives las notificaciones push." />
      {lista.length === 0 ? (
        <Vacio titulo="Sin notificaciones" />
      ) : (
        <ul className="notifs">
          {lista.map((n) => (
            <li key={n.id} className={n.leida ? '' : 'no-leida'}>
              <span className="notif-dot" aria-hidden="true" />
              <div>
                <b>{n.titulo}</b>
                <p>{n.mensaje}</p>
                <small>{hace(n.creadoEn)}</small>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// U16 – Perfil
export function Perfil({ usuario }: { usuario: Usuario }) {
  const { db } = useStore()
  const esUsuario = usuario.rol === 'usuario'
  return (
    <div className="pagina pagina-estrecha">
      <Encabezado titulo="Mi perfil" />
      <section className="bloque perfil">
        <span className="avatar avatar-xl" aria-hidden="true">{usuario.nombre.charAt(0)}</span>
        <div>
          <h2>{usuario.nombre}</h2>
          <p className="encabezado-desc">{usuario.correo}</p>
        </div>
      </section>
      <section className="bloque">
        <dl className="dl">
          <dt>Facultad o dependencia</dt>
          <dd>{usuario.facultad}</dd>
          <dt>Rol</dt>
          <dd className="cap">{usuario.rol}</dd>
          <dt>Miembro desde</dt>
          <dd>{fmtFecha(usuario.creadoEn)}</dd>
          <dt>Correo verificado</dt>
          <dd>{usuario.verificado ? 'Sí' : 'No'}</dd>
          {esUsuario && (
            <>
              <dt>Saldo confirmado</dt>
              <dd>{fmtNumero(saldoConfirmado(db, usuario.id))} pts</dd>
            </>
          )}
        </dl>
      </section>
      {esUsuario && <Insignias usuarioId={usuario.id} />}
      <section className="bloque">
        <h2 className="h-bloque">Privacidad</h2>
        <p className="nota">
          Tus fotografías se guardan en almacenamiento privado y solo las ven el recolector asignado y el administrador. Se eliminan a los {db.config.diasRetencionFotos} días.
          Si eliminas tu cuenta, tus datos se anonimizan según la política aprobada.
        </p>
        <a href="#/recuperar">Cambiar contraseña</a>
      </section>
    </div>
  )
}
