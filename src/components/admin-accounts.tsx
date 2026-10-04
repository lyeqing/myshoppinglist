'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { AdminAccount, useAdminStore } from '@/stores/admin-store'

function AccountEditor({ account }: { account: AdminAccount }) {
  const [draft, setDraft] = useState(account)
  const [reason, setReason] = useState('')
  const { busy, save, inspect } = useAdminStore()
  return (
    <article className='rounded-2xl border border-slate-200 bg-white p-5 space-y-4'>
      <h2 className='text-xl font-semibold'>
        {account.displayName} · {account.email ?? 'Trial account'}
      </h2>
      <p>
        Account {account.id} · Shared collection {account.contributionEnabled ? 'enabled' : 'off'}
      </p>
      <form
        className='space-y-4'
        onSubmit={(e) => {
          e.preventDefault()
          void save(draft, reason)
        }}
      >
        <div className='flex flex-wrap gap-6'>
          <label>
            <input type='checkbox' disabled={busy} checked={draft.isPaid} onChange={(e) => setDraft({ ...draft, isPaid: e.target.checked })} /> Paid customer
          </label>
          <label>
            <input
              type='checkbox'
              disabled={busy}
              checked={draft.contributionBlocked}
              onChange={(e) => setDraft({ ...draft, contributionBlocked: e.target.checked })}
            />{' '}
            Block contributions
          </label>
          <label>
            <input type='checkbox' disabled={busy} checked={!draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: !e.target.checked })} /> Suspend
            account
          </label>
        </div>
        {!draft.isActive && (
          <p className='rounded-lg bg-red-50 p-3 text-red-800'>
            Suspension signs this customer out and prevents shopping-list access. Restoring access will require a new sign-in.
          </p>
        )}
        <label className='block'>
          Review reason
          <textarea
            className='block w-full rounded border p-2'
            required
            maxLength={1000}
            disabled={busy}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <div className='flex gap-3'>
          <button disabled={busy || !reason.trim()} className='rounded bg-sky-700 px-4 py-2 text-white disabled:opacity-50'>
            Save reviewed decision
          </button>
          <button type='button' disabled={busy} className='rounded border px-4 py-2' onClick={() => void inspect(account.id)}>
            Review contributions and history
          </button>
        </div>
        {account.restrictionReason && <p>Last reason: {account.restrictionReason}</p>}
      </form>
    </article>
  )
}
export function AdminAccounts() {
  const { accounts, review, selected, busy, error, load } = useAdminStore()
  const [search, setSearch] = useState('')
  useEffect(() => {
    void load()
  }, [load])
  return (
    <main className='mx-auto max-w-5xl space-y-6 p-6'>
      <Link href='/' className='text-sky-700 underline'>
        ← MyShoppingList / sign in
      </Link>
      <h1 className='text-3xl font-bold'>Account administration</h1>
      <p>
        Review repeated, verified abuse before restricting access. Extraction failures alone are not proof of abuse. Paid status is recorded manually; this page
        does not charge customers.
      </p>
      <form
        className='flex gap-3'
        onSubmit={(e) => {
          e.preventDefault()
          void load(search)
        }}
      >
        <input
          aria-label='Search account email'
          className='min-w-0 flex-1 rounded border p-2'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Search by email'
        />
        <button className='rounded border px-4' disabled={busy}>
          Search
        </button>
      </form>
      {error && (
        <p role='alert' className='rounded bg-red-50 p-3 text-red-800'>
          {error}
        </p>
      )}
      {busy && <p role='status'>Loading…</p>}
      {!busy && !error && !accounts.length && <p>No matching accounts.</p>}
      <p className='text-sm'>Showing up to 100 accounts. Use email search to narrow the results.</p>
      {accounts.map((a) => (
        <AccountEditor key={`${a.id}-${a.updatedDate}`} account={a} />
      ))}
      {review && (
        <section className='space-y-3 rounded-2xl border bg-white p-5'>
          <h2 className='text-xl font-semibold'>Review for account {selected}</h2>
          <h3 className='font-semibold'>Latest 100 observations</h3>
          {!review.observations.length && <p>No observations recorded.</p>}
          {review.observations.map((o) => (
            <div key={o.id} className='break-words border-b py-2'>
              <p>
                {o.receivedAt} · {o.source} · {o.outcome} · Extension {o.extensionVersion}
              </p>
              <p>{o.url}</p>
            </div>
          ))}
          <h3 className='font-semibold'>Latest 100 administrator actions</h3>
          {review.actions.map((a) => (
            <div key={a.id} className='break-words border-b py-2'>
              <p>
                {a.createdAt} · Administrator {a.administratorId} · {a.reason}
              </p>
              <p>Before: {a.beforeJson}</p>
              <p>After: {a.afterJson}</p>
            </div>
          ))}
        </section>
      )}
    </main>
  )
}
