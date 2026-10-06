export interface Repo {
  id: number
  name: string
  source_type: 'url' | 'zip'
  source: string | null
  path: string | null
  status: 'pending' | 'cloning' | 'ingesting' | 'ready' | 'error'
  stage: string | null
  progress: number
  error: string | null
  ref: string
  head_sha: string | null
  commit_count: number
  author_count: number
  has_mailmap: number
  created_at: string
  ingested_at: string | null
}

export interface Kpi {
  commits: number
  authors: number
  added: number
  removed: number
  growth: number
  churn: number
  mods: number
  freq: number
  churn_rate: number
  files_touched: number
  dirs_touched: number
}

export interface TopAuthor {
  id: string
  name: string
  churn: number
  ownership: number
}

export interface ObjectRow {
  name: string
  path: string
  is_dir: boolean
  added: number
  removed: number
  growth: number
  churn: number
  mods: number
  freq: number
  churn_rate: number
  top_author: TopAuthor | null
}

export interface AuthorRow {
  id: string
  name: string
  members: string[]
  commits: number
  added: number
  removed: number
  growth: number
  churn: number
  mods: number
  freq: number
  churn_rate: number
  ownership: number
  files_touched: number
}

export interface TsPoint {
  bucket: string
  added: number
  removed: number
  growth: number
  churn: number
}

export interface Crumb {
  path: string
  name: string
}

export interface RepoView {
  kpi: Kpi
  bucket: string
  timeseries: TsPoint[]
  top_files: ObjectRow[]
  top_dirs: ObjectRow[]
  top_authors: AuthorRow[]
  h_count: number
}

export interface ObjectsView {
  level: 'files' | 'dirs'
  scope: string
  breadcrumbs: Crumb[]
  h_count: number
  total: number
  rows: ObjectRow[]
}

export interface AuthorsView {
  h_count: number
  total: number
  rows: AuthorRow[]
}

export interface OwnershipRow {
  id: string
  name: string
  churn: number
  mods: number
  ownership: number
}

export interface HistoryRow {
  sha: string
  ts: number
  subject: string
  author: string
  author_id: string
  added: number
  removed: number
  growth: number
  churn: number
}

export interface FileView {
  object: ObjectRow
  ownership: OwnershipRow[]
  history: HistoryRow[]
  timeseries: TsPoint[]
  bucket: string
  breadcrumbs: Crumb[]
  h_count: number
}

export interface CommitRow {
  sha: string
  ts: number
  subject: string
  author: string
  author_id: string
  files: number
  added: number
  removed: number
  growth: number
  churn: number
}

export interface CommitsView {
  total: number
  h_count: number
  rows: CommitRow[]
}

export interface CommitFileRow {
  path: string
  added: number
  removed: number
  growth: number
  churn: number
}

export interface CommitDetail {
  sha: string
  ts: number
  subject: string
  author: string
  author_id: string
  added: number
  removed: number
  growth: number
  churn: number
  files: CommitFileRow[]
}

export interface AuthorMember {
  ident: string
  name: string
  emails: string[]
  commits: number
  added: number
  removed: number
  churn: number
  first_ts: number | null
  last_ts: number | null
  mailmap: boolean
}

export interface AuthorGroup {
  id: string
  name: string
  members: AuthorMember[]
  commits: number
  added: number
  removed: number
  churn: number
  merged: boolean
  mailmap: boolean
}

export interface AuthorGroupsView {
  has_mailmap: boolean
  total: number
  rows: AuthorGroup[]
}

export interface Filters {
  authors?: string[]
  path?: string
  fromTs?: number
  toTs?: number
  shas?: string[]
  bucket?: string
}
