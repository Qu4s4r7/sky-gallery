import pg from 'pg'
import { config } from './config.js'

// BIGINT (20) y numeric (1700, resultado de SUM) llegan como string: se pasan a número
pg.types.setTypeParser(20, (v) => Number(v))
pg.types.setTypeParser(1700, (v) => Number(v))

const pool = new pg.Pool({ connectionString: config.databaseUrl })

// "?" -> "$1, $2, ..."
const fix = (sql: string) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`) }

type Conn = {
  query: (text: string, values?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>
}

type Q = {
  all: (sql: string, params?: unknown[]) => Promise<any[]>
  get: (sql: string, params?: unknown[]) => Promise<any | undefined>
  run: (sql: string, params?: unknown[]) => Promise<{ changes: number; rows: any[] }>
}

const queryer = (c: Conn): Q => ({
  all: async (sql, params = []) => (await c.query(fix(sql), params as any[])).rows,
  get: async (sql, params = []) => (await c.query(fix(sql), params as any[])).rows[0],
  run: async (sql, params = []) => {
    const r = await c.query(fix(sql), params as any[])
    return { changes: r.rowCount ?? 0, rows: r.rows }
  },
})

export const db = {
  ...queryer(pool),

  // varias consultas atómicas: o se aplican todas o ninguna
  tx: async <T>(fn: (q: Q) => Promise<T>): Promise<T> => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const out = await fn(queryer(client))
      await client.query('COMMIT')
      return out
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      client.release()
    }
  },
}
await pool.query(`
CREATE TABLE IF NOT EXISTS users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  quota_bytes BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS photos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  rel_path TEXT NOT NULL,
  original_name TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  width INTEGER,
  height INTEGER,
  taken_at BIGINT NOT NULL,
  exif JSONB,
  deleted_at BIGINT,
  created_at BIGINT NOT NULL,
  UNIQUE (user_id, sha256)
);

CREATE INDEX IF NOT EXISTS idx_photos_user_taken ON photos (user_id, taken_at DESC);

CREATE TABLE IF NOT EXISTS albums (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS album_photos (
  album_id BIGINT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  photo_id BIGINT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  added_at BIGINT NOT NULL,
  PRIMARY KEY (album_id, photo_id)
);

CREATE INDEX IF NOT EXISTS idx_albums_user
  ON albums (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_album_photos_photo
  ON album_photos (photo_id);
`)
