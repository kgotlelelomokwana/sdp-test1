import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useRepo, useRepoView } from '../hooks'
import type { Filters } from '../types'
import { fmtFloat, fmtInt, fmtPercent, shortSha } from '../format'
import { FilterBar } from '../components/FilterBar'
import { FileDrawer } from '../components/FileDrawer'
import { statusDot, statusLabel } from '../components/Sidebar'
import { AuthorsPanel } from '../panels/AuthorsPanel'
import { CommitsPanel } from '../panels/CommitsPanel'
import { ObjectsPanel } from '../panels/ObjectsPanel'
import { OverviewPanel } from '../panels/OverviewPanel'

type Tab = 'overview' | 'files' | 'dirs' | 'authors' | 'commits'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'files', label: 'Files' },
  { id: 'dirs', label: 'Directories' },
  { id: 'authors', label: 'Authors' },
  { id: 'commits', label: 'Commits' },
]

export function Dashboard() {
  const params = useParams()
  const id = Number(params.repoId)
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = (searchParams.get('tab') as Tab) ?? 'overview'
  const repoQuery = useRepo(id)
  const repo = repoQuery.data
  const ready = repo?.status === 'ready'

  const [filters, setFilters] = useState<Filters>({})
  const [filePath, setFilePath] = useState<string | null>(null)
  const [openSha, setOpenSha] = useState<string | null>(null)
  const repoView = useRepoView(id, filters, ready)
  const client = useQueryClient()

  useEffect(() => {
    setFilters({})
    setFilePath(null)
    setOpenSha(null)
  }, [id])

  function setTab(next: Tab) {
    setSearchParams(next === 'overview' ? {} : { tab: next })
  }

  function setPath(path: string | undefined) {
    setFilters((previous) => ({ ...previous, path: path || undefined }))
  }

  function drillDir(path: string) {
    setPath(path)
    setTab('dirs')
  }

  function focusAuthor(authorId: string) {
    setFilters((previous) => ({ ...previous, authors: [authorId] }))
    setFilePath(null)
    setTab('authors')
  }

  function openCommit(sha: string) {
    setFilePath(null)
    setOpenSha(sha)
    setTab('commits')
  }

  if (!Number.isFinite(id)) {
    return (
      <div className="content">
        <div className="card empty-state">
          Invalid repository id. <Link to="/">Back to repositories</Link>
        </div>
      </div>
    )
  }

  if (repoQuery.isError) {
    return (
      <div className="content">
        <div className="card empty-state">
          {String((repoQuery.error as Error).message)} — <Link to="/">back to repositories</Link>
        </div>
      </div>
    )
  }

  if (!repo) {
    return (
      <div className="content">
        <div className="card empty-state">
          <span className="spinner" /> Loading repository…
        </div>
      </div>
    )
  }

  if (!ready) {
    const busy = repo.status !== 'error'
    return (
      <div className="content">
        <div className="page-head">
          <div className="page-title">
            <span className="row" style={{ gap: 10 }}>
              <span className={statusDot(repo)} />
              {repo.name}
            </span>
          </div>
          <div className="page-sub">{repo.source}</div>
        </div>
        <div className="card" style={{ maxWidth: 640 }}>
          {busy ? (
            <>
              <div className="card-title" style={{ marginBottom: 10 }}>
                {repo.stage ?? 'Ingesting repository…'}
              </div>
              <div className="progress">
                <div className="progress-bar" style={{ width: `${Math.round((repo.progress || 0) * 100)}%` }} />
              </div>
              <div className="note">
                {Math.round((repo.progress || 0) * 100)}% · this page refreshes automatically. Large
                repositories can take a few minutes while the full history is streamed into the local
                index.
              </div>
            </>
          ) : (
            <>
              <div className="card-title" style={{ marginBottom: 6 }}>
                Ingestion failed
              </div>
              <div className="err-note">{repo.error}</div>
              <div className="note">
                Delete this repository on the <Link to="/">repositories page</Link> and try again with a
                different URL or zip.
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  const kpi = repoView.data?.kpi

  return (
    <>
      <div className="topbar">
        <div className="topbar-left">
          <Link className="btn ghost small" to="/">
            ← Repositories
          </Link>
          <div>
            <div className="topbar-title">
              <span className={statusDot(repo)} />
              {repo.name}
            </div>
            <div className="topbar-sub">
              <span className="tag tag-blue">ref {repo.ref}</span>
              {repo.head_sha && <span className="mono">{shortSha(repo.head_sha)}</span>}
              <span className="tag">{fmtInt(repo.commit_count)} commits</span>
              <span className="tag">{fmtInt(repo.author_count)} authors</span>
              {repo.has_mailmap ? <span className="tag tag-purple">.mailmap</span> : null}
            </div>
          </div>
        </div>
        <div className="row">
          <span className="muted" style={{ fontSize: 12 }}>
            {statusLabel(repo)}
          </span>
          <button
            className="btn small"
            onClick={() => {
              client.invalidateQueries({ queryKey: ['metrics', id] })
              client.invalidateQueries({ queryKey: ['file', id] })
              client.invalidateQueries({ queryKey: ['commits', id] })
              client.invalidateQueries({ queryKey: ['authorGroups', id] })
              client.invalidateQueries({ queryKey: ['repos'] })
            }}
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      <div className="content">
        <FilterBar id={id} filters={filters} onChange={setFilters} />

        {kpi && (
          <div className="kpi-grid">
            <div className="kpi">
              <div className="kpi-label">Commits |H|</div>
              <div className="kpi-value">{fmtInt(kpi.commits)}</div>
              <div className="kpi-sub">non-merge, in selection</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Authors</div>
              <div className="kpi-value">{fmtInt(kpi.authors)}</div>
              <div className="kpi-sub">after merges + mailmap</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Added l+</div>
              <div className="kpi-value pos">+{fmtInt(kpi.added)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Removed l−</div>
              <div className="kpi-value neg">−{fmtInt(kpi.removed)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Growth δ</div>
              <div className={`kpi-value ${kpi.growth >= 0 ? 'pos' : 'neg'}`}>
                {kpi.growth >= 0 ? '+' : '−'}
                {fmtInt(Math.abs(kpi.growth))}
              </div>
              <div className="kpi-sub">δ = l+ − l−</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Churn λ</div>
              <div className="kpi-value">{fmtInt(kpi.churn)}</div>
              <div className="kpi-sub">λ = l+ + l−</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Modifications n</div>
              <div className="kpi-value">{fmtInt(kpi.mods)}</div>
              <div className="kpi-sub">touched objects over H</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Frequency η</div>
              <div className="kpi-value">{fmtFloat(kpi.freq, 3)}</div>
              <div className="kpi-sub">η = n / |H|</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Churn rate ρ</div>
              <div className="kpi-value">{fmtFloat(kpi.churn_rate, 1)}</div>
              <div className="kpi-sub">ρ = λ / |H|</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Objects touched</div>
              <div className="kpi-value">{fmtInt(kpi.files_touched)}</div>
              <div className="kpi-sub">{fmtInt(kpi.dirs_touched)} directories</div>
            </div>
          </div>
        )}

        <div className="tabs">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              className={`tab${tab === entry.id ? ' tab-active' : ''}`}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
              {entry.id === 'commits' && repoView.data ? ` · ${fmtInt(repoView.data.h_count)}` : ''}
            </button>
          ))}
        </div>

        {repoView.isError && <div className="err-note">{String((repoView.error as Error).message)}</div>}

        {tab === 'overview' && (
          <OverviewPanel
            view={repoView.data}
            loading={repoView.isLoading}
            onOpenFile={setFilePath}
            onDrillDir={drillDir}
            onFocusAuthor={focusAuthor}
          />
        )}
        {tab === 'files' && (
          <ObjectsPanel id={id} filters={filters} level="files" onSetPath={setPath} onOpenFile={setFilePath} />
        )}
        {tab === 'dirs' && (
          <ObjectsPanel id={id} filters={filters} level="dirs" onSetPath={setPath} onOpenFile={setFilePath} />
        )}
        {tab === 'authors' && <AuthorsPanel id={id} filters={filters} onFocusAuthor={focusAuthor} />}
        {tab === 'commits' && (
          <CommitsPanel
            id={id}
            filters={filters}
            openSha={openSha}
            onConsumed={() => setOpenSha(null)}
            onOpenFile={setFilePath}
          />
        )}

        <div className="note" style={{ marginTop: 18 }}>
          Metrics computed over H = non-merge commits reachable from {`“${repo.ref}”`}; time filters use
          committer dates; renames detected at 50% similarity; binary files are excluded.
          {repoView.data?.bucket ? ` Time buckets: ${repoView.data.bucket}.` : ''}
        </div>
      </div>

      {filePath && (
        <FileDrawer
          id={id}
          filters={filters}
          path={filePath}
          onClose={() => setFilePath(null)}
          onOpenCommit={openCommit}
          onOpenAuthor={focusAuthor}
        />
      )}
    </>
  )
}
