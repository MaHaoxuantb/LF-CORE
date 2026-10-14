# LFOS integration

LF CORE remains a normal hosted web app and uses LFOS only when the version-1 SDK completes its authoritative `ready()` handshake. A page merely being framed is not treated as proof that LFOS is present.

## Install in LFOS

Deploy LF CORE over HTTPS, copy [`lfos/LF CORE.app.example`](../lfos/LF%20CORE.app.example), replace its placeholder `url` with the deployment URL, and install or import the resulting `.app` configuration in LFOS. The host must allow LFOS to frame it; this repository does not emit `X-Frame-Options` or a restrictive `frame-ancestors` policy.

The configuration requests only:

- `files:open` for the LFOS picker, file reads, and `.lfcore` Open With activations;
- `files:save` for Save As and in-place writes to a user-opened file.

It associates `.lfcore` and `application/vnd.linecoflow.project+json` with LF CORE. No `ai:generate` permission is declared, and the application does not call LFOS AI APIs.

## Runtime behavior

- Top-level browser and Electron windows do not load the LFOS SDK.
- A framed page imports the pinned `https://os.linecoflow.com/sdk/v1/lfos.js` module, calls `ready()`, validates LFOS protocol version 1, and checks each advertised capability before use.
- **Open project** prefers the LFOS virtual-drive picker when `files.open` and `files.read` are available. Cancellation is a no-op. If LFOS is absent or the permission is unavailable, the existing Electron dialog or browser file input is used.
- An Open With launch reads `activation.getInitial()` once and imports the `.lfcore` project. The opaque handle stays attached to that imported project for the lifetime of the app window.
- **Save project** writes through the retained handle without reopening a picker. **Save project as…** obtains a new LFOS destination. A successful Save As becomes the project's current handle and releases the prior handle.
- LFOS `CONFLICT` failures never retry or overwrite automatically. The project remains dirty and the user can review or use Save As.
- Project changes are compared with the last successful LFOS open/write snapshot. `lifecycle.setUnsavedChanges(true)` protects the LFOS window until a durable write succeeds. Browser-origin IndexedDB autosave remains separate from saving the external `.lfcore` file.
- Handles are released after failed imports, project deletion, replacement by Save As, or read failure.

## Verification

Use an LFOS installation whose `.app` configuration contains both file permissions, then verify:

1. ordinary launch completes without opening a picker;
2. **Open project** opens the LFOS virtual drive and cancellation is silent;
3. a valid `.lfcore` file imports and can be edited;
4. double-clicking or choosing Open With for `.lfcore` launches LF CORE with that project;
5. after an edit, closing the LFOS window triggers its unsaved-changes protection;
6. **Save project** updates the activated/opened file without another picker;
7. **Save project as…** creates a new file and subsequent saves update it;
8. removing either permission produces a clean fallback or an actionable error rather than an unrestricted browser picker inside the LFOS frame;
9. the same deployment still opens and downloads projects in an ordinary top-level browser.

Run `npm test` and `npm run build` for automated adapter and bundle checks.
