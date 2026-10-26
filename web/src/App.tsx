import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { api, type Me } from './api'
import Login from './components/Login'
import Layout from './components/Layout'
import Library from './components/Library'
import Albums from './components/Albums'
import AlbumView from './components/AlbumView'
import Admin from './components/Admin'

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined)   // undefined = comprobando sesión

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null))
  }, [])

  if (me === undefined) return <p className="center">Cargando…</p>

  // sin sesión se muestra el login en cualquier URL; al entrar te quedas en la URL que pedías
  if (me === null) return <Login onLogin={setMe} />

  return (
    <Routes>
      <Route
        element={
          <Layout
            me={me}
            onLogout={async () => {
              await api.logout().catch(() => {})
              setMe(null)
            }}
          />
        }
      >
        {/* el key evita que Fotos y Papelera compartan estado */}
        <Route index element={<Library key="fotos" trash={false} />} />
        <Route path="papelera" element={<Library key="papelera" trash />} />
        <Route path="albumes" element={<Albums />} />
        <Route path="albumes/:id" element={<AlbumView />} />
        <Route
          path="usuarios"
          element={me.role === 'admin' ? <Admin me={me} /> : <Navigate to="/" replace />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
