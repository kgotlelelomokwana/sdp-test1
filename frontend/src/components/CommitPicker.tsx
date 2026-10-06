import { useMemo, useState } from 'react'
import { useCommits, useDebounced } from '../hooks'
import { fmtDate, fmtInt, shortSha } from '../format'
import type { Filters } from '../types'

const PAGE = 50

export function CommitPicker({
  id,
  filters,
  selected,
  onApply,
  onClose,
}: {
  id: number
  filters: Filters
  selected: string[]
  onApply: (shas: string[]) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query, 250)
  const [offset, setOffset] = useState(0)
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(selected))

  // Commit listing ignores the shas filter itself (you are picking them) but
  // honours the active time window and author filters.
  const listingFilters = useMemo(() => ({ ...filters, shas: undefined }), [filters])
  const { data, isFetching } = useCommits(id, listingFilters, debouncedQuery, PAGE, offset)
  const rows = data?.rows ?? []
  const total = data?.total ?? 0

  function toggle(sha: string) {
    setChosen((previous) => {
      const next = new Set(previous)
      if (next.has(sha)) next.delete(sha)
      else next.add(sha)
      return next
    })
  }

  function togglePage() {
    setChosen((previous) => {
      const next = new Set(previous)
      const allOnPage = rows.every((row) => next.has(row.sha)) && rows.length > 0
      for (const row of rows) {
        if (allOnPage) next.delete(row.sha)
        else next.add(row.sha)
      }
      return next
    })
  }

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal modal-wide">
        <div className="modal-head">
          <div>
            <div className="modal-title">Select commits</div>
            <div className="card-sub">
              Manually pick the commit set H. Time window and author filters below still apply to this list.
            </div>
          </div>
          <button className="btn ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="row" style={{ marginBottom: 10 }}>
            <input
              className="input"
              placeholder="Search subject…"
              value={query}
              autoFocus
              onChange={(event) => {
                setQuery(event.target.value)
                setOffset(0)
              }}
            />
            <button className="btn small" onClick={togglePage} disabled={rows.length === 0}>
              Toggle page
            </button>
            {isFetching && <span className="spinner" />}
          </div>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.sha}
                    className={`clickable${chosen.has(row.sha) ? ' selected-row' : ''}`}
                    onClick={() => toggle(row.sha)}
                  >
                    <td style={{ width: 30 }}>
                      <input type="checkbox" checked={chosen.has(row.sha)} readOnly />
                    </td>
                    <td className="mono" style={{ width: 90 }}>
                      {shortSha(row.sha)}
                    </td>
                    <td style={{ width: 110 }}>{fmtDate(row.ts)}</td>
                    <td style={{ width: 150 }} className="cell-main">
                      {row.author}
                    </td>
                    <td className="cell-main" title={row.subject}>
                      {row.subject}
                    </td>
                    <td className="right pos mono" style={{ width: 80 }}>
                      +{fmtInt(row.added)}
                    </td>
                    <td className="right neg mono" style={{ width: 80 }}>
                      −{fmtInt(row.removed)}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td className="empty" colSpan={7}>
                      {isFetching ? <span className="spinner" /> : 'No commits match'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span>
              {fmtInt(total)} commits · showing {fmtInt(offset + 1)}–{fmtInt(Math.min(offset + PAGE, total))}
            </span>
            <button className="btn small" disabled={offset <= 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              ‹ Prev
            </button>
            <button className="btn small" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
              Next ›
            </button>
          </div>
        </div>
        <div className="modal-foot">
          <span className="muted">{fmtInt(chosen.size)} commits selected</span>
          <div className="row">
            <button className="btn ghost" onClick={() => setChosen(new Set())} disabled={chosen.size === 0}>
              Clear all
            </button>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" onClick={() => onApply([...chosen])}>
              Apply selection
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
