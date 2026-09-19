# Phase 0 and Phase 1 verification

Checked 20 September 2026 against the exit gates in [the master plan](MASTER_PLAN.md).

## Phase 0: technical exit gate met

- **Thin slice and sample:** the Plate tectonics workspace contains a manually written Markdown article and anchored graph cards. Selecting a linked passage opens its card; the details panel returns to the highlighted passage. The browser UI was checked in both directions.
- **One PDF:** [the self-authored reading sample](../output/pdf/plate-tectonics-spike.pdf) uses the same topic. Its one page was rendered and inspected, and its text was extracted successfully. It is a technical reading fixture, not an imported source; PDF import, passage coordinates, and missing-file recovery remain Phase 2.
- **Anchors:** tests cover multi-sentence selection after surrounding edits, repeated quotes whose former offset now belongs to another occurrence, and explicit failure when selected words change. An unresolved link is identified in the details panel and can be reconnected.
- **Persistence:** versioned JSON stores article Markdown, graph records, anchors, positions and undo/redo independently of DOM/SVG scene formats. Reopening the existing browser workspace after reload retained the sample and its links. Automated round-trip and legacy-migration tests cover the saved domain records.
- **Stack and alternatives:** see [implementation decisions](IMPLEMENTATION_DECISIONS.md). This spike does not establish that real learners find the workspace useful; observational usability checks remain outstanding.

## Phase 1: technical exit gate met

The library creates and reopens workspaces; the article edits as Markdown with a heading outline. A rendered multi-sentence selection creates an anchored card, and its passage and card navigate both ways. Cards can be linked, resized, moved, and undone/redone. Save mode and status persist; manual mode warns on leaving with unsaved work. Resize grips, card movement, and cross-links have keyboard alternatives. `npm test` and `npm run build` pass.

The browser check used an existing sample without deleting or replacing user data. It confirmed the article-to-card marker, the return-to-passage control, and a reload that retained the library. The storage round-trip test covers edits and layout after reopen; it is not a substitute for a fresh end-to-end human usability session. Phase 2 PDF import and later AI/proposal tasks are intentionally outside these exit gates.

To repeat the checks: run `npm test` and `npm run build`, start the app with `npm start`, open the seeded example, select several sentences and create an idea, follow the highlight and return control, edit the Markdown, then reload and reopen the workspace. The PDF fixture can be regenerated with `tests/create-spike-pdf.py` using ReportLab.
