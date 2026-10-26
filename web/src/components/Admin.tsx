import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { api, fmtBytes, type Me, type UserRow } from '../api'

const EMPTY = { username: '', password: '', role: 'user', quota_gb: '' }

export default function Admin({ me }: { me: Me }) {
  const [users, setUsers] = useState<UserRow[]>([])
  const [form, setForm] = useState(EMPTY)
  const [msg, setMsg] = useState('')
  const [notice, setNotice] = useState('')

  const [toDelete, setToDelete] = useState<UserRow | null>(null)
  const [mode, setMode] = useState<'transfer' | 'detach'>('transfer')
  const [delError, setDelError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => api.users().then(setUsers).catch((e) => setMsg(e.message))
  useEffect(() => { load() }, [])

  // Esc cierra el diálogo
  useEffect(() => {
    if (!toDelete) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) setToDelete(null) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [toDelete, busy])

  const set = (k: keyof typeof EMPTY) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value })

  async function create(e: FormEvent) {
    e.preventDefault()
    setMsg('')
    try {
      await api.createUser({ ...form, quota_gb: form.quota_gb ? Number(form.quota_gb) : undefined })
      setForm(EMPTY)
      load()
    } catch (err) {
      setMsg((err as Error).message)
    }
  }

  function askDelete(u: UserRow) {
    setToDelete(u)
    setMode('transfer')     // la opción que no pierde nada es la que viene marcada
    setDelError('')
    setNotice('')
  }

  async function confirmDelete() {
    if (!toDelete) return
    setBusy(true)
    setDelError('')
    try {
      const r = await api.deleteUser(toDelete.id, toDelete.photo_count > 0 ? mode : undefined)
      const parts = [`Usuario «${toDelete.username}» eliminado.`]
      if (r.transferred > 0) parts.push(`${r.transferred} fotografías pasaron a tu cuenta.`)
      if (r.duplicates > 0) parts.push(`${r.duplicates} ya las tenías y no se copiaron.`)
      if (r.archived) parts.push(`Sus archivos quedaron apartados en originales/${r.archived}.`)
      setNotice(parts.join(' '))
      setToDelete(null)
      load()
    } catch (err) {
      setDelError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="card wide">
        <h2>Usuarios</h2>
        {notice && <p className="muted">{notice}</p>}

        <table>
          <thead>
            <tr><th>Usuario</th><th>Rol</th><th>Fotos</th><th>Uso</th><th>Acciones</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}{u.id === me.id && <span className="muted"> (tú)</span>}</td>
                <td>{u.role}</td>
                <td>{u.photo_count}</td>
                <td>{fmtBytes(u.used_bytes)} / {fmtBytes(u.quota_bytes)}</td>
                <td className="actions">
                  <button
                    disabled={u.id === me.id}
                    title={u.id === me.id ? 'No puedes eliminar tu propia cuenta' : undefined}
                    onClick={() => askDelete(u)}
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Nuevo usuario</h3>
        <form onSubmit={create}>
          <input placeholder="usuario" value={form.username} onChange={set('username')} />
          <input type="password" placeholder="contraseña (mín. 8)" value={form.password} onChange={set('password')} />
          <select value={form.role} onChange={set('role')}>
            <option value="user">Usuario</option>
            <option value="admin">Admin</option>
          </select>
          <input type="number" min="1" placeholder="cuota en GB (opcional)" value={form.quota_gb} onChange={set('quota_gb')} />
          {msg && <p className="error">{msg}</p>}
          <button>Crear usuario</button>
        </form>
      </div>

      {toDelete && (
        <div className="overlay" onClick={() => !busy && setToDelete(null)}>
          <div
            className="card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="del-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="del-title">Eliminar a «{toDelete.username}»</h3>

            {toDelete.photo_count > 0 ? (
              <>
                <p>
                  Tiene {toDelete.photo_count} {toDelete.photo_count === 1 ? 'fotografía' : 'fotografías'}{' '}
                  ({fmtBytes(toDelete.used_bytes)}). ¿Qué hago con ellas?
                </p>

                <label className="choice">
                  <input type="radio" name="mode" checked={mode === 'transfer'} onChange={() => setMode('transfer')} />
                  <span>
                    <strong>Pasarlas a mi cuenta</strong>
                    <span className="muted"> Se conservan y pasan a ser tuyas. Sus álbumes se eliminan.</span>
                  </span>
                </label>

                <label className="choice">
                  <input type="radio" name="mode" checked={mode === 'detach'} onChange={() => setMode('detach')} />
                  <span>
                    <strong>Quitarlas de la galería</strong>
                    <span className="muted"> Los archivos no se borran: se apartan en el servidor, en la carpeta .borrados.</span>
                  </span>
                </label>
              </>
            ) : (
              <p>No tiene fotografías. Se eliminarán su cuenta y sus álbumes.</p>
            )}

            <p className="muted">Su sesión se cerrará de inmediato.</p>
            {delError && <p className="error">{delError}</p>}

            <div className="dialog-actions">
              <button disabled={busy} onClick={() => setToDelete(null)}>Cancelar</button>
              <button className="danger" disabled={busy} onClick={confirmDelete}>
                {busy ? 'Eliminando…' : 'Eliminar usuario'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
