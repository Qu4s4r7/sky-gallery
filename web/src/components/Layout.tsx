import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import { api, fmtBytes, type Me } from '../api'
import Uploader from './Uploader'
import Icon from './Icon'

const item = ({ isActive }: { isActive: boolean }) => (isActive ? 'nav-item active' : 'nav-item')

export default function Layout({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [version, setVersion] = useState(0)   // al cambiar, la página actual se recarga
  const [usage, setUsage] = useState<{ used_bytes: number; quota_bytes: number } | null>(null)

  useEffect(() => {
    api.usage().then(setUsage).catch(() => {})
  }, [version])

  const pct = usage ? Math.min(100, (usage.used_bytes / usage.quota_bytes) * 100) : 0

  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <Icon name="image" />
          <span>Galería</span>
        </NavLink>

        <span className="spacer" />

        <div className="upload-slot">
          <Uploader onDone={() => setVersion((v) => v + 1)} />
        </div>

        <span className="avatar" title={me.username}>{me.username[0].toUpperCase()}</span>
        <button className="icon-btn" onClick={onLogout} title="Salir" aria-label="Salir">
          <Icon name="logout" />
        </button>
      </header>

      <nav className="sidebar" aria-label="Principal">
        <NavLink to="/" end className={item}>
          <Icon name="image" /><span>Fotos</span>
        </NavLink>
        <NavLink to="/albumes" className={item}>
          <Icon name="albums" /><span>Álbumes</span>
        </NavLink>
        <NavLink to="/papelera" className={item}>
          <Icon name="trash" /><span>Papelera</span>
        </NavLink>
        {me.role === 'admin' && (
          <NavLink to="/usuarios" className={item}>
            <Icon name="shield" /><span>Administración</span>
          </NavLink>
        )}

        {usage && (
          <div className="storage">
            <strong>Almacenamiento</strong>
            <div className="storage-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${pct}%` }} />
            </div>
            <span className="muted">{fmtBytes(usage.used_bytes)} de {fmtBytes(usage.quota_bytes)} usados</span>
          </div>
        )}
      </nav>

      <main className="content">
        <Outlet key={version} />
      </main>
    </div>
  )
}
