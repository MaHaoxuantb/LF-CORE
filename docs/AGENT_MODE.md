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
