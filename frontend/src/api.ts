import type {
  AuthorGroupsView,
  AuthorsView,
  CommitDetail,
  CommitsView,
  FileView,
  Filters,
  ObjectsView,
  Repo,
  RepoView,
} from './types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) {
    const detail =
      body && typeof body === 'object' && 'detail' in body
        ? (body as { detail: unknown }).detail
        : text || res.statusText
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return body as T
}

export function filtersToParams(
  filters: Filters,
  extra: Record<string, string | number | boolean> = {},
): string {
  const params = new URLSearchParams()
  if (filters.authors && filters.authors.length) params.set('authors', filters.authors.join(','))
  if (filters.path) params.set('path', filters.path)
  if (filters.fromTs != null) params.set('from_ts', String(filters.fromTs))
  if (filters.toTs != null) params.set('to_ts', String(filters.toTs))
  if (filters.shas != null) params.set('shas', filters.shas.join(','))
  if (filters.bucket) params.set('bucket', filters.bucket)
  for (const [key, value] of Object.entries(extra)) params.set(key, String(value))
  return params.toString()
}

export const api = {
  repos: () => request<Repo[]>('/api/repos'),
  repo: (id: number) => request<Repo>(`/api/repos/${id}`),
  createRepo: (body: { url: string; name?: string; ref?: string }) =>
    request<Repo>('/api/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  uploadRepo: (file: File, name?: string, ref?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (name) form.append('name', name)
    if (ref) form.append('ref', ref)
    return request<Repo>('/api/repos/upload', { method: 'POST', body: form })
  },
  deleteRepo: (id: number) => request<void>(`/api/repos/${id}`, { method: 'DELETE' }),

  metrics: (
    id: number,
    level: 'repo' | 'files' | 'dirs' | 'authors',
    filters: Filters,
    extra: Record<string, string | number | boolean> = {},
  ) =>
    request<RepoView | ObjectsView | AuthorsView>(
      `/api/repos/${id}/metrics?level=${level}&${filtersToParams(filters, extra)}`,
    ),
  file: (id: number, filters: Filters) =>
    request<FileView>(`/api/repos/${id}/file?${filtersToParams(filters)}`),
  commits: (
    id: number,
    filters: Filters,
    q: string,
    limit: number,
    offset: number,
  ) =>
    request<CommitsView>(
      `/api/repos/${id}/commits?${filtersToParams(filters, { q, limit, offset })}`,
    ),
  commit: (id: number, sha: string) =>
    request<CommitDetail>(`/api/repos/${id}/commit/${sha}`),

  authorGroups: (id: number) => request<AuthorGroupsView>(`/api/repos/${id}/authors`),
  mergeAuthors: (id: number, target: string, members: string[]) =>
    request<unknown>(`/api/repos/${id}/authors/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, members }),
    }),
  unmergeAuthors: (id: number, ids: string[]) =>
    request<unknown>(`/api/repos/${id}/authors/unmerge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    }),
  resetAuthors: (id: number) =>
    request<unknown>(`/api/repos/${id}/authors/reset`, { method: 'POST' }),
}
