import { NavLink } from 'react-router-dom'
import { useRepos } from '../hooks'
import { fmtInt } from '../format'
import { useTheme } from '../theme'
import type { Repo } from '../types'

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4.4" />
      <path d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
      <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  )
}

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
  const { theme, toggle } = useTheme()

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            R
          </span>
          <span className="brand-text">
            <span className="brand-word-row">
              <span className="brand-word">RAT</span>
              <span className="brand-dot">.</span>
            </span>
            <span className="brand-sub">Repository Analysis Tool</span>
          </span>
        </div>
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
      <div className="sidebar-theme">
        <button
          type="button"
          className="theme-toggle"
          data-mode={theme}
          onClick={toggle}
          title="Toggle light / dark theme"
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          <span className="tt-track">
            <span className="tt-icon tt-sun">
              <SunIcon />
            </span>
            <span className="tt-icon tt-moon">
              <MoonIcon />
            </span>
            <span className="tt-thumb">{theme === 'dark' ? <MoonIcon /> : <SunIcon />}</span>
          </span>
          <span className="tt-label">{theme === 'dark' ? 'Dark mode' : 'Light mode'}</span>
        </button>
      </div>
      <div className="sidebar-foot">
        COMS3011A test build · committer dates · 50% rename detection
      </div>
    </aside>
  )
}
