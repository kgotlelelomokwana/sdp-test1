import type { ReactNode } from 'react'
import { fmtInt } from '../format'

export interface Column<T> {
  key: string
  title: ReactNode
  sortable?: boolean
  right?: boolean
  width?: number | string
  render: (row: T, index: number) => ReactNode
}

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string
  sort?: string
  order?: 'asc' | 'desc'
  onSort?: (key: string) => void
  onRowClick?: (row: T) => void
  selectedKey?: string | null
  loading?: boolean
  empty?: ReactNode
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  order,
  onSort,
  onRowClick,
  selectedKey,
  loading,
  empty,
}: DataTableProps<T>) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={`${column.sortable ? 'th-sort' : ''} ${column.right ? 'right' : ''}`.trim()}
                style={column.width ? { width: column.width } : undefined}
                onClick={column.sortable && onSort ? () => onSort(column.key) : undefined}
              >
                {column.title}
                {column.sortable && sort === column.key && (
                  <span className="sort-arrow">{order === 'desc' ? '▾' : '▴'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="empty" colSpan={columns.length}>
                {loading ? <span className="spinner" /> : (empty ?? 'No data for the current filters')}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => {
              const key = rowKey(row, index)
              return (
                <tr
                  key={key}
                  className={`${onRowClick ? 'clickable' : ''} ${selectedKey === key ? 'selected-row' : ''}`.trim()}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((column) => (
                    <td key={column.key} className={column.right ? 'right' : undefined}>
                      {column.render(row, index)}
                    </td>
                  ))}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

/** `+1,234` styled green. */
export function Added({ value }: { value: number }) {
  return <span className="pos mono">+{fmtInt(value)}</span>
}

/** `−1,234` styled red (true minus sign). */
export function Removed({ value }: { value: number }) {
  return <span className="neg mono">−{fmtInt(value)}</span>
}

/** Signed value, colored by sign. */
export function Signed({ value }: { value: number }) {
  const cls = value > 0 ? 'pos' : value < 0 ? 'neg' : 'muted'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return (
    <span className={`${cls} mono`}>
      {sign}
      {fmtInt(Math.abs(value))}
    </span>
  )
}

export function Pager({
  total,
  limit,
  offset,
  onChange,
}: {
  total: number
  limit: number
  offset: number
  onChange: (offset: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / limit))
  const page = Math.min(pages, Math.floor(offset / limit) + 1)
  return (
    <div className="pager">
      <span>
        {fmtInt(total)} rows · page {fmtInt(page)} / {fmtInt(pages)}
      </span>
      <button className="btn small" disabled={offset <= 0} onClick={() => onChange(Math.max(0, offset - limit))}>
        ‹ Prev
      </button>
      <button
        className="btn small"
        disabled={offset + limit >= total}
        onClick={() => onChange(offset + limit)}
      >
        Next ›
      </button>
    </div>
  )
}
