# LFOS integration

LF CORE remains a normal hosted web app and uses LFOS only when the version-1 SDK completes its authoritative `ready()` handshake. A page merely being framed is not treated as proof that LFOS is present.

## Install in LFOS

Deploy LF CORE over HTTPS, copy [`lfos/LF CORE.app.example`](../lfos/LF%20CORE.app.example), replace its placeholder `url` with the deployment URL, and install or import the resulting `.app` configuration in LFOS. The host must allow LFOS to frame it; this repository does not emit `X-Frame-Options` or a restrictive `frame-ancestors` policy.

The deployment also publishes the website-app manifest at `/.well-known/lfos-app.json` for Store → Add App discovery. On Vercel, the well-known route is rewritten to a small serverless handler that builds the manifest using the deployment's own host, so launch and publisher URLs stay same-origin for custom domains. It serves JSON with `Access-Control-Allow-Origin: *` for LFOS's credential-free cross-origin GET. The local development server exposes the same route for inspection, but localhost is not a valid HTTPS Store install origin. If the manifest's normalized contents change, increment its positive integer `version` in `src/website-app-manifest.js`.

The configuration requests:

- `files:open` for the LFOS picker, file reads, and `.lfcore` Open With activations;
- `files:save` for Save As and in-place writes to a user-opened file;
- `ai:generate` for SolOS Intelligence text generation;
- `agent:use` for LFOS task controls and `agent:provide` for the live project provider.

It declares LF CORE as the default handler for `.lfcore` and `application/vnd.linecoflow.project+json`. The website manifest is now version 5. Existing Store installations must apply its update and enable the newly requested AI permission to use SolOS Intelligence. LFOS owns the first-use cloud-processing consent prompt.

## Runtime behavior

- Top-level browser and Electron windows do not load the LFOS SDK.
- A framed page imports the pinned `https://os.linecoflow.com/sdk/v1/lfos.js` module, calls `ready()`, validates LFOS protocol version 1, and checks each advertised capability before use.
- **Open project** prefers the LFOS virtual-drive picker when `files.open` and `files.read` are available. Cancellation is a no-op. If LFOS is absent or the permission is unavailable, the existing Electron dialog or browser file input is used.
- An Open With launch reads `activation.getInitial()` once and imports the `.lfcore` project. The opaque handle stays attached to that imported project for the lifetime of the app window.
- **Save project** writes through the retained handle without reopening a picker. **Save project as…** obtains a new LFOS destination. A successful Save As becomes the project's current handle and releases the prior handle.
- **Auto save** keeps the browser copy and, after a short debounce, writes changed projects with a retained LFOS handle back to LFOS. New local projects first need **Save project to LFOS** to choose a destination. Background autosave never opens a picker. **Manual save** and **⌘S / Ctrl+S** save browser data and changed linked LFOS projects.
- LFOS `CONFLICT` failures never retry or overwrite automatically. Autosave pauses for that document, the save status shows failure, and the user can review or use Save As. Other file write failures also pause background retries until an explicit save.
- Project changes are compared with the exact snapshot last written to LFOS, so edits during an in-flight write remain unsaved. File writes and Save As run in order. `lifecycle.setUnsavedChanges(true)` protects the LFOS window until a durable write succeeds. The status tooltip names the save destination.
- Panning, zoom, and outline visibility are local view preferences. They are coalesced into small IndexedDB records, restored on reopening, and do not dirty a document or trigger LFOS autosave. A content export still includes the current camera position.
- Dirty checks use per-project revision counters. Background content saves wait until a canvas gesture finishes. The persistence worker owns the library mirror, receives changed projects and new undo snapshots, and writes IndexedDB off the main thread. Attachment loading, base64 encoding, project serialization, and UTF-8 encoding also run in that worker; the SDK receives transferable file bytes. Worker failures are surfaced as save failures, preserving unsaved state.
- Both home and project headers use the canonical `windowChrome` SDK geometry and drag binding. Overlay integration reserves the shell's control insets, adapts to resize/zoom, and falls back to the system title bar when controls do not fit. Browser and Electron headers keep their existing layout.
- Handles are released after failed imports, project deletion, replacement by Save As, or read failure.

## SolOS Intelligence

AI Settings offers SolOS Intelligence when the connected host advertises
`ai.responses.text` and exposes the SDK response API. Users explicitly choose it;
existing endpoint settings and encrypted keys are preserved when switching providers.
SolOS needs no app-managed API key or model ID. Thinking effort is saved locally
and offers None, Low, Medium (default), and High.

Chat and workspace-agent requests use `ai.responses.create`, map system prompts to
developer messages, and consume text deltas while awaiting successful completion.
Requests use the documented 16K maximum output budget to support complete drafts.
New Agent tasks run in the LFOS host and apply project operations through the native capability protocol. Historical staged proposals remain reviewable. See [Agent integration](AGENT_MODE.md).
Stop and panel teardown cancel generation. Service and permission failures are
shown without silently switching providers. Standalone browser and Electron
windows continue to use OpenAI-compatible endpoints.

## Verification

Use an LFOS installation whose `.app` configuration contains both file permissions, then verify:

1. ordinary launch completes without opening a picker;
2. **Open project** opens the LFOS virtual drive and cancellation is silent;
3. a valid `.lfcore` file imports and can be edited;
4. double-clicking or choosing Open With for `.lfcore` launches LF CORE with that project;
5. after an edit, closing the LFOS window triggers its unsaved-changes protection;
6. **Auto save** updates the activated/opened file without another picker; **⌘S / Ctrl+S** does the same in Manual save mode;
7. **Save project as…** creates a new file and subsequent saves update it;
8. removing either permission produces a clean fallback or an actionable error rather than an unrestricted browser picker inside the LFOS frame;
9. the same deployment still opens and downloads projects in an ordinary top-level browser;
10. home and project headers share the LFOS controls without overlap at normal size, restore the system title bar when too narrow, and support dragging the window from empty header space.

Also verify that AI Settings offers SolOS Intelligence only with `ai.responses.text`, each thinking effort reaches the SDK request, chat streams, Agent mode uses the host runtime, direct project changes have Undo, Stop cancels, and revoked AI permission shows a failure without sending to another provider.

Run `npm test` and `npm run build` for automated adapter and bundle checks.
# Background processing and activity

Project import parsing, PDF/media attachment decoding, and source-search
processing use `dist/compute-worker.js`. Owned attachment buffers return by
transfer. Invalid input returns a typed error without replacing the current
project. Worker failure/cancellation preserves the current project and permits
a fresh computation worker on retry. PDF.js and the existing persistence worker
remain separate; camera state continues to use its separate storage path.

When the host advertises `lifecycle.subscribeActivity`, optional PDF indexing
pauses while the LFOS window is hidden/minimized. Required saves continue.
Progress updates are throttled to 100 ms. Outside LFOS, document visibility
provides the scheduling signal. Include the computation worker in offline assets.

`tests/compute.test.js` runs the actual import worker on a synthetic project,
checks exact attachment bytes, malformed input and a successful retry.
