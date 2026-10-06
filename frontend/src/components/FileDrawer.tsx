import { useFileView } from '../hooks'
import { basename, fmtDate, fmtFloat, fmtInt, fmtPercent, shortSha } from '../format'
import type { Filters } from '../types'
import { ChurnChart, OwnershipDonut } from './charts'
import { Added, DataTable, Removed, Signed, type Column } from './DataTable'
import type { HistoryRow } from '../types'

export function FileDrawer({
  id,
  filters,
  path,
  onClose,
  onOpenCommit,
  onOpenAuthor,
}: {
  id: number
  filters: Filters
  path: string
  onClose: () => void
  onOpenCommit: (sha: string) => void
  onOpenAuthor?: (authorId: string) => void
}) {
  const query = useFileView(id, { ...filters, path }, true)
  const view = query.data

  const historyColumns: Column<HistoryRow>[] = [
    {
      key: 'sha',
      title: 'Commit',
      render: (row) => (
        <button
          className="crumb mono"
          title="Open commit details"
          onClick={(event) => {
            event.stopPropagation()
            onOpenCommit(row.sha)
          }}
        >
          {shortSha(row.sha)}
        </button>
      ),
    },
    { key: 'date', title: 'Date', render: (row) => fmtDate(row.ts) },
    { key: 'author', title: 'Author', render: (row) => row.author },
    { key: 'subject', title: 'Subject', render: (row) => <span title={row.subject}>{row.subject}</span> },
    { key: 'added', title: 'l+', right: true, render: (row) => <Added value={row.added} /> },
    { key: 'removed', title: 'l−', right: true, render: (row) => <Removed value={row.removed} /> },
    { key: 'growth', title: 'δ', right: true, render: (row) => <Signed value={row.growth} /> },
    { key: 'churn', title: 'λ', right: true, render: (row) => fmtInt(row.churn) },
  ]

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div style={{ minWidth: 0 }}>
            <div className="topbar-title" style={{ fontSize: 14 }} title={path}>
              <span className="kind-icon">▤</span>
              <span className="path-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {basename(path)}
              </span>
            </div>
            <div className="mono muted" style={{ fontSize: 11.5, marginTop: 3, wordBreak: 'break-all' }}>
              {path}
            </div>
          </div>
          <button className="btn ghost" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        <div className="drawer-body">
          {query.isLoading && <div className="empty-state"><span className="spinner" /> Loading file metrics…</div>}
          {query.isError && <div className="err-note">{String((query.error as Error).message)}</div>}
          {view && (
            <>
              <div className="stats-grid">
                <div className="stat">
                  <div className="stat-label">Added l+</div>
                  <div className="stat-value pos">+{fmtInt(view.object.added)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Removed l−</div>
                  <div className="stat-value neg">−{fmtInt(view.object.removed)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Growth δ</div>
                  <div className={`stat-value ${view.object.growth >= 0 ? 'pos' : 'neg'}`}>
                    {view.object.growth >= 0 ? '+' : '−'}
                    {fmtInt(Math.abs(view.object.growth))}
                  </div>
                </div>
                <div className="stat">
                  <div className="stat-label">Churn λ</div>
                  <div className="stat-value">{fmtInt(view.object.churn)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Modifications n</div>
                  <div className="stat-value">{fmtInt(view.object.mods)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Frequency η</div>
                  <div className="stat-value">{fmtFloat(view.object.freq, 2)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Churn rate ρ</div>
                  <div className="stat-value">{fmtFloat(view.object.churn_rate, 1)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Top author</div>
                  <div className="stat-value" style={{ fontSize: 12.5 }} title={view.object.top_author?.name}>
                    {view.object.top_author ? (
                      <button
                        className="crumb"
                        style={{ padding: 0 }}
                        onClick={() => onOpenAuthor?.(view.object.top_author!.id)}
                      >
                        {view.object.top_author.name} · {fmtPercent(view.object.top_author.ownership)}
                      </button>
                    ) : (
                      '—'
                    )}
                  </div>
                </div>
              </div>

              <div className="section-title">Churn over time</div>
              {view.timeseries.length > 0 ? (
                <ChurnChart data={view.timeseries} height={220} />
              ) : (
                <div className="empty-state">No churn in the selected commit set</div>
              )}

              <div className="section-title">Ownership (share of λ)</div>
              {view.ownership.length > 0 ? (
                <>
                  <OwnershipDonut rows={view.ownership} height={200} />
                  <div className="table-wrap" style={{ marginTop: 8 }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Author</th>
                          <th className="right">Churn λ</th>
                          <th className="right">Mods n</th>
                          <th className="right">Ownership ω</th>
                        </tr>
                      </thead>
                      <tbody>
                        {view.ownership.map((row) => (
                          <tr key={row.id}>
                            <td>
                              <button className="crumb" style={{ padding: 0 }} onClick={() => onOpenAuthor?.(row.id)}>
                                {row.name}
                              </button>
                            </td>
                            <td className="right mono">{fmtInt(row.churn)}</td>
                            <td className="right mono">{fmtInt(row.mods)}</td>
                            <td className="right mono">{fmtPercent(row.ownership)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="empty-state">No author touched this file in the selected commit set</div>
              )}

              <div className="section-title">History ({fmtInt(view.history.length)})</div>
              <DataTable
                columns={historyColumns}
                rows={view.history}
                rowKey={(row) => row.sha}
                empty="No commits touched this path"
              />
            </>
          )}
        </div>
      </aside>
    </>
  )
}
