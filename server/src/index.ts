import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { config } from './config.js'
import { db } from './db.js'
import { authRoutes } from './auth.js'
import { photoRoutes } from './photos.js'
import { albumRoutes } from './albums.js'
import { userAdminRoutes } from './users.js'

const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 })

await app.register(cookie)
await app.register(multipart, {
  limits: { fileSize: config.maxUploadBytes, files: 100 },
  throwFileSizeLimit: false,
})

authRoutes(app)
userAdminRoutes(app)
photoRoutes(app)
albumRoutes(app)

// Frontend compilado. La ruta relativa es la misma en tu PC (server/src)
// y en el servidor (server/dist): ../../web/dist
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist')

if (fs.existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist })

  // rutas del frontend (/papelera, /albumes/3...) → index.html; lo de /api sigue dando 404 en JSON
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html')
    return reply.code(404).send({ error: 'no encontrado' })
  })
} else {
  app.log.warn(`No existe ${webDist}: solo API. Compila el frontend con: npm --prefix ../web run build`)
}

// limpia sesiones vencidas cada hora
setInterval(() => {
  db.run('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]).catch(() => {})
}, 3_600_000)

await app.listen({ port: config.port, host: config.host })
