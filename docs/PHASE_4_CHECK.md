# Phase 4 verification

## Implemented flow

- A selected passage or set of nodes can seed a persistent research question. Each question records its original context, open/resolved status, attached source IDs, and timestamps.
- Existing PDFs and pasted sources can be attached to a question. Scholarly discovery searches OpenAlex with the visible query and returns title, authors, venue, date, citation count, and original/open-access URLs where available.
- Attaching a discovery result creates a web-source record containing its OpenAlex work ID and verification timestamp. The UI states that this verifies the provider record only and requires the learner to inspect the original before relying on a claim.
- A learner-written finding stays a proposed complete article edit until its diff is reviewed and applied. Stale proposals cannot overwrite a newer article. Acceptance records its question, sources, comparison, and proposal ID as article provenance and is undoable.
- The comparison view accepts the article and/or graph nodes, preserves a comparison record, identifies only conservative *possible* polarity contradictions, and creates a separate merge proposal for review.
- Session closeout stores current understanding and line-separated open questions without changing the article.
- `.lfcore` export/import includes Phase 4 records and remaps embedded PDF source IDs in questions, findings, and accepted research origins.

## Automated checks

`npm test` passes 46 tests. The five Phase 4 tests cover selected-context questions and source trails, OpenAlex response validation and network failure, conservative contradiction labeling, non-mutating research proposals, and closeout normalization. Existing project-format coverage now checks Phase 4 PDF source-ID remapping.

`npm run build` passes. The browser smoke check opened the existing Plate tectonics workspace, rendered all three Research tabs at desktop size in dark mode, exposed every comparison candidate through accessible checkboxes, and reported no console errors.

## Exit gate

The prototype now supports the exit-gate sequence: preserve a selected question, attach either a local source or provider-verified source record, compare it with existing ideas, review and accept a sourced article improvement, and retain the question → source → proposal → article-origin trail. The original local source remains separate and unchanged; web records retain their original URL.

## Deliberate limits

- OpenAlex discovery requires a network connection and its browser CORS policy to remain available. Local reading, existing sources, saved research, and consolidation review remain usable offline.
- Metadata verification does not verify a paper's conclusions, peer-review status, or applicability. Citation count is stored for context but is not treated as a quality score.
- Contradiction detection is lexical and intentionally cautious. It cannot replace reading the sources or expert judgment.
- Web sources open at their canonical landing page; exact-passage anchors remain available only for locally imported PDF and pasted-text sources.
