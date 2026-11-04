
import type { FastifyInstance } from 'fastify'
import { db } from './db.js'
import { requireUser } from './auth.js'

type AlbumBody = {
  name?: unknown
  description?: unknown
  cover_photo_id?: unknown
}

type AlbumPhotosBody = {
  photo_ids?: unknown
}

function parseId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) {
    return null
  }

  const id = Number(value)

  return Number.isSafeInteger(id) ? id : null
}

function parsePhotoIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) {
    return null
  }

  const ids: number[] = []

  for (const item of value) {
    let id: number

    if (typeof item === 'number') {
      id = item
    } else if (typeof item === 'string' && /^[1-9]\d*$/.test(item)) {
      id = Number(item)
    } else {
      return null
    }

    if (!Number.isSafeInteger(id) || id <= 0) {
      return null
    }

    ids.push(id)
  }

  return [...new Set(ids)]
}

export function albumRoutes(app: FastifyInstance) {
  // GET /api/albums
  // Lista los álbumes del usuario autenticado.
  app.get(
    '/api/albums',
    { preHandler: requireUser },
    async (req) => {
      return db.all(
        `SELECT
          a.id,
          a.user_id,
          a.name,
          a.description,
          a.created_at,
          a.updated_at,
          a.cover_photo_id,
          (
            SELECT COUNT(*)
            FROM album_photos ap
            JOIN photos p ON p.id = ap.photo_id
            WHERE ap.album_id = a.id
              AND p.user_id = a.user_id
              AND p.deleted_at IS NULL
          ) AS photo_count
        FROM albums a
        WHERE a.user_id = ?
        ORDER BY a.created_at DESC`,
        [req.user!.id],
      )
    },
  )

  // POST /api/albums
  // Crea un álbum.
  app.post(
    '/api/albums',
    { preHandler: requireUser },
    async (req, reply) => {
      const body = (req.body ?? {}) as AlbumBody

      const name =
        typeof body.name === 'string' ? body.name.trim() : ''

      const description =
        typeof body.description === 'string'
          ? body.description.trim()
          : ''

      if (!name || name.length > 100) {
        return reply.code(400).send({
          error: 'El nombre es obligatorio y debe tener máximo 100 caracteres',
        })
      }

      if (description.length > 1000) {
        return reply.code(400).send({
          error: 'La descripción no puede superar los 1000 caracteres',
        })
      }

      const now = Date.now()

      try {
        const result = await db.run(
          `INSERT INTO albums (
             user_id,
             name,
             description,
             created_at,
             updated_at
           )
           VALUES (?, ?, ?, ?, ?)
           RETURNING
             id,
             user_id,
             name,
             description,
             created_at,
             updated_at,
             cover_photo_id`,
          [req.user!.id, name, description, now, now],
        )

        return reply.code(201).send(result.rows[0])
      } catch (error: unknown) {
        const pgError = error as { code?: string }

        if (pgError.code === '23505') {
          return reply.code(409).send({
            error: 'Ya tienes un álbum con ese nombre',
          })
        }

        throw error
      }
    },
  )

  // PATCH /api/albums/:id
  // Actualiza nombre, descripción y fotografía de portada.
  app.patch(
    '/api/albums/:id',
    { preHandler: requireUser },
    async (req, reply) => {
      const { id: rawId } = req.params as { id: string }
      const albumId = parseId(rawId)

      if (albumId === null) {
        return reply.code(400).send({
          error: 'ID de álbum inválido',
        })
      }

      const body = (req.body ?? {}) as AlbumBody

      if (
        body.name === undefined &&
        body.description === undefined &&
        body.cover_photo_id === undefined
      ) {
        return reply.code(400).send({
          error: 'Debes proporcionar algún campo para actualizar',
        })
      }

      if (
        body.name !== undefined &&
        (
          typeof body.name !== 'string' ||
          !body.name.trim() ||
          body.name.trim().length > 100
        )
      ) {
        return reply.code(400).send({
          error: 'El nombre debe tener entre 1 y 100 caracteres',
        })
      }

      if (
        body.description !== undefined &&
        (
          typeof body.description !== 'string' ||
          body.description.trim().length > 1000
        )
      ) {
        return reply.code(400).send({
          error: 'La descripción no puede superar los 1000 caracteres',
        })
      }

      const existing = await db.get(
        'SELECT * FROM albums WHERE id = ? AND user_id = ?',
        [albumId, req.user!.id],
      )

      if (!existing) {
        return reply.code(404).send({
          error: 'Álbum no encontrado',
        })
      }

      const name =
        body.name === undefined
          ? existing.name
          : (body.name as string).trim()

      const description =
        body.description === undefined
          ? existing.description
          : (body.description as string).trim()

      let coverPhotoId: number | null = existing.cover_photo_id ?? null

      if (body.cover_photo_id !== undefined) {
        if (body.cover_photo_id === null) {
          coverPhotoId = null
        } else {
          const value = body.cover_photo_id

          const parsed =
            typeof value === 'number'
              ? value
              : typeof value === 'string' && /^[1-9]\d*$/.test(value)
                ? Number(value)
                : NaN

          if (!Number.isSafeInteger(parsed) || parsed <= 0) {
            return reply.code(400).send({
              error: 'ID de portada inválido',
            })
          }

          // La fotografía debe pertenecer al usuario,
          // estar activa y formar parte del álbum.
          const photo = await db.get(
            `SELECT p.id
             FROM photos p
             JOIN album_photos ap ON ap.photo_id = p.id
             WHERE p.id = ?
               AND p.user_id = ?
               AND p.deleted_at IS NULL
               AND ap.album_id = ?`,
            [parsed, req.user!.id, albumId],
          )

          if (!photo) {
            return reply.code(400).send({
              error: 'La fotografía seleccionada no pertenece a este álbum',
            })
          }

          coverPhotoId = parsed
        }
      }

      try {
        const result = await db.run(
          `UPDATE albums
           SET name = ?,
               description = ?,
               cover_photo_id = ?,
               updated_at = ?
           WHERE id = ? AND user_id = ?
           RETURNING *`,
          [
            name,
            description,
            coverPhotoId,
            Date.now(),
            albumId,
            req.user!.id,
          ],
        )

        return result.rows[0]
      } catch (error: unknown) {
        const pgError = error as { code?: string }

        if (pgError.code === '23505') {
          return reply.code(409).send({
            error: 'Ya tienes otro álbum con ese nombre',
          })
        }

        throw error
      }
    },
  )

  // GET /api/albums/:id/photos
  // Obtiene las fotografías de un álbum propio.
  app.get(
    '/api/albums/:id/photos',
    { preHandler: requireUser },
    async (req, reply) => {
      const { id: rawId } = req.params as { id: string }
      const albumId = parseId(rawId)

      if (albumId === null) {
        return reply.code(400).send({
          error: 'ID de álbum inválido',
        })
      }

      const album = await db.get(
        'SELECT * FROM albums WHERE id = ? AND user_id = ?',
        [albumId, req.user!.id],
      )

      if (!album) {
        return reply.code(404).send({
          error: 'Álbum no encontrado',
        })
      }

      const photos = await db.all(
        `SELECT p.*
         FROM photos p
         JOIN album_photos ap ON ap.photo_id = p.id
         WHERE ap.album_id = ?
           AND p.user_id = ?
           AND p.deleted_at IS NULL
         ORDER BY ap.added_at DESC`,
        [albumId, req.user!.id],
      )

      return { album, photos }
    },
  )

  // POST /api/albums/:id/photos
  // Añade fotografías al álbum.
  app.post(
    '/api/albums/:id/photos',
    { preHandler: requireUser },
    async (req, reply) => {
      const { id: rawId } = req.params as { id: string }
      const albumId = parseId(rawId)

      if (albumId === null) {
        return reply.code(400).send({
          error: 'ID de álbum inválido',
        })
      }

      const body = (req.body ?? {}) as AlbumPhotosBody
      const photoIds = parsePhotoIds(body.photo_ids)

      if (!photoIds) {
        return reply.code(400).send({
          error: 'Envía entre 1 y 500 IDs de fotografías válidos',
        })
      }

      const album = await db.get(
        'SELECT id FROM albums WHERE id = ? AND user_id = ?',
        [albumId, req.user!.id],
      )

      if (!album) {
        return reply.code(404).send({
          error: 'Álbum no encontrado',
        })
      }

      const placeholders = photoIds.map(() => '?').join(', ')

      const photos = await db.all(
        `SELECT id
         FROM photos
         WHERE user_id = ?
           AND deleted_at IS NULL
           AND id IN (${placeholders})`,
        [req.user!.id, ...photoIds],
      )

      if (photos.length !== photoIds.length) {
        return reply.code(400).send({
          error: 'Hay fotografías inexistentes, eliminadas o que no te pertenecen',
        })
      }

      const now = Date.now()

      const result = await db.run(
        `INSERT INTO album_photos (album_id, photo_id, added_at)
         SELECT ?, p.id, ?
         FROM photos p
         WHERE p.user_id = ?
           AND p.deleted_at IS NULL
           AND p.id IN (${placeholders})
         ON CONFLICT (album_id, photo_id) DO NOTHING
         RETURNING photo_id`,
        [albumId, now, req.user!.id, ...photoIds],
      )

      return {
        ok: true,
        added: result.changes,
      }
    },
  )

  // DELETE /api/albums/:id/photos/:photoId
  // Quita una foto del álbum, pero no borra el archivo original.
  app.delete(
    '/api/albums/:id/photos/:photoId',
    { preHandler: requireUser },
    async (req, reply) => {
      const { id: rawId, photoId: rawPhotoId } = req.params as {
        id: string
        photoId: string
      }

      const albumId = parseId(rawId)
      const photoId = parseId(rawPhotoId)

      if (albumId === null || photoId === null) {
        return reply.code(400).send({
          error: 'ID inválido',
        })
      }

      const result = await db.run(
        `DELETE FROM album_photos ap
         WHERE ap.album_id = ?
           AND ap.photo_id = ?
           AND EXISTS (
             SELECT 1
             FROM albums a
             WHERE a.id = ap.album_id
               AND a.user_id = ?
           )`,
        [albumId, photoId, req.user!.id],
      )

      if (result.changes === 0) {
        return reply.code(404).send({
          error: 'No se encontró esa fotografía en tu álbum',
        })
      }

      // Si era la portada, la quitamos.
      await db.run(
        `UPDATE albums
         SET cover_photo_id = NULL,
             updated_at = ?
         WHERE id = ?
           AND user_id = ?
           AND cover_photo_id = ?`,
        [Date.now(), albumId, req.user!.id, photoId],
      )

      return { ok: true }
    },
  )

  // DELETE /api/albums/:id
  // Elimina el álbum y sus relaciones, nunca los archivos originales.
  app.delete(
    '/api/albums/:id',
    { preHandler: requireUser },
    async (req, reply) => {
      const { id: rawId } = req.params as { id: string }
      const albumId = parseId(rawId)

      if (albumId === null) {
        return reply.code(400).send({
          error: 'ID de álbum inválido',
        })
      }

      const result = await db.run(
        'DELETE FROM albums WHERE id = ? AND user_id = ?',
        [albumId, req.user!.id],
      )

      if (result.changes === 0) {
        return reply.code(404).send({
          error: 'Álbum no encontrado',
        })
      }

      return { ok: true }
    },
  )
}
