import { useEffect, useState } from 'react'
import { useCommitDetail, useCommits, useDebounced } from '../hooks'
import { fmtDate, fmtDateTime, fmtInt, shortSha } from '../format'
import type { CommitFileRow, CommitRow, Filters } from '../types'
import { Added, DataTable, Pager, Removed, Signed, type Column } from '../components/DataTable'

const LIMIT = 100

export function CommitsPanel({
  id,
  filters,
  openSha,
  onConsumed,
  onOpenFile,
}: {
  id: number
  filters: Filters
  openSha: string | null
  onConsumed: () => void
  onOpenFile: (path: string) => void
}) {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query, 300)
  const [offset, setOffset] = useState(0)
  const [detailSha, setDetailSha] = useState<string | null>(null)

  useEffect(() => {
    setOffset(0)
  }, [filters, debouncedQuery])

  useEffect(() => {
    if (openSha) setDetailSha(openSha)
  }, [openSha])

  const commitsQuery = useCommits(id, filters, debouncedQuery, LIMIT, offset)
  const view = commitsQuery.data

  function closeDetail() {
    setDetailSha(null)
    onConsumed()
  }

  const columns: Column<CommitRow>[] = [
    {
      key: 'sha',
      title: 'Commit',
      render: (row) => <span className="mono">{shortSha(row.sha)}</span>,
    },
    { key: 'date', title: 'Date', render: (row) => fmtDate(row.ts) },
    { key: 'author', title: 'Author', render: (row) => row.author },
    {
      key: 'subject',
      title: 'Subject',
      render: (row) => (
        <span className="cell-main" style={{ display: 'inline-block' }} title={row.subject}>
          {row.subject}
        </span>
      ),
    },
    { key: 'files', title: 'Files', right: true, render: (row) => fmtInt(row.files) },
    { key: 'added', title: 'l+', right: true, render: (row) => <Added value={row.added} /> },
    { key: 'removed', title: 'l−', right: true, render: (row) => <Removed value={row.removed} /> },
    { key: 'growth', title: 'δ', right: true, render: (row) => <Signed value={row.growth} /> },
    { key: 'churn', title: 'λ', right: true, render: (row) => fmtInt(row.churn) },
  ]

  return (
    <>
      <div className="spread" style={{ marginBottom: 10 }}>
        <div className="row" style={{ flex: 1, maxWidth: 420 }}>
          <input
            className="input"
            placeholder="Search commit subjects…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {commitsQuery.isFetching && <span className="spinner" />}
        </div>
        <span className="muted" style={{ fontSize: 12.5 }}>
          {view ? `${fmtInt(view.total)} commits in selection H` : ''}
        </span>
      </div>

      {commitsQuery.isError && <div className="err-note">{String((commitsQuery.error as Error).message)}</div>}

      <DataTable
        columns={columns}
        rows={view?.rows ?? []}
        rowKey={(row) => row.sha}
        loading={commitsQuery.isLoading}
        onRowClick={(row) => setDetailSha(row.sha)}
        selectedKey={detailSha}
        empty="No commits match the current filters"
      />

      {view && view.total > LIMIT && <Pager total={view.total} limit={LIMIT} offset={offset} onChange={setOffset} />}

      {detailSha && <CommitDetailModal id={id} sha={detailSha} onClose={closeDetail} onOpenFile={onOpenFile} />}
    </>
  )
}

function CommitDetailModal({
  id,
  sha,
  onClose,
  onOpenFile,
}: {
  id: number
  sha: string
  onClose: () => void
  onOpenFile: (path: string) => void
}) {
  const query = useCommitDetail(id, sha)
  const detail = query.data

  const columns: Column<CommitFileRow>[] = [
    {
      key: 'path',
      title: 'File',
      render: (row) => (
        <div className="path-cell">
          <span className="kind-icon">▤</span>
          <span className="path-name" title={row.path}>
            {row.path}
          </span>
        </div>
      ),
    },
    { key: 'added', title: 'l+', right: true, render: (row) => <Added value={row.added} /> },
    { key: 'removed', title: 'l−', right: true, render: (row) => <Removed value={row.removed} /> },
    { key: 'growth', title: 'δ', right: true, render: (row) => <Signed value={row.growth} /> },
    { key: 'churn', title: 'λ', right: true, render: (row) => fmtInt(row.churn) },
  ]

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal modal-wide">
        <div className="modal-head">
          <div style={{ minWidth: 0 }}>
            <div className="modal-title">
              <span className="mono">{sha.slice(0, 12)}</span>
            </div>
            <div className="card-sub" title={detail?.subject}>
              {detail?.subject ?? 'Loading…'}
            </div>
          </div>
          <button className="btn ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {query.isError && <div className="err-note">{String((query.error as Error).message)}</div>}
          {detail && (
            <>
              <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
                <div className="stat">
                  <div className="stat-label">Author</div>
                  <div className="stat-value" style={{ fontSize: 13 }} title={detail.author_id}>
                    {detail.author}
                  </div>
                </div>
                <div className="stat">
                  <div className="stat-label">Committed</div>
                  <div className="stat-value" style={{ fontSize: 13 }}>
                    {fmtDateTime(detail.ts)}
                  </div>
                </div>
                <div className="stat">
                  <div className="stat-label">Added l+</div>
                  <div className="stat-value pos">+{fmtInt(detail.added)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Removed l−</div>
                  <div className="stat-value neg">−{fmtInt(detail.removed)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Growth δ</div>
                  <div className={`stat-value ${detail.growth >= 0 ? 'pos' : 'neg'}`}>
                    {detail.growth >= 0 ? '+' : '−'}
                    {fmtInt(Math.abs(detail.growth))}
                  </div>
                </div>
                <div className="stat">
                  <div className="stat-label">Churn λ</div>
                  <div className="stat-value">{fmtInt(detail.churn)}</div>
                </div>
              </div>
              <DataTable
                columns={columns}
                rows={detail.files}
                rowKey={(row) => row.path}
                onRowClick={(row) => {
                  onOpenFile(row.path)
                  onClose()
                }}
                empty="No measurable file changes (empty commit, pure rename or binary-only change)"
              />
              <div className="note">Click a file row to open its full report.</div>
            </>
          )}
        </div>
        <div className="modal-foot">
          <span className="muted">{detail ? `${fmtInt(detail.files.length)} files changed` : ''}</span>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
