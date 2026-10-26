import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'smol-toml'

const file = process.env.CONFIG_PATH ?? './config.toml'
const raw = parse(fs.readFileSync(file, 'utf8')) as any

function fail(msg: string): never {
  console.error(`\nconfig: ${msg}\n`)
  process.exit(1)
}

function need<T>(v: T | undefined, name: string): T {
  if (v === undefined) fail(`falta "${name}" en ${file}`)
  return v
}

// "~/algo" se expande a tu carpeta personal; el resultado debe ser absoluto
function absPath(value: string, name: string): string {
  const p = value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value
  if (!path.isAbsolute(p)) fail(`${name} debe ser una ruta absoluta o empezar con ~/ (valor actual: "${value}")`)
  return path.resolve(p)
}

const isInside = (p: string, root: string) => {
  const rel = path.relative(root, p)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

// carpeta de la app (la que contiene src/ o dist/) y raíz del repositorio git, si existe
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function findGitRoot(start: string): string | null {
  let dir = start
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

const guards = [appRoot, findGitRoot(appRoot)].filter((x): x is string => !!x)

// las fotos jamás pueden vivir dentro del código (ni el código dentro de las fotos)
function outsideApp(p: string, name: string): string {
  for (const g of guards) {
    if (isInside(p, g) || isInside(g, p)) {
      fail(`${name} (${p}) está dentro o alrededor de la aplicación/repositorio (${g}).\n` +
           `   Usa una carpeta fuera, por ejemplo ~/galeria-datos/...`)
    }
  }
  return p
}

const originalsDir = outsideApp(
  absPath(need(raw.storage?.originals_dir, 'storage.originals_dir'), 'storage.originals_dir'), 'originals_dir')
const cacheDir = outsideApp(
  absPath(need(raw.storage?.cache_dir, 'storage.cache_dir'), 'storage.cache_dir'), 'cache_dir')

if (isInside(cacheDir, originalsDir) || isInside(originalsDir, cacheDir)) {
  fail('cache_dir y originals_dir no pueden estar uno dentro del otro')
}

// los originales NO se crean solos: si el disco no está montado, la app no escribe en otro sitio
try {
  fs.accessSync(originalsDir, fs.constants.W_OK)
} catch {
  fail(`la carpeta de originales no existe o no se puede escribir: ${originalsDir}\n` +
       `   Créala tú primero:  mkdir -p "${originalsDir}"`)
}

export const config = {
  port: Number(need(raw.server?.port, 'server.port')),
  host: String(raw.server?.host ?? '127.0.0.1'),
  databaseUrl: String(need(raw.database?.url, 'database.url')),
  originalsDir,
  cacheDir,
  defaultQuotaBytes: Number(need(raw.storage?.default_quota_gb, 'storage.default_quota_gb')) * 1024 ** 3,
  maxUploadBytes: Number(need(raw.storage?.max_upload_mb, 'storage.max_upload_mb')) * 1024 ** 2,
  allowedTypes: need<string[]>(raw.storage?.allowed_types, 'storage.allowed_types'),
  trashDays: Number(raw.trash?.retention_days ?? 30),
}

export const dirs = {
  tmp: path.join(cacheDir, 'tmp'),
  thumbs: path.join(cacheDir, 'miniaturas'),
}

// solo la caché se crea sola
for (const d of [cacheDir, dirs.tmp, dirs.thumbs]) fs.mkdirSync(d, { recursive: true })
