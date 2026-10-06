import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuthorsView } from '../hooks'
import { fmtInt } from '../format'
import type { Filters } from '../types'
import { CommitPicker } from './CommitPicker'

function useClickAway<T extends HTMLElement>(onAway: () => void) {
  const ref = useRef<T | null>(null)
  const callback = useRef(onAway)
  callback.current = onAway
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) callback.current()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  return ref
}

type CommitMode = 'all' | 'range' | 'selected'

function modeOf(filters: Filters): CommitMode {
  if (filters.shas != null) return 'selected'
  if (filters.fromTs != null || filters.toTs != null) return 'range'
  return 'all'
}

function toDateInput(ts: number | undefined): string {
  if (ts == null) return ''
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

export function FilterBar({
  id,
  filters,
  onChange,
}: {
  id: number
  filters: Filters
  onChange: (filters: Filters) => void
}) {
  const [mode, setMode] = useState<CommitMode>(() => modeOf(filters))
  // Author list for the picker: keep the current time/commit selection but drop
  // the authors filter itself, so you can always pick somebody else.
  const base = useMemo(() => ({ ...filters, authors: undefined }), [filters])
  const { data: authorsView } = useAuthorsView(id, base)
  const authors = authorsView?.rows ?? []

  const [authorsOpen, setAuthorsOpen] = useState(false)
  const [authorQuery, setAuthorQuery] = useState('')
  const [pathDraft, setPathDraft] = useState(filters.path ?? '')
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useClickAway<HTMLDivElement>(() => setAuthorsOpen(false))

  useEffect(() => {
    setPathDraft(filters.path ?? '')
  }, [filters.path])

  const selected = filters.authors ?? []
  const filteredAuthors = authors
    .filter((row) => {
      if (!authorQuery) return true
      const needle = authorQuery.toLowerCase()
      return (
        row.name.toLowerCase().includes(needle) ||
        row.id.toLowerCase().includes(needle) ||
        row.members.some((member) => member.toLowerCase().includes(needle))
      )
    })
    .slice(0, 200)

  function toggleAuthor(authorId: string) {
    const next = new Set(selected)
    if (next.has(authorId)) next.delete(authorId)
    else next.add(authorId)
    onChange({ ...filters, authors: next.size ? [...next] : undefined })
  }

  function applyPath() {
    const next = pathDraft.trim().replace(/^\/+|\/+$/g, '')
    if (next !== (filters.path ?? '')) onChange({ ...filters, path: next || undefined })
  }

  function setCommitMode(next: CommitMode) {
    if (next === 'all') {
      setMode('all')
      onChange({ ...filters, fromTs: undefined, toTs: undefined, shas: undefined })
    } else if (next === 'range') {
      setMode('range')
      onChange({ ...filters, shas: undefined })
    } else {
      setPickerOpen(true)
    }
  }

  function applyRange(fromValue: string, toValue: string) {
    const fromTs = fromValue ? Math.floor(Date.parse(`${fromValue}T00:00:00Z`) / 1000) : undefined
    // End date is inclusive: the exclusive upper bound is the next midnight.
    const toTs = toValue ? Math.floor(Date.parse(`${toValue}T00:00:00Z`) / 1000) + 86400 : undefined
    onChange({
      ...filters,
      shas: undefined,
      fromTs: Number.isFinite(fromTs) ? fromTs : undefined,
      toTs: Number.isFinite(toTs) ? toTs : undefined,
    })
  }

  function applySelected(shas: string[]) {
    setPickerOpen(false)
    if (shas.length === 0) {
      setMode('all')
      onChange({ ...filters, shas: undefined })
      return
    }
    setMode('selected')
    onChange({ ...filters, fromTs: undefined, toTs: undefined, shas })
  }

  const activeCount =
    (selected.length ? 1 : 0) +
    (filters.path ? 1 : 0) +
    (mode !== 'all' ? 1 : 0) +
    (filters.bucket ? 1 : 0)

  return (
    <div className="filterbar">
      <div className="filter-group" ref={pickerRef} style={{ position: 'relative' }}>
        <span className="filter-label">Authors</span>
        <div className="picker">
          <button
            className="btn"
            style={{ minWidth: 170, textAlign: 'left' }}
            onClick={() => setAuthorsOpen((open) => !open)}
          >
            {selected.length ? `${fmtInt(selected.length)} author${selected.length > 1 ? 's' : ''} selected` : 'All authors'}{' '}
            ▾
          </button>
          {authorsOpen && (
            <div className="picker-panel">
              <input
                className="input"
                placeholder="Search name, email or identity…"
                value={authorQuery}
                autoFocus
                onChange={(event) => setAuthorQuery(event.target.value)}
              />
              <div className="picker-list">
                {filteredAuthors.length === 0 && <div className="empty-state">No authors match</div>}
                {filteredAuthors.map((row) => (
                  <label key={row.id} className="picker-item">
                    <input
                      type="checkbox"
                      checked={selected.includes(row.id)}
                      onChange={() => toggleAuthor(row.id)}
                    />
                    <span className="picker-name" title={`${row.name} · ${row.id}`}>
                      {row.name}
                      {row.members.length > 1 ? ` (+${row.members.length - 1})` : ''}
                    </span>
                    <span className="picker-meta">{fmtInt(row.commits)} commits</span>
                  </label>
                ))}
              </div>
              <div className="spread" style={{ marginTop: 8 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  {fmtInt(selected.length)} selected
                </span>
                <button
                  className="btn ghost small"
                  disabled={selected.length === 0}
                  onClick={() => onChange({ ...filters, authors: undefined })}
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {selected.length > 0 && (
        <div className="chips">
          {selected.slice(0, 4).map((authorId) => {
            const row = authors.find((candidate) => candidate.id === authorId)
            return (
              <span key={authorId} className="chip">
                {row?.name ?? authorId}
                <button title="Remove" onClick={() => toggleAuthor(authorId)}>
                  ×
                </button>
              </span>
            )
          })}
          {selected.length > 4 && <span className="chip">+{selected.length - 4}</span>}
        </div>
      )}

      <div className="filter-group filter-grow">
        <span className="filter-label">Path scope</span>
        <input
          className="input"
          placeholder="e.g. src/utils — leave empty for whole repo"
          value={pathDraft}
          onChange={(event) => setPathDraft(event.target.value)}
          onBlur={applyPath}
          onKeyDown={(event) => {
            if (event.key === 'Enter') applyPath()
          }}
        />
      </div>

      <div className="filter-group">
        <span className="filter-label">Commits</span>
        <div className="row" style={{ gap: 8 }}>
          <div className="seg">
            <button className={`seg-item${mode === 'all' ? ' seg-active' : ''}`} onClick={() => setCommitMode('all')}>
              All time
            </button>
            <button
              className={`seg-item${mode === 'range' ? ' seg-active' : ''}`}
              onClick={() => setCommitMode('range')}
            >
              Date range
            </button>
            <button
              className={`seg-item${mode === 'selected' ? ' seg-active' : ''}`}
              onClick={() => setCommitMode('selected')}
            >
              {mode === 'selected' ? `${fmtInt(filters.shas?.length ?? 0)} selected` : 'Select…'}
            </button>
          </div>
          {mode === 'range' && (
            <div className="row" style={{ gap: 6 }}>
              <input
                type="date"
                className="input"
                style={{ width: 150 }}
                value={toDateInput(filters.fromTs)}
                onChange={(event) => applyRange(event.target.value, toDateInput(filters.toTs))}
              />
              <span className="muted">→</span>
              <input
                type="date"
                className="input"
                style={{ width: 150 }}
                value={toDateInput(filters.toTs ? filters.toTs - 86400 : undefined)}
                onChange={(event) => applyRange(toDateInput(filters.fromTs), event.target.value)}
              />
            </div>
          )}
          {mode === 'selected' && (
            <button className="btn small" onClick={() => setPickerOpen(true)}>
              Edit selection…
            </button>
          )}
          {mode === 'range' && filters.fromTs == null && filters.toTs == null && (
            <span className="note">All commits are shown until you pick a from / to date.</span>
          )}
          {mode === 'range' &&
            filters.fromTs != null &&
            filters.toTs != null &&
            filters.fromTs >= filters.toTs && (
              <span className="warn-note">The from-date is after the end-date — no commits match.</span>
            )}
        </div>
      </div>

      <div className="filter-group">
        <span className="filter-label">Bucket</span>
        <select
          className="select"
          style={{ width: 110 }}
          value={filters.bucket ?? 'auto'}
          onChange={(event) =>
            onChange({
              ...filters,
              bucket: event.target.value === 'auto' ? undefined : event.target.value,
            })
          }
        >
          <option value="auto">Auto</option>
          <option value="day">Day</option>
          <option value="week">Week</option>
          <option value="month">Month</option>
        </select>
      </div>

      {activeCount > 0 && (
        <button
          className="btn ghost small"
          onClick={() => {
            setMode('all')
            onChange({ bucket: filters.bucket })
          }}
          title="Clear all filters except bucket preference"
        >
          Reset filters
        </button>
      )}

      {pickerOpen && (
        <CommitPicker
          id={id}
          filters={filters}
          selected={filters.shas ?? []}
          onApply={applySelected}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}
