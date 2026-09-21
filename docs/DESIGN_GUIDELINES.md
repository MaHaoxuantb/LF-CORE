# Design guidelines

## Design intent

Aim for a modern, Apple-like experience in **clarity, typography, responsiveness, and restraint**. The interface should feel calm enough for long reading sessions and direct enough for quick thought capture. The prototype should validate the article ↔ graph ↔ article loop before visual polish becomes a separate project.

## Screen structure

- **Library:** a small list of workspaces, a prominent “I want to learn …” entry, and import controls. Avoid folders in the first version.
- **Workspace:** a pannable canvas places the full Markdown document in a resizable card and connects ideas around it. The document expands with its content instead of scrolling inside the card. A floating upper-left control opens its heading outline; save status and history sit at the upper right. Sources will open without discarding the canvas position.
- **Selection toolbar:** appears beside selected content. A selected node exposes editing, structure, chat, source, passage, and deletion actions directly on the canvas; selected text exposes its contextual actions near the passage. On narrow screens, wrap controls compactly rather than opening a detached details panel.
- **Proposal review:** answer and suggested change stay separate from the article until accepted. “Put this in the article” opens an edit preview at the intended location.
- **Return view:** reopen at the article, with a discreet summary of unresolved questions and changes since the last session.

## Interaction rules

1. **One primary action at a time.** Keep reading surfaces quiet; reveal tools when text or a node is selected.
2. **Direct manipulation with an alternative.** Selecting a passage shows creation at the selection point; its directed line begins at the highlight. Persist that highlight directly in Markdown with `==…==` while retaining its stable graph endpoint ID. Enlarging a card reveals notes. Clicking a connection reveals its endpoint handles on the canvas; dragging a handle to a side of its node previews and sets the attachment. A bidirectional connection has an independent handle at each end and equally visible arrowheads. Do not use a detached side-selection menu for this spatial task. Arrow keys move a focused handle to a side, and Home restores automatic placement, so dragging is not required for precision.
3. **Preserve place.** Opening a node, source, or AI answer should not reset article scroll or selection.
4. **Show where a change will land.** An AI article edit names the target passage or heading and previews additions and removals before acceptance.
5. **Make origin available without visual noise.** Use subtle markers for source and AI provenance; reveal details on click or hover. Never use color alone to convey origin.
6. **Support undo and redo.** Creation, movement, resizing, linking, and accepted article edits need both. Autosave should show a small, truthful saved state.
7. **Use motion to explain.** A node created from a passage can animate outward from that passage. Keep motion brief and respect reduced-motion settings.
8. **Keep the graph legible.** Node titles should be short, bodies expandable, branches collapsible, and links readable. New branches get a suggested position; manually positioned branches stay where the learner puts them.

## Visual system for the prototype

- Favor a readable editorial type scale: clear article title, section headings, body text optimized for sustained reading, and restrained metadata.
- Limit article line length to a comfortable reading measure; give the graph more horizontal space when opened.
- Use a neutral background, high-contrast text, one accent color for interaction, and a small set of semantic colors for status. Color choices must meet accessible contrast targets.
- Use spacing, alignment, and subtle borders to establish hierarchy. Avoid heavy cards everywhere, decorative glass, and permanent toolbars around every paragraph.
- Use familiar platform conventions for selection, keyboard focus, context menus, file import, and navigation.

## Required states to design

The prototype must visibly handle: empty library, new workspace generation, loading, AI unavailable, unsourced generated text, unresolved anchor, PDF missing or moved, unsaved or failed save, proposal accepted/rejected, and returning to a workspace. Errors should say what happened and give a recovery action.

## Prototype usability checks

Observe a learner completing these tasks without coaching:

1. Start a topic and identify which article content is AI-generated.
2. Highlight text, create a connected node, and navigate back.
3. Ask a freeform question and tell whether the response has been saved in the article.
4. Preview and accept an article change, then undo it.
5. Open a cited PDF at the relevant passage.
6. Reopen the workspace and state what to study next.

Record where users hesitate, lose their place, or mistake a proposal for accepted knowledge. Fix those failures before adding more visual features.
