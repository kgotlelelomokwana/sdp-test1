import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
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

export function useRepos(pollMs = false) {
  return useQuery<Repo[]>({
    queryKey: ['repos'],
    queryFn: api.repos,
    refetchInterval: pollMs ? 1000 : false,
  })
}

export function useRepo(id: number) {
  return useQuery<Repo>({
    queryKey: ['repo', id],
    queryFn: () => api.repo(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && status !== 'ready' && status !== 'error' ? 800 : false
    },
  })
}

export function useRepoView(id: number, filters: Filters, enabled = true) {
  return useQuery<RepoView>({
    queryKey: ['metrics', id, 'repo', filters],
    queryFn: () => api.metrics(id, 'repo', filters) as Promise<RepoView>,
    enabled: enabled && Number.isFinite(id),
    staleTime: 30_000,
  })
}

export function useObjectsView(
  id: number,
  level: 'files' | 'dirs',
  filters: Filters,
  extra: Record<string, string | number | boolean>,
) {
  return useQuery<ObjectsView>({
    queryKey: ['metrics', id, level, filters, extra],
    queryFn: () => api.metrics(id, level, filters, extra) as Promise<ObjectsView>,
    enabled: Number.isFinite(id),
    staleTime: 30_000,
  })
}

export function useAuthorsView(id: number, filters: Filters) {
  return useQuery<AuthorsView>({
    queryKey: ['metrics', id, 'authors', filters],
    queryFn: () => api.metrics(id, 'authors', filters) as Promise<AuthorsView>,
    enabled: Number.isFinite(id),
    staleTime: 30_000,
  })
}

export function useFileView(id: number, filters: Filters, enabled: boolean) {
  return useQuery<FileView>({
    queryKey: ['file', id, filters],
    queryFn: () => api.file(id, filters),
    enabled: enabled && Number.isFinite(id),
    staleTime: 30_000,
  })
}

export function useCommits(
  id: number,
  filters: Filters,
  q: string,
  limit: number,
  offset: number,
) {
  return useQuery<CommitsView>({
    queryKey: ['commits', id, filters, q, limit, offset],
    queryFn: () => api.commits(id, filters, q, limit, offset),
    enabled: Number.isFinite(id),
    placeholderData: (previous) => previous,
  })
}

export function useCommitDetail(id: number, sha: string | null) {
  return useQuery<CommitDetail>({
    queryKey: ['commit', id, sha],
    queryFn: () => api.commit(id, sha as string),
    enabled: sha != null && Number.isFinite(id),
  })
}

export function useAuthorGroups(id: number) {
  return useQuery<AuthorGroupsView>({
    queryKey: ['authorGroups', id],
    queryFn: () => api.authorGroups(id),
    enabled: Number.isFinite(id),
  })
}

function useInvalidateRepo(id: number) {
  const client = useQueryClient()
  return () => {
    client.invalidateQueries({ queryKey: ['metrics', id] })
    client.invalidateQueries({ queryKey: ['file', id] })
    client.invalidateQueries({ queryKey: ['commits', id] })
    client.invalidateQueries({ queryKey: ['commit', id] })
    client.invalidateQueries({ queryKey: ['authorGroups', id] })
  }
}

export function useAuthorMutations(id: number) {
  const invalidate = useInvalidateRepo(id)
  const merge = useMutation({
    mutationFn: (variables: { target: string; members: string[] }) =>
      api.mergeAuthors(id, variables.target, variables.members),
    onSuccess: invalidate,
  })
  const unmerge = useMutation({
    mutationFn: (variables: { ids: string[] }) => api.unmergeAuthors(id, variables.ids),
    onSuccess: invalidate,
  })
  const reset = useMutation({
    mutationFn: () => api.resetAuthors(id),
    onSuccess: invalidate,
  })
  return { merge, unmerge, reset }
}

export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

export function useRepoMutations() {
  const client = useQueryClient()
  const create = useMutation({
    mutationFn: (body: { url: string; name?: string; ref?: string }) => api.createRepo(body),
    onSuccess: () => client.invalidateQueries({ queryKey: ['repos'] }),
  })
  const upload = useMutation({
    mutationFn: (variables: { file: File; name?: string; ref?: string }) =>
      api.uploadRepo(variables.file, variables.name, variables.ref),
    onSuccess: () => client.invalidateQueries({ queryKey: ['repos'] }),
  })
  const remove = useMutation({
    mutationFn: (repoId: number) => api.deleteRepo(repoId),
    onSuccess: () => client.invalidateQueries({ queryKey: ['repos'] }),
  })
  return { create, upload, remove }
}
