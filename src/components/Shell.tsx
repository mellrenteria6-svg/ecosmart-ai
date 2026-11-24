import { desactivar as desactivarAvisos } from '../lib/push'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { alternarOfflineSimulado, cerrarSesion, useStore } from '../data/store'
import type { Rol, Usuario } from '../data/types'
import { ETIQUETA_ROL } from '../lib/formato'
import { navegar, useRuta } from '../lib/router'
import { useCorreoReal } from '../lib/correo-real'

const MENU: Record<Rol, { href: string; texto: string }[]> = {
  usuario: [
    { href: '#/app', texto: 'Inicio' },
    { href: '#/app/reciclar', texto: 'Reciclar' },
    { href: '#/app/puntos', texto: 'Puntos' },
    { href: '#/app/historial', texto: 'Historial' },
    { href: '#/app/recompensas', texto: 'Recompensas' },
    { href: '#/app/canjes', texto: 'Mis canjes' },
    { href: '#/app/ranking', texto: 'EcoRanking' },
    { href: '#/app/impacto', texto: 'Mi impacto' },
  ],
  recolector: [
    { href: '#/rec', texto: 'Mis puntos' },
    { href: '#/rec/lotes', texto: 'Lotes cerrados' },
  ],
  admin: [
    { href: '#/admin', texto: 'Dashboard' },
    { href: '#/admin/puntos', texto: 'Puntos y QR' },
    { href: '#/admin/categorias', texto: 'Categorías' },
    { href: '#/admin/recompensas', texto: 'Recompensas' },
    { href: '#/admin/entregas', texto: 'Entregas' },
    { href: '#/admin/reportes', texto: 'Reportes' },
    { href: '#/admin/alertas', texto: 'Alertas' },
    { href: '#/admin/usuarios', texto: 'Usuarios' },
    { href: '#/admin/instituciones', texto: 'Universidades' },
    { href: '#/admin/auditoria', texto: 'Auditoría' },
  ],
  aliado: [
    { href: '#/aliado', texto: 'Resumen' },
    { href: '#/aliado/entregas', texto: 'Entregar canjes' },
    { href: '#/aliado/recompensas', texto: 'Mis recompensas' },
  ],
}

/** Logo. Dentro de la aplicación lleva al inicio de cada rol, no a la portada pública. */
export function Marca({ href = '#/' }: { href?: string }) {
  return (
    <a className="brand" href={href}>
      <span className="brand-mark" aria-hidden="true">
        E
      </span>
      <span>EcoSmart AI</span>
      <span className="sr-only">, ir al inicio</span>
    </a>
  )
}

export function IndicadorConexion() {
  const s = useStore()
  const pendientes = s.cola.length
  return (
    <button
      type="button"
      className={`conexion ${s.online ? 'conexion-on' : 'conexion-off'}`}
      onClick={alternarOfflineSimulado}
      title="Haz clic para simular la pérdida o recuperación de conexión"
    >
      <span className="conexion-punto" aria-hidden="true" />
      {s.online ? 'En línea' : 'Sin conexión'}
      {pendientes > 0 && <span className="conexion-cola">{pendientes} en cola</span>}
      <span className="sr-only">. Activar o desactivar modo sin conexión simulado.</span>
    </button>
  )
}

export function Shell({ usuario, children }: { usuario: Usuario; children: ReactNode }) {
  const s = useStore()
  const ruta = useRuta()
  const correoReal = useCorreoReal()
  const [menuAbierto, setMenuAbierto] = useState(false)
  // Escape cierra el menú del celular (RNF08)
  useEffect(() => {
    if (!menuAbierto) return
    const alPresionar = (e: KeyboardEvent) => e.key === 'Escape' && setMenuAbierto(false)
    window.addEventListener('keydown', alPresionar)
    return () => window.removeEventListener('keydown', alPresionar)
  }, [menuAbierto])
  const items = MENU[usuario.rol]
  const actual = '#' + ruta.path
  const activo = (href: string) => {
    const base = items[0].href
    if (href === base) return actual === base
    return actual === href || actual.startsWith(href + '/')
  }
  const noLeidas = s.db.notificaciones.filter((n) => n.usuarioId === usuario.id && !n.leida).length
  const salir = async () => {
    // Este dispositivo deja de recibir avisos de la cuenta que cierra sesión
    await desactivarAvisos().catch(() => undefined)
    cerrarSesion()
    navegar('/ingresar')
  }

  return (
    <div className="shell">
      <a className="saltar" href="#contenido" onClick={(e) => { e.preventDefault(); document.getElementById('contenido')?.focus() }}>
        Saltar al contenido
      </a>
      <header className="shell-header">
        <div className="shell-header-inner">
          <Marca href={items[0].href} />
          <nav className={`shell-nav ${menuAbierto ? 'abierto' : ''}`} aria-label="Navegación principal">
            {items.map((i) => (
              <a key={i.href} href={i.href} className={activo(i.href) ? 'activo' : ''} aria-current={activo(i.href) ? 'page' : undefined} onClick={() => setMenuAbierto(false)}>
                {i.texto}
              </a>
            ))}
            {/* En pantallas angostas "Salir" vive dentro del menú para que el encabezado quepa */}
            <button type="button" className="salir-movil" onClick={salir}>
              Salir
            </button>
          </nav>
          <div className="shell-acciones">
            <IndicadorConexion />
            {usuario.rol === 'usuario' && (
              <a href="#/app/notificaciones" className="btn-icono campana" aria-label={`Notificaciones, ${noLeidas} sin leer`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                  <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                </svg>
                {noLeidas > 0 && <span className="campana-num">{noLeidas}</span>}
              </a>
            )}
            <a href={usuario.rol === 'usuario' ? '#/app/perfil' : '#/perfil'} className="usuario-chip" title="Mi perfil">
              <span className="avatar" aria-hidden="true">
                {usuario.nombre.charAt(0)}
              </span>
              <span className="usuario-chip-texto">
                <span>{usuario.nombre.split(' ')[0]}</span>
                <small>{ETIQUETA_ROL[usuario.rol]}</small>
              </span>
            </a>
            <button type="button" className="btn btn-fantasma btn-sm salir-escritorio" onClick={salir}>
              Salir
            </button>
            <button type="button" className="btn-icono menu-movil" aria-expanded={menuAbierto} aria-label={menuAbierto ? 'Cerrar menú' : 'Abrir menú'} onClick={() => setMenuAbierto((v) => !v)}>
              ☰
            </button>
          </div>
        </div>
      </header>
      {!s.online && (
        <div className="banda-offline" role="status">
          Estás sin conexión. Puedes registrar reciclajes: se guardarán en una cola local y se sincronizarán al recuperar la conexión.
        </div>
      )}
      <main id="contenido" tabIndex={-1} className="shell-main">
        {children}
      </main>
      <footer className="shell-footer">
        <span>EcoSmart AI · Prototipo Fase 1</span>
        <span className="shell-footer-links">
          <a href="#/privacidad">Aviso de privacidad</a>
          {!correoReal && <a href="#/correo">Bandeja de correo simulada</a>}
        </span>
      </footer>
    </div>
  )
}
