
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
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
}

const safeName = (name: string) =>
  path.basename(name).replace(/[^\w.\- ]/g, '_')

const photoId = (req: FastifyRequest) =>
  Number((req.params as any).id) || 0

type StoredMedia = {
  id: number
  rel_path: string
  media_type: string
  size_bytes: number
}

// Copia sin sobrescribir jamás: si el nombre existe, añade -1, -2, ...
async function storeOriginal(
  tmp: string,
  dir: string,
  name: string,
): Promise<string> {
  await fsp.mkdir(dir, { recursive: true })

  const { name: base, ext } = path.parse(name)

  for (let i = 0; ; i++) {
    const candidate = i === 0 ? name : `${base}-${i}${ext}`

    try {
      await fsp.copyFile(
        tmp,
        path.join(dir, candidate),
        fs.constants.COPYFILE_EXCL,
      )
      return candidate
    } catch (e: any) {
      if (e.code !== 'EEXIST') throw e
    }
  }
}

const makeThumb = (src: string, out: string) =>
  sharp(src)
    .rotate()
    .resize(640, 640, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 78 })
    .toFile(out)

export function photoRoutes(app: FastifyInstance) {
  const auth = { preHandler: requireUser }

  // Devuelve un archivo solamente si pertenece al usuario autenticado.
  const own = (req: FastifyRequest) =>
    db.get(
      'SELECT * FROM photos WHERE id = ? AND user_id = ?',
      [photoId(req), req.user!.id],
    )

  // ---------- SUBIR FOTOS Y VÍDEOS ----------

  app.post('/api/photos', auth, async (req) => {
    const user = req.user!
    const results: Array<{ name: string; id?: number; error?: string }> = []

    for await (const part of req.files()) {
      const name = safeName(part.filename)
      const ext = path.extname(name).slice(1).toLowerCase()

      if (!config.allowedTypes.includes(ext) || !MIME[ext]) {
        part.file.resume()
        results.push({ name, error: 'tipo no permitido' })
        continue
      }

      // Solo aceptamos MP4 como vídeo en esta versión.
      const mediaType = ext === 'mp4' ? 'video' : 'image'

      const tmp = path.join(dirs.tmp, crypto.randomUUID())
      const hash = crypto.createHash('sha256')
      let size = 0

      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          hash.update(chunk)
          size += chunk.length
          callback(null, chunk)
        },
      })

      try {
        await pipeline(part.file, meter, fs.createWriteStream(tmp))

        if (part.file.truncated) {
          results.push({ name, error: 'archivo demasiado grande' })
          continue
        }

        const sha = hash.digest('hex')

        const duplicate = await db.get(
          'SELECT 1 FROM photos WHERE user_id = ? AND sha256 = ?',
          [user.id, sha],
        )

        if (duplicate) {
          results.push({ name, error: 'duplicada' })
          continue
        }

        const usage = await db.get(
          `SELECT COALESCE(SUM(size_bytes), 0) AS n
           FROM photos WHERE user_id = ?`,
          [user.id],
        )

        if (Number(usage.n) + size > Number(user.quota_bytes)) {
          results.push({ name, error: 'cuota excedida' })
          continue
        }

        let width: number | null = null
        let height: number | null = null
        let duration: number | null = null
        let takenAt = Date.now()
        let exifJson: string | null = null

        if (mediaType === 'image') {
          // Sharp se utiliza únicamente con imágenes.
          const meta = await sharp(tmp).metadata()

          if (!meta.width || !meta.height) {
            throw new Error('La imagen no contiene dimensiones válidas')
          }

          const swap = (meta.orientation ?? 1) >= 5

          width = swap ? meta.height : meta.width
          height = swap ? meta.width : meta.height

          try {
            const ex = await exifr.parse(tmp, [
              'DateTimeOriginal',
              'Make',
              'Model',
              'GPSLatitude',
              'GPSLongitude',
            ])

            if (ex) {
              exifJson = JSON.stringify(ex)

              if (ex.DateTimeOriginal instanceof Date) {
                const timestamp = ex.DateTimeOriginal.getTime()

                if (Number.isFinite(timestamp)) {
                  takenAt = timestamp
                }
              }
            }
          } catch {
            // Algunas imágenes no tienen EXIF.
          }
        }

        // Los vídeos conservan su original. La duración y las dimensiones
        // quedan en null hasta implementar la extracción con FFmpeg.
        const date = new Date(takenAt)
        const relDir = path.join(
          user.username,
          String(date.getFullYear()),
          String(date.getMonth() + 1).padStart(2, '0'),
        )

        const finalName = await storeOriginal(
          tmp,
          path.join(config.originalsDir, relDir),
          name,
        )

        const relPath = path.join(relDir, finalName)
        const dest = path.join(config.originalsDir, relPath)

        await fsp.chmod(dest, 0o444)

        const { rows } = await db.run(
          `INSERT INTO photos (
             user_id,
             rel_path,
             original_name,
             sha256,
             size_bytes,
             width,
             height,
             media_type,
             duration,
             taken_at,
             exif,
             created_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING id`,
          [
            user.id,
            relPath,
            name,
            sha,
            size,
            width,
            height,
            mediaType,
            duration,
            takenAt,
            exifJson,
            Date.now(),
          ],
        )

        const id = Number(rows[0].id)

        // Las miniaturas WebP se generan únicamente para imágenes.
        if (mediaType === 'image') {
          await makeThumb(dest, path.join(dirs.thumbs, `${id}.webp`))
        }

        results.push({ name, id })
      } catch (e) {
        req.log.error({ err: e, filename: name }, 'Error al procesar archivo')

        results.push({
          name,
          error:
            mediaType === 'video'
              ? 'no se pudo procesar el vídeo'
              : 'no se pudo procesar (¿es una imagen válida?)',
        })
      } finally {
        await fsp.rm(tmp, { force: true })
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
      `SELECT
         id,
         original_name,
         width,
         height,
         taken_at,
         size_bytes,
         media_type,
         duration
       FROM photos
       WHERE user_id = ? AND ${filter}
       ORDER BY taken_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [req.user!.id, lim, off],
    )
  })

  // ---------- USO DE ALMACENAMIENTO ----------

  app.get('/api/usage', auth, async (req) => {
    const row = await db.get(
      `SELECT COALESCE(SUM(size_bytes), 0) AS n
       FROM photos WHERE user_id = ?`,
      [req.user!.id],
    )

    return {
      used_bytes: Number(row.n),
      quota_bytes: Number(req.user!.quota_bytes),
    }
  })

  // ---------- MINIATURAS ----------

  app.get('/api/photos/:id/thumb', auth, async (req, reply) => {
    const p = await own(req) as StoredMedia | undefined

    if (!p) {
      return reply.code(404).send({ error: 'no existe' })
    }

    if (p.media_type === 'video') {
      return reply.code(415).send({
        error: 'las miniaturas de vídeo todavía no están disponibles',
      })
    }

    const src = path.join(config.originalsDir, p.rel_path)
    const thumb = path.join(dirs.thumbs, `${p.id}.webp`)

    try {
      await fsp.access(thumb).catch(async () => {
        await makeThumb(src, thumb)
      })
    } catch (e) {
      req.log.error({ err: e, photoId: p.id }, 'No se pudo generar miniatura')
      return reply.code(500).send({ error: 'no se pudo generar la miniatura' })
    }

    return reply
      .header('Cache-Control', 'private, max-age=86400')
      .type('image/webp')
      .send(fs.createReadStream(thumb))
  })

  // ---------- SERVIR ORIGINALES Y VÍDEOS CON HTTP RANGE ----------

  app.get('/api/photos/:id/file', auth, async (req, reply) => {
    const p = await own(req) as StoredMedia | undefined

    if (!p) {
      return reply.code(404).send({ error: 'no existe' })
    }

    const filePath = path.join(config.originalsDir, p.rel_path)

    let stat: fs.Stats

    try {
      stat = await fsp.stat(filePath)
    } catch {
      return reply.code(404).send({ error: 'archivo no encontrado' })
    }

    const ext = path.extname(p.rel_path).slice(1).toLowerCase()
    const mime = MIME[ext] ?? 'application/octet-stream'
    const range = req.headers.range

    reply
      .header('Cache-Control', 'private, max-age=86400')
      .header('Accept-Ranges', 'bytes')
      .type(mime)

    if (!range) {
      return reply
        .header('Content-Length', stat.size)
        .send(fs.createReadStream(filePath))
    }

    // Soporta una sola sección de bytes, como la que utiliza el reproductor.
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())

    if (!match || stat.size === 0) {
      return reply
        .code(416)
        .header('Content-Range', `bytes */${stat.size}`)
        .send()
    }

    const startText = match[1]
    const endText = match[2]

    let start: number
    let end: number

    if (startText === '') {
      // Rango de sufijo: bytes=-500 significa los últimos 500 bytes.
      const suffixLength = Number(endText)

      if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
        return reply
          .code(416)
          .header('Content-Range', `bytes */${stat.size}`)
          .send()
      }

      start = Math.max(stat.size - suffixLength, 0)
      end = stat.size - 1
    } else {
      start = Number(startText)
      end = endText === '' ? stat.size - 1 : Number(endText)

      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end < start ||
        start >= stat.size
      ) {
        return reply
          .code(416)
          .header('Content-Range', `bytes */${stat.size}`)
          .send()
      }

      end = Math.min(end, stat.size - 1)
    }

    const contentLength = end - start + 1

    return reply
      .code(206)
      .header('Content-Range', `bytes ${start}-${end}/${stat.size}`)
      .header('Content-Length', contentLength)
      .send(fs.createReadStream(filePath, { start, end }))
  })

  // ---------- PAPELERA ----------

  app.delete('/api/photos/trash', auth, async (req) => {
    const userId = req.user!.id

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
          'No se pudo eliminar el archivo original',
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
          'No se pudo eliminar la miniatura',
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
    const result = await db.run(
      `UPDATE photos
       SET deleted_at = ?
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [Date.now(), photoId(req), req.user!.id],
    )

    return result.changes
      ? { ok: true }
      : reply.code(404).send({ error: 'no existe' })
  })

  app.post('/api/photos/:id/restore', auth, async (req, reply) => {
    const result = await db.run(
      `UPDATE photos
       SET deleted_at = NULL
       WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL`,
      [photoId(req), req.user!.id],
    )

    return result.changes
      ? { ok: true }
      : reply.code(404).send({ error: 'no existe' })
  })
}
