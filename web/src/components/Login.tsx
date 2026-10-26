import { useState, type FormEvent } from 'react'
import { api, type Me } from '../api'

export default function Login({ onLogin }: { onLogin: (me: Me) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.login(username, password)
      onLogin(await api.me())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="center">
      <form className="card" onSubmit={submit}>
        <h1>Galería</h1>
        <input placeholder="Usuario" value={username} autoFocus autoComplete="username"
          onChange={(e) => setUsername(e.target.value)} />
        <input type="password" placeholder="Contraseña" value={password} autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="error">{error}</p>}
        <button disabled={busy || !username || !password}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  )
}
