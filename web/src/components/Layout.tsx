
import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import { api, fmtBytes, type Me } from '../api'
import Uploader from './Uploader'
import Icon from './Icon'

const item = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'nav-item active' : 'nav-item'

export default function Layout({
  me,
  onLogout,
}: {
  me: Me
  onLogout: () => void
}) {
  const [version, setVersion] = useState(0)
  const [usage, setUsage] = useState<{
    used_bytes: number
    quota_bytes: number
  } | null>(null)

  useEffect(() => {
    api.usage().then(setUsage).catch(() => {})
  }, [version])

  const pct = usage
    ? Math.min(100, (usage.used_bytes / usage.quota_bytes) * 100)
    : 0

  return (
    <div className="app">
      {/* Barra superior */}
      <header className="topbar">
        <div className='topbar-left'>
          <span className="material-symbols-rounded">
            search
          </span>
          <input type="text" placeholder='Buscar fotos, álbumes o lugares'/>

        </div>
        <div className='topbar-right'>
          <Uploader onDone={() => setVersion((v) => v + 1)} />
          <button
            className="icon-btn"
            onClick={onLogout}
            title="Salir"
            aria-label="Salir"
          >
            <Icon name="logout" />
          </button>

          <span className="avatar" title={me.username}>
            {me.username[0].toUpperCase()}
          </span>

        </div>
      </header>

      {/* Navegación lateral */}
      <nav className="sidebar" aria-label="Principal">
        <NavLink to="/" className="brand">
          <Icon name="image" />
          <span>Revelation Gallery</span>
        </NavLink>

        <div className="sidebar-nav">
          <NavLink to="/" end className={item}>
            <span className="material-symbols-rounded">home</span>
            <span>Inicio</span>
          </NavLink>

          <NavLink to="/albumes" className={item}>
            <span className="material-symbols-rounded">grid_view</span>
            <span>Álbumes</span>
          </NavLink>

          <NavLink to="/papelera" className={item}>
            <span className="material-symbols-rounded">delete</span>
            <span>Papelera</span>
          </NavLink>

          {me.role === 'admin' && (
            <NavLink to="/usuarios" className={item}>
            <span className="material-symbols-rounded">settings</span>
              <span>Configuración</span>
            </NavLink>
          )}
        </div>

        {usage && (
          <div className="storage">
            <strong>Espacio en disco</strong>
            <span className="muted">
              {fmtBytes(usage.used_bytes)} de{' '}
              {fmtBytes(usage.quota_bytes)}
            </span>

            <div
              className="storage-bar"
              role="progressbar"
              aria-valuenow={Math.round(pct)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div style={{ width: `${pct}%` }} />
            </div>

          </div>
        )}
      </nav>

      {/* Contenido */}
      <main className="content">
        <Outlet key={version} />
      </main>
    </div>
  )
}
