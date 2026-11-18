import { useStore } from '../data/store'
import { Marca } from '../components/Shell'
import { fmtNumero } from '../lib/formato'

const PASOS = [
  {
    titulo: 'Escanea el punto',
    texto: 'Cada contenedor del campus tiene un QR único. No necesitas un código personal: solo apunta y empieza.',
    icono: (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M6 16V8a2 2 0 0 1 2-2h8M32 6h8a2 2 0 0 1 2 2v8M42 32v8a2 2 0 0 1-2 2h-8M16 42H8a2 2 0 0 1-2-2v-8" />
        <rect x="15" y="15" width="7" height="7" />
        <rect x="26" y="15" width="7" height="7" />
        <rect x="15" y="26" width="7" height="7" />
        <path d="M26 26h3v3M33 33h-4" />
      </svg>
    ),
  },
  {
    titulo: 'Fotografía el residuo',
    texto: 'La foto se toma en el momento desde la cámara. Revisamos luz, tamaño y que no sea una foto repetida.',
    icono: (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M6 16a3 3 0 0 1 3-3h6l3-5h12l3 5h6a3 3 0 0 1 3 3v20a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3Z" />
        <circle cx="24" cy="25" r="8" />
      </svg>
    ),
  },
  {
    titulo: 'La IA lo clasifica',
    texto: 'Recibes categoría, nivel de confianza y versión del modelo. Si no estás de acuerdo, corriges y queda en revisión.',
    icono: (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <rect x="12" y="12" width="24" height="24" rx="4" />
        <path d="M18 6v6M30 6v6M18 36v6M30 36v6M6 18h6M6 30h6M36 18h6M36 30h6" />
        <path d="m19 25 4 4 7-8" />
      </svg>
    ),
  },
  {
    titulo: 'Se valida y sumas',
    texto: 'Tus EcoPoints nacen pendientes. Cuando el recolector confirma el lote, pasan a tu saldo y puedes canjearlos.',
    icono: (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="17" />
        <path d="M24 14v20M18 19c0-2.5 2.7-4 6-4s6 1.5 6 4-2.7 3.5-6 4-6 1.8-6 4.5 2.7 4 6 4 6-1.5 6-4" />
      </svg>
    ),
  },
]

const ROLES = [
  {
    nombre: 'Estudiantes y personal',
    rol: 'Usuario',
    puntos: ['Registra reciclajes con QR y foto', 'Consulta saldo confirmado y pendiente', 'Canjea recompensas con código único'],
  },
  {
    nombre: 'Equipo de recolección',
    rol: 'Recolector',
    puntos: ['Atiende solo los puntos asignados', 'Valida por lote y revisa los marcados', 'Corrige cantidades con motivo'],
  },
  {
    nombre: 'Gestión ambiental',
    rol: 'Administrador',
    puntos: ['Configura puntos, QR y categorías', 'Entrega premios y gestiona usuarios', 'Consulta indicadores y auditoría'],
  },
]

const MATERIALES = ['Plástico PET', 'Papel y cartón', 'Vidrio', 'Latas de aluminio', 'Tetra Pak']

export function Portada() {
  const { db } = useStore()
  const validados = db.reciclajes.filter((r) => r.estado === 'validado').length
  const otorgados = db.movimientos.filter((m) => m.tipo === 'reciclaje').reduce((t, m) => t + m.puntos, 0)
  const activos = db.puntos.filter((p) => p.estado === 'activo').length

  return (
    <div className="portada">
      <header className="p-header">
        <Marca />
        <nav className="p-nav" aria-label="Secciones">
          <a href="#como-funciona" onClick={(e) => { e.preventDefault(); document.getElementById('como-funciona')?.scrollIntoView() }}>Cómo funciona</a>
          <a href="#roles" onClick={(e) => { e.preventDefault(); document.getElementById('roles')?.scrollIntoView() }}>Roles</a>
          <a href="#fase" onClick={(e) => { e.preventDefault(); document.getElementById('fase')?.scrollIntoView() }}>Fase 1</a>
        </nav>
        <div className="p-header-cta">
          <a className="btn btn-fantasma" href="#/ingresar">Ingresar</a>
          <a className="btn btn-tinta" href="#/registro">Crear cuenta</a>
        </div>
      </header>

      <section className="p-hero">
        <div className="p-hero-copy">
          <p className="kicker">
            <span className="kicker-punto" /> Piloto de campus · 2026
          </p>
          <h1 className="p-titulo">
            Recicla en el campus. <em>La IA lo reconoce,</em> el recolector lo valida y tú{' '}
            <span className="subrayado">ganas</span>.
          </h1>
          <p className="p-lead">
            EcoSmart AI convierte cada botella, lata o cartón que llevas al punto de reciclaje en EcoPoints verificados.
            Sin básculas ni sensores: solo un QR, una foto y una validación real.
          </p>
          <div className="p-hero-acciones">
            <a className="btn btn-acento btn-lg" href="#/registro">
              Empezar a reciclar <span aria-hidden="true">→</span>
            </a>
            <a className="btn btn-linea btn-lg" href="#/ingresar">Probar con cuenta demo</a>
          </div>
          <dl className="p-datos">
            <div>
              <dt>Categorías</dt>
              <dd>{db.categorias.length}</dd>
            </div>
            <div>
              <dt>Registros por día</dt>
              <dd>{db.config.topeDiario}</dd>
            </div>
            <div>
              <dt>Para canjear</dt>
              <dd>
                {db.config.horasVencimientoCanje}
                <small>h</small>
              </dd>
            </div>
          </dl>
        </div>

        <div className="p-hero-visual" aria-hidden="true">
          <div className="sello">
            <svg viewBox="0 0 200 200">
              <defs>
                <path id="circulo" d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0" />
              </defs>
              <text>
                <textPath href="#circulo">RECICLA · VALIDA · CANJEA · RECICLA · VALIDA · CANJEA ·</textPath>
              </text>
            </svg>
            <span className="sello-centro">✳</span>
          </div>

          <div className="telefono">
            <div className="telefono-isla" />
            <div className="tel-pantalla">
              <div className="tel-top">
                <span>Hola, Valeria</span>
                <span className="tel-pill">En línea</span>
              </div>
              <div className="tel-saldo">
                <span>EcoPoints confirmados</span>
                <strong>1 260</strong>
                <div className="tel-saldo-pend">+ 60 pendientes de validación</div>
              </div>
              <div className="tel-escaner">
                <div className="tel-foto">
                  <div className="botella" />
                </div>
                <span className="esq esq-1" />
                <span className="esq esq-2" />
                <span className="esq esq-3" />
                <span className="esq esq-4" />
                <span className="linea-escaneo" />
              </div>
              <div className="tel-ia">
                <div>
                  <small>Clasificación IA</small>
                  <b>Plástico PET</b>
                </div>
                <span className="tel-conf">92 %</span>
              </div>
              <div className="tel-barra">
                <span style={{ width: '92%' }} />
              </div>
              <div className="tel-boton">Registrar 6 botellas · +60 pts</div>
            </div>
          </div>

          <div className="flotante flotante-1">
            <span className="flot-icono">✓</span>
            <div>
              <b>Lote validado</b>
              <small>Biblioteca central · 12 registros</small>
            </div>
          </div>
          <div className="flotante flotante-2">
            <span className="flot-codigo">ECO-7KQ2-M9XA</span>
            <small>Café americano · vence en 72 h</small>
          </div>
        </div>
      </section>

      <div className="marquesina" aria-hidden="true">
        <div className="marquesina-pista">
          {[0, 1].map((n) => (
            <div key={n} className="marquesina-grupo">
              {MATERIALES.map((m) => (
                <span key={m}>
                  {m} <i>✳</i>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <section className="p-seccion" id="como-funciona">
        <div className="p-seccion-cab">
          <p className="kicker">Cómo funciona</p>
          <h2 className="p-h2">
            Cuatro pasos, <em>cero</em> papeleo.
          </h2>
        </div>
        <ol className="pasos">
          {PASOS.map((p, i) => (
            <li key={p.titulo} className="paso">
              <span className="paso-num">0{i + 1}</span>
              <span className="paso-icono">{p.icono}</span>
              <h3>{p.titulo}</h3>
              <p>{p.texto}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="p-confianza">
        <div className="p-confianza-copy">
          <p className="kicker kicker-claro">Puntos que valen</p>
          <h2 className="p-h2">
            Cada EcoPoint pasa por <em>una persona</em> antes de llegar a tu saldo.
          </h2>
          <p>
            El saldo se calcula desde un libro de movimientos que no se edita ni se borra. Si hay un error, se crea un ajuste
            visible. Validaciones, canjes y cambios de configuración quedan auditados.
          </p>
        </div>
        <ol className="linea-estados">
          <li>
            <span className="le-dot le-info" />
            <b>Pendiente</b>
            <small>La IA estimó tus puntos</small>
          </li>
          <li>
            <span className="le-dot le-warn" />
            <b>En revisión</b>
            <small>Corregiste la categoría o hubo baja confianza</small>
          </li>
          <li>
            <span className="le-dot le-ok" />
            <b>Validado</b>
            <small>El recolector confirmó la cantidad: se suma al saldo</small>
          </li>
        </ol>
        <dl className="p-contadores">
          <div>
            <dt>Reciclajes validados</dt>
            <dd>{fmtNumero(validados)}</dd>
          </div>
          <div>
            <dt>EcoPoints otorgados</dt>
            <dd>{fmtNumero(otorgados)}</dd>
          </div>
          <div>
            <dt>Puntos activos</dt>
            <dd>{activos}</dd>
          </div>
        </dl>
      </section>

      <section className="p-seccion" id="roles">
        <div className="p-seccion-cab">
          <p className="kicker">Quién participa</p>
          <h2 className="p-h2">
            Una plataforma, <em>tres miradas</em>.
          </h2>
        </div>
        <div className="roles">
          {ROLES.map((r, i) => (
            <article key={r.rol} className={`rol-card rol-${i}`}>
              <span className="rol-etiqueta">{r.rol}</span>
              <h3>{r.nombre}</h3>
              <ul>
                {r.puntos.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="p-seccion" id="fase">
        <div className="fases">
          <div className="fase fase-actual">
            <span className="fase-tag">Disponible · Fase 1</span>
            <h3>Flujo completo de reciclaje</h3>
            <p>Cuentas institucionales, puntos con QR, captura y clasificación con IA, validación por lotes, libro de EcoPoints, catálogo, canjes, dashboard, auditoría y modo sin conexión.</p>
          </div>
          <div className="fase">
            <span className="fase-tag fase-tag-gris">Próximamente · Fase 2</span>
            <h3>Comunidad e impacto</h3>
            <p>Panel para aliados, ranking por facultad, impacto ambiental personal, notificaciones push, alertas antifraude y exportación de reportes.</p>
          </div>
        </div>
      </section>

      <section className="p-cta">
        <h2>
          ¿Listo para tu <em>primer</em> reciclaje?
        </h2>
        <p>Entra con una cuenta de demostración y recorre el flujo completo como estudiante, recolector o administrador.</p>
        <div className="p-hero-acciones">
          <a className="btn btn-lima btn-lg" href="#/ingresar">Ingresar al prototipo</a>
          <a className="btn btn-linea-clara btn-lg" href="#/registro">Crear mi cuenta</a>
        </div>
      </section>

      <footer className="p-footer">
        <div>
          <Marca />
          <p>Diseño de Sistemas e Ingeniería de Software II · Noviembre 2026</p>
        </div>
        <p className="p-equipo">
          Pablo Andrés Perea Bohorquez · Mell Eunice Rentería Alcivar · César Emilio Regalado Sandoval
        </p>
      </footer>
    </div>
  )
}
