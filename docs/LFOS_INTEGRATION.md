# LFOS integration

LF CORE remains a normal hosted web app and uses LFOS only when the version-1 SDK completes its authoritative `ready()` handshake. A page merely being framed is not treated as proof that LFOS is present.

## Install in LFOS

Deploy LF CORE over HTTPS, copy [`lfos/LF CORE.app.example`](../lfos/LF%20CORE.app.example), replace its placeholder `url` with the deployment URL, and install or import the resulting `.app` configuration in LFOS. The host must allow LFOS to frame it; this repository does not emit `X-Frame-Options` or a restrictive `frame-ancestors` policy.

The deployment also publishes the website-app manifest at `/.well-known/lfos-app.json` for Store → Add App discovery. On Vercel, the well-known route is rewritten to a small serverless handler that builds the manifest using the deployment's own host, so launch and publisher URLs stay same-origin for custom domains. It serves JSON with `Access-Control-Allow-Origin: *` for LFOS's credential-free cross-origin GET. The local development server exposes the same route for inspection, but localhost is not a valid HTTPS Store install origin. If the manifest's normalized contents change, increment its positive integer `version` in `src/website-app-manifest.js`.

The configuration requests only:

- `files:open` for the LFOS picker, file reads, and `.lfcore` Open With activations;
- `files:save` for Save As and in-place writes to a user-opened file.

It declares LF CORE as the default handler for `.lfcore` and `application/vnd.linecoflow.project+json`. The website manifest is now version 3; existing Store installations must apply its update (or reinstall) to receive the default association and overlay header configuration. No `ai:generate` permission is declared, and the application does not call LFOS AI APIs.

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

Run `npm test` and `npm run build` for automated adapter and bundle checks.
