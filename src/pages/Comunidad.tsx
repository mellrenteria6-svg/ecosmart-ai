// RF07 EcoRanking, RF22 impacto ambiental e insignias.
import { useState } from 'react'
import { cambiarAnonimatoRanking, useStore } from '../data/store'
import { ETIQUETA_PERIODO, impactoUsuario, insigniasUsuario, rankingFacultades, rankingUniversidades, rankingUsuarios } from '../data/analitica'
import type { Periodo } from '../data/analitica'
import type { Usuario } from '../data/types'
import { Encabezado, Vacio } from '../components/ui'
import { fmtNumero } from '../lib/formato'

function SelectorPeriodo({ valor, onCambio }: { valor: Periodo; onCambio: (p: Periodo) => void }) {
  return (
    <div className="tabs" role="tablist" aria-label="Periodo">
      {(Object.keys(ETIQUETA_PERIODO) as Periodo[]).map((p) => (
        <button key={p} role="tab" aria-selected={valor === p} className={valor === p ? 'activo' : ''} onClick={() => onCambio(p)}>
          {ETIQUETA_PERIODO[p]}
        </button>
      ))}
    </div>
  )
}

export function EcoRanking({ usuario }: { usuario: Usuario }) {
  const { db } = useStore()
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [vista, setVista] = useState<'usuarios' | 'facultades' | 'universidades'>('usuarios')
  const [alcance, setAlcance] = useState<'mia' | 'todas'>('mia')
  const miUni = db.instituciones.find((i) => i.id === usuario.institucionId)
  const filtroInst = alcance === 'mia' ? usuario.institucionId : undefined
  const filas = rankingUsuarios(db, periodo, filtroInst)
  const facultades = rankingFacultades(db, periodo, filtroInst)
  const universidades = rankingUniversidades(db, periodo)
  const maxUni = Math.max(1, ...universidades.map((u) => u.puntos))
  const yo = filas.find((f) => f.usuario.id === usuario.id)
  const podio = filas.slice(0, 3)
  const maxFac = Math.max(1, ...facultades.map((f) => f.puntos))

  return (
    <div className="pagina">
      <Encabezado
        titulo="EcoRanking"
        descripcion="Solo cuentan los EcoPoints ganados por reciclajes validados. Empate: gana quien tiene más reciclajes y, después, quien llegó primero al puntaje."
      />
      <div className="ranking-controles">
        <SelectorPeriodo valor={periodo} onCambio={setPeriodo} />
        <div className="tabs" role="tablist" aria-label="Vista">
          <button role="tab" aria-selected={vista === 'usuarios'} className={vista === 'usuarios' ? 'activo' : ''} onClick={() => setVista('usuarios')}>Personas</button>
          <button role="tab" aria-selected={vista === 'facultades'} className={vista === 'facultades' ? 'activo' : ''} onClick={() => setVista('facultades')}>Facultades</button>
          <button role="tab" aria-selected={vista === 'universidades'} className={vista === 'universidades' ? 'activo' : ''} onClick={() => setVista('universidades')}>Universidades</button>
        </div>
        {vista !== 'universidades' && (
          <div className="tabs" role="tablist" aria-label="Alcance">
            <button role="tab" aria-selected={alcance === 'mia'} className={alcance === 'mia' ? 'activo' : ''} onClick={() => setAlcance('mia')}>{miUni?.siglas ?? 'Mi universidad'}</button>
            <button role="tab" aria-selected={alcance === 'todas'} className={alcance === 'todas' ? 'activo' : ''} onClick={() => setAlcance('todas')}>Todas</button>
          </div>
        )}
      </div>

      <section className="mi-puesto">
        <div>
          <small>Tu puesto · {ETIQUETA_PERIODO[periodo]}</small>
          <b>{yo ? `#${yo.posicion}` : '—'}</b>
          <span>{yo ? `${fmtNumero(yo.puntos)} pts en ${yo.reciclajes} reciclajes` : 'Recicla para entrar al ranking'}</span>
        </div>
        <label className="interruptor">
          <input type="checkbox" checked={!!usuario.rankingAnonimo} onChange={(e) => cambiarAnonimatoRanking(usuario.id, e.target.checked)} />
          <span className="interruptor-pista" aria-hidden="true" />
          <span>Aparecer como anónimo</span>
        </label>
      </section>

      {vista === 'universidades' ? (
        universidades.length === 0 ? (
          <Vacio titulo="Sin datos en este periodo" />
        ) : (
          <ul className="barras bloque">
            {universidades.map((u, i) => (
              <li key={u.institucion.id}>
                <span className="barras-et">
                  <b>{i + 1}.</b> {u.institucion.siglas}
                  {u.institucion.id === usuario.institucionId && ' (tú)'}
                </span>
                <span className="barras-pista">
                  <span style={{ width: `${(u.puntos / maxUni) * 100}%`, background: u.institucion.id === usuario.institucionId ? 'var(--accent)' : 'var(--moss)' }} />
                </span>
                <span className="barras-val">
                  {fmtNumero(u.puntos)} pts <small>· {u.participantes} participantes</small>
                </span>
              </li>
            ))}
          </ul>
        )
      ) : vista === 'usuarios' ? (
        filas.length === 0 ? (
          <Vacio titulo="Aún no hay reciclajes validados en este periodo" />
        ) : (
          <>
            <div className="podio">
              {[podio[1], podio[0], podio[2]].map((f, i) =>
                f ? (
                  <div key={f.usuario.id} className={`podio-col podio-${f.posicion} ${f.usuario.id === usuario.id ? 'soy-yo' : ''}`}>
                    <span className="podio-avatar" aria-hidden="true">{f.usuario.rankingAnonimo ? '?' : f.usuario.nombre.charAt(0)}</span>
                    <b>{f.nombrePublico}</b>
                    <small>{fmtNumero(f.puntos)} pts</small>
                    <div className="podio-base">{f.posicion}</div>
                  </div>
                ) : (
                  <div key={i} className="podio-col podio-vacio" />
                ),
              )}
            </div>
            <ol className="ranking-lista">
              {filas.map((f) => (
                <li key={f.usuario.id} className={f.usuario.id === usuario.id ? 'soy-yo' : ''}>
                  <span className="rk-pos">{f.posicion}</span>
                  <div className="rk-info">
                    <b>
                      {f.nombrePublico}
                      {f.usuario.id === usuario.id && <span className="badge badge-ok">Tú</span>}
                    </b>
                    <small>
                      {f.usuario.rankingAnonimo ? 'Facultad oculta' : f.usuario.facultad}
                      {alcance === 'todas' && ` · ${db.instituciones.find((i) => i.id === f.usuario.institucionId)?.siglas ?? ''}`} · {f.reciclajes} reciclajes
                    </small>
                  </div>
                  <span className="rk-pts">{fmtNumero(f.puntos)}</span>
                </li>
              ))}
            </ol>
          </>
        )
      ) : facultades.length === 0 ? (
        <Vacio titulo="Sin datos en este periodo" />
      ) : (
        <ul className="barras bloque">
          {facultades.map((f, i) => (
            <li key={f.facultad}>
              <span className="barras-et">
                <b>{i + 1}.</b> {f.facultad}
              </span>
              <span className="barras-pista">
                <span style={{ width: `${(f.puntos / maxFac) * 100}%`, background: i === 0 ? 'var(--accent)' : 'var(--moss)' }} />
              </span>
              <span className="barras-val">
                {fmtNumero(f.puntos)} pts <small>· {f.participantes} participantes</small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const equivalencias = (co2: number, agua: number, energia: number) => [
  { icono: '🚗', texto: `${fmtNumero(Math.round((co2 / 0.17) * 10) / 10)} km sin auto` },
  { icono: '🚿', texto: `${fmtNumero(Math.round(agua / 9))} min de ducha` },
  { icono: '💡', texto: `${fmtNumero(Math.round(energia / 0.01))} h de foco LED` },
]

export function Impacto({ usuario }: { usuario: Usuario }) {
  const { db } = useStore()
  const [periodo, setPeriodo] = useState<Periodo>('siempre')
  const imp = impactoUsuario(db, usuario.id, periodo)
  const r1 = (n: number) => fmtNumero(Math.round(n * 10) / 10)

  return (
    <div className="pagina">
      <Encabezado titulo="Mi impacto ambiental" descripcion={<>Calculado con tus reciclajes validados y los factores de conversión versión <span className="mono">{imp.version}</span>.</>} />
      <SelectorPeriodo valor={periodo} onCambio={setPeriodo} />
      <div className="impacto-grid">
        <div className="impacto-card impacto-co2">
          <small>CO₂ evitado</small>
          <b>{r1(imp.total.co2Kg)}</b>
          <span>kg · {ETIQUETA_PERIODO[periodo].toLowerCase()}</span>
        </div>
        <div className="impacto-card impacto-agua">
          <small>Agua ahorrada</small>
          <b>{r1(imp.total.aguaL)}</b>
          <span>litros · {ETIQUETA_PERIODO[periodo].toLowerCase()}</span>
        </div>
        <div className="impacto-card impacto-energia">
          <small>Energía ahorrada</small>
          <b>{r1(imp.total.energiaKwh)}</b>
          <span>kWh · {ETIQUETA_PERIODO[periodo].toLowerCase()}</span>
        </div>
      </div>
      {imp.porCategoria.length === 0 ? (
        <Vacio titulo="Aún no hay reciclajes validados en este periodo" />
      ) : (
        <>
          <div className="equivalencias">
            <span>Es como…</span>
            {equivalencias(imp.total.co2Kg, imp.total.aguaL, imp.total.energiaKwh).map((e) => (
              <span key={e.texto} className="equiv">
                <i aria-hidden="true">{e.icono}</i> {e.texto}
              </span>
            ))}
          </div>
          <div className="tabla-envoltura" tabIndex={0} role="region" aria-label="Tabla (desplázala con las flechas si no cabe)">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Categoría</th>
                  <th className="num">Cantidad</th>
                  <th className="num">CO₂ (kg)</th>
                  <th className="num">Agua (L)</th>
                  <th className="num">Energía (kWh)</th>
                </tr>
              </thead>
              <tbody>
                {imp.porCategoria.map((c) => (
                  <tr key={c.categoriaId}>
                    <td>
                      <span className="chip-cat"><i style={{ background: c.color }} />{c.nombre}</span>
                    </td>
                    <td className="num">{fmtNumero(c.cantidad)} {c.unidad}</td>
                    <td className="num">{r1(c.co2Kg)}</td>
                    <td className="num">{r1(c.aguaL)}</td>
                    <td className="num">{r1(c.energiaKwh)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="nota">Los factores son estimaciones referenciales por unidad de cada categoría y se versionan cuando cambian.</p>
    </div>
  )
}

export function Insignias({ usuarioId, compacto = false }: { usuarioId: string; compacto?: boolean }) {
  const { db } = useStore()
  const lista = insigniasUsuario(db, usuarioId)
  const obtenidas = lista.filter((i) => i.obtenida).length
  return (
    <section className="bloque">
      <div className="bloque-cab">
        <h2>Insignias</h2>
        <small>
          {obtenidas} de {lista.length} obtenidas
        </small>
      </div>
      <ul className={`insignias ${compacto ? 'insignias-compactas' : ''}`}>
        {lista.map((i) => (
          <li key={i.id} className={i.obtenida ? 'obtenida' : ''} title={i.descripcion}>
            <span className="insignia-icono" aria-hidden="true">{i.icono}</span>
            <b>{i.nombre}</b>
            {!compacto && <small>{i.descripcion}</small>}
            <span className="insignia-prog">{i.obtenida ? 'Obtenida' : i.progreso}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
