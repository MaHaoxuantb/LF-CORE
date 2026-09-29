# Phase 1–2 implementation decisions

## Canvas direction

The graph is the only workspace surface. A dotted, pannable canvas holds the complete document and connected topic cards. The document is one Markdown file with rendered LaTeX; its outline is derived from headings and can be shown on the left. It expands with its content, and its lower-right grip changes width and minimum height. Cards also contain Markdown documents. Selecting text in either the main document or a card creates a child whose arrow begins at that passage. Selecting a linked passage frames its source and card. Left dragging on empty canvas selects cards within a rectangle; dragging a selected card's grip moves the group. Right dragging pans, while a stationary right click opens context actions. Cards reveal more content as they grow, can be dragged, resized on both axes, and collapsed, and support quick creation with **Tab** (child) and **Enter** (sibling). **+ Node** appears beside selected text; Fit sits with the zoom controls. Deleting a card removes its descendants in one undoable change. Questions are reserved for the later chat interface.

The interface uses the supplied AFFiNE reference for spatial layout and XMind style branch operations. It does not copy their assets or saved document formats.

## Stack and storage

The prototype uses browser APIs and Node's built-in HTTP and test modules. Marked 18.0.13 parses Markdown, marked-katex-extension 5.1.13 and KaTeX 0.18.7 render formulas, DOMPurify 3.4.15 sanitizes rendered HTML, and esbuild 0.28.2 bundles these assets locally. Saved records contain Markdown article text, nodes, parent IDs, cross-connections, anchor references, canvas coordinates, node sizes, and undo/redo stacks. They are independent of any graph renderer.

IndexedDB stores the complete versioned project state, including workspaces, chats, and up to 40 undo snapshots per workspace. Writes are asynchronous and rapid changes are coalesced so typing does not create an unbounded transaction queue. Existing versioned local-storage data is copied into IndexedDB and read back for validation before the legacy document keys are removed. Card content is stored as `{ type: 'markdown', markdown }`, leaving room for another document type later. Auto save is the default; a small local-storage preference stores the selected save mode. Manual save holds edits in memory until the user clicks Save or presses ⌘S / Ctrl+S, shows an Unsaved status, and warns before leaving with pending changes.

| Dependency | Version | License | Role and replacement cost |
| --- | --- | --- | --- |
| Marked | 18.0.13 | MIT | Markdown parsing; replaceable behind the rendering helper. |
| marked-katex-extension | 5.1.13 | MIT | `$...$` and `$$...$$` syntax bridge; replaceable with another Markdown math plugin. |
| KaTeX | 0.18.7 | MIT | Local formula rendering; another math renderer would need a visual review. |
| DOMPurify | 3.4.15 | MPL-2.0 or Apache-2.0 | Sanitizes article HTML; replacement needs a security review. |
| esbuild | 0.28.2 | MIT | Bundles scripts, styles, and local fonts; build-only replacement. |

| Responsibility | Current choice | Replacement path |
| --- | --- | --- |
| App shell | Local web app on `127.0.0.1` | A desktop wrapper can serve the same UI later. |
| Storage | Versioned project records and PDF bytes in IndexedDB | Small UI and save-mode preferences remain in local storage. |
| Article | Markdown source, sanitized preview, and native selection | A richer editor can retain Markdown as the portable content format. |
| Graph | DOM cards, SVG paths, saved world positions | A graph renderer can use the same nodes and coordinates. |
| Passage links | Quote, rendered-text offsets, surrounding context | Keep the anchor contract and improve repair when richer editing arrives. |

The original manual slice kept AI out of Phase 1; current Chat and Agent proposals build on the same Markdown, graph, history, and provenance records without changing the saved canvas format.

## Agent mode

Agent mode is implemented as a transport-neutral in-app workspace service rather than a localhost network API. A remote OpenAI-compatible model cannot call the user's loopback server directly, so the browser brokers a strict JSON tool protocol. Read tools expose a paginated project index, bounded Markdown ranges, and searchable imported-source passages. Mutation tools operate only on a cloned workspace and can create or edit Markdown nodes, revise the article, reparent branches, create or update links, and attach source passages issued by the service. There is no arbitrary JavaScript, file, network, deletion, source-editing, or raw-coordinate tool.

One run is limited to six model turns, eight calls per turn, 24 mutations, and 12 new nodes. Returned call batches validate atomically before touching the draft. The completed draft is stored with the chat as one proposal and can only be applied as one workspace history change; stale proposals are rejected when the workspace timestamp no longer matches. Agent origins are retained on affected article, node, edge, and source-reference records so Undo can be distinguished from acceptance without deleting the chat record.

Pasted text is directly searchable. PDF text is extracted page-by-page with PDF.js and stored in a separate version-2 IndexedDB cache keyed by source ID and checksum. This cache is disposable, excluded from `.lfcore` files and undo snapshots, and rebuilt from the canonical PDF bytes after import. Scanned pages remain unavailable without OCR.

## Phase 4 research and consolidation

Research records live with the workspace as four explicit collections: questions, findings/proposals, comparisons, and session closeouts. A question retains the selected node IDs and quoted passage that motivated it. Source IDs are attached to the question and copied into any resulting article proposal and accepted article origin, so later article edits do not erase the reasoning trail.

Lightweight discovery uses the public OpenAlex works search from the browser and sends only the search terms visible in the Research panel. An attached result becomes a `web` source with its OpenAlex work ID, resolution time, bibliographic metadata, and original URL. The interface consistently describes this as provider-record verification: it establishes that the indexed record exists, not that its contents prove a learner's claim. Existing pasted text and PDF sources can also be attached directly to a question. No discovered source is silently included in model context.

Findings and comparison merges are stored as proposals containing the complete before/after article Markdown. They never modify the article on creation. Acceptance requires a full diff review, rejects stale proposals when the article has changed, increments the article revision, participates in undo/redo, and records question, source, comparison, and proposal IDs in article provenance.

Comparison is deliberately local and inspectable. It summarizes up to eight selected article/node ideas, records shared terms, and raises a *possible* contradiction only when shared terms occur with different simple negative/positive wording. This is a review prompt, not semantic or factual adjudication. Session closeouts store current understanding plus discrete open questions and do not mutate the article.

## Phase 2 sources

The home screen offers topic, pasted-text, and local-PDF starts. Topic starts with an empty working article; pasted text and PDFs also begin with an empty working article, while the original material is recorded as a separate source. Each imported PDF also gets at most one canvas source node whose document is only `{ type: 'source', sourceId }`; it opens the canonical source reader, cannot be edited as Markdown, and can be removed without deleting the source. A compact card shows source metadata; resizing it to at least 320×260 renders an inline PDF page with navigation while keeping the selected preview page ephemeral. Workspaces have `sources[]`; ordinary nodes have `sourceRefs[]` with a source ID, page number for PDFs, and a quote/context anchor. These fields are optional on older saved records and are normalized on load without changing the storage key or the old source data. Source passage links are not article anchors and do not imply that the article contains the cited text.

PDF bytes are copied into a dedicated IndexedDB store under a stable source ID, not embedded in the versioned project record or undo snapshots. The SHA-256 checksum is recorded in source metadata. Moving the original file does not affect the copy. If the IndexedDB entry is missing, the reader offers reattachment and accepts only a byte-identical PDF, preserving page/passage correctness. Deleting a workspace clears its PDF copies after a successful project-state save; undoable source metadata changes retain the bytes so redo can restore the source. Pasted text stays in the structured source record, capped at 500,000 characters; PDF imports are capped at 50 MB to keep the prototype responsive. A versioned `.lfcore` download packages one canvas, its chats, source records, and PDF bytes; upload remaps browser-storage identities and creates an independent project copy. There is no cross-browser synchronization.

PDF.js `pdfjs-dist` 6.3.289 (Apache-2.0) renders one page at a time with a selectable text layer; its worker is served as a local `.mjs` asset with the correct JavaScript MIME type. The reader saves page and quote/context offsets, then re-resolves the quote on return and highlights its rendered rectangles. This supports text-based PDFs. Scanned/image-only PDFs need OCR, which is outside Phase 2. A local browser origin (`127.0.0.1`) keeps reading offline; no imported file is sent to an AI service.

## Phase 0 alternatives and deferred decisions

The browser shell was chosen over an Electron or Tauri wrapper for the first manual slice: it needs no installer and works offline once the local server and bundled assets are present. A wrapper would offer better local-file access and packaging but adds platform builds and update handling before the article-to-graph interaction is validated. IndexedDB removes the small Web Storage ceiling, but the data remains tied to one browser origin and profile, so project downloads remain the portable backup. This is not yet a packaged, double-click desktop app.

Native DOM text selection plus Markdown source was chosen over a structured editor such as ProseMirror or TipTap. It gives a small selectable rendered document and portable text at the cost of limited WYSIWYG editing and quote-based anchor repair. DOM cards with SVG connectors were chosen over React Flow or a whiteboard scene format: manual positions and edges remain domain data, but large graphs will need performance testing. The PDF spike uses a separate [reading fixture](../output/pdf/plate-tectonics-spike.pdf); adding a PDF renderer now would be premature because Phase 1 neither imports nor navigates source pages.

Remote versus on-device AI, initial article length, OCR/chapter handling, long-term project-format evolution, and observed learner preferences are not resolved by this non-AI manual slice. They remain explicit decisions for the phases that exercise those capabilities. See [Phase 0/1 verification](PHASE_0_1_CHECK.md) for the technical checks and their limits.
