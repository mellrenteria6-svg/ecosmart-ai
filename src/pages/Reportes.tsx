// Módulo de reportes: 8 reportes con filtros, vista previa y exportación a CSV y PDF.
import { useEffect, useMemo, useState } from 'react'
import { hoyIso, useStore } from '../data/store'
import { REPORTES, ZONA_HORARIA, aCsv } from '../data/reportes'
import type { Filtros } from '../data/reportes'
import type { Usuario } from '../data/types'
import { Campo, Encabezado, Vacio } from '../components/ui'
import { fmtFecha, fmtFechaHora } from '../lib/formato'

function haceDias(n: number) {
  const d = new Date(Date.now() - n * 86_400_000)
  const z = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}

export function Reportes({ usuario, reporteId }: { usuario: Usuario; reporteId?: string }) {
  const { db } = useStore()
  const def = REPORTES.find((r) => r.id === reporteId) ?? REPORTES[0]
  const [filtros, setFiltros] = useState<Filtros>({ desde: haceDias(30), hasta: hoyIso(), puntoId: 'todos', categoriaId: 'todas' })
  const res = useMemo(() => def.generar(db, filtros), [db, def, filtros])
  const rangoInvalido = filtros.desde > filtros.hasta

  const descFiltros = [
    `${fmtFecha(filtros.desde)} – ${fmtFecha(filtros.hasta)}`,
    def.usaPunto ? `Punto: ${filtros.puntoId === 'todos' ? 'todos' : db.puntos.find((p) => p.id === filtros.puntoId)?.nombre}` : null,
    def.usaCategoria ? `Categoría: ${filtros.categoriaId === 'todas' ? 'todas' : db.categorias.find((c) => c.id === filtros.categoriaId)?.nombre}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  useEffect(() => {
    const limpiar = () => document.body.classList.remove('modo-reporte')
    window.addEventListener('afterprint', limpiar)
    return () => window.removeEventListener('afterprint', limpiar)
  }, [])

  function exportarPdf() {
    // El navegador permite "Guardar como PDF" en el diálogo de impresión
    document.body.classList.add('modo-reporte')
    window.print()
  }

  return (
    <div className="pagina">
      <Encabezado titulo="Reportes" descripcion="Ocho reportes conciliables con los registros de origen. Exporta a CSV (Excel) o PDF respetando los filtros." />
      <div className="reportes-layout">
        <nav className="reportes-menu no-imprimir" aria-label="Lista de reportes">
          {REPORTES.map((r) => (
            <a key={r.id} href={`#/admin/reportes/${r.id}`} className={r.id === def.id ? 'activo' : ''} aria-current={r.id === def.id ? 'page' : undefined}>
              <span className="rep-num">{String(r.numero).padStart(2, '0')}</span>
              <span>
                <b>{r.titulo}</b>
                <small>{r.descripcion}</small>
              </span>
            </a>
          ))}
        </nav>

        <section className="reporte-hoja" aria-live="polite">
          <header className="reporte-cab">
            <div>
              <p className="kicker">Reporte {String(def.numero).padStart(2, '0')} de {REPORTES.length}</p>
              <h2>{def.titulo}</h2>
              <p className="nota">{def.descripcion}</p>
            </div>
            <div className="reporte-acciones no-imprimir">
              <button type="button" className="btn btn-linea btn-sm" disabled={rangoInvalido} onClick={() => aCsv(def, res, filtros, descFiltros)}>
                ⇣ CSV
              </button>
              <button type="button" className="btn btn-tinta btn-sm" disabled={rangoInvalido} onClick={exportarPdf}>
                ⇣ PDF
              </button>
            </div>
          </header>

          <div className="reporte-filtros no-imprimir">
            <Campo etiqueta="Desde">{(id) => <input id={id} type="date" className="input" value={filtros.desde} max={filtros.hasta} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} />}</Campo>
            <Campo etiqueta="Hasta">{(id) => <input id={id} type="date" className="input" value={filtros.hasta} onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} />}</Campo>
            {def.usaPunto && (
              <Campo etiqueta="Punto">
                {(id) => (
                  <select id={id} className="input" value={filtros.puntoId} onChange={(e) => setFiltros({ ...filtros, puntoId: e.target.value })}>
                    <option value="todos">Todos</option>
                    {db.puntos.map((p) => (
                      <option key={p.id} value={p.id}>{p.nombre}</option>
                    ))}
                  </select>
                )}
              </Campo>
            )}
            {def.usaCategoria && (
              <Campo etiqueta="Categoría">
                {(id) => (
                  <select id={id} className="input" value={filtros.categoriaId} onChange={(e) => setFiltros({ ...filtros, categoriaId: e.target.value })}>
                    <option value="todas">Todas</option>
                    {db.categorias.map((c) => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                  </select>
                )}
              </Campo>
            )}
            <div className="atajos">
              {[
                ['7 días', 7],
                ['30 días', 30],
                ['90 días', 90],
              ].map(([t, n]) => (
                <button key={t} type="button" className="filtro" onClick={() => setFiltros({ ...filtros, desde: haceDias(n as number), hasta: hoyIso() })}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <p className="reporte-meta">
            {descFiltros} · Generado {fmtFechaHora(Date.now())} ({ZONA_HORARIA}) por {usuario.nombre}
          </p>

          {rangoInvalido ? (
            <Vacio titulo="La fecha inicial es posterior a la final" />
          ) : (
            <>
              <dl className="reporte-resumen">
                {res.resumen.map((r) => (
                  <div key={r.etiqueta}>
                    <dt>{r.etiqueta}</dt>
                    <dd>{r.valor}</dd>
                  </div>
                ))}
              </dl>
              {res.filas.length === 0 ? (
                <Vacio titulo="Sin datos para estos filtros">Prueba con un rango de fechas más amplio.</Vacio>
              ) : (
                <div className="tabla-envoltura">
                  <table className="tabla tabla-reporte">
                    <thead>
                      <tr>
                        {res.columnas.map((c) => (
                          <th key={c.clave} className={c.num ? 'num' : ''}>{c.titulo}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {res.filas.map((f, i) => (
                        <tr key={i}>
                          {res.columnas.map((c) => (
                            <td key={c.clave} className={c.num ? 'num' : ''}>{f[c.clave]}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    {res.totales && (
                      <tfoot>
                        <tr>
                          {res.columnas.map((c) => (
                            <td key={c.clave} className={c.num ? 'num' : ''}>{res.totales![c.clave] ?? ''}</td>
                          ))}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
              <p className="nota">{res.filas.length} filas</p>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
