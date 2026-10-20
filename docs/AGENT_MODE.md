# Agent mode integration

Agent mode requires the LFOS host agent runtime, SolOS Intelligence, and the
version-5 LF CORE website manifest (`agent:use`, `agent:provide`, `ai:generate`).
Deploy LunOS/SDK support first, update the installed LF CORE app, then enable
the new permissions. Outside LFOS, ordinary Chat retains its provider settings;
Agent does not silently fall back to the old local proposal loop.

LF CORE registers each saved project as a session with a stable project ID and
monotonic project revision. The native `lfos.agent/v1` MessagePort protocol
exposes document indexing/search, Markdown reads and precise edits, graph
operations, imported source passages, source/attachment import, bounded
attachment reads, research records, comparisons, closeouts, and export artifacts.
This is a native LFOS protocol, not MCP. New research, computation, or external
services require their own providers; unavailable capabilities are reported.

The LFOS runtime owns model calls, plans, activity, clarification, permissions,
verification, and execution budgets. LF CORE uses the selected reasoning effort
with SolOS Intelligence; it does not send Agent requests to its saved endpoint.
LFAssistant can attach the same project and follow the same task. Closing a
panel removes its interface, not the task. Closing an attached project window
retains that session while its task is unfinished. LFOS must remain open.

One active library instance owns project writes through a Web Lock. A second
instance shows a recovery message instead of opening a competing editor. Each
agent mutation checks the expected revision, validates graph/source integrity,
stores its receipt and provenance, and creates one Undo snapshot. It reports
success only after IndexedDB persistence. LFOS-file autosave remains separately
tracked through the existing save controls. Undo pauses active project tasks
before restoring content; receipts survive Undo to prevent replaying a write.

Restarted tasks become interrupted and require Resume. The host reopens the
original app when necessary. Missing project data, unavailable permissions,
unknown write outcomes, and save failures pause work visibly. Source passage
tokens are task-local and need fresh reads after provider restart. Raw imported
bytes are retained when a source is removed so Undo can restore it.

Project files retain historical proposals, completed task summaries, and
provenance. Live execution handles, host grants, and operation receipts are not
exported. Import creates a distinct project identity and cannot resume the
original task automatically.

Automated tests cover transaction isolation, revision conflicts, exact edits,
receipt replay, failed persistence, source token isolation, graph integrity,
research operations, cancellation, and portable exports. LunOS adds runtime and
SDK channel tests. Before release, exercise both interfaces on connected SolOS
and actual Safari, including live edits, hidden-window indexing, Undo,
permission revocation, LFOS restart, and resume without duplicate edits. Those
production/browser acceptance checks are not implied by passing unit tests.


## Provider recovery contract

Every project result reports the observed revision. Mutations store their result
receipt atomically with project state; status queries wait for queued mutations
before reporting an operation absent. A lost reply must not trigger a duplicate
write. A committed receipt advances the host revision before its next decision.
Verification requires a read of this project's latest observed revision.

Source deletion removes dependent source cards, highlights, graph connections,
anchors, layout entries and source references. Precise Markdown edits accept
node aliases issued earlier in the same task, as well as stable node IDs.
Waiting tasks require `tasks.provideInput`; Resume cannot bypass their question.

The canonical developer contract is the LFOS documentation's **Agent** capability
page and LunOS `docs/lfos-agent-framework.md`. The dated developer-document export
in this repository is a historical snapshot and does not describe new Agent APIs.

From the LunOS checkout, run the combined provider/SDK regression check:

```sh
LFCORE_REPO=/path/to/LF-CORE node --experimental-strip-types --test scripts/validate-agent-integration.mjs
```

This uses the production host module, real SDK channel and project service with
a deterministic model and emulated IndexedDB. It checks a persisted edit, lost
reply recovery, and receipt lookup after recreating the provider. Connected
SolOS, iframe origin checks, actual Safari and real browser storage still require
the release acceptance checks above.


## Permission, registration and attachment failures

The host checks the originating app's current Intelligence authority before each
model call and tool dispatch. A reply arriving after revocation cannot authorize
another project edit. Pause/Stop wins over an in-flight Resume reconnect, and a
failed reconnect does not consume a pending clarification answer.

The SDK serializes provider registrations and restores accepted handlers after
explicit rejection. A registration timeout disables handlers because acceptance
is uncertain; register the complete provider again. Removing a project from the
registration pauses its active task. Provider disconnects notify other clients.

Attachment reads distinguish a valid zero-byte file from missing stored bytes.
Missing bytes report `NOT_FOUND`; invalid ranges report `INVALID_ARGUMENT`.
Reads accept offsets from zero and lengths from 1 through 24,000 bytes. Restore
or reimport the original attachment when bytes are unavailable; the agent must
not describe an unavailable attachment as an empty file.


Task visibility and provider dispatch are bound to the original installed app,
project ID and session. Reusing an old session ID in another installed app does
not inherit its tasks or pending operation receipts. Malformed operation-status
responses preserve the pending operation and pause work; they never count as
proof that a write was absent.

## Conversation and review

Agent messages sent while a task runs steer that task at its next safe dispatch boundary. A running write finishes and retains its receipt; unused calls from an older decision are skipped. Pause/Resume/Stop remain available, and follow-up requests after completion use the same conversation context.

The transcript shows plan status, progress, tool arguments and results, and a project change review. Durable history stores changed records before and after each transaction. Markdown changes have diffs; graph/source changes show record changes with canvas navigation for existing nodes. LFOS clients receive bounded previews and an explicit truncation notice. Older count-only history remains preserved but cannot reconstruct past diffs.

`verify_changes` checks transaction results against the actual current records, including later edits from the same task. Intervening conflicting edits produce mismatches. Completion requires these checks and model-reported evidence; this is not a guarantee of semantic correctness.

Task events update the task card without replacing the composer. Expanded details and transcript scroll position are retained. Full LFOS/SolOS and actual Safari acceptance testing is still required before declaring that environment supported.
