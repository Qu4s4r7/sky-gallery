import fsp from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { config, dirs } from './config.js'
import { db } from './db.js'
import { requireAdmin } from './auth.js'

export function userAdminRoutes(app: FastifyInstance) {
  // DELETE /api/admin/users/:id?photos=transfer|detach
  app.delete('/api/admin/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const me = req.user!
    const id = Number((req.params as any).id) || 0
    const mode = (req.query as any).photos as string | undefined

    if (id === me.id) {
      return reply.code(400).send({ error: 'No puedes eliminar tu propia cuenta' })
    }

    const target = await db.get('SELECT id, username FROM users WHERE id = ?', [id])
    if (!target) return reply.code(404).send({ error: 'El usuario no existe' })

    const { n } = await db.get('SELECT count(*) AS n FROM photos WHERE user_id = ?', [id])
    if (n > 0 && mode !== 'transfer' && mode !== 'detach') {
      return reply.code(400).send({ error: `El usuario tiene ${n} fotografías: indica qué hacer con ellas` })
    }

    let transferred = 0
    let duplicates = 0
    const removed: number[] = []

    await db.tx(async (q) => {
      // sus álbumes se eliminan primero (las fotos no se tocan)
      await q.run('DELETE FROM albums WHERE user_id = ?', [id])

      if (mode === 'transfer') {
        // pasa a tu cuenta las fotos que no tengas ya (mismo contenido = mismo SHA-256)
        transferred = (await q.run(
          `UPDATE photos p SET user_id = ?
           WHERE p.user_id = ?
             AND NOT EXISTS (SELECT 1 FROM photos o WHERE o.user_id = ? AND o.sha256 = p.sha256)`,
          [me.id, id, me.id])).changes
      }

      // lo que queda: fotos "quitadas" (detach) o duplicadas de tu biblioteca (transfer)
      const left = await q.all('SELECT id FROM photos WHERE user_id = ?', [id])
      removed.push(...left.map((r) => r.id as number))
      if (mode === 'transfer') duplicates = left.length

      await q.run('DELETE FROM photos WHERE user_id = ?', [id])
      await q.run('DELETE FROM users WHERE id = ?', [id])   // sus sesiones se borran solas
    })

    // --- tras confirmar la base de datos: archivos (nunca se borran) ---
    let archived: string | null = null

    if (mode === 'detach' && /^[a-z0-9_-]{3,32}$/.test(target.username)) {
      const from = path.join(config.originalsDir, target.username)
      const to = path.join(config.originalsDir, '.borrados', `${target.username}-${Date.now()}`)
      try {
        await fsp.mkdir(path.dirname(to), { recursive: true })
        await fsp.rename(from, to)
        archived = path.relative(config.originalsDir, to)
      } catch (e: any) {
        if (e.code !== 'ENOENT') req.log.error(e)   // ENOENT: nunca subió nada
      }
    }

    // las miniaturas de registros eliminados ya no hacen falta (se regeneran si hiciera falta)
    for (const pid of removed) {
      await fsp.rm(path.join(dirs.thumbs, `${pid}.webp`), { force: true }).catch(() => {})
    }

    return { ok: true, transferred, duplicates, archived }
  })
}
