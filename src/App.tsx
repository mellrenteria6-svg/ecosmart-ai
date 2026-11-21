import { useEffect } from 'react'
import './App.css'
import { MODO_SERVIDOR, aplicarRetencionFotos, procesarVencimientos, refrescarDesdeServidor, sincronizarCola, useStore, usuarioActual } from './data/store'
import type { Rol, Usuario } from './data/types'
import { Shell } from './components/Shell'
import { Vacio } from './components/ui'
import { navegar, useRuta } from './lib/router'
import { vigilarAvisosLocales } from './lib/push'
import { Portada } from './pages/Portada'
import { BandejaCorreo, Ingresar, Recuperar, Registro, Restablecer, Verificar } from './pages/Acceso'
import { AvisoPrivacidad, Catalogo, Historial, InicioUsuario, MisCanjes, Notificaciones, Perfil, PuntosCampus } from './pages/Usuario'
import { Reciclar } from './pages/Reciclar'
import { LotesCerrados, PendientesPunto, PuntosRecolector, RevisionIndividual } from './pages/Recolector'
import { Reportes } from './pages/Reportes'
import { EcoRanking, Impacto } from './pages/Comunidad'
import { ResumenAliado, AdminAlertas, AdminInstituciones, AdminCategorias, AdminPuntos, AdminRecompensas, AdminUsuarios, Auditoria, Dashboard, Entregas } from './pages/Admin'

const INICIO_ROL: Record<Rol, string> = { usuario: '/app', recolector: '/rec', admin: '/admin', aliado: '/aliado' }

function Redirigir({ a }: { a: string }) {
  useEffect(() => navegar(a), [a])
  return null
}

function PaginaUsuario({ u, partes, query }: { u: Usuario; partes: string[]; query: URLSearchParams }) {
  switch (partes[1]) {
    case undefined:
      return <InicioUsuario usuario={u} />
    case 'reciclar':
      return <Reciclar key={query.get('codigo') ?? ''} usuario={u} />
    case 'puntos':
      return <PuntosCampus />
    case 'historial':
      return <Historial usuario={u} />
    case 'recompensas':
      return <Catalogo usuario={u} />
    case 'canjes':
      return <MisCanjes usuario={u} nuevo={query.get('nuevo') ?? undefined} />
    case 'notificaciones':
      return <Notificaciones usuario={u} />
    case 'perfil':
      return <Perfil usuario={u} />
    case 'ranking':
      return <EcoRanking usuario={u} />
    case 'impacto':
      return <Impacto usuario={u} />
    default:
      return <Vacio titulo="Página no encontrada" />
  }
}

function PaginaRecolector({ u, partes }: { u: Usuario; partes: string[] }) {
  if (partes[1] === 'punto' && partes[2]) return <PendientesPunto usuario={u} puntoId={partes[2]} />
  if (partes[1] === 'reciclaje' && partes[2]) return <RevisionIndividual usuario={u} reciclajeId={partes[2]} />
  if (partes[1] === 'lotes') return <LotesCerrados usuario={u} />
  return <PuntosRecolector usuario={u} />
}

function PaginaAdmin({ u, partes }: { u: Usuario; partes: string[] }) {
  switch (partes[1]) {
    case 'puntos':
      return <AdminPuntos usuario={u} />
    case 'categorias':
      return <AdminCategorias usuario={u} />
    case 'recompensas':
      return <AdminRecompensas usuario={u} />
    case 'entregas':
      return <Entregas usuario={u} />
    case 'usuarios':
      return <AdminUsuarios usuario={u} />
    case 'auditoria':
      return <Auditoria />
    case 'alertas':
      return <AdminAlertas usuario={u} />
    case 'instituciones':
      return <AdminInstituciones usuario={u} />
    case 'reportes':
      return <Reportes key={partes[2] ?? ''} usuario={u} reporteId={partes[2]} />
    default:
      return <Dashboard />
  }
}

export default function App() {
  const s = useStore()
  const { path, partes, query } = useRuta()
  const u = usuarioActual(s)

  useEffect(() => vigilarAvisosLocales(), [])

  useEffect(() => {
    procesarVencimientos()
    aplicarRetencionFotos()
    void sincronizarCola()
    if (!MODO_SERVIDOR) return
    // Modo base de datos: trae los datos de PostgreSQL y los mantiene al día
    void refrescarDesdeServidor()
    const t = setInterval(() => void refrescarDesdeServidor(), 20000)
    const alVolver = () => document.visibilityState === 'visible' && void refrescarDesdeServidor()
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [path])

  // Rutas públicas
  switch (path) {
    case '/':
      return <Portada />
    case '/ingresar':
      return u ? <Redirigir a={INICIO_ROL[u.rol]} /> : <Ingresar />
    case '/registro':
      return <Registro />
    case '/verificar':
      return <Verificar />
    case '/recuperar':
      return <Recuperar />
    case '/restablecer':
      return <Restablecer />
    case '/correo':
      return <BandejaCorreo />
    case '/privacidad':
      return <AvisoPrivacidad />
  }

  // Rutas protegidas: sesión válida (RF02) y rol autorizado (RNF04)
  if (!u) return <Redirigir a="/ingresar" />
  const area = partes[0]
  if (area === 'perfil') return <Shell usuario={u}><Perfil usuario={u} /></Shell>
  const permitido =
    (area === 'app' && u.rol === 'usuario') ||
    (area === 'rec' && (u.rol === 'recolector' || (u.rol === 'admin' && partes[1] !== undefined && partes[1] !== 'lotes'))) ||
    (area === 'admin' && u.rol === 'admin') ||
    (area === 'aliado' && u.rol === 'aliado')
  if (!permitido) return <Redirigir a={INICIO_ROL[u.rol]} />

  return (
    <Shell usuario={u}>
      {area === 'app' && <PaginaUsuario u={u} partes={partes} query={query} />}
      {area === 'rec' && <PaginaRecolector u={u} partes={partes} />}
      {area === 'admin' && <PaginaAdmin u={u} partes={partes} />}
      {area === 'aliado' && (partes[1] === 'entregas' ? <Entregas usuario={u} /> : partes[1] === 'recompensas' ? <AdminRecompensas usuario={u} /> : <ResumenAliado usuario={u} />)}
    </Shell>
  )
}
