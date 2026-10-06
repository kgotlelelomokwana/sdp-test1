import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRepos, useRepoMutations } from '../hooks'
import { fmtDateTime, fmtInt } from '../format'
import type { Repo } from '../types'
import { statusLabel } from '../components/Sidebar'

export function ReposPage() {
  const navigate = useNavigate()
  const { data: repos } = useRepos(true)
  const { create, upload, remove } = useRepoMutations()

  const [url, setUrl] = useState('')
  const [urlName, setUrlName] = useState('')
  const [urlRef, setUrlRef] = useState('')

  const [zipFile, setZipFile] = useState<File | null>(null)
  const [zipName, setZipName] = useState('')
  const [zipRef, setZipRef] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement | null>(null)

  function submitUrl() {
    if (!url.trim()) return
    create.mutate(
      { url: url.trim(), name: urlName.trim() || undefined, ref: urlRef.trim() || undefined },
      {
        onSuccess: (repo) => {
          setUrl('')
          setUrlName('')
          setUrlRef('')
          navigate(`/repo/${repo.id}`)
        },
      },
    )
  }

  function submitZip() {
    if (!zipFile) return
    upload.mutate(
      { file: zipFile, name: zipName.trim() || undefined, ref: zipRef.trim() || undefined },
      {
        onSuccess: (repo) => {
          setZipFile(null)
          setZipName('')
          setZipRef('')
          navigate(`/repo/${repo.id}`)
        },
      },
    )
  }

  function pickFile(file: File | null | undefined) {
    if (!file) return
    setZipFile(file)
    if (!zipName) setZipName(file.name.replace(/\.zip$/i, ''))
  }

  const list = repos ?? []

  return (
    <div className="content">
      <div className="page-head">
        <div className="page-title">Repositories</div>
        <div className="page-sub">
          Add a repository by cloning a remote URL (full history) or uploading a zip archive that
          includes the <span className="inline-code">.git</span> directory.
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Clone from URL</div>
              <div className="card-sub">Full mirror clone — works with github.com, gitlab, etc.</div>
            </div>
          </div>
          <div className="field">
            <label className="field-label">Repository URL *</label>
            <input
              className="input"
              placeholder="https://github.com/user/project.git"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && submitUrl()}
            />
          </div>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: 1 }}>
              <label className="field-label">Display name (optional)</label>
              <input
                className="input"
                placeholder="project"
                value={urlName}
                onChange={(event) => setUrlName(event.target.value)}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label className="field-label">Ref (optional)</label>
              <input
                className="input"
                placeholder="HEAD"
                value={urlRef}
                onChange={(event) => setUrlRef(event.target.value)}
              />
            </div>
          </div>
          <button className="btn primary" disabled={create.isPending || !url.trim()} onClick={submitUrl}>
            {create.isPending ? <span className="spinner" /> : 'Clone & analyze'}
          </button>
          {create.isError && <div className="err-note">{String((create.error as Error).message)}</div>}
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Upload zip archive</div>
              <div className="card-sub">Zip the repository folder itself, including its .git directory.</div>
            </div>
          </div>
          <div
            className={`drop${dragOver ? ' drop-over' : ''}`}
            style={{ marginBottom: 12 }}
            onClick={() => fileInput.current?.click()}
            onDragOver={(event) => {
              event.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragOver(false)
              pickFile(event.dataTransfer.files?.[0])
            }}
          >
            {zipFile ? (
              <span>
                <b>{zipFile.name}</b> · {(zipFile.size / (1 << 20)).toFixed(1)} MB
              </span>
            ) : (
              <span>Drop a .zip here or click to browse</span>
            )}
            <input
              ref={fileInput}
              type="file"
              accept=".zip"
              className="sr-only"
              onChange={(event) => pickFile(event.target.files?.[0])}
            />
          </div>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: 1 }}>
              <label className="field-label">Display name (optional)</label>
              <input
                className="input"
                placeholder="my-repo"
                value={zipName}
                onChange={(event) => setZipName(event.target.value)}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label className="field-label">Ref (optional)</label>
              <input
                className="input"
                placeholder="HEAD"
                value={zipRef}
                onChange={(event) => setZipRef(event.target.value)}
              />
            </div>
          </div>
          <button className="btn primary" disabled={upload.isPending || !zipFile} onClick={submitZip}>
            {upload.isPending ? <span className="spinner" /> : 'Upload & analyze'}
          </button>
          {upload.isError && <div className="err-note">{String((upload.error as Error).message)}</div>}
        </div>
      </div>

      <div className="card-head">
        <div className="card-title">Analyzed repositories</div>
        <div className="card-sub">{fmtInt(list.length)} total</div>
      </div>

      {list.length === 0 && (
        <div className="card empty-state">
          No repositories yet — clone a URL or upload a zip above to get started.
        </div>
      )}

      <div className="repo-cards">
        {list.map((repo) => (
          <RepoCard
            key={repo.id}
            repo={repo}
            deleting={remove.isPending && remove.variables === repo.id}
            onOpen={() => navigate(`/repo/${repo.id}`)}
            onDelete={() => {
              if (window.confirm(`Delete “${repo.name}” and all of its analysis data?`)) {
                remove.mutate(repo.id)
              }
            }}
          />
        ))}
      </div>
    </div>
  )
}

function RepoCard({
  repo,
  onOpen,
  onDelete,
  deleting,
}: {
  repo: Repo
  onOpen: () => void
  onDelete: () => void
  deleting: boolean
}) {
  const busy = repo.status !== 'ready' && repo.status !== 'error'
  const stateClass = repo.status === 'ready' ? 'status-ready' : repo.status === 'error' ? 'status-error' : 'status-busy'
  const statusTag = repo.status === 'ready' ? 'tag-green' : repo.status === 'error' ? 'tag-red' : 'tag-yellow'
  return (
    <div className={`repo-card ${stateClass}`}>
      <div className="repo-card-top">
        <div className={`repo-avatar${repo.source_type === 'zip' ? ' avatar-zip' : ''}`} aria-hidden="true">
          {repo.source_type === 'url' ? '🌐' : '🗜'}
        </div>
        <div className="repo-card-heading">
          <div className="repo-card-title">
            <span className="name" title={repo.name}>
              {repo.name}
            </span>
          </div>
          <div className="repo-card-sub" title={repo.source ?? ''}>
            {repo.source}
          </div>
        </div>
        <span className={`tag ${statusTag}`}>{statusLabel(repo)}</span>
      </div>
      <div className="repo-stats">
        <div className="repo-stat">
          <span className="repo-stat-value">{fmtInt(repo.commit_count)}</span>
          <span className="repo-stat-label">Commits</span>
        </div>
        <div className="repo-stat">
          <span className="repo-stat-value">{fmtInt(repo.author_count)}</span>
          <span className="repo-stat-label">Authors</span>
        </div>
        <div className="repo-stat">
          <span className="repo-stat-value ref" title={repo.ref}>
            {repo.ref}
          </span>
          <span className="repo-stat-label">Ref</span>
        </div>
      </div>
      {busy && (
        <div>
          <div className="progress">
            <div className="progress-bar" style={{ width: `${Math.round((repo.progress || 0) * 100)}%` }} />
          </div>
          <div className="note">{repo.stage ?? 'Working…'}</div>
        </div>
      )}
      {repo.status === 'error' && <div className="err-note">{repo.error}</div>}
      <div className="repo-card-foot">
        <span className="muted" style={{ fontSize: 11.5 }}>
          {repo.ingested_at ? `ingested ${fmtDateTime(Date.parse(repo.ingested_at) / 1000)}` : `added ${repo.created_at.slice(0, 16).replace('T', ' ')}`}
        </span>
        <div className="row">
          {repo.has_mailmap ? <span className="tag tag-purple">.mailmap</span> : null}
          <button className="btn danger small" disabled={deleting} onClick={onDelete}>
            {deleting ? <span className="spinner" /> : 'Delete'}
          </button>
          <button className="btn primary small" disabled={repo.status !== 'ready'} onClick={onOpen}>
            Open
          </button>
        </div>
      </div>
    </div>
  )
}
