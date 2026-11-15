<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## MyShoppingList integration rules

- Reuse existing components, gateway and account stores. Backend services own matching, prices, quantities and permissions. Labels must reflect actual evidence status.
- AI research is customer initiated. Opening an AI app/copying a request does not execute research. Reported prices remain unverified and excluded from definitive totals.
- Preserve loading, retry, cancellation, mobile/keyboard and account-switch behaviour. Clear private research, drafts and pending operations after a session change.
- Keep extension capture optional until a tested replacement and an explicit retirement decision exist. Check manifests and runtime entry points before deletion.
- Reserve 3000 for the user; use a command-line override for Codex servers on 3001. Never stop the user's server.
- Report tests/limitations accurately. Backend `docs/AI_CONNECTIONS.md` and the migration plan own shared contracts; do not duplicate business rules in UI code.
