# Storage Rework Design

**Date:** 2026-06-10
**Status:** Approved design, ready for implementation planning

## Problem

Two user-reported problems, which investigation linked to a shared root cause.

1. **Slow homepage.** `Home.tsx` calls `drawingStore.list()` for metadata, then fetches
   *every full drawing document* (`drawingStore.get`) just to render a thumbnail via the
   bespoke `generatePreview()`. The payload is large and the load is slow.

2. **Lost work.** Long editing sessions have been silently lost after reload — despite the
   2s autosave debounce firing many times during the session.

### Root cause of lost work

The trigger is **`QuotaExceededError` on `localStorage.setItem`**, surfaced in production:

```
QuotaExceededError: Setting the value of 'gridpaint:drawings' exceeded the quota.
  at writeStorage → save → ...
```

Mechanism:

- All drawings are stored under a **single** localStorage key (`gridpaint:drawings`) as one
  JSON blob. Every save re-serializes and rewrites the *entire* blob.
- localStorage has a ~5MB cap. As drawings accumulated (points, `pointModifications`,
  `exportRects`, cutout/3D data), the blob crossed the quota — no code change required,
  which matches "started happening erratically in the past few days."
- Once over quota, **every `setItem` throws**. In `saveDrawingState` the error is caught and
  only `console.error`'d. The save *ran* but persisted nothing.
- The user keeps editing; changes live only in in-memory nanostores. On reload, memory is
  gone and localStorage holds the last pre-quota version. **All work since the quota broke
  is lost.** This explains "many intermediate saves should have happened" — they did, and
  all silently failed.

A secondary, independent correctness bug in the sync layer compounds losses once cloud sync
is enabled:

- `updatedAt` is regenerated independently at each layer (`localStore.save` stamps `Date.now()`,
  then the debounced `firestoreStore.save` stamps a *later* `Date.now()` ~2s afterward). So
  `updatedAt` does not identify *content*; it is a re-rolled wall clock.
- `HybridDrawingStore.get()` reconciles local vs cloud by `cloudDoc.updatedAt > localDoc.updatedAt`
  and **overwrites local with cloud** when cloud appears newer. Because cloud's stamp is
  structurally later for the same content, a stale cloud doc can out-rank and clobber newer
  local work.
- Every cloud write is an unconditional `setDoc` of the whole document — a stale device can
  overwrite a fresh cloud copy with no guard.

## Goals

- Remove the localStorage quota ceiling as a source of silent data loss.
- Never report a save as succeeded when it did not persist.
- Make cloud reconciliation correct: never silently discard the side that is ahead.
- Make the homepage load only metadata + a small thumbnail, not full documents.

## Non-goals

- Live multi-device sync (no Firestore `onSnapshot` listener). Reconcile on drawing open only.
- Multi-user / sharing changes beyond what exists.
- Rewriting the serialization / legacy-migration logic (it is correct and tested; it is
  extracted and kept).

## Approach

Approach B (confirmed): **rewrite the sync orchestration; keep serialization & migration.**
The bugs live in orchestration (single-key localStorage, silent quota failure, timestamp-based
reconciliation, unconditional cloud writes). The serialization/migration code is correct.

The robust sync model is the standard local-first playbook:

1. **A content version (`rev`)**, not a wall clock. A monotonically increasing integer bumped
   in exactly one place (the engine save path) and preserved verbatim through local and cloud.
   Reconciliation compares `rev`, never two independent `Date.now()` stamps.
2. **A durable outbox** (dirty queue) so an unconfirmed write survives reload and retries. A
   write leaves the outbox only after cloud confirms.
3. **Conditional cloud writes** (Firestore transaction): a device may only overwrite the cloud
   version it last saw (`baseRev`). If cloud advanced, the write aborts → conflict path. This
   is what makes stale-device clobbering impossible.

## Architecture

### Module layout

```
src/lib/storage/
  types.ts            (+ rev, thumbnail fields; outbox + recovery types)
  serialization.ts    NEW — shared serialize/deserialize + legacy migration
                      (extracted from local-store & firestore-store, currently duplicated)
  idb.ts              NEW — tiny IndexedDB wrapper (or idb-keyval dep) for the local store
  local-store.ts      thin: IndexedDB read/write of serialized docs + metadata index
  firestore-store.ts  thin: Firestore read + CONDITIONAL (transaction) write
  outbox.ts           NEW — durable per-drawing dirty queue (localStorage; tiny)
  reconcile.ts        NEW — PURE reconciliation function (the testable core)
  sync-engine.ts      NEW — replaces hybrid-store: save path, drain, flush, reconcile orchestration
  store.ts            DrawingStore interface (shape unchanged) + instance
  storage-manager.ts  unchanged role (singleton + setCloudSync)
  thumbnail.ts        NEW — capture viewport PNG → dataURL helper
```

### Local store: IndexedDB

- Durable local store moves from localStorage to **IndexedDB** (via a small wrapper; `idb-keyval`
  is acceptable). Removes the ~5MB ceiling that caused the loss.
- One record per drawing (no single giant blob): a save rewrites only that drawing's bytes.
- A small **metadata index** (id, name, createdAt, updatedAt, rev, thumbnail) is maintained so
  `list()` is fast and never touches full content.
- The **outbox** stays in localStorage (it is tiny: `{ [id]: { baseRev, queuedAt } }`). Keeping
  it in localStorage keeps it synchronously readable during exit handlers.

### Data model (types.ts)

- `rev: number` — monotonic content version. Bumped only by the engine save path; preserved
  verbatim across local and cloud. `updatedAt` remains, but is **display-only** ("last edited"),
  no longer used for reconciliation.
- `DrawingMetadata` gains `rev: number` and `thumbnail?: string` (dataURL).
- Outbox record: `{ [id]: { baseRev: number; queuedAt: number } }`.
- Recovery snapshot: stored in localStorage under `gridpaint:recovery:{id}:{rev}`.
- Legacy docs without `rev` are treated as `rev = 0` and migrated on first write.

### Write path (engine.save)

1. Determine whether this save is a **content change** (layers/points/pointModifications/
   exportRects changed) vs **position-only** (panOffset/zoom). Only content changes bump the
   thumbnail (see Homepage).
2. Bump `rev = rev + 1`; set `updatedAt = now`.
3. Write to IndexedDB (await). The engine reads the **current** doc at drain time — no
   closure capture of a stale `doc` (also fixes the old debounce-closure bug).
4. If the local write throws (quota/denied): **do not** advance persisted `rev`, **do not**
   clear outbox, surface the blocking save-failure banner (see below), and retry. Never report
   success.
5. On successful local write: mark dirty in outbox (`baseRev` = last known cloud rev for this id).
6. Schedule debounced cloud drain (~1–2s) and ensure exit-flush handlers are registered.

### Conditional cloud write (firestore-store, in a transaction)

- In a transaction: read current cloud doc; `cloudRev = doc.rev ?? 0`.
- If `cloudRev === outbox.baseRev` → write local doc (with its `rev`), commit, clear outbox
  entry, update last-known-cloud-rev.
- If `cloudRev > outbox.baseRev` → abort; return `{ conflict: true, cloudDoc }` to the engine.
- Legacy cloud docs (no `rev`) → treated as rev 0; first write migrates them.

### Reconciliation (reconcile.ts — pure)

`reconcile(local, cloud, outboxEntry) → Action`. Drives both drawing-open and post-drain.

| Local dirty? | cloud rev vs baseRev/local | Action |
|---|---|---|
| no | cloud.rev > local.rev | `adopt-cloud` — save cloud to local, update baseRev. Legit background-device update; silent. |
| no | cloud.rev === local.rev | `in-sync` — nothing. |
| yes | cloud.rev === baseRev | `push-local` — conditional write succeeds. |
| yes | cloud.rev > baseRev | `conflict` — return `{ local, cloud }`. Engine/UI handles. |

The idle / just-opened tab has nothing dirty, so it always lands in `adopt-cloud` or `in-sync`
— **no modal, no noise**, per requirement. A modal only appears on genuine divergence.

### Conflict handling: blocking modal

On `conflict`, the editor must **block** loading the drawing for editing and show
`ConflictResolutionModal` so the user cannot deepen the conflict by editing the wrong base.

Modal contents:

- Title: "This drawing was edited on another device"
- **This device** — last edited `<local.updatedAt>` (`toLocaleString()`), optional thumbnail.
- **Other device** — last edited `<cloud.updatedAt>` (`toLocaleString()`), optional thumbnail.
- Buttons: **Keep this version** / **Use the other version**.
- Note: "The version you don't pick is saved as a recoverable copy."

Behavior:

- **Always** write the displaced version to `gridpaint:recovery:{id}:{rev}` (local-only), regardless
  of choice, where `{rev}` is the displaced version's own `rev` (so the key is unique and the
  snapshot is self-describing) — the modal makes the choice explicit *and* keeps a safety net.
- The chosen version gets a fresh `rev` above cloud and is queued for sync.
- `reconcile.ts` stays pure (returns `{ action: 'conflict', local, cloud }`); the engine surfaces a
  pending-conflict state the editor reads; the editor renders the modal and applies the choice.

### Save-failure UX: blocking banner + retry

A persistent, blocking banner ("Couldn't save your latest changes — retrying…") shown whenever a
local write fails (e.g. genuine IndexedDB quota exhaustion or denied storage). Data stays dirty
and retries; success is never reported while a write is failing. This replaces today's silent
`console.error`. (Exposed via an `$saveStatus` store consumed by an editor-level banner component.)

### Flush-on-exit (durability backstop)

Wired in the editor:

- On `visibilitychange → hidden` (fires reliably on tab close / nav, desktop + mobile) and on
  route-change away from the editor: trigger an immediate cloud drain.
- The local IndexedDB write already happened synchronously at edit time, so local is safe.
- The exit flush is **best-effort** — the browser may not await the network call. Correctness
  comes from the **durable outbox**, not the exit flush: a hard kill mid-flush just leaves the
  entry pending for the next load. The flush only shortens the window.

### Homepage payload

- `list()` returns metadata **including `thumbnail`** from the IndexedDB metadata index — no
  full-document fetch. This removes the slow load.
- Thumbnail = `canvas.toDataURL()` of the current viewport (recognizable to the user), captured
  by `thumbnail.ts` using the live p5 canvas in the editor.
- Thumbnail is regenerated **only on content-change saves**, not on position-only (pan/zoom)
  saves. The editor requests a refresh when the engine reports a content change.
- Delete `generatePreview()` from `Home.tsx`; render `metadata.thumbnail` directly. Show a
  neutral placeholder when a drawing has no thumbnail yet.

### Firestore changes

- Add `rev` to each drawing document; writes go through a transaction (conditional write).
- `firestore.rules` updated as needed to keep the existing `writeToken` gate working alongside
  the new field (the user approved updating the model + transactions).

## Testing

- **`reconcile.ts`** — unit tests covering every row of the table (this is where correctness lives).
- **`outbox.ts`** — add / drain / persist round-trip; survives simulated reload.
- **`serialization.ts`** — serialize/deserialize round-trip + the existing legacy-migration cases
  (groups, pointModifications, cutout v1→v2→v3), moved out of the store files.
- **Conditional write** — conflict path with a faked Firestore transaction (cloud rev advanced).
- **Save-failure path** — IndexedDB write throws → `$saveStatus` reflects failure, outbox not
  cleared, rev not advanced, success not reported.

## Migration / rollout

- On first load after deploy, migrate existing `gridpaint:drawings` localStorage blob into the
  per-drawing IndexedDB records + metadata index (one-time), then leave the old key in place as a
  fallback (do not delete immediately) until confirmed migrated.
- Existing docs (local & cloud) without `rev` are treated as `rev = 0`.

## Open trade-offs (accepted)

- Exit-flush is best-effort; durability rests on the outbox. (Accepted.)
- No live listener; background-device changes are picked up on next open. (Accepted — YAGNI for
  single user.)
- Conflict snapshots are local-only; a localStorage clear loses the *snapshot* (not the chosen
  version). (Accepted.)
