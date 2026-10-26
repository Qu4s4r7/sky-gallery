import crypto from 'node:crypto'
import argon2 from 'argon2'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { db } from './db.js'
import { config } from './config.js'

export type User = { id: number; username: string; role: string; quota_bytes: number }
declare module 'fastify' {
  interface FastifyRequest { user?: User }
}

const DAY = 86_400_000
const SESSION_DAYS = 30

export async function createUser(username: string, password: string, role: 'admin' | 'user', quotaBytes: number) {
  username = username.toLowerCase()
  // el nombre se usa como carpeta en disco: validación estricta
  if (!/^[a-z0-9_-]{3,32}$/.test(username)) {
    throw new Error('usuario inválido (3-32 caracteres: letras, números, _ o -)')
  }
  if (password.length < 8) throw new Error('la contraseña debe tener al menos 8 caracteres')
  const hash = await argon2.hash(password)
  await db.run(
    'INSERT INTO users (username, password_hash, role, quota_bytes, created_at) VALUES (?,?,?,?,?)',
    [username, hash, role, quotaBytes, Date.now()])
}

// Middleware: exige sesión válida
export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies.sid
  if (token) {
    const row = await db.get(
      `SELECT u.id, u.username, u.role, u.quota_bytes
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`,
      [token, Date.now()])
    if (row) { req.user = row as User; return }
  }
  return reply.code(401).send({ error: 'no autenticado' })
}

// Middleware: exige sesión válida + rol admin
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireUser(req, reply)
  if (reply.sent) return reply
  if (req.user!.role !== 'admin') return reply.code(403).send({ error: 'solo admin' })
}

export function authRoutes(app: FastifyInstance) {
  const fails = new Map<string, { n: number; until: number }>()

  app.post('/api/login', async (req, reply) => {
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string }

    const f = fails.get(req.ip)
    if (f && f.n >= 5 && f.until > Date.now()) {
      return reply.code(429).send({ error: 'demasiados intentos, espera unos minutos' })
    }

    const u = await db.get('SELECT * FROM users WHERE username = ?', [(username ?? '').toLowerCase()])
    const ok = u && (await argon2.verify(u.password_hash, password ?? ''))
    if (!ok) {
      fails.set(req.ip, { n: (f?.n ?? 0) + 1, until: Date.now() + 10 * 60_000 })
      return reply.code(401).send({ error: 'usuario o contraseña incorrectos' })
    }

    fails.delete(req.ip)
    const token = crypto.randomBytes(32).toString('hex')
    await db.run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)',
      [token, u.id, Date.now() + SESSION_DAYS * DAY])
    reply.setCookie('sid', token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 86400 })
    return { username: u.username, role: u.role }
  })

  app.post('/api/logout', { preHandler: requireUser }, async (req, reply) => {
    await db.run('DELETE FROM sessions WHERE token = ?', [req.cookies.sid])
    reply.clearCookie('sid', { path: '/' })
    return { ok: true }
  })

  app.get('/api/me', { preHandler: requireUser }, async (req) => req.user)

  // ---- administración de usuarios ----
  app.get('/api/admin/users', { preHandler: requireAdmin }, async () =>
    db.all(`SELECT id, username, role, quota_bytes,
      (SELECT COALESCE(SUM(size_bytes),0) FROM photos WHERE user_id = users.id) AS used_bytes,
      (SELECT count(*) FROM photos WHERE user_id = users.id) AS photo_count
      FROM users ORDER BY id`)
  )

  app.post('/api/admin/users', { preHandler: requireAdmin }, async (req, reply) => {
    const { username, password, role, quota_gb } = (req.body ?? {}) as any
    const quota = quota_gb ? Number(quota_gb) * 1024 ** 3 : config.defaultQuotaBytes
    try {
      await createUser(String(username ?? ''), String(password ?? ''), role === 'admin' ? 'admin' : 'user', quota)
      return { ok: true }
    } catch (e: any) {
      // 23505 = usuario duplicado en Postgres
      return reply.code(e.code === '23505' ? 409 : 400).send({ error: e.message })
    }
  })
}
