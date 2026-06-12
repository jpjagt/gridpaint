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
- Fix cloud reconciliation so a stale device can no longer clobber newer work.
- Make the homepage load only metadata + a small thumbnail, not full documents.

## Non-goals

- Live multi-device sync (no Firestore `onSnapshot` listener). Reconcile on drawing open only.
- Full conflict-resolution machinery (rev versioning, durable outbox, conflict modal,
  recovery snapshots). Deferred — see "Deferred: full sync model".
- Multi-user / sharing changes beyond what exists.
- Rewriting the serialization / legacy-migration logic (it is correct and tested; it is
  extracted and kept).

## Scope decision

The identified root cause is the **localStorage quota error**. After weighing it, the chosen
scope is **lean**: fix both bugs with the minimum necessary change, and skip the heavy
multi-device sync machinery (per-document `rev` versioning, durable outbox with retry queue,
blocking conflict modal, recovery snapshots). That machinery defends against genuine concurrent
multi-device divergence — a rare case for a single user — and the dangerous cloud-clobber it
guards against is already eliminated by the much smaller fixes below. The full design is
preserved in "Deferred: full sync model" for revisiting if real multi-device conflicts appear.

Approach B still holds at a smaller scale: **fix the storage orchestration; keep serialization
& migration.**

## In scope

1. **IndexedDB local store** — removes the ~5MB ceiling that caused the loss.
2. **Loud save failures** — replace the silent `console.error` with a visible, blocking,
   retrying banner.
3. **Homepage thumbnails** — metadata + stored thumbnail, no full-document fetch.
4. **Minimal sync correctness fix** — single-source `updatedAt` + conditional cloud write, so a
   stale device can no longer clobber newer cloud work.

## Architecture

### Module layout

```
src/lib/storage/
  types.ts            (+ thumbnail field on metadata)
  serialization.ts    NEW — shared serialize/deserialize + legacy migration
                      (extracted from local-store & firestore-store, currently duplicated)
  idb.ts              NEW — tiny IndexedDB wrapper (idb-keyval dep is acceptable)
  local-store.ts      thin: IndexedDB read/write of serialized docs + metadata index
  firestore-store.ts  thin: Firestore read + CONDITIONAL (transaction) write
  hybrid-store.ts     updated: reconcile by single-source updatedAt (no re-rolling),
                      never clobber newer local; debounced drain reads current doc
  store.ts            DrawingStore interface (shape unchanged) + instance
  storage-manager.ts  unchanged role (singleton + setCloudSync)
  thumbnail.ts        NEW — capture viewport PNG → dataURL helper
```

`hybrid-store.ts` is kept (not replaced by a new sync-engine). The lean fixes are surgical
changes to it; no outbox/reconcile modules are introduced.

### Local store: IndexedDB

- Durable local store moves from localStorage to **IndexedDB** (via a small wrapper; `idb-keyval`
  is acceptable). Removes the ~5MB ceiling that caused the loss — the direct fix for the quota bug.
- One record per drawing (no single giant blob): a save rewrites only that drawing's bytes, so a
  single large drawing can never block saves for others.
- A small **metadata index** (id, name, createdAt, updatedAt, thumbnail) is maintained so
  `list()` is fast and never touches full content.

### Data model (types.ts)

- `DrawingMetadata` gains `thumbnail?: string` (dataURL).
- No `rev` field. Reconciliation uses `updatedAt`, but **stamped once at the source** (see below)
  rather than re-rolled per layer — which is what made the old timestamp compare unsafe.

### Single-source `updatedAt`

- `updatedAt` is set **once**, in `saveDrawingState` (the engine entry point), and passed
  verbatim through local and cloud writes. The store layers must **not** re-roll `Date.now()`.
  (Today `local-store.save` and `firestore-store.save` each call `Date.now()` independently,
  making cloud structurally newer than local for identical content.)
- With a single source, `updatedAt` correctly identifies content: equal stamps = same content.

### Write path (save)

1. Determine whether this save is a **content change** (layers/points/pointModifications/
   exportRects changed) vs **position-only** (panOffset/zoom). Only content changes refresh the
   thumbnail (see Homepage).
2. Set `updatedAt = now` **once** here.
3. Write to IndexedDB (await).
4. If the local write throws (quota/denied): surface the blocking save-failure banner, keep the
   data dirty, retry. **Never report success.** (Replaces today's silent `console.error`.)
5. On success, schedule the debounced cloud drain. The drain reads the **current** doc from the
   local store at fire time (no stale closure capture).

### Conditional cloud write (firestore-store, in a transaction)

- In a transaction: read current cloud doc; compare its `updatedAt` to the `updatedAt` of the
  doc being written derived from (the version this device last saw).
- If cloud has **not** advanced past what this device last saw → write. Commit.
- If cloud **has** advanced (someone else wrote a newer `updatedAt`) → **abort the write**;
  do not overwrite. Pull the newer cloud doc and adopt it locally on the next reconcile.
- This guarantees a stale device cannot clobber newer cloud work — the dangerous case from the
  diagnosis. It resolves to last-write-wins by `updatedAt` (no conflict modal); the loser is not
  destroyed locally because local already holds whichever version the user is actively editing.

### Reconciliation (hybrid-store.get)

- Pull cloud + read local. Use single-source `updatedAt`.
- cloud newer than local → adopt cloud, save to local (legit background-device update).
- local newer than or equal to cloud → keep local; never overwrite newer local with older cloud.
- This fixes the specific clobber bug: because `updatedAt` is now single-source, an older cloud
  copy can no longer out-rank newer local content.

### Save-failure UX: blocking banner + retry

A persistent, blocking banner ("Couldn't save your latest changes — retrying…") shown whenever a
local write fails (e.g. genuine IndexedDB quota exhaustion or denied storage). Data stays dirty
and retries; success is never reported while a write is failing. This replaces today's silent
`console.error`. Exposed via a `$saveStatus` store consumed by an editor-level banner component.

### Homepage payload

- `list()` returns metadata **including `thumbnail`** from the IndexedDB metadata index — no
  full-document fetch. This removes the slow load.
- Thumbnail = `canvas.toDataURL()` of the current viewport (recognizable to the user), captured
  by `thumbnail.ts` using the live p5 canvas in the editor.
- Thumbnail is regenerated **only on content-change saves**, not on position-only (pan/zoom)
  saves. The editor requests a refresh when the save path reports a content change.
- Delete `generatePreview()` from `Home.tsx`; render `metadata.thumbnail` directly. Show a
  neutral placeholder when a drawing has no thumbnail yet.

### Firestore changes

- Writes go through a transaction (conditional write keyed on `updatedAt`).
- `firestore.rules` updated only as needed to keep the existing `writeToken` gate working with
  the transactional write.

## Testing

- **`serialization.ts`** — serialize/deserialize round-trip + the existing legacy-migration cases
  (groups, pointModifications, cutout v1→v2→v3), moved out of the store files.
- **`local-store` (IndexedDB)** — save/get/list/delete round-trip; metadata index stays in sync;
  one drawing's write does not affect another's bytes.
- **Reconciliation in `hybrid-store.get`** — cloud-newer adopts cloud; local-newer keeps local;
  equal stays in sync. Asserts older cloud never clobbers newer local.
- **Conditional write** — cloud advanced → write aborts (no clobber); cloud unchanged → write lands.
- **Save-failure path** — IndexedDB write throws → `$saveStatus` reflects failure, success not
  reported.

## Migration / rollout

- On first load after deploy, migrate the existing `gridpaint:drawings` localStorage blob into
  per-drawing IndexedDB records + metadata index (one-time). Leave the old localStorage key in
  place as a fallback (do not delete immediately) until migration is confirmed.

## Open trade-offs (accepted)

- Cloud reconciliation is last-write-wins by single-source `updatedAt`; no conflict modal. The
  dangerous stale-clobber is prevented by the conditional write, and local always retains the
  version being actively edited. (Accepted for single-user use.)
- No live listener; background-device changes are picked up on next open. (Accepted — YAGNI.)

## Deferred: full sync model (not building now)

Documented in case real multi-device conflicts appear later. The robust local-first model adds:

1. **Per-document `rev`** (monotonic content version) bumped in one place, preserved verbatim
   across local/cloud; reconciliation compares `rev` instead of timestamps.
2. **Durable outbox** (dirty queue in localStorage) so unconfirmed writes survive reload and
   retry; an entry leaves only after cloud confirms.
3. **Conditional cloud writes keyed on `baseRev`** in a transaction.
4. **Blocking conflict modal** (`ConflictResolutionModal`) when both sides diverge from the same
   base: shows each version's `updatedAt` (`toLocaleString()`) + thumbnail, user picks one, the
   unpicked version saved to `gridpaint:recovery:{id}:{rev}` (local-only recovery snapshot).
5. A pure `reconcile(local, cloud, outboxEntry) → action` function as the testable core.

This is strictly additive over the lean scope: the IndexedDB store, thumbnails, and loud save
failures all carry forward unchanged.
