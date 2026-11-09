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
    <div className="login">
      <h1>Revelation Gallery</h1>
      <form className="card" onSubmit={submit}>
        <div>
          <input placeholder="Username" value={username} autoFocus autoComplete="username"
          onChange={(e) => setUsername(e.target.value)} />
          <span className="material-symbols-rounded filled">
          person
          </span>
        </div>
        <div>
          <input type="password" placeholder="Password" value={password} autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)} />
          <span className="material-symbols-rounded filled">
          lock
          </span>
        </div>
        
        
        {error && <p className="error">{error}</p>}
        <button disabled={busy || !username || !password}>{busy ? 'Loginnig…' : 'Login'}</button>
      </form>
    </div>
  )
}
