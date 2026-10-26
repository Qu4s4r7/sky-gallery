import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import sharp from 'sharp'
import exifr from 'exifr'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { config, dirs } from './config.js'
import { db } from './db.js'
import { requireUser } from './auth.js'

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
}

const safeName = (name: string) => path.basename(name).replace(/[^\w.\- ]/g, '_')
const photoId = (req: FastifyRequest) => Number((req.params as any).id) || 0

// Copia sin sobrescribir jamás: si el nombre existe, añade -1, -2, ...
async function storeOriginal(tmp: string, dir: string, name: string): Promise<string> {
  await fsp.mkdir(dir, { recursive: true })
  const { name: base, ext } = path.parse(name)
  for (let i = 0; ; i++) {
    const candidate = i === 0 ? name : `${base}-${i}${ext}`
    try {
      await fsp.copyFile(tmp, path.join(dir, candidate), fs.constants.COPYFILE_EXCL)
      return candidate
    } catch (e: any) {
      if (e.code !== 'EEXIST') throw e
    }
  }
}

const makeThumb = (src: string, out: string) =>
  sharp(src).rotate().resize(640, 640, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toFile(out)

export function photoRoutes(app: FastifyInstance) {
  const auth = { preHandler: requireUser }

  // foto solo si pertenece al usuario logueado
  const own = (req: FastifyRequest) =>
    db.get('SELECT * FROM photos WHERE id = ? AND user_id = ?', [photoId(req), req.user!.id])

  // ---------- SUBIR ----------
  app.post('/api/photos', auth, async (req) => {
    const user = req.user!
    const results: any[] = []

    for await (const part of req.files()) {
      const name = safeName(part.filename)
      const ext = path.extname(name).slice(1).toLowerCase()

      if (!config.allowedTypes.includes(ext)) {
        part.file.resume()   // descarta el archivo
        results.push({ name, error: 'tipo no permitido' })
        continue
      }

      const tmp = path.join(dirs.tmp, crypto.randomUUID())
      const hash = crypto.createHash('sha256')
      let size = 0
      const meter = new Transform({
        transform(chunk, _e, cb) { hash.update(chunk); size += chunk.length; cb(null, chunk) },
      })

      try {
        await pipeline(part.file, meter, fs.createWriteStream(tmp))
        if (part.file.truncated) { results.push({ name, error: 'archivo demasiado grande' }); continue }

        const sha = hash.digest('hex')

        if (await db.get('SELECT 1 FROM photos WHERE user_id = ? AND sha256 = ?', [user.id, sha])) {
          results.push({ name, error: 'duplicada' }); continue
        }

        const used = (await db.get(
          'SELECT COALESCE(SUM(size_bytes),0) AS n FROM photos WHERE user_id = ?', [user.id])).n
        if (used + size > user.quota_bytes) { results.push({ name, error: 'cuota excedida' }); continue }

        // si no es una imagen válida, sharp lanza error y no se guarda nada
        const meta = await sharp(tmp).metadata()
        const swap = (meta.orientation ?? 1) >= 5
        const width = swap ? meta.height : meta.width
        const height = swap ? meta.width : meta.height

        let takenAt = Date.now()
        let exifJson: string | null = null
        try {
          const ex = await exifr.parse(tmp, ['DateTimeOriginal', 'Make', 'Model', 'GPSLatitude', 'GPSLongitude'])
          if (ex) {
            exifJson = JSON.stringify(ex)
            if (ex.DateTimeOriginal instanceof Date) {
              const t = ex.DateTimeOriginal.getTime()
              if (Number.isFinite(t)) takenAt = t
            }
          }
        } catch { /* sin EXIF: se usa la fecha de subida */ }

        const d = new Date(takenAt)
        const relDir = path.join(user.username, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'))
        const finalName = await storeOriginal(tmp, path.join(config.originalsDir, relDir), name)
        const dest = path.join(config.originalsDir, relDir, finalName)
        await fsp.chmod(dest, 0o444)   // solo lectura

        const { rows } = await db.run(
          `INSERT INTO photos (user_id, rel_path, original_name, sha256, size_bytes, width, height, taken_at, exif, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id`,
          [user.id, path.join(relDir, finalName), name, sha, size, width, height, takenAt, exifJson, Date.now()])
        const id = rows[0].id

        await makeThumb(dest, path.join(dirs.thumbs, `${id}.webp`))
        results.push({ name, id })
      } catch (e) {
        req.log.error(e)
        results.push({ name, error: 'no se pudo procesar (¿es una imagen válida?)' })
      } finally {
        await fsp.rm(tmp, { force: true })   // siempre limpia el temporal
      }
    }
    return results
  })

  // ---------- LISTAR ----------
  app.get('/api/photos', auth, async (req) => {
    const { offset, limit, trash } = req.query as any
    const lim = Math.min(Math.max(Number(limit) || 200, 1), 500)
    const off = Math.max(Number(offset) || 0, 0)
    const filter = trash ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'
    return db.all(
      `SELECT id, original_name, width, height, taken_at, size_bytes
       FROM photos WHERE user_id = ? AND ${filter}
       ORDER BY taken_at DESC, id DESC LIMIT ? OFFSET ?`,
      [req.user!.id, lim, off])
  })

  app.get('/api/usage', auth, async (req) => {
    const row = await db.get(
      'SELECT COALESCE(SUM(size_bytes),0) AS n FROM photos WHERE user_id = ?', [req.user!.id])
    return { used_bytes: row.n, quota_bytes: req.user!.quota_bytes }
  })

  // ---------- SERVIR ----------
  app.get('/api/photos/:id/thumb', auth, async (req, reply) => {
    const p = await own(req)
    if (!p) return reply.code(404).send({ error: 'no existe' })
    const t = path.join(dirs.thumbs, `${p.id}.webp`)
    if (!fs.existsSync(t)) await makeThumb(path.join(config.originalsDir, p.rel_path), t)   // se regenera sola
    return reply.header('Cache-Control', 'private, max-age=86400').type('image/webp').send(fs.createReadStream(t))
  })

  app.get('/api/photos/:id/file', auth, async (req, reply) => {
    const p = await own(req)
    if (!p) return reply.code(404).send({ error: 'no existe' })
    const ext = path.extname(p.rel_path).slice(1).toLowerCase()
    return reply
      .header('Cache-Control', 'private, max-age=86400')
      .type(MIME[ext] ?? 'application/octet-stream')
      .send(fs.createReadStream(path.join(config.originalsDir, p.rel_path)))
  })

  // ---------- PAPELERA (el archivo en disco NO se toca) ----------
  // DELETE /api/photos/trash
  // Elimina permanentemente todas las fotografías de la papelera del usuario.
  app.delete('/api/photos/trash', auth, async (req) => {
    const userId = req.user!.id

    // El borrado de las filas es atómico. RETURNING permite recuperar
    // las rutas de los originales y los IDs de las miniaturas.
    const deletedPhotos = await db.tx(async (tx) => {
      const result = await tx.run(
        `DELETE FROM photos
         WHERE user_id = ?
           AND deleted_at IS NOT NULL
         RETURNING id, rel_path`,
        [userId],
      )

      return result.rows as Array<{ id: number; rel_path: string }>
    })

    let cleanupFailures = 0

    // La base de datos ya eliminó las fotos y sus relaciones con álbumes.
    // Ahora eliminamos los archivos físicos.
    for (const photo of deletedPhotos) {
      try {
        await fsp.rm(
          path.join(config.originalsDir, photo.rel_path),
          { force: true },
        )
      } catch (error) {
        cleanupFailures++
        req.log.error(
          { err: error, photoId: photo.id },
          'No se pudo eliminar el archivo original de una foto borrada',
        )
      }

      try {
        await fsp.rm(
          path.join(dirs.thumbs, `${photo.id}.webp`),
          { force: true },
        )
      } catch (error) {
        cleanupFailures++
        req.log.error(
          { err: error, photoId: photo.id },
          'No se pudo eliminar la miniatura de una foto borrada',
        )
      }
    }

    return {
      ok: true,
      deleted: deletedPhotos.length,
      cleanupFailures,
    }
  })
  app.delete('/api/photos/:id', auth, async (req, reply) => {
    const r = await db.run(
      'UPDATE photos SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
      [Date.now(), photoId(req), req.user!.id])
    return r.changes ? { ok: true } : reply.code(404).send({ error: 'no existe' })
  })

  app.post('/api/photos/:id/restore', auth, async (req, reply) => {
    const r = await db.run(
      'UPDATE photos SET deleted_at = NULL WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL',
      [photoId(req), req.user!.id])
    return r.changes ? { ok: true } : reply.code(404).send({ error: 'no existe' })
  })
}
