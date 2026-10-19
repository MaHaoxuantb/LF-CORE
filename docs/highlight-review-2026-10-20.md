# Highlight and selection review — 2026-10-20

Reviewed the changes made in this chat and the connected creation, normalization, removal, repair, selection, and drag paths. The review covered text and formula highlights in articles and node documents, shared passage anchors, repeated quotes, Markdown formatting, and keyboard/pointer interaction.

## Issues fixed in this review

| Issue | Reproduction or cause | Correction |
| --- | --- | --- |
| Partial formatting could be damaged | Highlight `bold` in `A **bold word** ends`; the earlier wrapper produced crossing delimiters. | Try valid boundaries and verify rendered content/formatting and the intended passage before writing Markdown. Unsupported source ranges remain saved annotations. |
| Formatted highlights could resist removal | `==*hello*==`, `==[hello](url)==`, and entity-containing text did not match the old source projection. | Resolve the rendered mark using the canonical text, then remove only a source occurrence that produces the expected rendering. Code literals and repeated quotes are protected. |
| Removing leading whitespace could turn text into code | Removing markers around a tab-indented phrase could create an indented code block. | Encode leading indentation where necessary so removing the highlight preserves its rendered formatting. |
| Old offsets could identify the wrong highlight | Insert text before an existing highlight, then select its new location or different text at its old location. | Resolve each saved anchor against current document text before reusing it or declaring a duplicate. |
| Formula boundaries included an unselected equation | A range ending at the formula's start, or starting at its end, expanded into the formula. | Distinguish a boundary-only selection from selection of formula content. |
| Accessibility clicks did nothing | A click without a preceding pointer drag did not open highlight actions. | Support activation clicks as well as keyboard and pointer actions. Prevent an enclosing hyperlink from navigating during highlight activation. |
| Interrupted drags left active listeners | Window blur or lost pointer capture was not handled; a different pointer could end the drag. | Cancel and clean up on interruption, and ignore other pointers. |
| A canceled selection retained the previous passage | Beginning a new selection hid its old toolbar but retained the old saved selection. | Clear the captured passage when a new selection begins. |
| Shared passage repair could restore old markup | Several nodes held independent copies of one anchor; repairing one left another copy stale. | Update every node copy sharing that anchor identity before normalization. |

## Similar behavior still needing follow-up

These are existing behavior and scope limitations, not covered by the fixes above:

1. **Fully overlapping highlights have no chooser.** `markAnchors` displays the first matching highlight for a text segment/formula. A smaller highlight fully covered by another can have no directly accessible mark until the covering one is removed. A menu listing all highlights at the clicked passage would make each independently accessible.
2. **Removing `==` in the Markdown editor does not remove a saved anchor.** `ensureUnifiedNodeEdges` reapplies source highlighting from saved records, so a marker-only edit can appear to be undone. The editor needs an explicit policy for removing annotations and handling their graph connections; the current reliable removal path is the highlight's Remove highlight action.
3. **Edits inside an anchored quote invalidate exact matching.** Nearby edits are handled through context, but changing the quoted text/formula itself can leave an unresolved anchor. Connected nodes offer Repair link; standalone unresolved highlights have no equivalent management UI. A highlight list with repair/remove actions would cover both this and overlap management.

## Validation

- `npm test`: 183 tests passed.
- `npm run build`: passed.
- `git diff --check`: passed.
- Browser fixture `/tests/fixtures/passage-selection.html`: 13 checks passed using actual DOM Range/Selection behavior.
- Browser fixture `/tests/fixtures/highlight-markdown.html`: 8 checks passed using the production DOMPurify/KaTeX text reader, including named HTML entities and formulas inside italics.

To run the Markdown browser fixture, bundle its entry before opening the page on the development server:

```sh
node --input-type=module -e "import { build } from 'esbuild'; await build({ entryPoints: ['tests/fixtures/highlight-markdown.js'], bundle: true, format: 'esm', outfile: 'dist/highlight-markdown-checks.js' });"
```

The browser fixtures are supplementary checks; `npm test` does not launch them automatically. The earlier real-app checks in this chat also verified reverse-drag Highlight/Add node, formula removal, Undo, and reopening saved annotations.
