# LFOS Developer Documentation

> Complete Markdown export generated from the canonical LFOS developer documentation.
> Generated: 2026-10-14

Canonical site: https://os-docs.linecoflow.com/docs/

<!-- Canonical documentation: https://os-docs.linecoflow.com/docs/ -->
<!-- Source: docs/intro.mdx -->

> Run an existing web application in LFOS and integrate with LFOS files and text generation.

# Build for LFOS with the web platform

LFOS runs hosted HTTPS applications inside sandboxed windows. Keep your existing framework, hosting, authentication, and browser behavior. Add the versioned LFOS SDK when your app needs files from the LFOS virtual drive or permissioned text generation.

## What works today

- Hosted HTTPS web applications
- Browser-native APIs permitted by the LFOS iframe sandbox
- Browser-native device file inputs
- LFOS virtual-drive open and save dialogs
- `files.open`, `files.read`, `files.save`, `files.write`, and `files.release`
- SolOS-only streaming text generation through `ai.responses.create`
- Store Add App discovery through the canonical `/.well-known/lfos-app.json` contract, with user-reviewed updates and explicit capability selection
- Versioned manifest permissions: `files:open`, `files:save`, `ai:generate`, `notifications:post`, `intents:provide`, and `intents:subscribe`
- Settings management for installed web apps and per-app privacy controls

LFOS identity, directory handles, persistent file handles, packaged applications, and the developer CLI are not implemented yet. See [Implementation status](https://os-docs.linecoflow.com/ai/docs/reference/implementation-status.md).

[Bring your web app to LFOS](https://os-docs.linecoflow.com/ai/docs/getting-started/bring-your-web-app.md)

---

<!-- Canonical documentation: https://os-docs.linecoflow.com/docs/getting-started/bring-your-web-app -->
<!-- Source: docs/getting-started/bring-your-web-app.mdx -->

> Install an HTTPS web app in LFOS and add virtual-drive file access.

# Bring your web app to LFOS

An existing React, Vue, Svelte, Angular, or plain JavaScript app remains a hosted web app. LFOS displays it in a sandboxed iframe inside an LFOS window.

## 1. Prepare the hosted app

Your app must:

- use HTTPS in production;
- permit LFOS to frame it—do not block the LFOS host with `X-Frame-Options` or CSP `frame-ancestors`;
- use responsive layout suitable for a resizable window;
- tolerate interrupted network access;
- handle third-party iframe cookie and authentication restrictions in its supported browsers.

LFOS cannot override a provider's framing headers. Configure `embedPolicy: "external"` when the site must open in a browser tab instead; LFOS SDK capabilities are unavailable in that mode.

## 2. Install it in LFOS

For a website that publishes an LFOS manifest, open **LFOS Store → Add App** and enter the site's HTTPS origin. LFOS requests `/.well-known/lfos-app.json` directly from that origin. Review the publisher details and requested capabilities, select which permissions to enable, inspect the final configuration, and confirm installation. A compatible manifest is not reviewed or certified by LFOS. See [Website app manifest](https://os-docs.linecoflow.com/ai/docs/reference/website-app-manifest.md) for the exact contract and hosting requirements.

If discovery fails (for example, the manifest is missing, invalid, unreachable, or CORS is not configured), the wizard can continue with ordinary manual installation. Enter a local app name and launch URL and configure basic window behavior. Manual fallback does not inherit publisher-declared capabilities and is not labeled LFOS Compatible.

After installation, use **Settings → Apps** to manage installed web apps, see their source and declared capabilities, control Dock visibility, or move an app to Trash. **Settings → Privacy** lets you disable a permission for an app. These device-local controls can remove access declared by the manifest but cannot add undeclared access.

For development, you may also edit the local `.app` configuration in `/Applications`. In Finder, right-click the `.app` file and choose **Edit Configuration**. Add the permissions needed by the app:

```json title="My App.app"
{
  "schemaVersion": 1,
  "name": "My App",
  "url": "https://app.example.com",
  "displayMode": "standalone",
  "embedPolicy": "embed",
  "rememberWindowBounds": true,
  "permissions": ["files:open", "files:save"]
}
```

For manual apps, the `.app` file's LFOS virtual-filesystem identity is the installed app identity. Website-managed and catalog apps also preserve their local VFS identity while retaining source-specific provenance for update checks.

For a website-hosted manifest, runtime permissions go in its `install` block. For Store-catalog distribution, permissions likewise go in the catalog entry's `install` block, but catalog review and trust metadata are managed separately:

```json
{
  "install": {
    "url": "https://app.example.com",
    "displayMode": "standalone",
    "embedPolicy": "embed",
    "permissions": ["files:open", "files:save"]
  }
}
```

## 3. Load the SDK

Import the SDK from the LFOS deployment that will host the app window:

```ts
import {lfos} from 'https://os.linecoflow.com/sdk/v1/lfos.js';

try {
  const environment = await lfos.ready();
  console.log(environment.capabilities);
} catch {
  // The app is running in an ordinary browser or an incompatible host.
}
```

The `/sdk/v1/lfos.js` endpoint permits cross-origin ES module imports. Pin the versioned `/v1/` path. `ready()` rejects after 15 seconds if no compatible LFOS host answers.

## 4. Open and save files

```ts
const opened = await lfos.files.open({
  title: 'Open notes',
  accept: [{mimeTypes: ['text/*']}],
});

if (opened) {
  const bytes = await lfos.files.read(opened);
  console.log(new TextDecoder().decode(bytes));
  await lfos.files.release(opened);
}

const destination = await lfos.files.save({
  suggestedName: 'notes.txt',
  mimeType: 'text/plain',
});

if (destination) {
  await lfos.files.write(destination, 'Hello from my web app.\n');
  await lfos.files.release(destination);
}
```

Open and save cancellation resolves to `null`.

## 5. Test

Confirm all of these cases:

1. the app opens inside LFOS rather than the external fallback;
2. `ready()` reports the expected file capabilities;
3. cancelling either dialog does not show an error;
4. opening and decoding a supported file succeeds;
5. saving creates the file in the chosen LFOS folder;
6. the ordinary-browser fallback still works outside LFOS;
7. a manifest without the permission receives `PERMISSION_DENIED`;
8. disabling a previously enabled permission in **Settings → Privacy** immediately removes the capability from the running app.

See [Files and folders](https://os-docs.linecoflow.com/ai/docs/capabilities/files.md) for the full API and [App manifest](https://os-docs.linecoflow.com/ai/docs/reference/manifest.md) for configuration fields.

---

<!-- Canonical documentation: https://os-docs.linecoflow.com/docs/getting-started/integration-levels -->
<!-- Source: docs/getting-started/integration-levels.mdx -->
# Choose an integration level

| Level | Status | What you provide | Best for |
| --- | --- | --- | --- |
| Hosted web app | Available | HTTPS URL and app configuration; optional `/.well-known/lfos-app.json` for Store discovery | Existing sites, dashboards, and SaaS apps |
| LFOS file-enabled app | Available | Hosted app, file permissions, and SDK calls | Apps that open or save LFOS virtual-drive files |
| Same-origin offline catalog app | Available with constraints | Hosted resources on the LFOS origin and catalog offline metadata | Controlled same-origin deployments |
| Packaged signed app | Not implemented | Future bundle, manifest, and signature | Future offline distribution |

## Hosted web app

No LFOS-specific JavaScript is required. Browser features allowed by the sandbox continue to work. A provider can still block iframe embedding with its HTTP security headers. Publishing the canonical [website app manifest](https://os-docs.linecoflow.com/ai/docs/reference/website-app-manifest.md) is optional; it lets users discover the app in Store's Add App wizard and receive user-reviewed updates. It does not confer Store review or certification.

## LFOS file-enabled app

The SDK adds user-mediated access to the LFOS virtual drive. The app never receives a native path or unrestricted drive access. File handles remain valid only in the app window that created them.

## Same-origin offline catalog app

The Store can preload a catalog app only when its install URL and declared resources share the LFOS origin. Remote provider apps remain dependent on their provider's service worker and browser cache.

## Packaged app

The package format, signing, installer, updates, and rollback are future work. Do not describe packaged applications as available.

---

<!-- Canonical documentation: https://os-docs.linecoflow.com/docs/getting-started/code-studio-extensions -->
<!-- Source: docs/getting-started/code-studio-extensions.mdx -->

> Install, package, test, and recover Code Studio extensions through Developer Hub.

# Code Studio extensions

Developer Hub manages Code Studio extensions installed on the current device. Reviewed built-ins and user-installed packages use the same versioned manifest and contribution model, while privileged built-in features such as PDF Annotator and Git use reviewed host handlers.

## Get and install an extension

Open **Developer Hub → Code Studio Extensions**, then choose one of these options:

- **Install from File** accepts a local `.luext` archive.
- **Install from URL** accepts a direct HTTPS package URL and opens a review dialog.

Before installation, Developer Hub shows the package name, publisher, version, source, requested permissions, and SHA-256 integrity value. Packages and approvals are device-local. Enabling an extension on one LFOS installation does not make it executable on another installation.

Use **Developer Hub → Settings** to turn on Extension Safe Start if a user extension prevents Code Studio from starting. Safe Start leaves reviewed built-ins enabled. Extensions that repeatedly fail during activation are quarantined automatically.

## Package layout

A `.luext` file is a ZIP archive with `extension.json` at its root:

```text
my-extension.luext
├── extension.json
├── dist/
│   └── extension.js
└── assets/
    └── theme.json
```

LFOS rejects absolute paths, `..` traversal, empty path segments, missing entry points, more than 256 files, and packages larger than 20 MiB after expansion.

## Manifest

Use schema version 1. IDs contain lowercase letters, digits, dots, or hyphens and are 3–80 characters long. Versions use semantic versioning. The supported engine range is either an exact LFOS version or a minimum such as `>=0.4.1`.

```json
{
  "schemaVersion": 1,
  "id": "example.workspace-tools",
  "name": "Workspace Tools",
  "version": "1.0.0",
  "publisher": "Example",
  "description": "Small commands for the current workspace.",
  "engines": { "lunos": ">=0.4.1" },
  "main": "dist/extension.js",
  "permissions": ["workspace:read", "ui:notifications"],
  "contributes": {
    "commands": [
      { "id": "example.workspace-tools.inspect", "title": "Inspect Workspace" }
    ],
    "customEditors": [
      {
        "id": "example.workspace-preview",
        "label": "Workspace Preview",
        "extensions": [".example"],
        "mimeTypes": ["application/x-example"]
      }
    ],
    "activityViews": [
      { "id": "example-tools", "title": "Example Tools" }
    ],
    "languages": [
      { "id": "example", "extensions": [".example"] }
    ],
    "themes": [
      { "id": "example-dark", "label": "Example Dark", "path": "assets/theme.json" }
    ],
    "sourceControlProviders": [
      { "id": "example-scm", "label": "Example SCM" }
    ]
  },
  "updateUrl": "https://downloads.example.com/workspace-tools.luext"
}
```

An update URL is optional but must use HTTPS. Every declared entry point and local asset must be included in the archive. Contributions declare what an extension can add; an installed custom editor appears in Code Studio’s **Open With** resolver only when LFOS has a compatible host implementation for that editor contribution.

## Permissions and runtime API

Request only the capabilities the extension uses:

| Permission | Host-mediated capability |
| --- | --- |
| `workspace:read` | Read a URI inside the currently opened workspace |
| `workspace:write` | Write UTF-8 content inside the currently opened workspace |
| `network` | Fetch an HTTPS URL without browser credentials |
| `ui:dialogs` | Reserved for host-mediated dialogs |
| `ui:notifications` | Show a Code Studio status notification |

User code runs in a sandboxed opaque-origin frame with no direct filesystem, shell, terminal, credential, or host API access. Export an asynchronous `activate` function and call the provided request bridge:

```js
export async function activate(lunos) {
  const bytes = await lunos.request("workspace.readFile", {
    uri: "lunos-vfs://local/Users/default/Documents/Read%20me.md"
  });

  await lunos.request("ui.notify", {
    message: `Read ${bytes.length} bytes from the workspace.`
  });
}
```

The current RPC methods are `workspace.readFile`, `workspace.writeFile`, `ui.notify`, and `network.fetch`. Requests outside the opened workspace, undeclared permissions, non-HTTPS network requests, and raw credential access are denied by the host.

## Build and test

1. Bundle the extension into browser-compatible JavaScript. Do not depend on Node.js globals or native processes.
2. Put `extension.json` at the archive root and include the declared `main` file.
3. ZIP the contents, not their parent directory, and rename the result to `.luext`.
4. In Developer Hub, choose **Install from File**, verify identity, permissions, source, and integrity, then install.
5. Reload Code Studio and test against a disposable workspace containing no sensitive data.
6. Disable or uninstall the package from Developer Hub after testing. Use Safe Start if activation repeatedly fails.

For distribution, publish the unchanged `.luext` archive at a direct HTTPS URL. A future update should use a new semantic version; Developer Hub must ask again if requested permissions change.

## Current boundaries

User extensions cannot access terminals, native processes, SSH, arbitrary browser host APIs, or raw Git credentials. Reviewed built-ins may use private host adapters, but their manifests and contributions remain visible through the same registry. This boundary allows compatible contributions to be mapped to the planned Code—OSS backend later.

---

<!-- Canonical documentation: https://os-docs.linecoflow.com/docs/capabilities/files -->
<!-- Source: docs/capabilities/files.mdx -->

> Open and save files in the LFOS virtual drive through revocable handles.

# Files

LFOS offers two distinct file experiences:

- Standard `<input type="file">` opens the browser's device file selector.
- The LFOS SDK opens the LFOS virtual drive used by Finder and LFOS apps.

## Connect to LFOS

```ts
import {lfos, LFOSError} from 'https://os.linecoflow.com/sdk/v1/lfos.js';

let connected = false;
try {
  const environment = await lfos.ready();
  connected = environment.name === 'LFOS';
} catch {
  // Use the ordinary web fallback.
}
```

Call `ready()` before checking capabilities:

```ts
if (connected && lfos.capabilities.has('files.open')) {
  // LFOS virtual-drive selection is available.
}
```

`isAvailable()` only detects whether the page is framed; `ready()` is the authoritative LFOS check.

## Open and read

The manifest must declare `files:open`.

```ts
const handle = await lfos.files.open({
  title: 'Choose an image',
  accept: [{mimeTypes: ['image/*']}],
});

if (handle) {
  const buffer = await lfos.files.read(handle);
  const blob = new Blob([buffer], {type: handle.type});
  const objectUrl = URL.createObjectURL(blob);

  try {
    document.querySelector<HTMLImageElement>('#preview')!.src = objectUrl;
  } finally {
    await lfos.files.release(handle);
  }
}
```

`open()` resolves to `null` when cancelled. `read()` resolves to an `ArrayBuffer`.

### Open options

```ts
type OpenFileOptions = {
  title?: string;
  accept?: Array<{
    description?: string;
    extensions?: string[];
    mimeTypes?: string[];
  }>;
};
```

The runtime supports one selected file. It evaluates every `extensions` and `mimeTypes` entry across every supplied filter; a file is shown when any declared extension or MIME pattern matches. Extensions include the leading dot, comparison is case-insensitive, and a MIME wildcard such as `image/*` is supported. `description` labels a filter for hosts that expose filter labels. Multiple selection is not implemented.

For example, an Office editor can expose all six formats without using an overly broad `application/*` wildcard:

```ts
accept: [{
  description: 'Microsoft Word, Excel, or PowerPoint',
  extensions: ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'],
  mimeTypes: [
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
}],
```

## Save and write

The manifest must declare `files:save`.

For a file opened through `files.open` or an Open With activation, normal **Save** writes through that same handle and does not show another selector:

```ts
const activation = await lfos.activation.getInitial();
if (activation?.type === 'open-file') {
  const bytes = await lfos.files.read(activation.file);
  const editedBytes = await editDocument(bytes);
  await lfos.files.write(activation.file, editedBytes);
  await lfos.files.release(activation.file);
}
```

This in-place write is accepted only when the installed app declares both `files:open` and `files:save`. Selecting the file authorizes its identity; `files:save` authorizes modification. Other files remain inaccessible.

For **Save As**, or for a new document with no existing LFOS handle, request a destination:

```ts
const handle = await lfos.files.save({
  title: 'Save report',
  suggestedName: 'report.txt',
  requiredExtension: '.txt',
  mimeType: 'text/plain',
});

if (handle) {
  const saved = await lfos.files.write(handle, 'Report contents\n');
  console.log(`Saved ${saved.name}: ${saved.size} bytes`);
  await lfos.files.release(handle);
}
```

`save()` chooses a new path; the current dialog does not overwrite an existing item. It resolves to `null` when cancelled. The file is created when `write()` succeeds, not when the save dialog closes. Do not call `files.save` for an ordinary Save when an open handle is still available.

`write()` accepts a string, `ArrayBuffer`, or typed-array view. A single write is limited to 50 MB. Writing again through the same save handle updates that file only if its revision still matches the last successful read or write. A concurrent change rejects with `CONFLICT`; keep the editor dirty and let the user review, reload, or Save As. Do not automatically retry a stale write or re-read merely to obtain permission to overwrite.

### Save options

```ts
type SaveFileOptions = {
  title?: string;
  suggestedName?: string;
  requiredExtension?: string;
  mimeType?: string;
};
```

If `requiredExtension` is omitted, LFOS derives it from `suggestedName` when that name contains an extension.

## Handles

```ts
type LFFileHandle = {
  id: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
};
```

Handles are opaque, bound to document identity, and scoped to one app window and vault activation. Renaming or moving a file does not redirect its handle to a replacement at the old path. They expire when released, when the app window closes, or when the embedded app origin changes. An open handle is readable and supports in-place writing when `files:save` is also declared. A save-dialog handle is write-only. Persistent handles across app windows and directory handles are not implemented.

## Browser fallback

Keep a normal file input for browsers and incompatible hosts:

```html
<input id="image-input" type="file" accept="image/*" hidden />
```

```ts
async function chooseImage() {
  try {
    await lfos.ready();
    if (lfos.capabilities.has('files.open')) {
      return await lfos.files.open({accept: [{mimeTypes: ['image/*']}]});
    }
  } catch {
    // Continue to browser fallback.
  }

  document.querySelector<HTMLInputElement>('#image-input')?.click();
  return null;
}
```

For saving, `showSaveFilePicker()` is only a valid fallback when the app is a top-level browser page. Browsers reject it in a cross-origin iframe. An app embedded in LFOS must use `lfos.files.save` and `lfos.files.write`; therefore editors need `files:save` in their installed manifest.

If an editor must asynchronously serialize or convert its document before calling `files.write`, it should keep `lfos.lifecycle.setUnsavedChanges(true)` set from the first unsaved edit until `files.write` resolves. This lets LFOS protect the app window from being closed while the previous file version is still the latest durable version.

If an embedded installation lacks `files.save`, do not invoke the browser picker. Disable the save action with an installation-permission explanation, or preserve the result with a normal download:

```ts
function downloadFallback(data: BlobPart, fileName: string) {
  const url = URL.createObjectURL(new Blob([data]));
  const link = Object.assign(document.createElement('a'), {
    href: url,
    download: fileName,
  });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

if (window.self !== window.top) {
  downloadFallback(bytes, 'report.docx');
} else {
  // A top-level browser page may use showSaveFilePicker() when available.
}
```

## Errors

SDK failures reject with `LFOSError`, whose `code` is one of:

| Code | Meaning |
| --- | --- |
| `PERMISSION_DENIED` | The installed `.app` manifest lacks the permission, or the destination is read-only. |
| `INVALID_ARGUMENT` | A handle, filename, or data value is invalid. |
| `HANDLE_EXPIRED` | The handle is invalid, released, expired, or has the wrong access mode. |
| `CONFLICT` | The document changed since its last read/write, or a Save As destination was taken. Preserve unsaved work and offer review or Save As. |
| `CONTENT_UNAVAILABLE` | Stored document bytes are missing; an empty document is never substituted. |
| `RESOURCE_NOT_FOUND` | The selected LFOS resource no longer exists. |
| `RESOURCE_BUSY` | LFOS background admission is full. Preserve edits and the existing handle/revision; retry later with regenerated transferable bytes. |
| `RESOURCE_TOO_LARGE` | A write exceeds 50 MB. |
| `NOT_SUPPORTED` | The page is outside LFOS, the protocol is unavailable, or the method is unsupported. |
| `INTERNAL_ERROR` | LFOS could not complete the operation for another reason. |

Cancellation is not an error and resolves to `null`.


## Local saves and cloud sync

A successful `files.write` means the bytes and pending sync operation are durable
locally. It does not mean the cloud has accepted them. Automatic sync starts after
a one-second debounce (at most five seconds while saves continue), retries on
reconnect, and polls for remote changes at the configured interval. “Up to date”
requires no pending operations after reconciliation. Manual sync remains available
when automatic sync is off.

Independent metadata changes and non-overlapping plain-text edits can merge
without review. Structured documents, JSON application state, Office files, and
binary documents do not receive line-based merges. Delete/edit conflicts preserve
the competing version and need an explicit decision. Read-only “sync recovery”
items expose recoverable edits in Documents without silently restoring the
canonical file. Restoring a competing version whose original parent disappeared
uses Documents; ordinary Trash restoration instead asks for a destination when
the original folder is missing.

File names retain their display spelling but use NFC normalization and
locale-independent lowercase for uniqueness. Concurrent remote collisions stay
recoverable; ambiguous paths fail instead of selecting a document arbitrarily.
Vault switching invalidates handles, temporarily blocks saves, and checkpoints
the local documents and pending work for recovery after interruption.

## Background saves

LFOS executes filesystem preparation and transactions in a worker. Binary bytes
are stored directly; saving one document does not reconstruct unrelated files.
This does not move an app's own serializer off its UI thread. Use an app worker
for expensive serialization and conversion, then pass its output to `files.write`.

A transferred buffer belongs to its receiver. Retain editable source data so you
can regenerate a payload after failure. A timeout or worker interruption does not
prove that a write failed to commit. Keep the document dirty and reconcile its
saved state; never obtain a newer revision just to overwrite a conflicting save.

---

<!-- Canonical documentation: https://os-docs.linecoflow.com/docs/capabilities/background-work -->
<!-- Source: docs/capabilities/background-work.mdx -->

> Keep LFOS interactions responsive while parsing, converting, indexing and saving.

LFOS keeps input, DOM updates, permissions, and pickers on the window thread.
Its runtime worker owns filesystem transactions and sync. Separate, bounded
workers handle expensive computation. Third-party apps retain the ordinary SDK
permission boundary and do not receive internal runtime ports.

## App workers

Keep large source data in a worker or IndexedDB. Send changed records, content
IDs, blobs, or owned `ArrayBuffer` values instead of repeatedly cloning complete
projects. Serialize document saves and label each snapshot with the content
revision it contains. Clear dirty state only for that acknowledged revision.

Workers cannot manipulate the DOM or call the window-dependent LFOS SDK. Return
results to the app's window, then call `lfos.files.write`. Keep browser input and
rendering coalesced to animation frames.

## Visibility

```js
const environment = await lfos.ready();
if (environment.capabilities.includes('lifecycle.subscribeActivity')) {
  const dispose = lfos.lifecycle.onActivityChange(({visible, focused}) => {
    processingWorker.postMessage({type: 'activity', visible, focused});
  });
  // Call dispose when the editor is removed.
}
```

Pause optional indexing and prewarming while hidden. Explicit saves continue.
Outside LFOS, use the document's visibility state. Do not discard unsaved work
when its window loses focus.

## Limits and failures

LFOS admits at most 32 active/pending runtime jobs and 64 MiB of copied request
payloads. Immutable Blob/File backing storage is referenced rather than eagerly
copied. Owned ArrayBuffers are transferred only when the sender releases ownership.
`RESOURCE_BUSY` is retryable; it does not authorize overwriting a newer file.
Foreground reads and saves precede optional background work, with aging to prevent
starvation. Started transactions finish even when their caller closes.

A stopped worker fails pending requests. Reload authoritative storage before
accepting further mutations and retain uncertain edits. Optional computations
such as a replaced search can be cancelled independently of durable storage.

LFOS uses message passing and transferable buffers. Integration does not require
SharedArrayBuffer, cross-origin isolation, or a provider-side threading service.

---

<!-- Canonical documentation: https://os-docs.linecoflow.com/docs/capabilities/file-associations -->
<!-- Source: docs/capabilities/file-associations.mdx -->

> Register extensions and MIME types so LFOS can open files with your web app.

# File associations

An installed web app can declare which LFOS virtual-drive files it opens. LFOS uses one association resolver for built-in apps and installed web apps, so double-click, Spotlight, Finder, Desktop, and **Open with…** choose applications consistently.

## Declare an association

The app must declare `files:open`, because LFOS delivers the selected file as a readable SDK handle. Opening does not imply permission to modify: an editor must separately declare `files:save`. It can then use `files.write` on the activation handle for ordinary Save, preserving the original LFOS location. Use `files.save` only for Save As or a new document. An embedded app must not fall back to the browser's `showSaveFilePicker()`, because browsers prohibit cross-origin subframes from showing that picker.

The declaration must be present in the installed `.app` configuration. Install the reviewed Store entry or a website manifest that declares the association, or add the app through **LFOS Store → Add App** and edit its local `.app` configuration. Manual fallback creates a basic configuration; it does not automatically import a repository-side `.app` file. Without a declared association, the app will not appear in **Open With**.

```json title="Markdown Studio.app"
{
  "schemaVersion": 1,
  "name": "Markdown Studio",
  "url": "https://markdown.example.com",
  "embedPolicy": "embed",
  "permissions": ["files:open"],
  "fileAssociations": [
    {
      "extensions": [".md", ".markdown"],
      "mimeTypes": ["text/markdown"],
      "default": true
    }
  ]
}
```

Each entry must contain at least one valid extension or MIME type.

```ts
type WebAppFileAssociation = {
  extensions?: string[];
  mimeTypes?: string[];
  default?: boolean;
};
```

## What `mimeTypes` means

A MIME type (also called a media type) is a standardized content identifier such as `application/pdf` or `image/png`. It has a top-level type before the slash and a subtype after it. LFOS stores a MIME type as file metadata and can use it to find a handler even when the file name has no useful extension.

`extensions` and `mimeTypes` describe the same supported formats in complementary ways:

- `extensions` matches the file-name suffix, such as `.docx`. Include the leading dot.
- `mimeTypes` matches the file's stored media type, such as `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
- Matching uses **OR**, not AND. A file is associated when either its extension or MIME type matches.
- Declaring a MIME type does not convert, validate, or inspect the file contents. The application remains responsible for safely parsing the file.
- Use the real media type for each format. For example, `text/markdown` describes Markdown, not a `.docx` document.
- A subtype wildcard such as `image/*` matches all stored MIME types beginning with `image/`. Prefer exact MIME types for document editors.

Common document media types:

| Format | Extension | MIME type |
| --- | --- | --- |
| Word (OOXML) | `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| Word 97–2003 | `.doc` | `application/msword` |
| Excel (OOXML) | `.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| Excel 97–2003 | `.xls` | `application/vnd.ms-excel` |
| PowerPoint (OOXML) | `.pptx` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` |
| PowerPoint 97–2003 | `.ppt` | `application/vnd.ms-powerpoint` |
| PDF | `.pdf` | `application/pdf` |
| Markdown | `.md`, `.markdown` | `text/markdown` |
| Plain text | `.txt` | `text/plain` |

For ONLYOFFICE, a complete editable association looks like this:

```json title="ONLYOFFICE.app"
{
  "schemaVersion": 1,
  "name": "ONLYOFFICE",
  "url": "http://127.0.0.1:8848/",
  "displayMode": "browser",
  "embedPolicy": "auto",
  "permissions": ["files:open", "files:save"],
  "fileAssociations": [
    {
      "extensions": [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"],
      "mimeTypes": [
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      ],
      "default": true
    }
  ]
}
```

Localhost HTTP is supported for development. Installed production applications should use HTTPS.

## Matching rules

- Extensions include the leading dot and match case-insensitively.
- Exact MIME types match case-insensitively.
- A subtype wildcard such as `image/*` is supported.
- An association matches when either an extension or MIME pattern matches.
- Invalid values and empty association entries are discarded.
- An app without `files:open` is never registered as a file handler.
- An app configured with `embedPolicy: "external"` is not registered because an external page cannot receive the LFOS activation bridge.

When `default` is `false` or omitted, the app appears in the collapsed **Open With** submenu but does not replace the current default. When `default` is `true`, the web app is preferred over built-in defaults for matching files. If multiple installed web apps request default status, LFOS resolves the tie deterministically by app name and installed app identity; publishers should not rely on installation order.

## Receive the opened file

When LFOS launches the web app for a file, request the initial activation after connecting:

```ts
import {lfos} from 'https://os.linecoflow.com/sdk/v1/lfos.js';

await lfos.ready();

const activation = await lfos.activation.getInitial();
if (activation?.type === 'open-file') {
  const bytes = await lfos.files.read(activation.file);
  const text = new TextDecoder().decode(bytes);
  openDocument(text, activation.file.name);

  // Keep activation.file while the document is open. For an editor that
  // declares files:save, ordinary Save writes back to the same LFOS file:
  await lfos.files.write(activation.file, serializeDocument());

  // Release it when the document closes, not immediately after reading.
  await lfos.files.release(activation.file);
}
```

The activation contains the same opaque `LFFileHandle` returned by `files.open`. It does not expose a VFS URI or native path. `activation.getInitial()` returns `null` when the app was launched normally rather than from a file.

The initial API delivers one launch activation per app window. LFOS opens a separate window when a different file is launched, so applications do not yet need a live activation-event listener. Viewers may release the handle after reading; editors must retain it until the document closes if they want ordinary Save to preserve the original location.

## Built-in handlers

| App | Association | Default behavior |
| --- | --- | --- |
| Office | `.ludoc`, `.lusheet`, `.luslide`, `.docx`, `.xlsx`, `.pptx`, and LFOS Office MIME types | Default for matches |
| Image Viewer | `image/*` | Default for matches |
| Text Editor | `text/*`, with general file fallback | Default when no more specific default exists |
| Code Studio | All files | Available through **Open with…**; not the default |

## Store catalog

For Store distribution, copy `permissions` and `fileAssociations` into the catalog entry's `install` object. Store updates replace these declarations with the reviewed catalog version.

```json
{
  "install": {
    "url": "https://markdown.example.com",
    "displayMode": "standalone",
    "embedPolicy": "embed",
    "permissions": ["files:open"],
    "fileAssociations": [
      {
        "extensions": [".md", ".markdown"],
        "mimeTypes": ["text/markdown"],
        "default": true
      }
    ]
  }
}
```

The Store review should confirm that every claimed type opens safely and that requesting default status is appropriate.

---

<!-- Canonical documentation: https://os-docs.linecoflow.com/docs/capabilities/ai -->
<!-- Source: docs/capabilities/ai.mdx -->

> Generate streaming text through the secure SolOS-only LFOS AI Framework.

# AI text generation

The LFOS AI Framework lets a web app generate text without owning an AI-provider key or infrastructure. Version 1 is available only in SolOS. The system chooses the model, sends transient request text through the SolOS backend to OpenAI, and enforces one account allowance plus rate and concurrency limits.

Tools, function calls, web search, MCP, files, images, audio, background jobs, stored conversations, provider headers, and model selection are not available.

## Permission and availability

Declare the permission in the installed app configuration:

```json
{
  "schemaVersion": 1,
  "id": "com.example.assistant",
  "version": "1.0.0",
  "name": "Example Assistant",
  "launchMode": "embedded",
  "url": "https://assistant.example.com",
  "fallback": "external",
  "permissions": ["ai:generate"]
}
```

On first use, LFOS explains that text leaves the encrypted SolOS environment for OpenAI processing and uses the AI allowance. The parent shell owns this prompt. Approval is stored on the device and is invalidated after an app identity, origin, catalog version, or permission-manifest change.

Check runtime support after connecting:

```ts
import {lfos} from 'https://os.linecoflow.com/sdk/v1/lfos.js';

const environment = await lfos.ready();
const canGenerate = environment.capabilities.includes('ai.responses.text');
```

`lfos.isAvailable()` only detects framing and is not an AI capability check.

## Stream a response

```ts
const stream = await lfos.ai.responses.create({
  input: [
    {role: 'developer', content: 'Answer clearly and briefly.'},
    {role: 'user', content: 'What makes an application local-first?'},
  ],
  reasoning: {effort: 'medium'},
  text: {verbosity: 'medium', format: {type: 'text'}},
  maxOutputTokens: 2048,
});

let output = '';
for await (const event of stream) {
  if (event.type === 'output_text.delta') {
    output += event.delta;
    renderAsText(output);
  }
  if (event.type === 'completed') {
    console.log(event.usage.inputTokens, event.usage.outputTokens);
  }
}
```

The app receives only sanitized deltas, final text, token usage, and stable LFOS errors. It never receives raw provider events, reasoning items, response identifiers, provider headers, or upstream error bodies.

## Request type

```ts
type LFOSAIRequest = {
  input: string | Array<{
    role: 'developer' | 'user' | 'assistant';
    content: string;
  }>;
  instructions?: string;
  reasoning?: {
    effort?: 'none' | 'low' | 'medium' | 'high';
  };
  text?: {
    verbosity?: 'low' | 'medium' | 'high';
    format?:
      | {type: 'text'}
      | {
          type: 'json_schema';
          name: string;
          strict?: boolean;
          schema: Record<string, unknown>;
        };
  };
  maxOutputTokens?: number;
};
```

Unknown fields are rejected. The default output limit is 2,048 tokens and the maximum is 16K. A request may contain up to 128 messages, 32 KiB of instructions, and a 32 KiB bounded-depth JSON schema. The serialized request body may not exceed 2 MiB. SolOS performs an exact 256K input-token preflight.

## Lifecycle and cancellation

```ts
interface LFOSAIStream extends AsyncIterable<LFOSAIEvent> {
  cancel(): void;
  completed: Promise<LFOSAICompleted>;
}
```

Call `cancel()` when the user presses Stop or the app view is destroyed. `completed` resolves with final text and usage or rejects with `LFOSError`. Conversations are app-managed: keep the history you need and resend it as message text on the next request. The AI transport and SolOS backend do not store a conversation ID or content history. An app may persist its own conversation files through the normal VFS APIs.

The SDK resets a 60-second idle deadline on incoming stream events. A silent stream is cancelled and `completed` rejects with `ai_stream_interrupted`; this is an idle timeout rather than a total-generation limit.

## Errors

Generation may fail with these stable service codes:

| Code | Meaning |
| --- | --- |
| `ai_allowance_exhausted` | The account allowance is unavailable until its displayed refresh date. |
| `ai_rate_limited` | Too many attempts were made; inspect `retryAfterSeconds` when present. |
| `ai_busy` | The account already has the allowed number of concurrent requests. |
| `ai_request_too_large` | A body, text, schema, token, message, or output limit was exceeded. |
| `ai_provider_unavailable` | The upstream service is temporarily unavailable. |
| `ai_provider_rejected` | The provider rejected the safe request. |
| `ai_stream_interrupted` | Generation may have started but the final stream event was unavailable. |

Bridge failures such as `PERMISSION_DENIED`, `NOT_SUPPORTED`, `INVALID_ARGUMENT`, and `CANCELLED` also use `LFOSError`.

## Security and privacy

Generated output is untrusted data. Render it as text unless it has been validated and escaped for a narrower context. Never directly inject output into privileged HTML, execute it, or treat it as a trusted command or URL.

The AI transport does not persist conversations, prompts, or responses. Apps control any history they save locally or through the encrypted VFS. Request text is nevertheless received transiently by the SolOS backend and processed by OpenAI. Provider-side application storage is disabled, but this alone does not guarantee zero provider retention; the first-use disclosure reflects the deployment's current OpenAI data-control status.

---

<!-- Canonical documentation: https://os-docs.linecoflow.com/docs/capabilities/app-intents -->
<!-- Source: docs/capabilities/app-intents.mdx -->
# App Intents

App Intents let an installed app publish typed actions, trigger sources, entities, and queries to LFOS-owned surfaces. ShortCut, Universal Search, and LFAssistant may discover them. Hosted apps cannot invoke another provider and cannot create, edit, approve, or enable user automations.

## Active execution guarantee

LFOS guarantees execution only while an LFOS/SolOS browser client is loaded. A hidden provider executor can continue while its workflow is active, but Safari and other browsers do not guarantee arbitrary work after every client is closed. Every active synced device evaluates its own eligible triggers.

## Built-in system app providers

Core apps publish the same typed descriptors as third-party providers. They are shell-owned and execute without a hidden iframe, but otherwise appear in the same ShortCut, Universal Search, LFAssistant, and Developer Hub catalog.

| Provider | Public actions |
| --- | --- |
| `settings` | `open-section`, `get-preferences`, `set-theme`, `set-accent-color`, `set-reduced-motion`, `set-touch-optimization`, `set-show-hidden-files` |
| `lfcloud-settings` | `open-section`, `get-sync-status`, `sync-now` |
| `finder` | `open-location`, `reveal-file`, `create-folder` |
| `code-studio` | `open-file`, `open-shortcut-workflows` |
| `developer-hub` | `open-section` |
| `shortcut` | `open`, `run-workflow` |
| `lfassistant` | `new-conversation` |

The fully qualified identifier is `<provider>.<action>`, such as `settings.set-theme` or `lfcloud-settings.sync-now`. Actions that open UI deep-link to a typed section. File and workflow arguments use LFOS entity references rather than paths or display names. Reading LFCloud status redacts the active vault identifier from logs, and syncing still requires an authenticated online installation.

For example:

```yaml
actions:
  - action: settings.set-theme
    with:
      theme: dark
  - action: lfcloud-settings.sync-now
```

System app actions remain OS privileges. Hosted apps can describe their own intents through the provider SDK, but receive no cross-app invocation API.

## Manifest

```json
{
  "schemaVersion": 1,
  "id": "com.example.tasks",
  "name": "Tasks",
  "url": "https://tasks.example/app",
  "embedPolicy": "embed",
  "permissions": ["intents:provide", "intents:subscribe"],
  "intents": {
    "schemaVersion": 1,
    "entry": "https://tasks.example/lfos-intents.html",
    "actions": [{
      "id": "tasks.find",
      "version": 1,
      "title": "Find Tasks",
      "parameterSummary": "Find {status} tasks",
      "input": {"type": "object", "properties": {
        "status": {"type": "enum", "required": true, "choices": [
          {"value": "open", "title": "Open"},
          {"value": "done", "title": "Completed"}
        ]}
      }},
      "output": {"type": "object", "properties": {"count": {"type": "integer"}}},
      "executionMode": "background",
      "sideEffect": "read"
    }],
    "triggers": [{
      "id": "task.changed", "version": 1, "title": "Task Changed",
      "configuration": {"type": "object", "properties": {}},
      "output": {"type": "object", "properties": {"taskId": {"type": "text"}}},
      "delivery": "emit"
    }],
    "entities": [{
      "id": "task", "version": 1, "title": "Task", "syncable": true,
      "ownership": "private", "properties": {"status": {"type": "text"}},
      "query": ["resolve", "search", "suggest"]
    }]
  }
}
```

Descriptors may include BCP-47 `localizations`, deprecation metadata, and `replacementId`. Standard LFOS domain identifiers communicate semantic equivalence; custom actions remain valid without one.

## Executor

The executor page loads SDK v1 and registers only handlers declared by the manifest:

```js
import {lfos} from '/sdk/v1/lfos.js';

lfos.intents.registerProvider({
  actions: {
    'tasks.find': async ({input, signal, reportProgress}) => {
      const tasks = await database.find(input.status, {signal});
      reportProgress({fraction: 1, message: 'Tasks loaded'});
      return {value: {count: tasks.length, tasks}, summary: `Found ${tasks.length} tasks.`};
    },
  },
  entities: {
    task: async ({operation, ids, search, cursor, limit, signal}) =>
      database.queryEntities({operation, ids, search, cursor, limit, signal}),
  },
});
```

A visible app may emit a declared event trigger with `lfos.intents.emitTrigger('task.changed', {taskId})`. Subscription handlers receive configuration, `emit`, context, and an `AbortSignal`.

LFOS validates the exact source window, origin, app identity, handler ID, protocol version, and typed input. Executors are pooled for 60 seconds, get 15 seconds to register, and normally get 30 seconds per action. Declared long-running work may use five minutes with progress and cancellation. Hidden handlers cannot draw UI; return `user-action-required` when interaction is needed.

## Types and risk

Schemas support text, rich text, number, integer, Boolean, date/time, duration, URL, enum, list, object, opaque file references, and entity references. Fields may declare defaults, validation bounds, choices, sensitivity, and redaction.

Use stable cross-device entity IDs. Missing resolved IDs must produce `not-found`. Never return credentials; keep authentication in your origin and expose opaque entity or secret references only.

Risk declarations are advisory. LFOS computes a minimum risk from side effects, permissions, entity ownership, and sensitive data flow. Interrupted non-idempotent actions fail explicitly and are not silently replayed.

The LFOS source tree includes a runnable provider at `/examples/task-intents/`, with a visible task app, hidden executor, installable `.app` example, action, entity query, and event trigger.

---

<!-- Canonical documentation: https://os-docs.linecoflow.com/docs/reference/manifest -->
<!-- Source: docs/reference/manifest.mdx -->
# App configuration reference

An installed hosted app is represented by an editable `.app` JSON file in LFOS `/Applications`. This is the local runtime configuration. Website publishers may separately offer the canonical `/.well-known/lfos-app.json` contract for discovery through Store; see [Website app manifest](https://os-docs.linecoflow.com/ai/docs/reference/website-app-manifest.md). Store catalog entries use a third, separate format.

## Complete example

```json title="Example.app"
{
  "schemaVersion": 1,
  "name": "Example",
  "url": "https://app.example.com",
  "icon": "https://app.example.com/icon.png",
  "displayMode": "standalone",
  "embedPolicy": "embed",
  "defaultZoom": 100,
  "rememberWindowBounds": true,
  "windowChrome": {
    "mode": "overlay",
    "background": "surface"
  },
  "id": "com.example.app",
  "version": "1.0.0",
  "permissions": ["files:open", "files:save", "ai:generate", "intents:provide"],
  "intents": {
    "schemaVersion": 1,
    "entry": "https://app.example.com/lfos-intents.html",
    "actions": [],
    "triggers": [],
    "entities": []
  },
  "fileAssociations": [
    {
      "extensions": [".md"],
      "mimeTypes": ["text/markdown"],
      "default": false
    }
  ]
}
```

## Fields

| Field | Required | Runtime behavior |
| --- | --- | --- |
| `schemaVersion` | Yes | Must be `1`. |
| `id` | For App Intents | Stable app identifier used to namespace capabilities. |
| `version` | No | App contract version shown by developer surfaces. |
| `name` | Yes | User-visible application name. |
| `url` | Yes | Hosted entry URL. Use HTTPS for installed production apps. |
| `icon` | No | Icon URL or supported icon value stored with the app. |
| `displayMode` | No | `browser`, `minimal-ui`, `standalone`, or `fullscreen`; defaults to `browser`. |
| `embedPolicy` | No | `auto`, `embed`, or `external`; defaults to `auto`. |
| `defaultZoom` | No | Initial zoom from 50 through 200 percent. |
| `rememberWindowBounds` | No | Restores the last window position and size when `true`. |
| `windowChrome` | No | Overlay or system-titlebar appearance. |
| `permissions` | No | Recognized LFOS SDK permissions. Unknown values are discarded. |
| `fileAssociations` | No | Extensions and MIME types the app can open. Requires `files:open`. |
| `intents` | No | Versioned actions, triggers, entities, and hidden same-origin executor entry. Requires `intents:provide`. |

## Why some fields use arrays and others use objects

JSON brackets express cardinality, not a different configuration system:

- `windowChrome` is an object (`{}`) because an app has one window-chrome configuration with named properties such as `mode` and `background`.
- `permissions` is an array (`[]`) because an app can request several independent permission identifiers.
- `fileAssociations` is an array (`[]`) because an app can declare several association groups—for example one filter for documents and another for images. Each item is an object containing related extension and MIME-type arrays.

Use one `fileAssociations` item when all supported extensions and MIME types have the same default behavior. Split them only when groups need different `default` values or clearer maintenance boundaries.

Capability identifiers are exposed as `<app-id>.<local-id>`. `intents.entry` must be same-origin HTTPS, except localhost HTTP during development. Apps using `embedPolicy: external`, cross-origin entries, invalid descriptors, or undeclared intent permissions cannot publish capabilities.

The installed `.app` format and the website-hosted manifest have different purposes. Do not use `manifestVersion` or a top-level `entry` alias: local configurations and the website contract use `schemaVersion`, and website manifests place runtime fields inside `install`.

## Display modes

- `browser`: shows LFOS web history controls.
- `minimal-ui`: keeps a reduced browser presentation.
- `standalone`: hides LFOS history controls.
- `fullscreen`: uses the standalone web-app presentation; actual user-controlled window fullscreen remains separate.

## Embedding policy

- `auto`: attempt embedding and offer an external fallback if loading fails.
- `embed`: attempt embedding.
- `external`: do not embed; open through the external/browser path. LFOS SDK APIs are unavailable.

Remote sites can still refuse `auto` or `embed` using CSP or `X-Frame-Options`.

## Window chrome

```ts
type WindowChromeConfiguration = {
  mode: 'overlay' | 'titlebar';
  background?: 'surface' | 'sidebar';
};
```

`background` affects titlebar presentation and defaults to `surface`. Missing
window-chrome configuration uses a system title bar. `overlay` requests a shared
header; the app must prepare its layout and explicitly activate integration
through the SDK. See [Shared window headers](https://os-docs.linecoflow.com/ai/docs/reference/window-chrome.md).

## Store catalog installation

Store entries place runtime fields inside `install`. Catalog `id` and `version` control Store identity and updates:

```json
{
  "id": "example-app",
  "version": 2,
  "kind": "app",
  "install": {
    "url": "https://app.example.com",
    "displayMode": "standalone",
    "embedPolicy": "embed",
    "defaultZoom": 100,
    "rememberWindowBounds": true,
    "permissions": ["files:open", "files:save", "ai:generate"],
    "fileAssociations": [
      {"extensions": [".md"], "mimeTypes": ["text/markdown"]}
    ]
  }
}
```

This abbreviated block is not a complete catalog entry; publisher, review, descriptive, and status fields are also required by the Store catalog format. Store review metadata belongs only to the catalog and must never be copied into a website-hosted manifest.

---

<!-- Canonical documentation: https://os-docs.linecoflow.com/docs/reference/permissions -->
<!-- Source: docs/reference/permissions.mdx -->
# Permissions

LFOS web apps are untrusted by default. Privileged APIs are enabled only when the installed `.app` configuration declares the corresponding permission.

## Available permissions

| Permission | Enables | User mediation |
| --- | --- | --- |
| `files:open` | `files.open` and `files.read` | Every new handle begins with an LFOS open dialog. The handle is readable. |
| `files:save` | `files.save` and `files.write` | Allows Save As through an LFOS dialog and in-place writes to a user-opened handle. |
| `ai:generate` | `ai.responses.create` | First use shows an LFOS-owned cloud-processing disclosure and asks for approval. |
| `notifications:post` | `notifications.post`, update, removal, settings, and badge methods | First use asks for notification approval; the user can allow, mute, or deny delivery. |
| `intents:provide` | Register declared action and entity-query handlers in a hidden executor. | ShortCut and Assistant apply their own capability review. |
| `intents:subscribe` | Keep declared trigger subscriptions alive while an enabled workflow needs them. | Enabling the workflow reviews the subscription and its downstream actions. |

These are the only implemented web-app permissions. Intent permissions do not grant files, AI, credentials, or another app's permissions. Generic network automation, identity, clipboard, window control, and inter-app invocation are not available through the public SDK.

## Declare permissions

```json
{
  "schemaVersion": 1,
  "name": "Example",
  "url": "https://app.example.com",
  "permissions": ["files:open", "files:save", "ai:generate"]
}
```

Website manifests and Store catalog entries are strictly validated; unknown permission strings are rejected during discovery or installation. In manual `.app` files, declare only capabilities the app needs. Changing a remote page does not grant permissions.

Manifest permissions use colon-separated names such as `files:open`. Runtime capability and method names use dots, such as `files.open`. They are related but deliberately not interchangeable: the permission authorizes LFOS to expose the corresponding SDK capability.

`files:open` and `files:save` are independent. A viewer can declare only `files:open`. An editor should declare both: the handle returned by Open or Open With remains readable and may also be passed to `files.write` for in-place Save. Without `files:save`, LFOS rejects that write. Use `files.save` when the user chooses Save As or when the document has no existing LFOS location.

## Permission management model

**Settings → Apps** lists installed web apps and their source, origin, version, and declared capabilities. **Settings → Privacy** provides per-app controls for `files:open`, `files:save`, `ai:generate`, `intents:provide`, and `intents:subscribe`. A local choice may subtract from the publisher's declaration but cannot grant undeclared access. Store and website installation flows let users select which requested capabilities to enable; newly requested capabilities during a website update start disabled unless the user opts in.

Keep three different concepts distinct:

- **Declared access** comes from the installed `.app` configuration and its source manifest. Updating a publisher declaration changes the maximum access available to that app.
- **Effective access** is the intersection of declared access and the device-local permission policy. Disabling a capability removes it from the running app's bridge and denies requests; changing the policy takes effect immediately.
- **Per-operation choices and durable consent** are additional LFOS safeguards. File open/save remain mediated by LFOS-owned pickers and scoped handles. AI generation still requires first-use data-transfer consent even when `ai:generate` is enabled. Notification delivery continues to use its LFOS-owned approval controls.

Revoking `ai:generate` also revokes that installed app's saved AI approval; enabling it again requires fresh consent on next use. Intent providers and subscriptions are deactivated when their corresponding effective permissions are disabled. Removing an app moves it to Trash and removes it from the Dock without making Trash recovery equivalent to continued access.

## Enforcement

- Every bridge request must come from the exact window and origin associated with the installed app URL.
- A nested third-party iframe cannot use its parent app's bridge.
- Navigation to another origin loses access even when the destination remains framed.
- The app receives opaque handles, never LFOS VFS URIs or native paths.
- Open handles are readable. They allow in-place writes only when the same installed app also declares `files:save`; save-dialog handles are write-only.
- Handles are cleared when the app window or bridge lifecycle ends.
- The selector prevents opening hidden or sync-suppressed LFOS namespace entries.
- AI consent is owned by the parent shell and cannot be forged or suppressed by the app.
- AI grants are device-local and invalidated after an app identity, origin, catalog version, or permission-manifest change.

## Safety boundaries

File and save-location choice is explicitly user-mediated each time a new handle is created. AI generation additionally requires first-use consent. Settings permission controls cannot turn off these LFOS-owned mediation steps or create a grant for a capability the app did not declare.

---

<!-- Canonical documentation: https://os-docs.linecoflow.com/docs/reference/sdk -->
<!-- Source: docs/reference/sdk.mdx -->

> Complete reference for the LFOS web SDK version 1.

# SDK v1 reference

The ES module is served by every compatible LFOS deployment:

```ts
import {lfos, LFOSError} from 'https://os.linecoflow.com/sdk/v1/lfos.js';
```

Type declarations are available at `/sdk/v1/lfos.d.ts`. The module also assigns `window.lfos` when that property is not already defined.

## Connection

### `lfos.isAvailable()`

Returns `true` when the page has a parent frame. This is only a quick framing check and can be true in a non-LFOS iframe. Use `ready()` for authoritative detection.

### `await lfos.ready()`

Connects to the parent LFOS bridge and caches the result:

```ts
type EnvironmentInfo = {
  name: 'LFOS';
  protocolVersion: 1;
  capabilities: string[];
};
```

The request times out after 15 seconds with `NOT_SUPPORTED`. Repeated successful calls return the cached environment information.

### `lfos.capabilities.has(name)`

Checks the capabilities returned by `ready()`. It returns `false` before a successful `ready()` call.

Current capability names:

- `appearance.get`
- `appearance.subscribe`
- `lifecycle.setUnsavedChanges`
- `lifecycle.getActivity`
- `lifecycle.subscribeActivity`
- `files.open`
- `files.read`
- `files.save`
- `files.write`
- `activation.getInitial` when this window was launched for a file
- `ai.responses.text` when `ai:generate` is declared and the SolOS installation is connected with an active vault
- `intents.registerProvider` when a validated `intents` block and `intents:provide` are declared
- `intents.emitTrigger` for visible windows publishing a declared event trigger

`files.open` and `files.read` appear together when `files:open` is declared. `files.save` and `files.write` appear together when `files:save` is declared.

`ai.responses.text` is SolOS-only and may be absent even when the manifest declares `ai:generate`. Apps must check the advertised capability before enabling generation UI.

## Appearance

### `await lfos.appearance.get()`

Returns the shell-resolved `colorScheme`, active `accent` plus its light and
dark variants, `reducedMotion`, and `touchOptimized`. The SDK also applies these
values to the document root as `data-lfos-*` attributes and `--lfos-*` custom
properties.

### `lfos.appearance.subscribe(listener)`

Calls the listener for the current appearance and every live system change.
It returns an unsubscribe function. Apps should unsubscribe during view
teardown. The public UI module subscribes automatically.

```ts
const stop = lfos.appearance.subscribe((appearance) => {
  chart.setAnimationEnabled(!appearance.reducedMotion);
});
```

See [Navigation split view](https://os-docs.linecoflow.com/ai/docs/reference/navigation-split-view.md) for the standard app
layout and semantic token contract.

## Window lifecycle

### `await lfos.lifecycle.setUnsavedChanges(dirty)`

Reports whether closing the app window could discard edits or interrupt a save that has not reached durable storage. While `dirty` is `true`, LFOS asks the user to keep editing or explicitly discard the pending work before it closes the window. Set it to `false` only after the durable write succeeds. The state belongs to the current app window and is cleared when that window closes. No manifest permission is required.

Editors whose serialization is asynchronous should set this state before starting conversion, keep it set through `lfos.files.write`, and clear it only after that promise resolves:

```ts
await lfos.lifecycle.setUnsavedChanges(true);
try {
  const bytes = await serializeDocument();
  await lfos.files.write(handle, bytes);
  await lfos.lifecycle.setUnsavedChanges(false);
} catch (error) {
  // Keep the window protected so the user can retry the save.
  throw error;
}
```

## Activation

### `await lfos.activation.getInitial()`

Returns `{type: 'open-file', file: LFFileHandle}` when LFOS launched this app through a declared file association. Returns `null` for an ordinary launch. The handle is readable through `lfos.files.read` and requires `files:open`.

See [File associations](https://os-docs.linecoflow.com/ai/docs/capabilities/file-associations.md) for declaration and matching rules.

## Files

### `await lfos.files.open(options?)`

Shows the LFOS virtual-drive open dialog. Returns `Promise<LFFileHandle | null>`. Requires `files:open`.

### `await lfos.files.read(handle)`

Reads an open handle. Returns `Promise<ArrayBuffer>`. Requires `files:open`.

### `await lfos.files.save(options?)`

Shows the LFOS virtual-drive save dialog. Returns `Promise<LFFileHandle | null>`. Requires `files:save`.

### `await lfos.files.write(handle, data)`

Writes a string, `ArrayBuffer`, or typed-array view to a save handle, or back to an open/activation handle belonging to the same app window. Returns the updated `LFFileHandle`. Requires `files:save`; an open handle additionally requires the app's `files:open` declaration. Maximum 50 MB per call.

When an `ArrayBuffer` or typed array is supplied, the SDK transfers its copied or original buffer to LFOS. Do not rely on the transferred input buffer remaining usable afterward.

### `await lfos.files.release(handle)`

Expires the handle and returns `null`. Releasing an already invalid handle is currently harmless because only its identifier is removed.

## AI responses

### `await lfos.ai.responses.create(request)`

Creates a text-only response and returns `Promise<LFOSAIStream>`. Requires `ai:generate` and the `ai.responses.text` capability. The stream is an `AsyncIterable<LFOSAIEvent>`, exposes a `completed` promise, and has `cancel()` for user cancellation and view teardown.

See [AI text generation](https://os-docs.linecoflow.com/ai/docs/capabilities/ai.md) for request types, streaming examples, limits, errors, and security requirements.

## App Intents

### `lfos.intents.registerProvider(provider)`

Registers action, trigger-subscription, and entity-query handlers in the hidden provider executor. The registration returns a cleanup function. Handler IDs must exactly match the installed manifest; LFOS rejects undeclared IDs.

Action handlers receive validated `input`, execution `context`, an `AbortSignal`, and `reportProgress`. Entity handlers receive `resolve`, `search`, or `suggest`, pagination data, and cancellation. See [App Intents](https://os-docs.linecoflow.com/ai/docs/capabilities/app-intents.md).

### `lfos.intents.emitTrigger(triggerId, payload?)`

Emits one declared event trigger from a visible app window. LFOS verifies the source window, origin, provider identity, and descriptor before delivering it to enabled, approved ShortCut workflows.

## Errors

```ts
try {
  await lfos.files.open();
} catch (error) {
  if (error instanceof LFOSError) {
    console.error(error.code, error.message);
  }
}
```

See [Files](https://os-docs.linecoflow.com/ai/docs/capabilities/files.md#errors) for stable error codes.

## Bridge security

SDK requests use protocol version 1 and unique request IDs. The SDK sends to its parent frame because a hosted app cannot know the LFOS origin in every deployment. The LFOS host—not the child SDK—enforces the security boundary by accepting requests only from the exact iframe window and installed app origin, then replies only to that origin.

Applications should never send bridge messages directly unless implementing an SDK port. Pin the versioned module instead.

## Runnable example

LFOS serves a complete open/read/save/write example at `/examples/file-access/index.html`. Its installed `.app` configuration must declare both file permissions before the buttons can use the LFOS virtual drive.

## Window chrome

`lfos.windowChrome.get()`, `subscribe(listener)`, `setIntegrated(boolean)`, and
`bindDragRegion(element)` support a single app-owned header with shell-owned
window controls. See [Shared window headers](https://os-docs.linecoflow.com/ai/docs/reference/window-chrome.md) for geometry,
layout requirements, and a working example.

## Window activity

`await lfos.lifecycle.getActivity()` returns `{visible, focused}`. Visibility is
false for minimized windows or hidden host tabs. Focus is true only for the active,
visible LFOS window.

`lfos.lifecycle.onActivityChange(listener)` subscribes through the canonical
`lifecycle.subscribeActivity` method and returns a disposer. Pause optional
indexing and prewarming while hidden. Continue necessary saves and keep unsaved
state set until their durable acknowledgements arrive. Activity is a scheduling
hint, not a permission grant.

The SDK belongs on the app's window thread. Use your own workers for parsing,
conversion, serialization, and search; send their results to the window before
calling LFOS methods. See [Background work](../capabilities/background-work).

---

<!-- Canonical documentation: https://os-docs.linecoflow.com/docs/reference/shortcut-yaml -->
<!-- Source: docs/reference/shortcut-yaml.mdx -->
# ShortCut YAML v1

ShortCut owns user automations. Developers publish capabilities; they cannot write ShortCut storage or install, approve, or enable a workflow.

Canonical workflow files live at `/System/ApplicationData/ShortCut/Workflows/<workflow-id>.shortcut.yaml` and sync through the ordinary encrypted SolOS path.

```yaml
schema: lfos.shortcut/v1
id: 17a6c8d8-860b-4ee8-a79b-c4f78ac45dc8
name: Morning review
enabled: true
mode: single

inputs: {}
triggers:
  - id: manual
    trigger: lfos.manual
  - id: weekday
    trigger: lfos.schedule
    with:
      weekdays: [mon, tue, wed, thu, fri]
      at: "09:00"
      timezone: system
      catchUp: PT15M

conditions:
  - condition: equals
    left: {ref: context.device.name}
    right: Studio Mac

actions:
  - id: find_tasks
    action: com.example.tasks.tasks.find
    with: {status: open}
  - action: lfos.notification.show
    with:
      title: Morning review
      message:
        template: "{count} tasks found on {device}"
        values:
          count: {ref: steps.find_tasks.output.count}
          device: {ref: context.device.name}
```

References are restricted to `input`, `trigger`, `context`, `variables`, `steps.<id>.output`, and bounded repeat context. Templates only replace named values. JavaScript, Jinja, shell, custom YAML tags, and evaluation are forbidden.

Actions include typed provider calls, variables, delays, prompts, confirmations, `if`/`then`/`else`, `choose`, bounded `repeat`, bounded `parallel`, nested workflows, and stop. Modes are `single`, `restart`, `queued`, and `parallel`; queue and parallel limits are capped at 10. Nesting is capped at 16, loops at 1,000 iterations, and a run at 10,000 expanded steps.

Completed steps produce durable checkpoints. Delays and prompts record a waiting checkpoint. An action interrupted mid-call becomes an explicit failure unless the declared operation is safe to retry. Destructive operations always reconfirm.

Enabling compiles the complete action graph and stores a synced approval digest. Changes to actions, parameters, schemas, execution modes, risk, permissions, or nested graphs invalidate approval. Titles and localization do not.

---

<!-- Canonical documentation: https://os-docs.linecoflow.com/docs/reference/navigation-split-view -->
<!-- Source: docs/reference/navigation-split-view.mdx -->

> Build an LFOS-native two- or three-column application layout.

# Navigation split view

The version 1 UI kit supplies a complete, container-responsive application
layout. Declare one detail region, an optional leading sidebar, and an optional
trailing sidebar. LFOS owns resizing, persistence, compact overlays, sidebar
controls, focus handling, RTL, reduced motion, and touch-sized targets.

Import both versioned assets:

```html
<link rel="stylesheet" href="https://os.linecoflow.com/sdk/v1/ui.css">
<script type="module" src="https://os.linecoflow.com/sdk/v1/ui.js"></script>
```

Type declarations are at `/sdk/v1/ui.d.ts`. The elements use light DOM, so an
app may extend their visuals through the documented `--lfos-*` semantic tokens
without replacing layout behavior.

## Two-column application

```html
<lfos-navigation-split-view storage-key="notes-main">
  <lfos-sidebar
    side="leading"
    aria-label="Notes"
    resizable
    default-width="260"
    min-width="200"
    max-width="380"
  >
    <lfos-navigation-header><strong>Notes</strong></lfos-navigation-header>
    <lfos-sidebar-item value="today" selected>Today</lfos-sidebar-item>
    <lfos-sidebar-item value="archive">Archive</lfos-sidebar-item>
  </lfos-sidebar>

  <lfos-detail>
    <lfos-navigation-header><h1>Today</h1></lfos-navigation-header>
    <main>Your content</main>
  </lfos-detail>
</lfos-navigation-split-view>

<script type="module">
  document.querySelector('lfos-navigation-split-view')
    .addEventListener('lfos-selection-change', ({detail}) => {
      console.log('Selected', detail.value);
    });
</script>
```

The detail header automatically receives a leading-sidebar button in compact
containers. If the detail has no declared header, LFOS creates a minimal compact
control header. No media query, overlay state, or menu button is required.

## Three-column Finder-style application

```html
<lfos-navigation-split-view storage-key="file-browser">
  <lfos-sidebar side="leading" aria-label="Locations" resizable
    default-width="220" min-width="180" max-width="360">
    <lfos-navigation-header><strong>Locations</strong></lfos-navigation-header>
    <lfos-sidebar-item selected>Documents</lfos-sidebar-item>
    <lfos-sidebar-item>Downloads</lfos-sidebar-item>
  </lfos-sidebar>

  <lfos-detail>
    <lfos-navigation-header>
      <strong>Documents</strong>
      <button type="button">New folder</button>
    </lfos-navigation-header>
    <main>Files</main>
  </lfos-detail>

  <lfos-sidebar side="trailing" aria-label="File information" resizable
    default-width="280" min-width="220" max-width="420">
    <lfos-navigation-header><strong>Information</strong></lfos-navigation-header>
    <dl><dt>Kind</dt><dd>Folder</dd></dl>
  </lfos-sidebar>
</lfos-navigation-split-view>
```

At compact widths both sidebars become overlays. Opening one closes the other;
the generated controls update `aria-expanded`, move focus into the opened
sidebar, and restore focus when the scrim or Escape closes it.

## React adapters

Render the public elements rather than copying their CSS or behavior:

```tsx
import type {PropsWithChildren} from 'react';
import 'https://os.linecoflow.com/sdk/v1/ui.js';
import 'https://os.linecoflow.com/sdk/v1/ui.css';

export function NavigationSplitView(
  {storageKey, children}: PropsWithChildren<{storageKey: string}>,
) {
  return <lfos-navigation-split-view storage-key={storageKey}>{children}</lfos-navigation-split-view>;
}

export function NavigationHeader({
  colored = false,
  children,
}: PropsWithChildren<{colored?: boolean}>) {
  return (
    <lfos-navigation-header colored={colored || undefined}>
      {children}
    </lfos-navigation-header>
  );
}

export function Sidebar({
  side,
  label,
  resizable = false,
  children,
}: PropsWithChildren<{
  side: 'leading' | 'trailing';
  label: string;
  resizable?: boolean;
}>) {
  return (
    <lfos-sidebar side={side} aria-label={label} resizable={resizable || undefined}>
      {children}
    </lfos-sidebar>
  );
}

export function SidebarItem({value, children}: PropsWithChildren<{value: string}>) {
  return <lfos-sidebar-item value={value}>{children}</lfos-sidebar-item>;
}

export function Detail({children}: PropsWithChildren) {
  return <lfos-detail>{children}</lfos-detail>;
}
```

Include `ui.d.ts` in a TypeScript JSX project's types. Built-in LFOS React apps
use equivalent typed primitives backed by the same behavior and token contract.

## API reference

| Element | Declaration | Behavior |
| --- | --- | --- |
| `lfos-navigation-split-view` | `storage-key`, `compact-breakpoint` | Hosts the regions, observes its own width, and persists each sidebar independently. The default compact breakpoint is 680 px. |
| `lfos-sidebar` | `side="leading\|trailing"`, `resizable`, `default-width`, `min-width`, `max-width`, `aria-label` | Declares either sidebar. It is fixed unless `resizable` is present. Defaults are 280 px leading, 320 px trailing, 160 px minimum, and 420 px maximum. |
| `lfos-navigation-header` | Child of a sidebar or detail; optional `colored` | Sticky region header for a title and arbitrary actions. `colored` applies the current semantic LFOS accent, and detail headers receive automatic compact controls. |
| `lfos-detail` | No layout attributes | Declares the one flexible, independently scrolling detail region. |
| `lfos-sidebar-item` | `value`, `selected`, `disabled` | Supplies keyboard activation, selection state, and `lfos-selection-change`. |

`LFOSNavigationSplitView` exposes `openSidebar(side)`, `closeSidebar()`, and
`toggleSidebar(side)`. Each returns whether state changed. A successful change
dispatches `lfos-sidebar-open-change` with `{side, open}`. The read-only
`compact` and `openSide` properties expose current layout state.

Width properties are also available from JavaScript as `defaultWidth`,
`minWidth`, and `maxWidth`. `side`, `resizable`, `storageKey`, and
`compactBreakpoint` reflect their corresponding attributes.

## Resizing, persistence, and accessibility

Pointer dragging and Left/Right Arrow keys resize a focused divider. Home and
End select the declared minimum and maximum. Widths are clamped before use and
stored separately for the leading and trailing sides under the split view's
`storage-key`. Direction and side are both considered, so pointer and keyboard
movement remain spatially correct in RTL.

Keep regions in leading, detail, trailing DOM order; provide an `aria-label` for
each sidebar; preserve generated separator and toggle semantics; and mark the
current destination with `selected`. Compact sidebars close through their
control, the scrim, or Escape. LFOS allows only one overlay to remain open.

The UI module calls `lfos.appearance.get()` and applies these semantic values:

- `--lfos-accent`, `--lfos-accent-light`, `--lfos-accent-dark`
- `--lfos-background`, `--lfos-sidebar-background`, `--lfos-surface`
- `--lfos-text`, `--lfos-secondary-text`, `--lfos-separator`

Use semantic tokens instead of hard-coded theme colors. Touch optimization
increases navigation targets to 48 pixels, and reduced motion disables the
sidebar transition.

---

<!-- Canonical documentation: https://os-docs.linecoflow.com/docs/reference/window-chrome -->
<!-- Source: docs/reference/window-chrome.mdx -->
LFOS owns window controls and window movement. Your app owns its document title,
actions, and toolbar. Cooperating apps can combine these into one row; unmodified
websites keep a safe system title bar.

## Request integration

Add this to your `.app` manifest:

```json
{ "windowChrome": { "mode": "overlay", "background": "surface" } }
```

`overlay` requests integration. LFOS keeps a system title bar until your app's
layout is ready and calls `lfos.windowChrome.setIntegrated(true)`. Missing or
invalid configuration defaults to `titlebar`; an explicit `titlebar` disables
integration. No additional permission is required.

## Use the header component

Load the versioned SDK UI CSS and module from your LFOS host. Keep a single
`lfos-window-header` at the top of the app. It reserves space for system controls,
binds dragging on empty areas, and enables integration only while its content
fits. Keep your own title and actions inside it:

```html
<link rel="stylesheet" href="https://os.linecoflow.com/sdk/v1/ui.css" />
<script type="module" src="https://os.linecoflow.com/sdk/v1/ui.js"></script>
<lfos-window-header>
  <button id="save">Save</button>
  <strong style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis">Notes</strong>
  <button data-window-drag="false">Search</button>
</lfos-window-header>
<main>Your app content</main>
```

Bind the buttons to your app's existing actions. The shell renders the close,
minimize, maximize, and app-menu controls. Do not render your own window controls.

## Adapt an existing toolbar

```ts
interface LFOSWindowChromeGeometry {
  mode: 'overlay' | 'titlebar'; // effective presentation
  canIntegrate: boolean;      // manifest requests overlay
  headerHeight: number;
  leadingInset: number;
  trailingInset: number;
}
```

`lfos.windowChrome.get()` returns this geometry. `subscribe(listener)` immediately
provides the latest known geometry, then reports changes, and returns an
unsubscribe function. Values use your app iframe's CSS pixels, adjusted for app
zoom. Do not hardcode the shell's physical dimensions.

The SDK also sets `--lfos-window-chrome-height`, `--lfos-window-chrome-leading`,
and `--lfos-window-chrome-trailing` on the app document. Use these to size your
header and reserve leading/trailing space. Preserve enough room for your actions,
title, and an empty drag area before enabling integration.

```js
import { lfos } from 'https://os.linecoflow.com/sdk/v1/lfos.js';

await lfos.ready();
const header = document.querySelector('#app-header');
header.style.boxSizing = 'border-box';
const unbind = lfos.windowChrome.bindDragRegion(header);
let current;
let pending = false;

const update = async () => {
  if (!current?.canIntegrate || pending) return;
  header.style.minHeight = `${current.headerHeight}px`;
  header.style.paddingLeft = `${current.leadingInset}px`;
  header.style.paddingRight = `${current.trailingInset}px`;
  const fits = header.clientWidth >= current.leadingInset + current.trailingInset + 200
    && header.scrollWidth <= header.clientWidth;
  if (fits === (current.mode === 'overlay')) return;
  pending = true;
  try { await lfos.windowChrome.setIntegrated(fits); }
  finally { pending = false; }
};
const unsubscribe = lfos.windowChrome.subscribe(geometry => {
  current = geometry;
  void update();
});
const observer = new ResizeObserver(() => void update());
observer.observe(header);

// When removing/replacing this toolbar:
function dispose() {
  observer.disconnect();
  unsubscribe();
  unbind();
  void lfos.windowChrome.setIntegrated(false);
}
```

The drag region must occupy the top of the app. Buttons, links, labels, inputs,
editable content, tabs, menu items, sliders, and descendants marked
`data-window-drag="false"` are excluded. The binding captures the pointer and ends
the drag on release, cancellation, lost capture, blur, or cleanup.

For a same-origin nested editor, the outer app can bind the nested header element
and copy geometry into that document. Its header must align with the outer app's
top edge. Communicate with LFOS through the outer app's SDK; direct requests from
nested frames are rejected.

## Lifecycle and fallback

Navigation, reload, errors, and page exit clear integration. Reinstall your
adapter before reactivating it. Call `setIntegrated(false)` whenever the toolbar
is removed or no longer fits. Standalone apps and hosts without the capability
retain their normal app UI. Do not depend on integration for essential actions.

The canonical wire methods are `windowChrome.get`, `windowChrome.setIntegrated`,
and `windowChrome.drag`, carried by the version-1 `lfos:request` envelope.
`lfos:window-chrome-changed` carries geometry updates. Apps should use the SDK
instead of constructing messages.

---

<!-- Canonical documentation: https://os-docs.linecoflow.com/docs/reference/application-data -->
<!-- Source: docs/reference/application-data.mdx -->

> The file-system location and ownership rules for durable LFOS application state.

# Application data

LFOS is file-based. Durable state owned by a system application belongs under:

```text
/System/ApplicationData/<app-name>/
```

Examples include conversation histories, indexes, saved sessions, application
preferences, and caches that must survive a restart. LFAssistant stores its
conversation files under `/System/ApplicationData/LFAssistant`.

User-authored documents and explicit exports do not belong in application
data. Save those in a user-selected location such as Documents so they remain
easy to find, move, and open with another app.

## Ownership

- `/System/ApplicationData` is created and managed by LFOS.
- A system app may create and manage files only inside its assigned child
  directory.
- Apps must treat sibling application directories as out of scope.
- Use a stable directory name for the lifetime of the app.
- Store versioned, parseable formats and handle malformed or newer files
  without crashing the app.
- Generated or externally sourced content remains untrusted after it is saved.

Application-data files use the normal LFOS file lifecycle. Writable files are
included in local backups and, in SolOS, follow the encrypted synchronization
path used by other writable LFOS files.

## Hosted web apps

Hosted web apps remain sandboxed and do not receive unrestricted virtual-file
system paths. The `/System/ApplicationData` convention currently describes
system-owned apps. A future scoped app-storage SDK may map a hosted app to its
own directory without revealing arbitrary LFOS paths. Until that API ships,
hosted apps must use the documented user-mediated file APIs or their ordinary
browser-origin storage.

## No implicit legacy migration

Changing an app's storage convention does not require LFOS to scan, move, or
delete files from an older location. If a product needs migration, it must be
an explicit, versioned application behavior with clear conflict and recovery
rules—not an automatic platform assumption.

---

<!-- Canonical documentation: https://os-docs.linecoflow.com/docs/reference/implementation-status -->
<!-- Source: docs/reference/implementation-status.mdx -->
# Implementation status

This page separates available behavior from planned platform work. Website-manifest discovery and app permission management require a recent LFOS Store and shell build.

| Area | Status | Notes |
| --- | --- | --- |
| Hosted HTTPS apps | Available | Sandboxed iframe windows, origin policy, window lifecycle, navigation controls, and external fallback exist. |
| Installed `.app` configuration | Available | Schema version 1, embedding, display, zoom, chrome, bounds, SDK permissions, source provenance, and local permission policy are supported. |
| Standard `<input type="file">` | Available | Opens the browser/device selector, not the LFOS virtual drive. |
| `files.open` / `files.read` | Available | User-mediated VFS selection, origin-checked bridge, and read handles. |
| `files.save` / `files.write` | Available | Save As destination dialog, permission-checked in-place writes to opened files, and 50 MB per-write limit. |
| `files.release` | Available | Explicitly expires an app-window file handle. |
| File associations | Available | Built-in and web apps share extension/MIME resolution, Open with menus, defaults, and activation handles. |
| AI text responses | Available in SolOS | Permissioned streaming text and structured-text output through a backend-controlled model and allowance. |
| System application data | Available for system apps | Durable app-owned files live under `/System/ApplicationData/<app-name>`; public hosted apps do not yet receive unrestricted path access. |
| SDK v1 ES module and declarations | Available | Served at `/sdk/v1/lfos.js` and `/sdk/v1/lfos.d.ts`. |
| Appearance API | Available | Live color scheme, accent, reduced-motion, and touch-optimization values through `get()` and `subscribe()`. |
| Shared window headers | Available | Opt-in app-owned headers, zoom-adjusted system control insets, pointer drag binding, and automatic title-bar fallback are available through the SDK and `lfos-window-header`. |
| Navigation split-view UI kit | Available | Declarative region headers, fixed or independently resizable leading/trailing sidebars, persisted widths, and automatic accessible compact overlays are available in the versioned CSS, JavaScript components, declarations, and React adapter pattern. |
| App Intents registry | Available | Typed actions, event triggers, entities, queries, manifest validation, same-origin hidden executors, cancellation, progress, and structured failures. Execution is guaranteed only while LFOS is active. |
| ShortCut YAML v1 | Available | Synced workflow source, capability approvals, manual/schedule/interval/VFS triggers, typed references, bounded control flow, checkpoints, history, and Monaco workbench. |
| Universal Search actions | Available | Locally indexes actions and workflows; typed required values and risky side effects remain LFOS-mediated. |
| LFAssistant proposals | Available in SolOS | Sends a bounded locally ranked catalog, validates structured proposals, and always confirms before OS-owned execution. |
| Same-origin catalog offline cache | Available with constraints | Only for resources hosted on the LFOS origin. |
| Website app manifest | Available | Store discovers only `/.well-known/lfos-app.json`; HTTPS, CORS, strict schema, same-origin URLs, and a 256 KiB limit are enforced. See [Website app manifest](https://os-docs.linecoflow.com/ai/docs/reference/website-app-manifest.md). |
| Store Add App wizard | Available | Discovers compatible website apps, supports explicit capability selection, and offers manual fallback when discovery fails. |
| Compatible app updates | Available | Checks installed website-managed apps when the Compatible section opens or Store refreshes; updates require field review and confirmation. |
| Settings Apps and Privacy | Available | Manages installed web apps, Dock visibility, Trash removal, and subtractive per-app controls for file, AI, and App Intents capabilities. |
| Multiple selection and richer filters | Not implemented | The initial picker uses one file and the first declared MIME filter. |
| Overwrite selection | Not implemented | Save requires a new filename; later writes through the same handle replace content. |
| Directory and persistent handles | Not implemented | Handles are file-only and window-scoped. |
| Notifications | Implemented | Permissioned post, update, removal, settings, and badge methods are available. |
| Identity and window SDK | Not implemented | No public bridge methods exist yet. |
| Packaged signed apps | Not implemented | Bundle, signing, installer, updates, and rollback remain future work. |
| Developer CLI | Not implemented | `init`, `dev`, `validate`, and `pack` are planned only. |

## Verification expectations

An available capability should have public types, documented limits, stable permission and cancellation behavior, a runnable example, and compatibility tests for its SDK/bridge protocol. The file integration currently has the implementation and example; broader automated browser-level coverage remains an improvement area.

---

<!-- Canonical documentation: https://os-docs.linecoflow.com/docs/reference/website-app-manifest -->
<!-- Source: docs/reference/website-app-manifest.mdx -->

> Publish and validate the canonical LFOS manifest for installing hosted web apps.

# Website app manifest

LFOS Store can discover an app configuration published by its own website. The single supported discovery URL is:

```text
https://<app-origin>/.well-known/lfos-app.json
```

This website manifest is distinct from both the installed `.app` file and the LFOS Store catalog. It is publisher-provided configuration, not Store review or certification. A valid manifest is labeled **LFOS Compatible — not reviewed by LFOS**; that label means only that LFOS validated the declared contract and origin.

## Canonical example

```json title="/.well-known/lfos-app.json"
{
  "schemaVersion": 1,
  "id": "com.example.tasks",
  "version": 1,
  "name": "Example Tasks",
  "summary": "A concise app listing for the Store.",
  "description": "Organize personal tasks and projects.",
  "category": "productivity",
  "tags": ["tasks", "planning"],
  "icon": "https://tasks.example.com/assets/icon.png",
  "screenshots": [
    "https://tasks.example.com/assets/tasks-list.png"
  ],
  "publisher": {
    "name": "Example Company",
    "url": "https://tasks.example.com/about"
  },
  "install": {
    "url": "https://tasks.example.com/app",
    "displayMode": "standalone",
    "embedPolicy": "embed",
    "defaultZoom": 100,
    "rememberWindowBounds": true,
    "windowChrome": {
      "mode": "overlay",
      "background": "surface"
    },
    "permissions": ["files:open", "files:save", "intents:provide"],
    "fileAssociations": [
      {"extensions": [".task"], "mimeTypes": ["application/x-example-task"]}
    ],
    "intents": {
      "schemaVersion": 1,
      "entry": "https://tasks.example.com/lfos-intents.html",
      "actions": [],
      "triggers": [],
      "entities": []
    }
  }
}
```

A published structural JSON Schema is available at [`/schemas/website-app-manifest.v1.json`](/schemas/website-app-manifest.v1.json). It is useful for editor assistance but does not replace runtime validation: LFOS additionally validates exact URL origins, credentials, intent descriptors, file-association values, UI profiles, and permissions during discovery.

## Contract

| Field | Required | Meaning |
| --- | --- | --- |
| `schemaVersion` | Yes | Must be the integer `1`. |
| `id` | Yes | Stable publisher app identifier. Keep it unchanged across releases. |
| `version` | Yes | Positive, increasing integer. Increment it for every change to normalized manifest content. |
| `name` | Yes | App name shown to users. |
| `summary` | Yes | Short Store listing text. |
| `description` | Yes | App description shown in Compatible apps. |
| `category` | Yes | Listing category. |
| `publisher` | Yes | Publisher name and same-origin HTTPS URL. |
| `install` | Yes | Runtime configuration, including launch URL and requested capabilities. |
| `tags` | No | Bounded list of short listing tags. |
| `icon` | No | Same-origin HTTPS icon URL. |
| `screenshots` | No | Up to five same-origin HTTPS image URLs. |

`install` uses the hosted app configuration fields documented in [App configuration](https://os-docs.linecoflow.com/ai/docs/reference/manifest.md): `url`, `displayMode`, `embedPolicy`, `defaultZoom`, `rememberWindowBounds`, `windowChrome`, `permissions`, `fileAssociations`, and `intents`. An optional `uiProfile` may provide a validated LFOS UI profile. Unknown fields and unsupported values are rejected; do not add local state or Store-review fields to the publisher manifest.

The only app permissions currently recognized are `files:open`, `files:save`, `ai:generate`, `notifications:post`, `intents:provide`, and `intents:subscribe`. LFOS presents requested capabilities during installation and lets the user choose which declared permissions to enable. A local privacy choice can disable a declared permission, but cannot grant one the manifest did not request.

## Hosting and security requirements

- Serve the manifest over HTTPS as `application/json` and allow cross-origin `GET` requests from the LFOS Store origin with CORS. Discovery is performed directly by the browser; LFOS does not proxy the request.
- The response must be no larger than 256 KiB. Use UTF-8 JSON with no duplicate object keys.
- LFOS requests the exact well-known path with credentials omitted, cache disabled, and redirects rejected. Alternate paths and names (including `lfos.app.json`, `lfos-config.json`, or `manifestVersion`) are not aliases.
- The manifest origin, launch URL, publisher URL, icon, screenshots, and any intent executor must all use HTTPS and the exact website origin. Do not include URL credentials.
- The parser rejects unknown top-level or install fields, unknown permissions, invalid intent or file-association declarations, and fields that attempt to claim LFOS verification, certification, review, or status.
- Only a valid HTTPS manifest receives the Compatible label. Ordinary manual web app installation remains a separate fallback and is not labeled compatible.

CORS is a browser-enforced opt-in: if the website does not permit the LFOS Store origin, discovery fails and the user can choose the ordinary manual installation path. Do not weaken the same-origin requirement to make a cross-origin resource load.

## Updates and versioning

LFOS checks installed Compatible apps when a user opens the Compatible section or explicitly refreshes Store data. Checks are bounded and isolated per app; there are no startup or periodic background checks. An unavailable or invalid manifest does not disable, uninstall, or alter the last installed app configuration.

- A greater integer `version` is offered as an update after a field-by-field review and explicit user confirmation.
- A lower integer version is rejected as a downgrade.
- A changed normalized manifest with the same version is a publisher contract error. Fix it by increasing `version`.
- An unchanged version and normalized content is not an update.
- LFOS preserves the installed file identity, local filename, Dock state, saved window bounds/zoom, and current permission choices. Existing permissions retain their choices; removed permissions disappear; newly requested permissions start disabled until selected.

## Install and trust model

Use **LFOS Store → Add App** and enter the website origin. Review the discovered publisher, app details, requested permissions, and final configuration before installing. If discovery fails, the wizard explains the failure and offers manual installation with a local app name and basic window configuration; manual apps do not inherit website-declared permissions.

Store-catalog apps and website-compatible apps are separate sources. Catalog review or verification is controlled by LFOS and cannot be self-asserted in this manifest. Compatible apps are shown locally only when installed; this is not a public app directory, security audit, endorsement, or guarantee that the publisher or app is safe.

## Publisher checklist

1. Keep `id` stable and start `version` at a positive integer.
2. Host the exact file at `/.well-known/lfos-app.json` with the required JSON content type and CORS response headers.
3. Use only HTTPS URLs on the same origin, including the launch page, publisher page, assets, and intent executor.
4. Declare only permissions and integrations the app actually needs; test each permission-denied path.
5. Increase `version` whenever any normalized field changes, including listing text, assets, launch configuration, or capability declarations.
6. Test the URL using LFOS Store's Add App wizard and verify both successful discovery and a useful manual-fallback path when CORS or validation fails.


---

# Agent tasks and project providers (updated 2026-10-21)

The current Agent contract is documented at
https://os-docs.linecoflow.com/docs/capabilities/agent and in
`docs/AGENT_MODE.md`. This bundled snapshot predates that API; use the current
page and LFOS `/sdk/v1/agent-types.d.ts` for complete types.

Declare `ai:generate`, `agent:use`, and (for project adapters) `agent:provide`.
After `lfos.ready()`, require advertised `agent.tasks` and `agent.provider` before
using them. `lfos.agent` exposes discover/registerProvider/subscribe/
subscribeSessions and tasks.start/list/get/pause/cancel/resume/provideInput.
Only the canonical `lfos.agent/v1` MessagePort envelope is supported.

Use the same conversation ID for follow-up tasks. `provideInput` answers waiting
tasks and steers running tasks; paused/interrupted tasks require Resume first.
Display completed summaries, progress, plan statuses, tool arguments/results,
and bounded change previews. Preserve composer drafts during asynchronous work.

Providers serialize mutations, check expectedRevision, and durably commit project
state, Undo/provenance, and operation receipts in one transaction. Lost replies
require operationStatus reconciliation; a timeout never proves absence.
A write returning verificationRequired must expose a verifying read. LF CORE's
com.linecoflow.lfcore.verify_changes accepts 1–100 operation IDs and returns
revision, verifiedOperations, mismatches, and checkedRecords. Generic reads cannot
clear those pending requirements. Never advertise unsupported schema keywords,
including minItems. The model supplies planStatus alongside plan and evidence
before completion; record verification does not prove semantic correctness.
