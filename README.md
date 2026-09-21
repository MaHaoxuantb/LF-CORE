# LF CORE

LF CORE by LinecoFlow is an article-first, local-first workspace for independent learning. Start with a question or source, explore ideas in a connected graph, and consolidate what matters into a master article.

**North Star:** Does this make the next study session easier to revisit than chat?

## Run the Phase 3 prototype

Requires Node.js 20 or newer.

```sh
npm install
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). Start from a topic, pasted text, or a local PDF; the latter two create separate sources alongside an editable, initially blank working article. You can also add sources to an existing canvas with **Sources**. In the source reader, select text on a PDF page or pasted source, then create a node or attach the passage to an existing node. The node’s details link returns to the original page and highlighted passage. Imported PDF bytes live in this browser’s IndexedDB, separate from the workspace’s small JSON record. Moving the original file will not break it; if browser-stored bytes are missing, reattach the same PDF. Scanned PDFs without text need OCR and are not selectable yet.

For AI, open **Chat** in a workspace, then choose **Model settings** inside the chat panel. Enter an OpenAI compatible base URL (such as `https://api.openai.com/v1`) or its complete `/chat/completions` URL, one or more model IDs (one per line), and the active model ID. Enter a key and a passphrase of at least 12 characters to encrypt the key locally. Unlock it with the passphrase after each reload. A local endpoint that does not require a key can leave it empty. Browser requests require the endpoint to allow CORS. Settings are specific to this browser origin. The key is never stored in workspace history or plaintext browser storage; while unlocked it lives in tab memory and is sent only to the configured endpoint. Use trusted endpoints; browser encryption does not protect an unlocked key from a compromised page or browser extension.

A topic canvas opens a chat with a draft request ready to send. Other chats can start from the article, a selected passage, or one or more selected nodes. The compact **Context** control offers **Master article**, **Selected nodes** (captured from the canvas when chosen), and **All** (article plus every node). Chat can answer questions or propose a full Markdown revision to any item in the chosen context. Review each proposed article or node change, edit the proposed Markdown if needed, then apply it; Undo remains available. **History** inside chat contains resumable conversations. Each request records the exact content sent, while later requests use current content. The panel shows the model and context size before sending and blocks oversized context rather than silently cutting it. Imported PDF content is not included automatically. Generated content does not count as a verified source.

Open the seeded Plate tectonics example for the manual article/graph loop. Scroll to move around, and use the zoom percentage’s preset menu and **Fit** control at the lower left. Right-click the **master article** to edit its Markdown, including `$...$` and `$$...$$` formulas. The floating outline control at the upper left shows headings and jumps to them. Drag the document’s lower-right grip to change its width and minimum height, or focus the grip and use the arrow keys. Selecting text in the document or a card reveals **+ Node** and **Highlight**. A highlight can connect to any node or another highlight: drag from the highlight, or focus it and press Space to choose an endpoint. New connections snap to the nearest of a node’s four sides as you drag. Select a connection to edit its description, cycle its arrow direction, remove it, or drag either endpoint onto another node or highlight. Right-click a highlight to connect it again or remove it. Existing highlighted passages keep their links when older canvases are opened.

Left drag across empty canvas to draw a rectangle and select multiple cards. Left click selects one card or clears the selection on empty canvas. Drag a selected card’s top grip to move the group, or focus the grip and use the arrow keys (Shift for larger steps). Press Delete to remove the selection in one undoable change. Right drag to pan; a stationary right click opens actions for the canvas, document, card, or selection.

Select a card and press **Tab** for a child, **Enter** for a sibling, or **F2** to rename it. Each card contains Markdown; write in its details panel or use **Edit content** in the right-click menu, then select rendered text to create a linked child. Drag the top grip to move it; drag its lower-right grip to resize width and height. Larger cards show more content, with an ellipsis when content does not fit. Both grips have arrow-key alternatives. Use a card’s count badge to collapse children. Drag the side connection handle from one card to another for a two-way relationship, or focus the handle and press Enter/Space to choose a target. Select its label on the line to rename it, or use × beside the label to remove it. **Delete node** in the details panel removes it and its descendants; Undo restores them. The home screen also has a delete control for each canvas. **Undo** (⌘Z / Ctrl+Z) and **Redo** (⇧⌘Z / Ctrl+Shift+Z or Ctrl+Y) cover edits, links, moves, and resizing. Questions belong to the planned chat interface, so graph cards have no question type.

The save control at the upper right offers **Auto save** and **Manual save**. In Manual save, click the status button or press **⌘S / Ctrl+S** to save. The status reads **Unsaved** while changes are pending; the browser warns before leaving with unsaved changes. The mode choice persists across reloads.

The prototype stores workspace records in this browser's local storage and imported PDF bytes in IndexedDB. Previous Phase 1 data, including card notes, migrates to Markdown without changing the old saved record. Use the same browser profile to reopen workspaces. There is no account, cloud sync, or export yet; clearing site data removes workspaces and PDF copies. Run `npm test` for the anchor, outline, migration, and persistence checks.

Current scope includes workspace chat with reviewed article and node edits alongside the Phase 2 source workflow. See [implementation decisions](docs/IMPLEMENTATION_DECISIONS.md), [Phase 2 verification](docs/PHASE_2_CHECK.md), and [Phase 3 verification](docs/PHASE_3_CHECK.md) for the earlier prototype decisions.

[Phase 0/1 verification](docs/PHASE_0_1_CHECK.md) records the technical exit-gate checks, the PDF reading spike, and what still requires learner observation.

Project documents:

- [Master plan](docs/MASTER_PLAN.md) — phases, implementation sequence, and completion tests.
- [Core concepts](docs/CORE_CONCEPTS.md) — product rules, interaction model, and data model.
- [Design guidelines](docs/DESIGN_GUIDELINES.md) — interface principles and prototype behavior.

These documents define a prototype direction, not a finished specification. Decisions marked *open* in the master plan should be resolved through a working slice and user observation.
