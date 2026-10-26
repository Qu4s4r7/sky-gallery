export type Me = {
  id: number
  username: string
  role: 'admin' | 'user'
  quota_bytes: number
}

export type Photo = {
  id: number
  original_name: string
  width: number | null
  height: number | null
  taken_at: number
  size_bytes: number
  media_type: 'image' | 'video'
  duration: number | null
}

export type UserRow = {
  id: number
  username: string
  role: string
  quota_bytes: number
  used_bytes: number
  photo_count: number
}

export type UploadResult = {
  name: string
  id?: number
  error?: string
}

export type Album = {
  id: number
  user_id: number
  name: string
  description: string
  created_at: number
  updated_at: number
  photo_count?: number
}

export type AlbumPhotos = {
  album: Album
  photos: Photo[]
}

export const fmtBytes = (n: number) =>
  n >= 1024 ** 3
    ? `${(n / 1024 ** 3).toFixed(1)} GB`
    : `${(n / 1024 ** 2).toFixed(0)} MB`

async function request<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const r = await fetch(url, init)

  if (!r.ok) {
    const body = await r.json().catch(() => ({}))
    throw new Error(body.error ?? `error ${r.status}`)
  }

  return r.json()
}

const withJson = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
})

export const api = {
  // Autenticación y sesión
  me: () => request<Me>('/api/me'),

  login: (username: string, password: string) =>
    request<{ username: string }>(
      '/api/login',
      withJson('POST', { username, password }),
    ),

  logout: () =>
    request('/api/logout', { method: 'POST' }),

  // Uso de almacenamiento
  usage: () =>
    request<{ used_bytes: number; quota_bytes: number }>('/api/usage'),

  // Fotos y vídeos
  photos: (offset: number, limit: number, trash: boolean) =>
    request<Photo[]>(
      `/api/photos?offset=${offset}&limit=${limit}${trash ? '&trash=1' : ''}`,
    ),

  emptyTrash: () =>
    request<{
      ok: boolean
      deleted: number
      cleanupFailures: number
    }>('/api/photos/trash', { method: 'DELETE' }),

  remove: (id: number) =>
    request(`/api/photos/${id}`, { method: 'DELETE' }),

  restore: (id: number) =>
    request(`/api/photos/${id}/restore`, { method: 'POST' }),

  upload: (files: File[]) => {
    const fd = new FormData()
    files.forEach((f) => fd.append('files', f))

    return request<UploadResult[]>('/api/photos', {
      method: 'POST',
      body: fd,
    })
  },

  thumb: (id: number) => `/api/photos/${id}/thumb?v=2`,
  file: (id: number) => `/api/photos/${id}/file`,

  // Administración de usuarios
  users: () =>
    request<UserRow[]>('/api/admin/users'),

  createUser: (u: {
    username: string
    password: string
    role: string
    quota_gb?: number
  }) =>
    request('/api/admin/users', withJson('POST', u)),

  deleteUser: (id: number, photos?: 'transfer' | 'detach') =>
    request<{
      ok: boolean
      transferred: number
      duplicates: number
      archived: string | null
    }>(
      `/api/admin/users/${id}${photos ? `?photos=${photos}` : ''}`,
      { method: 'DELETE' },
    ),

  // Álbumes
  albums: () =>
    request<Album[]>('/api/albums'),

  createAlbum: (data: {
    name: string
    description: string
  }) =>
    request<Album>('/api/albums', withJson('POST', data)),

  updateAlbum: (
    id: number,
    data: {
      name?: string
      description?: string
    },
  ) =>
    request<Album>(
      `/api/albums/${id}`,
      withJson('PATCH', data),
    ),

  deleteAlbum: (id: number) =>
    request<{ ok: boolean }>(
      `/api/albums/${id}`,
      { method: 'DELETE' },
    ),

  albumPhotos: (id: number) =>
    request<AlbumPhotos>(`/api/albums/${id}/photos`),

  addPhotosToAlbum: (id: number, photo_ids: number[]) =>
    request<{ ok: boolean; added: number }>(
      `/api/albums/${id}/photos`,
      withJson('POST', { photo_ids }),
    ),

  removePhotoFromAlbum: (albumId: number, photoId: number) =>
    request<{ ok: boolean }>(
      `/api/albums/${albumId}/photos/${photoId}`,
      { method: 'DELETE' },
    ),
}
