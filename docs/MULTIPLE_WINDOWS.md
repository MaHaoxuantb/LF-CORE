# Multiple LF CORE windows

Different projects can be edited in separate LFOS app windows or same-origin
browser tabs. A project has one editable owner. Opening an owned project elsewhere
requests that owner's window instead of starting a competing editor. Ownership
lasts until its browser document is destroyed, including when its UI returns Home;
this allows background agent tasks and pending manual edits to keep their owner.
Closing the window releases its browser Web Locks. Browsers without Web Locks
fail visibly before acquiring a project for editing.

## Storage and ownership

- Each project has its own IndexedDB record, containing its document, chats and
  undo/redo history. A separate library record tracks membership and ordering.
- Changed/deleted IDs and their expected storage revisions commit atomically.
  A stale writer fails without partially committing other project changes.
  A stale window's library list cannot delete or resurrect another project.
- The former whole-library record migrates in one transaction. Legacy localStorage
  data is removed only after a verified readback; a divergent fallback is retained.
- BroadcastChannel announces successful commits and requests owner focus. Web
  Locks, rather than messages or timeout-based heartbeats, determine ownership.
- Library refreshes preserve owned, potentially unsaved projects. New owners read
  the latest committed project after acquiring its lease. Stale refresh results
  are ignored, and workers tolerate library entries created by other windows.
- LFOS close protection includes pending local edits as well as linked-file edits.
- Agent registration, project reads and task event handling are restricted to
  projects owned by that window. LFOS already rejects competing provider sessions.
- Camera and outline state use the window's sessionStorage, outside document saves
  and undo history. Selection, panels and editor interaction remain in window memory.

## Linked LFOS files

LFOS `files.getIdentity(handle)` returns a path-free identity scoped to the current
vault activation. It does not grant access or advance the handle's write revision.
A document lease prevents simultaneous imports of the same LFOS file, even when
local project IDs differ. Duplicate activations focus the owner without resetting
its current editor or panels. `lifecycle.focus()` focuses only the calling iframe's
window through the authenticated host bridge.

Persisted bindings include a hash of the last read/written file and the document
revision saved there. Reopening an unchanged file reuses its local project and
retains locally saved changes that still need external autosave. If external
contents changed, the previous local project is retained as an independent local
copy before importing the current file. File opening is serialized within each
window. Save As updates the binding and releases the previous document lease;
undo/redo preserves the current binding. Portable exports/imports omit bindings.

The host's file revision preconditions remain authoritative. Conflicts preserve
unsaved state and pause automatic retries. Local binding persistence failures also
remain visible and dirty. A new save handle cannot overwrite an existing file.

Deploy the LFOS host/SDK additions and LF CORE together and reload old windows.
An old already-running LF CORE bundle still uses the former storage implementation;
keeping old and new bundles open together is not a supported upgrade path.

## Verification

`npm test` covers transactional IndexedDB migration, independent concurrent saves,
stale-write rejection, atomic failure, concurrent creation/deletion, queued worker
revisions, newly discovered library entries, legacy fallback preservation, lease
handoff, file conflict handling, binding failures, undo and portable copies.

Manual browser checks use an isolated localhost origin with projects named
“Multi-window verification A/B”. Two app windows open independently, a duplicate
project requests its owner, different article edits save independently, and project
ownership transfers when the previous window closes. LFOS SDK/bridge unit tests and
TypeScript checking cover the host additions. Actual Safari and a live LFOS file
picker/agent session still require integration validation; no Safari-specific
compatibility claim is made. Multiple editable views of the same project are not
implemented.
