import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { api, type Album } from '../api'

export default function Albums() {
  const navigate = useNavigate()
  const location = useLocation()

  const [albums, setAlbums] = useState<Album[] | null>(null)   // null = cargando
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice] = useState<string>(() => (location.state as { notice?: string } | null)?.notice ?? '')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  useEffect(() => {
    api.albums()
      .then(setAlbums)
      .catch((e) => { setError((e as Error).message); setAlbums([]) })
  }, [])

  // el aviso llega por el estado de navegación: se limpia para que no reaparezca al recargar
  useEffect(() => {
    if (notice) navigate(location.pathname, { replace: true, state: null })
  }, [])

  async function createAlbum(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const album = await api.createAlbum({ name: name.trim(), description: description.trim() })
      navigate(`/albumes/${album.id}`, { state: { notice: 'Álbum creado.' } })
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <section className="albums">
      <div className="album-toolbar">
        <h2>Mis álbumes</h2>
        <span className="spacer" />
        <button
          onClick={() => {
            setName('')
            setDescription('')
            setCreating(!creating)
            setError('')
          }}
        >
          {creating ? 'Cancelar' : '+ Crear álbum'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="muted">{notice}</p>}

      {creating && (
        <form className="card album-form" onSubmit={createAlbum}>
          <h3>Nuevo álbum</h3>
          <input
            placeholder="Nombre del álbum"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <textarea
            placeholder="Descripción (opcional)"
            value={description}
            maxLength={1000}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
          <button disabled={busy || !name.trim()}>{busy ? 'Creando…' : 'Crear álbum'}</button>
        </form>
      )}

      {!creating && albums === null && <p className="muted">Cargando…</p>}

      {!creating && albums && (
        albums.length === 0 ? (
          <p className="center muted">
            Todavía no tienes álbumes. Crea uno para organizar tus fotografías.
          </p>
        ) : (
          <div className="album-list">
            {albums.map((album) => {
              const n = Number(album.photo_count ?? 0)
              return (
                <Link className="album-card" key={album.id} to={`/albumes/${album.id}`}>
                  <span className="album-card-icon">▧</span>
                  <strong>{album.name}</strong>
                  <span className="muted">{n} {n === 1 ? 'fotografía' : 'fotografías'}</span>
                  {album.description && (
                    <span className="muted album-description">{album.description}</span>
                  )}
                </Link>
              )
            })}
          </div>
        )
      )}
    </section>
  )
}
