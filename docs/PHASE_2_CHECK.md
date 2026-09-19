# Phase 2 verification

## Exit-gate coverage

- Topic entry creates a working article without generating unsupported claims. Pasted-text and PDF entry create the same article structure and keep the original material in a separate source record.
- In an isolated browser origin, a pasted source was created, selected, linked to a new node, reopened, and highlighted at the original passage.
- The self-authored one-page PDF fixture was imported through the UI, rendered with selectable text, and a selected page-1 passage was attached to an existing node. The node details reopened page 1 and highlighted the exact quote. The PDF bytes were read back from IndexedDB after page navigation.
- The zoom preset menu and arrow endpoint menu from the preceding UI request were opened in the browser without mutating the existing workspaces. The graph and compact node cards rendered without a runtime error.
- Automated tests cover source/reference persistence, old-record normalization, existing article anchors, migration, and save preference. `npm run build`, `npm test`, and `git diff --check` pass.

## Known limits

- Scanned or image-only PDFs display visually but have no selectable text until OCR is added. PDF.js text extraction may not produce a meaningful reading order for unusually complex layouts.
- Imported bytes and browser-local records have no portable export or cloud backup. Clearing site data removes them. PDF reattachment requires the exact original bytes, verified by SHA-256; this protects saved page references but cannot recover a permanently lost original.
- Human learner observation is still needed for the product exit gate, especially with multi-page textbook PDFs and dense source pages. This technical check does not claim a formal usability study.
