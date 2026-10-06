import { useEffect, useState } from 'react'
import { useObjectsView } from '../hooks'
import { fmtFloat, fmtInt, fmtPercent } from '../format'
import type { Filters, ObjectRow } from '../types'
import { Added, DataTable, Pager, Removed, Signed, type Column } from '../components/DataTable'

const LIMIT = 100

export function ObjectsPanel({
  id,
  filters,
  level,
  onSetPath,
  onOpenFile,
}: {
  id: number
  filters: Filters
  level: 'files' | 'dirs'
  onSetPath: (path: string | undefined) => void
  onOpenFile: (path: string) => void
}) {
  const [sort, setSort] = useState('churn')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [offset, setOffset] = useState(0)
  const [includeIdle, setIncludeIdle] = useState(true)

  useEffect(() => {
    setOffset(0)
  }, [filters, level, sort, order, includeIdle])

  const query = useObjectsView(id, level, filters, {
    sort,
    order,
    limit: LIMIT,
    offset,
    include_idle: includeIdle,
  })
  const view = query.data

  function handleSort(key: string) {
    if (key === sort) {
      setOrder((previous) => (previous === 'desc' ? 'asc' : 'desc'))
    } else {
      setSort(key)
      setOrder(key === 'name' || key === 'path' ? 'asc' : 'desc')
    }
  }

  const columns: Column<ObjectRow>[] = [
    {
      key: 'name',
      title: 'Name',
      sortable: true,
      render: (row) => (
        <div className="path-cell">
          <span className="kind-icon">{row.is_dir ? '▸' : '▤'}</span>
          <span className="path-name" title={row.path}>
            {row.name}
            {row.is_dir ? '/' : ''}
          </span>
        </div>
      ),
    },
    { key: 'added', title: 'l+', right: true, sortable: true, render: (row) => <Added value={row.added} /> },
    { key: 'removed', title: 'l−', right: true, sortable: true, render: (row) => <Removed value={row.removed} /> },
    { key: 'growth', title: 'δ', right: true, sortable: true, render: (row) => <Signed value={row.growth} /> },
    { key: 'churn', title: 'λ', right: true, sortable: true, render: (row) => fmtInt(row.churn) },
    { key: 'mods', title: 'n', right: true, sortable: true, render: (row) => fmtInt(row.mods) },
    { key: 'freq', title: 'η', right: true, sortable: true, render: (row) => fmtFloat(row.freq, 2) },
    { key: 'churn_rate', title: 'ρ', right: true, sortable: true, render: (row) => fmtFloat(row.churn_rate, 1) },
    {
      key: 'top',
      title: 'Top author',
      render: (row) =>
        row.top_author ? (
          <span title={`${row.top_author.name} · ${fmtPercent(row.top_author.ownership)} of λ`}>
            {row.top_author.name} · {fmtPercent(row.top_author.ownership)}
          </span>
        ) : (
          <span className="muted">—</span>
        ),
    },
  ]

  const crumbs = view?.breadcrumbs ?? [{ path: '', name: 'repository root' }]
  const scope = view?.scope ?? ''

  return (
    <>
      <div className="crumbs">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1
          return (
            <span key={crumb.path} className="row" style={{ gap: 6 }}>
              {index > 0 && <span className="crumb-sep">/</span>}
              {last ? (
                <span className="crumb crumb-here">{crumb.name}</span>
              ) : (
                <button className="crumb" onClick={() => onSetPath(crumb.path || undefined)}>
                  {crumb.name}
                </button>
              )}
            </span>
          )
        })}
        {scope && (
          <button
            className="btn ghost small"
            style={{ marginLeft: 6 }}
            onClick={() => {
              const parent = scope.includes('/') ? scope.slice(0, scope.lastIndexOf('/')) : ''
              onSetPath(parent || undefined)
            }}
          >
            ↑ up
          </button>
        )}
      </div>

      <div className="spread" style={{ marginBottom: 10 }}>
        <div className="row">
          <span className="muted" style={{ fontSize: 12.5 }}>
            {view ? `${fmtInt(view.total)} entries` : ''} · aggregated over all descendants ·{' '}
            {view ? `H = ${fmtInt(view.h_count)} commits` : ''}
          </span>
          {query.isFetching && <span className="spinner" />}
        </div>
        <div className="row">
          <label className="row muted" style={{ fontSize: 12.5, gap: 6 }}>
            <input
              type="checkbox"
              checked={includeIdle}
              onChange={(event) => setIncludeIdle(event.target.checked)}
            />
            show untouched entries
          </label>
          <button className="btn ghost small" onClick={() => query.refetch()}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {query.isError && <div className="err-note">{String((query.error as Error).message)}</div>}

      <DataTable
        columns={columns}
        rows={view?.rows ?? []}
        rowKey={(row) => row.path}
        sort={sort}
        order={order}
        onSort={handleSort}
        loading={query.isLoading}
        onRowClick={(row) => (row.is_dir ? onSetPath(row.path) : onOpenFile(row.path))}
        empty={
          level === 'files'
            ? 'No files match — try widening the filters or enabling untouched entries'
            : 'No directories match the current filters'
        }
      />

      {view && view.total > LIMIT && (
        <Pager total={view.total} limit={LIMIT} offset={offset} onChange={setOffset} />
      )}
    </>
  )
}
