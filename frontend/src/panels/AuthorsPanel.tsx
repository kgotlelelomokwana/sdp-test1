import { useMemo, useState } from 'react'
import { useAuthorGroups, useAuthorMutations, useAuthorsView } from '../hooks'
import { fmtDate, fmtFloat, fmtInt, fmtPercent } from '../format'
import type { AuthorRow, Filters } from '../types'
import { DataTable, type Column } from '../components/DataTable'

export function AuthorsPanel({
  id,
  filters,
  onFocusAuthor,
}: {
  id: number
  filters: Filters
  onFocusAuthor: (authorId: string) => void
}) {
  const metricsQuery = useAuthorsView(id, filters)
  const groupsQuery = useAuthorGroups(id)
  const { merge, unmerge, reset } = useAuthorMutations(id)

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [target, setTarget] = useState('')
  const [marked, setMarked] = useState<Set<string>>(() => new Set())
  const [identityQuery, setIdentityQuery] = useState('')

  const groups = groupsQuery.data?.rows ?? []
  const selectedAuthors = filters.authors ?? []

  const columns: Column<AuthorRow>[] = [
    {
      key: 'name',
      title: 'Author',
      render: (row) => (
        <span>
          {row.name}
          {row.members.length > 1 && (
            <>
              {' '}
              <span className="tag tag-purple" title={row.members.join('\n')}>
                {row.members.length} identities
              </span>
            </>
          )}
        </span>
      ),
    },
    {
      key: 'commits',
      title: 'Commits',
      right: true,
      render: (row) => fmtInt(row.commits),
    },
    { key: 'added', title: 'l+', right: true, render: (row) => <span className="pos mono">+{fmtInt(row.added)}</span> },
    {
      key: 'removed',
      title: 'l−',
      right: true,
      render: (row) => <span className="neg mono">−{fmtInt(row.removed)}</span>,
    },
    { key: 'churn', title: 'λ', right: true, render: (row) => fmtInt(row.churn) },
    { key: 'mods', title: 'n', right: true, render: (row) => fmtInt(row.mods) },
    { key: 'freq', title: 'η', right: true, render: (row) => fmtFloat(row.freq, 2) },
    { key: 'churn_rate', title: 'ρ', right: true, render: (row) => fmtFloat(row.churn_rate, 1) },
    { key: 'ownership', title: 'ω', right: true, render: (row) => fmtPercent(row.ownership) },
    { key: 'files', title: 'Files', right: true, render: (row) => fmtInt(row.files_touched) },
  ]

  // Member checkboxes for the merge flow: every identity except the chosen
  // target's own canonical identity.
  const candidates = useMemo(() => {
    const needle = identityQuery.trim().toLowerCase()
    const list: { ident: string; name: string; commits: number; mailmap: boolean; groupName: string }[] = []
    for (const group of groups) {
      for (const member of group.members) {
        if (member.ident === target) continue
        if (
          needle &&
          !member.ident.includes(needle) &&
          !member.name.toLowerCase().includes(needle) &&
          !member.emails.some((email) => email.includes(needle))
        ) {
          continue
        }
        list.push({
          ident: member.ident,
          name: member.name,
          commits: member.commits,
          mailmap: member.mailmap,
          groupName: group.name,
        })
      }
    }
    return list.sort((a, b) => b.commits - a.commits)
  }, [groups, target, identityQuery])

  function toggleMarked(ident: string) {
    setMarked((previous) => {
      const next = new Set(previous)
      if (next.has(ident)) next.delete(ident)
      else next.add(ident)
      return next
    })
  }

  function toggleExpanded(groupId: string) {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  const targetGroup = groups.find((group) => group.id === target)
  const mutationError = merge.error ?? unmerge.error ?? reset.error

  return (
    <>
      <div className="spread" style={{ marginBottom: 10 }}>
        <span className="muted" style={{ fontSize: 12.5 }}>
          {metricsQuery.data
            ? `${fmtInt(metricsQuery.data.total)} authors · H = ${fmtInt(metricsQuery.data.h_count)} commits`
            : 'Loading authors…'}{' '}
          · click a row to filter the whole dashboard by that author
        </span>
        {metricsQuery.isFetching && <span className="spinner" />}
      </div>

      {metricsQuery.isError && <div className="err-note">{String((metricsQuery.error as Error).message)}</div>}

      <DataTable
        columns={columns}
        rows={metricsQuery.data?.rows ?? []}
        rowKey={(row) => row.id}
        loading={metricsQuery.isLoading}
        onRowClick={(row) => onFocusAuthor(row.id)}
        empty="No authors in the selected commit set"
      />

      <div className="divider" />

      <div className="card-head">
        <div>
          <div className="card-title">Author identities</div>
          <div className="card-sub">
            {groupsQuery.data?.has_mailmap
              ? 'This repository has a .mailmap — its mappings were applied automatically. Manual merges stack on top.'
              : 'No .mailmap found — merge duplicate identities manually below.'}
          </div>
        </div>
        <div className="row">
          {unmerge.isPending && <span className="spinner" />}
          <button
            className="btn ghost small"
            disabled={reset.isPending}
            onClick={() => {
              if (window.confirm('Remove all manual merges for this repository?')) reset.mutate()
            }}
          >
            Reset manual merges
          </button>
        </div>
      </div>

      {mutationError && <div className="err-note">{String((mutationError as Error).message)}</div>}

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div>
          <div className="field-label" style={{ marginBottom: 8 }}>
            Identities ({fmtInt(groupsQuery.data?.rows.length ?? 0)} groups)
          </div>
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table className="table">
              <tbody>
                {groups.map((group) => (
                  <tr key={group.id} style={{ verticalAlign: 'top' }}>
                    <td>
                      <span className="row" style={{ gap: 8 }}>
                        <button className="btn ghost small" onClick={() => toggleExpanded(group.id)}>
                          {expanded.has(group.id) ? '▾' : '▸'}
                        </button>
                        <span>
                          <b>{group.name}</b>
                          {group.merged && <span className="tag tag-blue" style={{ marginLeft: 6 }}>merged</span>}
                          {group.mailmap && <span className="tag tag-purple" style={{ marginLeft: 6 }}>.mailmap</span>}
                          <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                            {fmtInt(group.commits)} commits · {group.members.length} identit
                            {group.members.length === 1 ? 'y' : 'ies'}
                          </span>
                        </span>
                      </span>
                      {expanded.has(group.id) && (
                        <table className="table" style={{ marginTop: 6 }}>
                          <thead>
                            <tr>
                              <th>Identity</th>
                              <th>Emails</th>
                              <th className="right">Commits</th>
                              <th>Active</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {group.members.map((member) => (
                              <tr key={member.ident}>
                                <td className="mono" style={{ fontSize: 12 }}>
                                  {member.ident}
                                  {member.mailmap && (
                                    <span className="tag tag-purple" style={{ marginLeft: 6 }}>
                                      mailmap
                                    </span>
                                  )}
                                </td>
                                <td className="muted" style={{ fontSize: 11.5 }}>
                                  {member.emails.join(', ') || '—'}
                                </td>
                                <td className="right mono">{fmtInt(member.commits)}</td>
                                <td className="muted" style={{ fontSize: 11.5 }}>
                                  {fmtDate(member.first_ts)} → {fmtDate(member.last_ts)}
                                </td>
                                <td className="right">
                                  {member.ident !== group.id && (
                                    <button
                                      className="btn ghost small"
                                      title="Remove this identity from the group (manual merges only)"
                                      disabled={unmerge.isPending}
                                      onClick={() => unmerge.mutate({ ids: [member.ident] })}
                                    >
                                      Remove
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-title" style={{ marginBottom: 10 }}>
            Merge identities
          </div>
          <div className="field">
            <label className="field-label">Merge into (target author)</label>
            <select className="select" value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="">Choose target…</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name} · {fmtInt(group.commits)} commits
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Search identities to merge in</label>
            <input
              className="input"
              placeholder="name or email…"
              value={identityQuery}
              onChange={(event) => setIdentityQuery(event.target.value)}
            />
          </div>
          <div className="picker-list" style={{ maxHeight: 260, border: '1px solid var(--border-soft)', borderRadius: 8, padding: 6 }}>
            {candidates.length === 0 && <div className="empty-state">No matching identities</div>}
            {candidates.map((candidate) => (
              <label key={candidate.ident} className="picker-item">
                <input
                  type="checkbox"
                  checked={marked.has(candidate.ident)}
                  onChange={() => toggleMarked(candidate.ident)}
                />
                <span className="picker-name" title={`${candidate.ident} (${candidate.groupName})`}>
                  {candidate.name}
                  {candidate.mailmap && <span className="tag tag-purple" style={{ marginLeft: 6 }}>mailmap</span>}
                </span>
                <span className="picker-meta">{fmtInt(candidate.commits)} commits</span>
              </label>
            ))}
          </div>
          <div className="spread" style={{ marginTop: 12 }}>
            <span className="muted" style={{ fontSize: 12 }}>
              {fmtInt(marked.size)} selected
              {targetGroup ? ` → ${targetGroup.name}` : ''}
            </span>
            <button
              className="btn primary"
              disabled={!target || marked.size === 0 || merge.isPending}
              onClick={() =>
                merge.mutate(
                  { target, members: [...marked] },
                  { onSuccess: () => setMarked(new Set()) },
                )
              }
            >
              {merge.isPending ? <span className="spinner" /> : 'Merge identities'}
            </button>
          </div>
          <div className="note">
            Merging unifies commit counts, churn and ownership under the target author. Manual merges
            can be removed per identity or reset entirely.
          </div>
        </div>
      </div>

      {selectedAuthors.length > 0 && (
        <div className="note">
          Note: the metrics table above is currently filtered to {fmtInt(selectedAuthors.length)} author
          {selectedAuthors.length > 1 ? 's' : ''} — reset the author filter to see everyone.
        </div>
      )}
    </>
  )
}
