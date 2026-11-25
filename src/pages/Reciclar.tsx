// U04–U07: escanear punto → foto → clasificación IA → confirmación. Incluye la cola sin conexión (RF30).
import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import {
  descartarDeCola,
  encolar,
  nuevaClaveIdempotencia,
  puntoPorCodigo,
  registrarReciclaje,
  registrosHoy,
  reintentarElemento,
  useStore,
} from '../data/store'
import type { PuntoReciclaje, Reciclaje, Usuario } from '../data/types'
import { Alerta, Campo, EstadoBadge, useAccion } from '../components/ui'
import { ChipCategoria } from '../components/Visual'
import { FotoInvalida, UMBRAL_NITIDEZ, canvasDesdeFuente, procesarCanvas } from '../lib/imagen'
import type { FotoProcesada } from '../lib/imagen'
import { clasificar, explicarErrorIa, precargarIa, reintentarIa, useEstadoIa } from '../lib/ia'
import type { ResultadoIa } from '../lib/ia'
import { ETIQUETA_COLA, fmtPct, hace } from '../lib/formato'
import { navegar, useRuta } from '../lib/router'

type Paso = 'punto' | 'foto' | 'ia' | 'listo'

const PASOS: { id: Paso; texto: string }[] = [
  { id: 'punto', texto: 'Punto' },
  { id: 'foto', texto: 'Foto' },
  { id: 'ia', texto: 'Clasificación' },
  { id: 'listo', texto: 'Listo' },
]

function extraerCodigo(texto: string) {
  const m = texto.match(/codigo=([^&]+)/)
  return decodeURIComponent(m ? m[1] : texto).trim().toUpperCase()
}

function useCamara(activa: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [lista, setLista] = useState(false)
  useEffect(() => {
    if (!activa) return
    let stream: MediaStream | null = null
    let cancelado = false
    setError(null)
    setLista(false)
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Este navegador no permite usar la cámara.')
      return
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (cancelado) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        // Enfoque y exposición automáticos continuos donde la cámara lo permita
        const pista = s.getVideoTracks()[0]
        const capacidades = (pista.getCapabilities?.() ?? {}) as Record<string, unknown>
        const avanzado: Record<string, string>[] = []
        if (Array.isArray(capacidades.focusMode) && capacidades.focusMode.includes('continuous')) avanzado.push({ focusMode: 'continuous' })
        if (Array.isArray(capacidades.exposureMode) && capacidades.exposureMode.includes('continuous')) avanzado.push({ exposureMode: 'continuous' })
        if (avanzado.length) void pista.applyConstraints({ advanced: avanzado as MediaTrackConstraintSet[] }).catch(() => {})
        if (videoRef.current) {
          videoRef.current.srcObject = s
          void videoRef.current.play().then(() => setLista(true))
        }
      })
      .catch(() => setError('No pudimos acceder a la cámara. Revisa los permisos del navegador.'))
    return () => {
      cancelado = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [activa])
  return { videoRef, error, lista }
}

export function Reciclar({ usuario }: { usuario: Usuario }) {
  const s = useStore()
  const ruta = useRuta()
  const codigoInicial = ruta.query.get('codigo') ?? ''
  const [paso, setPaso] = useState<Paso>('punto')
  const [punto, setPunto] = useState<PuntoReciclaje | null>(null)
  const [foto, setFoto] = useState<FotoProcesada | null>(null)
  const [ia, setIa] = useState<ResultadoIa | null>(null)
  const [resultado, setResultado] = useState<{ reciclaje?: Reciclaje; enCola?: boolean } | null>(null)
  const hoy = registrosHoy(s.db, usuario.id)
  const topeAlcanzado = hoy >= s.db.config.topeDiario
  const estadoIa = useEstadoIa()
  const [verErrorIa, setVerErrorIa] = useState(false)
  useEffect(() => precargarIa(), [])

  const reiniciar = () => {
    setPaso('punto')
    setPunto(null)
    setFoto(null)
    setIa(null)
    setResultado(null)
    navegar('/app/reciclar')
  }

  const indice = PASOS.findIndex((p) => p.id === paso)

  return (
    <div className="pagina pagina-estrecha">
      <div className="reciclar-cab">
        <div>
          <p className="kicker">Nuevo reciclaje</p>
          <h1 className="h-pagina">{['¿Dónde estás reciclando?', 'Fotografía el residuo', 'Revisa la clasificación', '¡Registro enviado!'][indice]}</h1>
        </div>
        <div className="reciclar-chips">
          {estadoIa.fase === 'error' ? (
            <button type="button" className="chip-ia chip-ia-error" aria-expanded={verErrorIa} onClick={() => setVerErrorIa((v) => !v)}>
              IA sin conexión · ver por qué
            </button>
          ) : (
            <span className={`chip-ia chip-ia-${estadoIa.fase}`} title="Estado del modelo de IA en este dispositivo">
              {estadoIa.fase === 'listo' ? 'IA lista' : estadoIa.fase === 'cargando' ? `Descargando IA ${estadoIa.progreso} %` : 'IA'}
            </span>
          )}
          <span className="contador-dia" title="Registros de hoy / tope diario">
            {hoy}/{s.db.config.topeDiario} hoy
          </span>
        </div>
      </div>
      {estadoIa.fase === 'error' && verErrorIa && (
        <Alerta tono="warn">
          {explicarErrorIa(estadoIa.mensaje)} Mientras tanto puedes registrar igual: se usa una estimación por color y el registro pasa a revisión.
          <small className="error-tecnico">Detalle: {estadoIa.mensaje}</small>
          <button type="button" className="btn btn-tinta btn-sm" onClick={() => { setVerErrorIa(false); reintentarIa() }}>Reintentar</button>
        </Alerta>
      )}
      <ol className="stepper" aria-label="Progreso">
        {PASOS.map((p, i) => (
          <li key={p.id} className={i < indice ? 'hecho' : i === indice ? 'actual' : ''} aria-current={i === indice ? 'step' : undefined}>
            <span>{i < indice ? '✓' : i + 1}</span>
            {p.texto}
          </li>
        ))}
      </ol>

      {topeAlcanzado && paso !== 'listo' && (
        <Alerta tono="warn" titulo="Tope diario alcanzado">
          Ya registraste {s.db.config.topeDiario} reciclajes hoy. Podrás registrar más mañana.
        </Alerta>
      )}

      {paso === 'punto' && (
        <PasoPunto
          codigoInicial={codigoInicial}
          onPunto={(p) => {
            setPunto(p)
            setPaso('foto')
          }}
        />
      )}
      {paso === 'foto' && punto && (
        <PasoFoto
          punto={punto}
          onFoto={(f) => {
            setFoto(f)
            setPaso('ia')
          }}
          onVolver={reiniciar}
        />
      )}
      {paso === 'ia' && punto && foto && (
        <PasoIa
          usuario={usuario}
          punto={punto}
          foto={foto}
          ia={ia}
          setIa={setIa}
          onRetomar={() => {
            setFoto(null)
            setIa(null)
            setPaso('foto')
          }}
          onListo={(r) => {
            setResultado(r)
            setPaso('listo')
          }}
        />
      )}
      {paso === 'listo' && resultado && <PasoListo resultado={resultado} punto={punto!} onOtro={reiniciar} />}
    </div>
  )
}

function PasoPunto({ codigoInicial, onPunto }: { codigoInicial: string; onPunto: (p: PuntoReciclaje) => void }) {
  const [codigo, setCodigo] = useState(codigoInicial)
  const [escaneando, setEscaneando] = useState(false)
  const { error, setError, ejecutar } = useAccion()
  const { videoRef, error: errorCam, lista } = useCamara(escaneando)
  const intentado = useRef(false)

  const validar = (valor: string) => {
    void ejecutar(() => {
      const p = puntoPorCodigo(extraerCodigo(valor))
      onPunto(p)
    })
  }

  // QR escaneado con la cámara del teléfono: el enlace ya trae el código
  useEffect(() => {
    if (codigoInicial && !intentado.current) {
      intentado.current = true
      validar(codigoInicial)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigoInicial])

  useEffect(() => {
    if (!escaneando || !lista) return
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    let raf = 0
    const leer = () => {
      const v = videoRef.current
      if (v && v.videoWidth) {
        canvas.width = 480
        canvas.height = Math.round((480 * v.videoHeight) / v.videoWidth)
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const qr = jsQR(img.data, img.width, img.height)
        if (qr?.data) {
          setEscaneando(false)
          setCodigo(extraerCodigo(qr.data))
          validar(qr.data)
          return
        }
      }
      raf = requestAnimationFrame(leer)
    }
    raf = requestAnimationFrame(leer)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escaneando, lista])


  return (
    <div className="paso-cuerpo">
      <div className={`visor ${escaneando ? 'visor-activo' : ''}`}>
        {escaneando ? (
          <>
            <video ref={videoRef} playsInline muted className="visor-video" aria-label="Vista de la cámara para escanear el QR" />
            <span className="esq esq-1" />
            <span className="esq esq-2" />
            <span className="esq esq-3" />
            <span className="esq esq-4" />
            <span className="linea-escaneo" />
            {errorCam && <p className="visor-error">{errorCam}</p>}
          </>
        ) : (
          <button type="button" className="visor-iniciar" onClick={() => { setError(null); setEscaneando(true) }}>
            <svg viewBox="0 0 48 48" aria-hidden="true">
              <path d="M6 16V8a2 2 0 0 1 2-2h8M32 6h8a2 2 0 0 1 2 2v8M42 32v8a2 2 0 0 1-2 2h-8M16 42H8a2 2 0 0 1-2-2v-8" />
              <rect x="15" y="15" width="18" height="18" rx="2" />
            </svg>
            <b>Escanear QR del punto</b>
            <small>Usa la cámara de tu dispositivo</small>
          </button>
        )}
      </div>
      {escaneando && (
        <button type="button" className="btn btn-fantasma btn-bloque" onClick={() => setEscaneando(false)}>
          Detener cámara
        </button>
      )}

      <div className="separador"><span>o ingresa el código impreso</span></div>

      <form
        className="form form-linea"
        onSubmit={(e) => {
          e.preventDefault()
          validar(codigo)
        }}
      >
        <Campo etiqueta="Código del punto" ayuda="Aparece debajo del QR, por ejemplo ECO-BIB-01.">
          {(id, d) => <input id={id} aria-describedby={d} className="input input-mono" value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} placeholder="ECO-XXX-00" autoCapitalize="characters" />}
        </Campo>
        <button className="btn btn-tinta">Continuar</button>
      </form>
      {error && <Alerta tono="error">{error}</Alerta>}

    </div>
  )
}

function PasoFoto({ punto, onFoto, onVolver }: { punto: PuntoReciclaje; onFoto: (f: FotoProcesada) => void; onVolver: () => void }) {
  const { db } = useStore()
  const { videoRef, error: errorCam, lista } = useCamara(true)
  const [error, setError] = useState<string | null>(null)

  function usarCanvas(canvas: HTMLCanvasElement) {
    try {
      setError(null)
      onFoto(procesarCanvas(canvas))
    } catch (e) {
      setError(e instanceof FotoInvalida ? e.message : 'No se pudo procesar la foto.')
    }
  }

  function capturar() {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    usarCanvas(canvasDesdeFuente(v, v.videoWidth, v.videoHeight))
  }

  return (
    <div className="paso-cuerpo">
      <div className="punto-elegido">
        <div>
          <small>Punto</small>
          <b>{punto.nombre}</b>
        </div>
        <button type="button" className="enlace-boton" onClick={onVolver}>Cambiar</button>
      </div>
      <div className="chips">
        {punto.categorias.map((id) => {
          const c = db.categorias.find((x) => x.id === id)!
          return <ChipCategoria key={id} nombre={c.nombre} color={c.color} titulo={c.descripcion} />
        })}
      </div>

      <div className="visor visor-activo visor-foto">
        <video ref={videoRef} playsInline muted className="visor-video" aria-label="Vista previa de la cámara" />
        <span className="esq esq-1" />
        <span className="esq esq-2" />
        <span className="esq esq-3" />
        <span className="esq esq-4" />
        {(errorCam || !lista) && <p className="visor-error">{errorCam ?? 'Activando cámara…'}</p>}
      </div>
      <button type="button" className="btn-disparador" onClick={capturar} disabled={!lista} aria-label="Tomar foto">
        <span />
      </button>
      <p className="nota nota-centro">En la Fase 1 solo se aceptan fotos tomadas en este momento: la galería está deshabilitada.</p>
      {error && <Alerta tono="error">{error}</Alerta>}

      {errorCam && <p className="nota nota-centro">Para reciclar hace falta una cámara: prueba desde tu celular.</p>}
    </div>
  )
}

function PasoIa({
  usuario,
  punto,
  foto,
  ia,
  setIa,
  onRetomar,
  onListo,
}: {
  usuario: Usuario
  punto: PuntoReciclaje
  foto: FotoProcesada
  ia: ResultadoIa | null
  setIa: (r: ResultadoIa) => void
  onRetomar: () => void
  onListo: (r: { reciclaje?: Reciclaje; enCola?: boolean }) => void
}) {
  const s = useStore()
  const { db } = s
  const [categoria, setCategoria] = useState<string>('')
  const [cantidad, setCantidad] = useState(1)
  const [clave] = useState(nuevaClaveIdempotencia) // misma clave en cada reintento
  const { error, cargando, ejecutar } = useAccion()
  const aceptadas = db.categorias.filter((c) => c.activa && punto.categorias.includes(c.id))

  useEffect(() => {
    if (ia) return
    let vivo = true
    void clasificar(foto, db.categorias).then((r) => {
      if (!vivo) return
      console.info(`[IA] ${r.version}: clasificación en ${r.ms} ms`)
      setIa(r)
    })
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foto])

  useEffect(() => {
    if (ia && !categoria) {
      // Si el punto no acepta lo que vio la IA, se preselecciona la mejor opción que sí acepta
      const candidatos = [ia.categoriaId, ...ia.alternativas.map((a) => a.categoriaId)]
      const elegida = candidatos.find((id) => punto.categorias.includes(id)) ?? punto.categorias[0]
      setCategoria(elegida)
      const c = db.categorias.find((x) => x.id === elegida)
      if (c) setCantidad(c.minimo)
    }
  }, [ia, categoria, db.categorias, punto.categorias])

  const cat = db.categorias.find((c) => c.id === categoria)
  const corregido = ia && categoria !== ia.categoriaId
  const baja = ia && ia.confianza < db.config.umbralConfianza
  const fueraDelPunto = ia && !punto.categorias.includes(ia.categoriaId)
  const borrosa = foto.nitidez < UMBRAL_NITIDEZ
  const estadoIa = useEstadoIa()
  const estimado = cat ? Math.round(cantidad * cat.puntosPorUnidad) : 0

  async function enviar() {
    if (!ia || !cat) return
    const datos = {
      idempotencyKey: clave,
      usuarioId: usuario.id,
      codigoPunto: punto.codigoQr,
      categoriaId: cat.id,
      categoriaIa: ia.categoriaId,
      confianzaIa: ia.confianza,
      modeloVersion: ia.version,
      cantidad,
      foto: foto.dataUrl,
      fotoHash: foto.hash,
    }
    if (!s.online) {
      encolar({ ...datos, creadoEn: Date.now(), estado: 'en_cola' })
      onListo({ enCola: true })
      return
    }
    const r = await ejecutar(() => registrarReciclaje(datos))
    if (r) onListo({ reciclaje: r.reciclaje })
  }

  return (
    <div className="paso-cuerpo">
      <div className="ia-grid">
        <div className="ia-foto">
          <img src={foto.dataUrl} alt="Foto capturada del residuo" />
          {!ia && (
            <div className="ia-analizando" role="status">
              <span className="linea-escaneo" />
              <b>{estadoIa.fase === 'cargando' ? `Descargando modelo de IA… ${estadoIa.progreso} %` : 'Analizando imagen…'}</b>
              {estadoIa.fase === 'cargando' && <small>Solo la primera vez (≈ 90 MB). Luego queda guardado en el dispositivo.</small>}
            </div>
          )}
          <button type="button" className="btn btn-fantasma btn-sm ia-retomar" onClick={onRetomar}>Tomar otra</button>
        </div>

        {ia ? (
          <div className="ia-resultado">
            <p className="kicker">Resultado de la IA</p>
            <h2 className="ia-cat">{db.categorias.find((c) => c.id === ia.categoriaId)?.nombre}</h2>
            <div className="ia-confianza">
              <div className="medidor" style={{ ['--v' as string]: ia.confianza }}>
                <span>{fmtPct(ia.confianza)}</span>
              </div>
              <div>
                <small>Confianza</small>
                <p className={baja ? 'txt-warn' : 'txt-ok'}>{baja ? `Menor al umbral de ${fmtPct(db.config.umbralConfianza)}` : 'Clasificación confiable'}</p>
                <small className="mono">Modelo {ia.version}</small>
              </div>
            </div>
            {ia.respaldo && <Alerta tono="warn">No se pudo cargar el modelo de IA (¿sin conexión?). Se usó una estimación por color, poco precisa: el registro irá a revisión.</Alerta>}
            {ia.noReconocido && <Alerta tono="warn">No parece un residuo reciclable o está muy lejos. Acércate al objeto, con buena luz y fondo despejado.</Alerta>}
            {fueraDelPunto && <Alerta tono="warn">Este punto no recibe {db.categorias.find((c) => c.id === ia.categoriaId)?.nombre}. Llévalo a otro punto o corrige la categoría si la IA se equivocó.</Alerta>}
            {borrosa && <Alerta tono="warn">La foto salió algo borrosa. Si puedes, sostén el dispositivo firme y toma otra.</Alerta>}
            {ia.alternativas.length > 0 && (
              <p className="nota">
                Otras opciones: {ia.alternativas.map((a) => `${db.categorias.find((c) => c.id === a.categoriaId)?.nombre} (${fmtPct(a.confianza)})`).join(', ')}
              </p>
            )}
          </div>
        ) : (
          <div className="ia-resultado ia-esqueleto" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

      {ia && cat && (
        <div className="bloque form">
          <fieldset className="fieldset">
            <legend>¿Es correcta la categoría?</legend>
            <div className="opciones-cat">
              {aceptadas.map((c) => (
                <label key={c.id} className={`opcion-cat ${categoria === c.id ? 'sel' : ''}`}>
                  <input
                    type="radio"
                    name="categoria"
                    value={c.id}
                    checked={categoria === c.id}
                    onChange={() => {
                      setCategoria(c.id)
                      setCantidad(c.minimo)
                    }}
                  />
                  <i style={{ background: c.color }} />
                  {c.nombre}
                  {c.id === ia.categoriaId && <small>IA</small>}
                </label>
              ))}
            </div>
          </fieldset>

          {cat.descripcion && (
            <p className="nota incluye">
              <b>{cat.nombre}</b> incluye: {cat.descripcion}.
            </p>
          )}

          <Campo etiqueta={`Cantidad (${cat.unidad})`} ayuda={`Entre ${cat.minimo} y ${cat.maximo} ${cat.unidad} · ${cat.puntosPorUnidad} pts por ${cat.unidad}`}>
            {(id, d) => (
              <div className="contador">
                <button type="button" className="btn-icono" aria-label="Disminuir" onClick={() => setCantidad((n) => Math.max(cat.minimo, +(n - (cat.unidad === 'kg' ? 0.5 : 1)).toFixed(1)))}>−</button>
                <input id={id} aria-describedby={d} className="input input-num" type="number" step={cat.unidad === 'kg' ? 0.5 : 1} min={cat.minimo} max={cat.maximo} value={cantidad} onChange={(e) => setCantidad(Number(e.target.value))} />
                <button type="button" className="btn-icono" aria-label="Aumentar" onClick={() => setCantidad((n) => Math.min(cat.maximo, +(n + (cat.unidad === 'kg' ? 0.5 : 1)).toFixed(1)))}>+</button>
              </div>
            )}
          </Campo>

          {(corregido || baja) && (
            <Alerta tono="warn" titulo="Este registro irá a revisión individual">
              {corregido ? 'Cambiaste la categoría propuesta por la IA. ' : ''}
              {baja ? 'La confianza de la IA es baja. ' : ''}El recolector lo revisará con la foto antes de acreditar los puntos.
            </Alerta>
          )}

          <div className="resumen-envio">
            <div>
              <small>Puntos estimados</small>
              <b>≈ {estimado} pts</b>
              <small>Se suman cuando el recolector valide</small>
            </div>
            <button type="button" className="btn btn-acento btn-lg" onClick={enviar} disabled={cargando}>
              {s.online ? 'Registrar reciclaje' : 'Guardar sin conexión'}
            </button>
          </div>
          {error && (
            <Alerta tono="error">
              {error}
            </Alerta>
          )}
        </div>
      )}
    </div>
  )
}

function PasoListo({ resultado, punto, onOtro }: { resultado: { reciclaje?: Reciclaje; enCola?: boolean }; punto: PuntoReciclaje; onOtro: () => void }) {
  const r = resultado.reciclaje
  return (
    <div className="paso-cuerpo listo">
      <div className="listo-sello" aria-hidden="true">
        <svg viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="36" />
          <path d="m24 41 11 11 22-24" />
        </svg>
      </div>
      {resultado.enCola ? (
        <>
          <h2>Guardado en tu dispositivo</h2>
          <p>Estás sin conexión. El registro quedó en la cola local y se enviará automáticamente cuando vuelvas a estar en línea; el servidor volverá a validar las reglas.</p>
        </>
      ) : r ? (
        <>
          <h2>{r.estado === 'en_revision' ? 'Registro enviado a revisión' : 'Registro pendiente de validación'}</h2>
          <p>
            Dejaste {r.cantidadReportada} {r.unidad} en {punto.nombre}. Recibirás ≈ <b>{r.puntosEstimados} EcoPoints</b> cuando el recolector valide el lote.
          </p>
          <EstadoBadge estado={r.estado} etiqueta={r.estado === 'en_revision' ? 'En revisión' : 'Pendiente'} />
        </>
      ) : null}
      <div className="listo-acciones">
        <button type="button" className="btn btn-tinta" onClick={onOtro}>Registrar otro</button>
        <a className="btn btn-linea" href="#/app">Ir al inicio</a>
      </div>
    </div>
  )
}

export function ColaOffline({ usuarioId }: { usuarioId: string }) {
  const s = useStore()
  const items = s.cola.filter((c) => c.usuarioId === usuarioId)
  if (!items.length) return null
  return (
    <section className="bloque cola">
      <div className="bloque-cab">
        <h2>Registros guardados sin conexión</h2>
        <small>{s.online ? 'Sincronizando con el servidor…' : 'Se enviarán al recuperar la conexión'}</small>
      </div>
      <ul className="lista-reciclajes">
        {items.map((c) => {
          const cat = s.db.categorias.find((x) => x.id === c.categoriaId)
          return (
            <li key={c.idempotencyKey} className="fila-reciclaje">
              <img src={c.foto} alt="" className="miniatura" />
              <div className="fila-info">
                <b>
                  {c.cantidad} · {cat?.nombre}
                </b>
                <small>
                  {c.codigoPunto} · {hace(c.creadoEn)}
                </small>
                {c.motivo && <small className="txt-error">{c.motivo}</small>}
              </div>
              <div className="fila-fin">
                <EstadoBadge estado={c.estado} etiqueta={ETIQUETA_COLA[c.estado]} />
                {c.estado === 'requiere_accion' && (
                  <span className="fila-acciones">
                    <button type="button" className="enlace-boton" onClick={() => reintentarElemento(c.idempotencyKey)}>Reintentar</button>
                    <button type="button" className="enlace-boton" onClick={() => descartarDeCola(c.idempotencyKey)}>Descartar</button>
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

