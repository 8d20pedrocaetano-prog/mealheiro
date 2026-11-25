# Architecture

```
 CGD app ──PDF──▶ Ingest session (Claude, cheap model)          Phone (Chrome PWA)   Laptop (browser)
                  runs tools/mh.py in the data repo                    │                    │
                         │ git commit + push                          └──── Mealheiro ─────┘
                         ▼                                        static site on GitHub Pages
            ┌──────────────────────────────┐   GitHub REST API    (public repo, code only)
            │  data repo (PRIVATE)         │◀────────────────────▶  token in IndexedDB,
            │  CSV files + settings.json   │   read: trees/blobs    encrypted with PIN
            │  tools/ + ingest skill       │   write: git data API
            └──────────────────────────────┘
```

## 1. Two repositories

| | App repo (`mealheiro`) | Data repo (`mealheiro-data`) |
|---|---|---|
| Visibility | **public** (free GitHub Pages) | **private** |
| Contains | source, docs, synthetic fixtures, reference tools | CSV data, `settings.json`, `tools/`, ingest skill |
| Written by | Fable/owner via git | the app (API), ingest sessions (git) |

The site is public but empty without a token: it holds no data.

## 2. Auth

- The owner creates a **fine-grained personal access token**: repository access = only the data repo;
  permissions = *Contents: read and write* (Metadata: read is added automatically); expiry ≈ 1 year.
- Connect screen: owner, repo, branch, token → "Test connection" (`GET /repos/{owner}/{repo}`) → set PIN.
- Token storage: AES-GCM encrypted in IndexedDB with a key derived from the PIN (PBKDF2-SHA256, ≥ 310k
  iterations, random salt). Decrypted key kept in memory only while unlocked. Lock after 5 min hidden.
- Lost phone: revoke the token on GitHub; nothing else to do.

## 3. Reading (sync down)

1. `GET /repos/{o}/{r}/git/ref/heads/{branch}` → commit sha. If equal to the cached sha, stop.
2. `GET /repos/{o}/{r}/git/trees/{sha}?recursive=1` → paths + blob shas.
3. For each `*.csv` / `settings.json` whose blob sha changed: `GET /git/blobs/{sha}` (base64) → decode UTF-8.
4. Store raw text by path + blob sha in IndexedDB; parse; rebuild the in-memory model (core is pure and fast;
   run it in a Web Worker if a full recompute exceeds 50 ms).
5. Triggers: app open/unlock, pull-to-refresh, and every 10 min while visible. ETags / `If-None-Match` welcome.

## 4. Writing (sync up)

- Every edit becomes an **op**: `{file, key, row | delete, at}` (e.g. upsert `overrides.csv` row keyed by
  `txn_id`; append `manual.csv`; upsert `rules.csv` by `id`). Ops are persisted in IndexedDB *before* the UI
  updates (optimistic update from the same op).
- A flusher batches pending ops (debounce 3 s; also on `visibilitychange → hidden`) into **one commit**:
  read the base files at the current head, apply ops, serialise CSV (stable column order, preserve unknown
  columns), then Git Data API: create blobs → create tree with `base_tree` → create commit → `PATCH` the ref
  (no force).
- **Conflict** (`422`, ref moved because an ingest session pushed): re-sync down, re-apply the same ops to the
  new base (ops are row-level upserts, so this is a deterministic merge), retry up to 3 times with backoff.
- Commit messages: `app: recategorise 3 transactions`, `app: confirm trip "Edinburgh"`, with a
  `Device: phone|desktop` trailer.
- UI shows sync state: synced / N changes waiting / offline / error with retry.

## 5. Offline and PWA

- `vite-plugin-pwa`: precache the app shell; `display: standalone`; icons; theme colours; `start_url` with
  `?source=pwa`.
- Ask for persistent storage (`navigator.storage.persist()`) after the first successful sync.
- All reads come from IndexedDB, so the app opens offline with the last synced data.
- M5: `share_target` in the manifest (POST, `multipart/form-data`, accepts `application/pdf` and `text/csv`) so
  the owner can share a statement from the CGD app straight into Mealheiro (Chrome on Android).

## 6. Deploy

- GitHub Actions on push to `main`: install, lint, typecheck, test (unit + parity), build, deploy to Pages.
- Vite `base: '/mealheiro/'` (repo name). SPA fallback: copy `index.html` to `404.html`.
- Demo data from `fixtures/demo-data` is bundled under `/demo/` at build time.

## 7. Security checklist

- CSP via meta tag: `default-src 'self'; connect-src https://api.github.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'`.
- No third-party runtime code, fonts or analytics. Dependencies pinned; `npm audit` in CI.
- Never put tokens, amounts or descriptions in URLs, logs or error reports.
- Settings → "Wipe this device" clears IndexedDB, caches and the service worker.
- Pre-commit + CI guard in the app repo against committing real data (see CLAUDE.md).

## 8. Ingest session (outside the app)

A Claude session on a cheaper model, opened on the **data repo**, follows `.claude/skills/ingest-statement`:
parse with `tools/parse_cgd.py`, dedupe, write month files, suggest categories / rules / proposed events, run
`tools/mh.py validate`, commit and push. It never edits the owner-only files (DATA_MODEL §2). The app picks the
new commit up on its next sync. From M5 the app can also import a CGD PDF itself; both paths produce identical
rows and ids.
