export function fmtInt(value: number | null | undefined): string {
  if (value == null) return '—'
  return value.toLocaleString('en-US')
}

export function fmtFloat(value: number | null | undefined, digits = 2): string {
  if (value == null) return '—'
  return value.toFixed(digits)
}

export function fmtPercent(value: number | null | undefined, digits = 1): string {
  if (value == null) return '—'
  return `${(value * 100).toFixed(digits)}%`
}

export function fmtDate(ts: number | null | undefined): string {
  if (ts == null) return '—'
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

export function fmtDateTime(ts: number | null | undefined): string {
  if (ts == null) return '—'
  return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16)
}

export function shortSha(sha: string): string {
  return sha.slice(0, 8)
}

export function parentPath(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? '' : path.slice(0, idx)
}

export function basename(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? path : path.slice(idx + 1)
}
