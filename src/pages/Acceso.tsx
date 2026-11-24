import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  MODO_SERVIDOR,
  INSTITUCION_INVITADOS,
  institucionPorCorreo,
  iniciarSesion,
  reenviarVerificacion,
  registrar,
  restablecerDemo,
  restablecerPassword,
  solicitarRestablecimiento,
  useStore,
  verificarCorreo,
  verificarSegundoFactor,
} from '../data/store'
import { DEMO_CUENTAS, DEMO_PASSWORD } from '../data/seed'
import { Marca } from '../components/Shell'
import { Alerta, Campo, EntradaContrasena, useAccion } from '../components/ui'
import { hace } from '../lib/formato'
import { navegar, useRuta } from '../lib/router'
import { useAvisoCorreo, useCorreoReal } from '../lib/correo-real'

const FACULTADES = ['Ingeniería', 'Ciencias Económicas', 'Ciencias de la Salud', 'Arquitectura y Diseño', 'Ciencias Sociales', 'Educación', 'Personal administrativo']

function MarcoAcceso({ titulo, subtitulo, children }: { titulo: ReactNode; subtitulo?: ReactNode; children: ReactNode }) {
  return (
    <div className="acceso">
      <aside className="acceso-lado">
        <Marca />
        <blockquote>
          <p>
            “Lo que se mide <em>se cuida</em>. Lo que se valida, <em>se premia</em>.”
          </p>
        </blockquote>
        <ul className="acceso-chips" aria-hidden="true">
          <li>QR por punto</li>
          <li>IA con confianza</li>
          <li>Validación humana</li>
          <li>Libro inmutable</li>
        </ul>
        <div className="acceso-hoja" aria-hidden="true" />
      </aside>
      <main className="acceso-main">
        <div className="acceso-caja">
          <a className="enlace-volver" href="#/">← Volver al inicio</a>
          <h1>{titulo}</h1>
          {subtitulo && <p className="acceso-sub">{subtitulo}</p>}
          {children}
        </div>
      </main>
    </div>
  )
}

function enfocarAlMontar() {
  // devuelve un ref que enfoca el primer campo
  return (el: HTMLInputElement | null) => el?.focus()
}

export function Ingresar() {
  const [correo, setCorreo] = useState('')
  const [password, setPassword] = useState('')
  const [segundoFactor, setSegundoFactor] = useState<string | null>(null)
  const cuentaEliminada = useRuta().query.get('eliminada') === '1'
  const [codigo, setCodigo] = useState('')
  const { error, cargando, ejecutar } = useAccion()
  // Sin correo real (o una cuenta de demostración sin buzón configurado) el código está en la bandeja simulada
  const { usaBandeja, demo } = useAvisoCorreo(correo)
  // Cuentas internas (@…eco.smart.com) y de demostración: el código va al correo del proyecto
  const [alProyecto, setAlProyecto] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    const r = await ejecutar(() => iniciarSesion(correo, password))
    if (!r) return
    if (r.tipo === 'segundo_factor') {
      setAlProyecto(!!r.alProyecto || demo)
      setSegundoFactor(r.usuarioId)
    }
    else navegar(r.usuario.rol === 'recolector' ? '/rec' : r.usuario.rol === 'aliado' ? '/aliado' : r.usuario.rol === 'admin' ? '/admin' : '/app')
  }

  async function enviarCodigo(e: FormEvent) {
    e.preventDefault()
    const u = await ejecutar(() => verificarSegundoFactor(segundoFactor!, codigo))
    if (u) navegar(u.rol === 'aliado' ? '/aliado' : '/admin')
  }

  if (segundoFactor) {
    return (
      <MarcoAcceso titulo="Verificación en dos pasos" subtitulo="Es la primera vez que entras desde este equipo. Enviamos un código de 6 dígitos a tu correo; después, este equipo queda recordado 30 días.">
        <form onSubmit={enviarCodigo} className="form">
          {error && <Alerta tono="error">{error}</Alerta>}
          <Campo
            etiqueta="Código de verificación"
            ayuda={
              usaBandeja ? (
                <>Revísalo en la <a href="#/correo" target="_blank">bandeja de correo simulada</a>.</>
              ) : alProyecto ? (
                'Esta cuenta no tiene buzón propio: el código llegó al correo del proyecto. Pídeselo a la administración. Vence en 10 minutos.'
              ) : (
                'Revisa tu bandeja de entrada (y la carpeta de Spam). Vence en 10 minutos.'
              )
            }
          >
            {(id, d) => <input id={id} aria-describedby={d} className="input input-codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} ref={enfocarAlMontar()} required />}
          </Campo>
          <button className="btn btn-tinta btn-bloque" disabled={cargando || codigo.length !== 6}>Verificar y entrar</button>
          <button type="button" className="btn btn-fantasma btn-bloque" onClick={() => setSegundoFactor(null)}>Usar otra cuenta</button>
        </form>
      </MarcoAcceso>
    )
  }

  return (
    <MarcoAcceso titulo={<>Hola de <em>nuevo</em>.</>} subtitulo="Ingresa con tu correo institucional.">
      {cuentaEliminada && <Alerta tono="ok" titulo="Tu cuenta fue eliminada">Borramos tus datos personales y tus fotos. Gracias por reciclar con EcoSmart AI.</Alerta>}
      <form onSubmit={enviar} className="form">
        {error && <Alerta tono="error">{error}</Alerta>}
        <Campo etiqueta="Correo institucional">
          {(id) => <input id={id} className="input" type="email" autoComplete="email" value={correo} onChange={(e) => setCorreo(e.target.value)} required />}
        </Campo>
        <Campo etiqueta="Contraseña">
          {(id) => <EntradaContrasena id={id} className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
        </Campo>
        <div className="form-fila-fin">
          <a href="#/recuperar">¿Olvidaste tu contraseña?</a>
        </div>
        <button className="btn btn-tinta btn-bloque btn-lg" disabled={cargando}>{cargando ? 'Ingresando…' : 'Ingresar'}</button>
        <p className="form-pie">
          ¿No tienes cuenta? <a href="#/registro">Regístrate</a>
        </p>
      </form>
      {/* Las cuentas de demostración solo se muestran en el modo sin servidor (datos en el navegador) */}
      {!MODO_SERVIDOR && <div className="demo-cuentas">
        <p>
          <b>Cuentas de demostración</b> · contraseña <code>{DEMO_PASSWORD}</code>
        </p>
        <div className="demo-botones">
          {DEMO_CUENTAS.map((c) => (
            <button
              key={c.correo}
              type="button"
              className="demo-boton"
              onClick={() => {
                setCorreo(c.correo)
                setPassword(DEMO_PASSWORD)
              }}
            >
              <b>{c.rol}</b>
              <small>{c.correo}</small>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="enlace-boton"
          onClick={() => {
            if (confirm('¿Restablecer todos los datos de demostración? Se perderán los registros creados en este navegador.')) restablecerDemo()
          }}
        >
          Restablecer datos de demostración
        </button>
      </div>}
    </MarcoAcceso>
  )
}

export function Registro() {
  const { db } = useStore()
  const [f, setF] = useState({ nombre: '', correo: '', facultad: FACULTADES[0], password: '', consentimiento: false })
  const [listo, setListo] = useState<string | null>(null)
  const { error, cargando, ejecutar } = useAccion()
  // Universidades con dominio propio; "Invitados" recibe cualquier otro correo si está activa
  const activas = db.instituciones.filter((i) => i.activa && i.dominios.length > 0)
  const invitados = db.instituciones.some((i) => i.id === INSTITUCION_INVITADOS && i.activa)
  // "ESPOL, ECOTEC, UCSG o UEES" (la universidad de demostración no se anuncia)
  const siglas = activas.filter((i) => i.id !== 'inst-demo').map((i) => i.siglas)
  const listaUniversidades = siglas.length > 1 ? `${siglas.slice(0, -1).join(', ')} o ${siglas.at(-1)}` : siglas.join('')
  const detectada = f.correo.includes('@') ? institucionPorCorreo(db, f.correo) : undefined
  const dominioEscrito = f.correo.split('@')[1] ?? ''

  const correoReal = useCorreoReal()

  async function enviar(e: FormEvent) {
    e.preventDefault()
    const u = await ejecutar(() => registrar(f))
    if (u) setListo(u.correo)
  }

  if (listo) {
    return (
      <MarcoAcceso titulo="Revisa tu correo" subtitulo={<>Enviamos un enlace de verificación a <b>{listo}</b>. Tu cuenta no podrá reciclar hasta que lo abras.</>}>
        {correoReal ? (
          <Alerta tono="info">Llega desde <b>EcoSmart AI</b> en unos segundos. Si no lo ves, revisa la carpeta de Spam o Correo no deseado.</Alerta>
        ) : (
          <Alerta tono="info" titulo="Prototipo">
            Los correos se muestran en la <a href="#/correo">bandeja de correo simulada</a>.
          </Alerta>
        )}
        <div className="form">
          {!correoReal && <a className="btn btn-tinta btn-bloque" href="#/correo">Abrir bandeja simulada</a>}
          <button type="button" className="btn btn-fantasma btn-bloque" onClick={() => reenviarVerificacion(listo)}>Reenviar enlace</button>
        </div>
      </MarcoAcceso>
    )
  }

  return (
    <MarcoAcceso
      titulo={<>Crea tu cuenta <em>verde</em>.</>}
      subtitulo={
        invitados
          ? 'Regístrate y empieza a sumar EcoPoints por reciclar.'
          : `Usa el correo de tu universidad: ${listaUniversidades}.`
      }
    >
      <form onSubmit={enviar} className="form">
        {error && <Alerta tono="error">{error}</Alerta>}
        <Campo etiqueta="Nombre completo">
          {(id) => <input id={id} className="input" autoComplete="name" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} required />}
        </Campo>
        <Campo
          etiqueta={invitados ? 'Correo' : 'Correo institucional'}
          ayuda={
            detectada ? (
              <span className="txt-ok">✓ {detectada.nombre}</span>
            ) : dominioEscrito.includes('.') && invitados ? (
              <span className="txt-ok">✓ Entrarás como Invitado (no es de una universidad participante). Te enviaremos un correo para verificarlo.</span>
            ) : dominioEscrito.includes('.') ? (
              <span className="txt-warn">@{dominioEscrito} no pertenece a una universidad participante.</span>
            ) : invitados ? (
              <>Cualquier correo que puedas abrir: te llegará un enlace para verificarlo.</>
            ) : (
              <>Dominios aceptados: {activas.flatMap((i) => i.dominios.map((x) => '@' + x)).join(', ')}</>
            )
          }
        >
          {(id, d) => <input id={id} aria-describedby={d} className="input" type="email" autoComplete="email" value={f.correo} onChange={(e) => setF({ ...f, correo: e.target.value })} required />}
        </Campo>
        <Campo etiqueta="Facultad o dependencia">
          {(id) => (
            <select id={id} className="input" value={f.facultad} onChange={(e) => setF({ ...f, facultad: e.target.value })}>
              {FACULTADES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          )}
        </Campo>
        <Campo etiqueta="Contraseña" ayuda="Mínimo 8 caracteres, con letras y números.">
          {(id, d) => <EntradaContrasena id={id} aria-describedby={d} className="input" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />}
        </Campo>
        <label className="check">
          <input type="checkbox" checked={f.consentimiento} onChange={(e) => setF({ ...f, consentimiento: e.target.checked })} />
          <span>
            Acepto el <a href="#/privacidad" target="_blank" rel="noreferrer">aviso de privacidad</a>: mis fotos solo las ven el recolector y el administrador autorizados y se conservan {db.config.diasRetencionFotos} días.
          </span>
        </label>
        <button className="btn btn-tinta btn-bloque btn-lg" disabled={cargando}>Crear cuenta</button>
        <p className="form-pie">
          ¿Ya tienes cuenta? <a href="#/ingresar">Ingresa</a>
        </p>
      </form>
    </MarcoAcceso>
  )
}

export function Verificar() {
  const ruta = useRuta()
  const token = ruta.query.get('token') ?? ''
  const [estado, setEstado] = useState<{ ok: boolean; texto: string } | null>(null)
  const hecho = useRef(false)
  useEffect(() => {
    if (hecho.current) return
    hecho.current = true
    verificarCorreo(token)
      .then((u) => setEstado({ ok: true, texto: `Listo, ${u.nombre}. Tu correo quedó verificado.` }))
      .catch((e) => setEstado({ ok: false, texto: e instanceof Error ? e.message : 'No se pudo verificar.' }))
  }, [token])
  return (
    <MarcoAcceso titulo={estado?.ok ? <>Cuenta <em>verificada</em></> : 'Verificación de correo'}>
      {estado && <Alerta tono={estado.ok ? 'ok' : 'error'}>{estado.texto}</Alerta>}
      <div className="form">
        <a className="btn btn-tinta btn-bloque" href="#/ingresar">Ir a ingresar</a>
      </div>
    </MarcoAcceso>
  )
}

// Cambiar o recuperar la contraseña: es el único momento en que se pide un código por correo
// a cualquier cuenta (además del segundo factor del administrador y el aliado en un equipo nuevo).
export function Recuperar() {
  const ruta = useRuta()
  const [correo, setCorreo] = useState(ruta.query.get('correo') ?? '')
  const [enviado, setEnviado] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [password, setPassword] = useState('')
  const [confirmacion, setConfirmacion] = useState('')
  const [ok, setOk] = useState(false)
  const { error, setError, cargando, ejecutar } = useAccion()
  const { usaBandeja } = useAvisoCorreo(correo)

  if (ok) {
    return (
      <MarcoAcceso titulo="Contraseña actualizada" subtitulo="Se cerraron tus sesiones abiertas en otros equipos.">
        <div className="form">
          <a className="btn btn-tinta btn-bloque" href="#/ingresar">Ingresar con la nueva contraseña</a>
        </div>
      </MarcoAcceso>
    )
  }

  return (
    <MarcoAcceso titulo="Cambia tu contraseña" subtitulo={enviado ? <>Enviamos un código de 6 dígitos a <b>{correo}</b>. Vence en 15 minutos.</> : 'Te enviaremos un código de 6 dígitos a tu correo.'}>
      {!enviado ? (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            solicitarRestablecimiento(correo)
            setEnviado(true)
          }}
        >
          <Campo etiqueta="Correo institucional">
            {(id) => <input id={id} className="input" type="email" autoComplete="email" value={correo} onChange={(e) => setCorreo(e.target.value)} required />}
          </Campo>
          <button className="btn btn-tinta btn-bloque">Enviar código</button>
        </form>
      ) : (
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault()
            if (password !== confirmacion) return setError('Las contraseñas no coinciden.')
            const r = await ejecutar(async () => {
              await restablecerPassword(correo, codigo, password)
              return true
            })
            if (r) setOk(true)
          }}
        >
          {error && <Alerta tono="error">{error}</Alerta>}
          <Campo
            etiqueta="Código de verificación"
            ayuda={usaBandeja ? <>Revísalo en la <a href="#/correo" target="_blank">bandeja de correo simulada</a>.</> : 'Si el correo está registrado, llega en unos segundos. Revisa también la carpeta de Spam.'}
          >
            {(id, d) => <input id={id} aria-describedby={d} className="input input-codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} ref={enfocarAlMontar()} required />}
          </Campo>
          <Campo etiqueta="Nueva contraseña" ayuda="Mínimo 8 caracteres, con letras y números.">
            {(id, d) => <EntradaContrasena id={id} aria-describedby={d} className="input" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
          </Campo>
          <Campo etiqueta="Confirmar contraseña">
            {(id) => <EntradaContrasena id={id} className="input" autoComplete="new-password" value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} required />}
          </Campo>
          <button className="btn btn-tinta btn-bloque" disabled={cargando || codigo.length !== 6}>Guardar contraseña</button>
          <button
            type="button"
            className="btn btn-fantasma btn-bloque"
            onClick={() => {
              solicitarRestablecimiento(correo)
              setCodigo('')
            }}
          >
            Enviar otro código
          </button>
        </form>
      )}
    </MarcoAcceso>
  )
}

export function BandejaCorreo() {
  const { db } = useStore()
  const correoReal = useCorreoReal()
  const [remotos, setRemotos] = useState<typeof db.correos | null>(null)
  useEffect(() => {
    if (!MODO_SERVIDOR) return
    const cargar = () =>
      fetch('/api/correos')
        .then((r) => r.json())
        .then((d) => setRemotos(d.correos ?? []))
        .catch(() => setRemotos([]))
    cargar()
    const t = setInterval(cargar, 4000)
    return () => clearInterval(t)
  }, [])
  const correos = MODO_SERVIDOR ? (remotos ?? []) : [...db.correos].reverse()
  return (
    <div className="bandeja">
      <header className="bandeja-cab">
        <Marca />
        <a href="#/ingresar" className="btn btn-fantasma btn-sm">Ir a ingresar</a>
      </header>
      <div className="bandeja-cuerpo">
        <h1>Bandeja de correo simulada</h1>
        <p className="encabezado-desc">
          {correoReal
            ? 'Los correos ya se envían de verdad al buzón de cada persona. Aquí solo aparecen los de las cuentas de demostración (@universidad.edu.ec), que no tienen buzón real.'
            : 'El prototipo no envía correos reales. Aquí aparecen los enlaces de verificación, recuperación y códigos de segundo factor.'}
        </p>
        {correos.length === 0 ? (
          <p className="vacio-texto">Todavía no hay correos. Crea una cuenta, recupera una contraseña o ingresa como administrador.</p>
        ) : (
          <ul className="correos">
            {correos.map((c) => (
              <li key={c.id} className="correo">
                <div className="correo-meta">
                  <span>Para: {c.para}</span>
                  <span>{hace(c.creadoEn)}</span>
                </div>
                <h2>{c.asunto}</h2>
                <p>{c.cuerpo}</p>
                {c.enlace && (
                  <a className="btn btn-acento btn-sm" href={c.enlace}>
                    Abrir enlace
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
