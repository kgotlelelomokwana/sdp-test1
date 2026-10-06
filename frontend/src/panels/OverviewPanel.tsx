import type { AuthorRow, ObjectRow, RepoView } from '../types'
import { fmtFloat, fmtInt, fmtPercent } from '../format'
import { ChurnChart, DirTreemap, TopAuthorsChart } from '../components/charts'
import { Added, DataTable, Removed, Signed, type Column } from '../components/DataTable'

export function OverviewPanel({
  view,
  loading,
  onOpenFile,
  onDrillDir,
  onFocusAuthor,
}: {
  view: RepoView | undefined
  loading: boolean
  onOpenFile: (path: string) => void
  onDrillDir: (path: string) => void
  onFocusAuthor: (authorId: string) => void
}) {
  if (!view) {
    return <div className="card empty-state">{loading ? <span className="spinner" /> : 'No metrics yet'}</div>
  }

  const fileColumns: Column<ObjectRow>[] = [
    {
      key: 'name',
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
    { key: 'churn', title: 'λ', right: true, render: (row) => fmtInt(row.churn) },
    { key: 'mods', title: 'n', right: true, render: (row) => fmtInt(row.mods) },
    {
      key: 'top',
      title: 'Top author',
      render: (row) =>
        row.top_author ? (
          <span title={`${row.top_author.name} · ${fmtPercent(row.top_author.ownership)}`}>
            {row.top_author.name} · {fmtPercent(row.top_author.ownership)}
          </span>
        ) : (
          '—'
        ),
    },
  ]

  const dirColumns: Column<ObjectRow>[] = [
    {
      key: 'name',
      title: 'Directory',
      render: (row) => (
        <div className="path-cell">
          <span className="kind-icon">▸</span>
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
    { key: 'mods', title: 'n', right: true, render: (row) => fmtInt(row.mods) },
  ]

  const authorColumns: Column<AuthorRow>[] = [
    { key: 'name', title: 'Author', render: (row) => row.name },
    { key: 'commits', title: 'Commits', right: true, render: (row) => fmtInt(row.commits) },
    { key: 'churn', title: 'λ', right: true, render: (row) => fmtInt(row.churn) },
    { key: 'mods', title: 'n', right: true, render: (row) => fmtInt(row.mods) },
    { key: 'ownership', title: 'ω', right: true, render: (row) => fmtPercent(row.ownership) },
    { key: 'churn_rate', title: 'ρ', right: true, render: (row) => fmtFloat(row.churn_rate, 1) },
  ]

  return (
    <>
      <div className="charts-grid">
        <div className="chart-card">
          <div className="chart-head">
            <span className="chart-title">Churn over time</span>
            <span className="chart-sub">bars: l+ / l− per bucket · line: growth δ</span>
          </div>
          {view.timeseries.length > 0 ? (
            <ChurnChart data={view.timeseries} />
          ) : (
            <div className="empty-state">No commits in the selected set</div>
          )}
        </div>
        <div className="chart-card">
          <div className="chart-head">
            <span className="chart-title">Top authors by churn</span>
            <span className="chart-sub">share of repository λ</span>
          </div>
          {view.top_authors.length > 0 ? (
            <TopAuthorsChart rows={view.top_authors} />
          ) : (
            <div className="empty-state">No authors in the selected set</div>
          )}
        </div>
      </div>

      <div className="charts-grid-2">
        <div className="chart-card">
          <div className="chart-head">
            <span className="chart-title">Where the churn lives</span>
            <span className="chart-sub">treemap of directories by λ — click to drill in</span>
          </div>
          {view.top_dirs.length > 0 ? (
            <DirTreemap rows={view.top_dirs} onDrill={onDrillDir} />
          ) : (
            <div className="empty-state">No touched directories in the selected set</div>
          )}
        </div>
        <div className="chart-card">
          <div className="chart-head">
            <span className="chart-title">Most churned files</span>
            <span className="chart-sub">click a row for the full file report</span>
          </div>
          <DataTable
            columns={fileColumns}
            rows={view.top_files}
            rowKey={(row) => row.path}
            onRowClick={(row) => onOpenFile(row.path)}
            empty="No file changes in the selected set"
          />
        </div>
      </div>

      <div className="charts-grid-2">
        <div className="chart-card">
          <div className="chart-head">
            <span className="chart-title">Top directories</span>
            <span className="chart-sub">aggregated over all descendants — click to drill in</span>
          </div>
          <DataTable
            columns={dirColumns}
            rows={view.top_dirs}
            rowKey={(row) => row.path}
            onRowClick={(row) => onDrillDir(row.path)}
            empty="No directory changes in the selected set"
          />
        </div>
        <div className="chart-card">
          <div className="chart-head">
            <span className="chart-title">Top authors</span>
            <span className="chart-sub">click a row to filter the whole dashboard</span>
          </div>
          <DataTable
            columns={authorColumns}
            rows={view.top_authors}
            rowKey={(row) => row.id}
            onRowClick={(row) => onFocusAuthor(row.id)}
            empty="No authors in the selected set"
          />
        </div>
      </div>
    </>
  )
}
