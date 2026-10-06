import { NavLink } from 'react-router-dom'
import { useRepos } from '../hooks'
import { fmtInt } from '../format'
import type { Repo } from '../types'

export function statusDot(repo: Repo): string {
  if (repo.status === 'ready') return 'repo-dot dot-ok'
  if (repo.status === 'error') return 'repo-dot dot-err'
  return 'repo-dot dot-warn'
}

export function statusLabel(repo: Repo): string {
  if (repo.status === 'ready') return 'ready'
  if (repo.status === 'error') return 'error'
  if (repo.status === 'cloning') return 'cloning…'
  if (repo.status === 'ingesting') return 'ingesting…'
  return repo.status
}

export function Sidebar() {
  // Poll while anything is in flight so progress bars stay live.
  const { data: repos } = useRepos(true)
  const list = repos ?? []

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          RAT<span>.</span>
        </div>
        <div className="brand-sub">Repository Analysis Tool</div>
      </div>
      <div className="sidebar-nav">
        <NavLink to="/" end className={({ isActive }) => `repo-item${isActive ? ' active' : ''}`}>
          <div className="repo-item-name">
            <span className="repo-dot dot-ok" style={{ visibility: 'hidden' }} />
            Repositories
          </div>
          <div className="repo-item-meta">add · inspect · delete</div>
        </NavLink>
      </div>
      <div className="repo-list">
        <div className="repo-list-title">Analyzed repositories</div>
        {list.length === 0 && <div className="muted" style={{ padding: '4px 8px', fontSize: 12 }}>None yet</div>}
        {list.map((repo) => (
          <NavLink
            key={repo.id}
            to={`/repo/${repo.id}`}
            className={({ isActive }) => `repo-item${isActive ? ' active' : ''}`}
          >
            <div className="repo-item-name">
              <span className={statusDot(repo)} />
              <span className="name">{repo.name}</span>
            </div>
            <div className="repo-item-meta">
              {repo.status === 'ready'
                ? `${fmtInt(repo.commit_count)} commits · ${fmtInt(repo.author_count)} authors`
                : statusLabel(repo)}
            </div>
          </NavLink>
        ))}
      </div>
      <div className="sidebar-foot">
        COMS3011A test build · committer dates · 50% rename detection
      </div>
    </aside>
  )
}
