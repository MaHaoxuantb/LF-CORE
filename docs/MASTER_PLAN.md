# Master implementation plan

## Objective and scope

Build a local-first prototype for independent learners. A user may start with a topic prompt, pasted material, or an imported PDF. The system produces or helps build a master article; highlighted passages expand into a graph; freeform AI requests help investigate; accepted answers improve the article. The test of the product is whether the resulting workspace is easier to revisit than a chat transcript.

Read [core concepts](CORE_CONCEPTS.md) for product and data rules, and [design guidelines](DESIGN_GUIDELINES.md) for interface behavior.

## Working architecture

Use a modular desktop-capable web UI with local persistence. Keep these responsibilities separate:

1. **Domain and storage:** workspaces, article revisions, nodes, edges, anchors, proposals, source records, and canvas positions.
2. **Article editor:** one Markdown document with LaTeX support, heading outline, selections, revision preview, undo/redo, and anchor repair.
3. **Graph view:** nodes, labeled links, manual positions, and navigation to anchors.
4. **Source reader:** PDF and pasted text, selection, source anchors, and local file management.
5. **AI adapter:** selected-context packaging, freeform request, typed proposal response, research/source verification, and error handling.

For the first build, prefer integrating focused open-source components over forking whole applications. Evaluate a graph library for custom nodes and links, a structured text editor that exposes stable selections, and a PDF renderer. Record each dependency's license, version, role, and replacement cost before adoption. Do not couple saved workspace data to one library's proprietary scene format.

**Storage direction:** separate structured records from imported file bytes. Start with a local database or browser storage that can reliably save revisions and source references. A single-file export may be added later; it should not dictate internal architecture. The user-facing library does not need folders.

**AI direction:** use one request/response contract and an adapter for the selected model provider. This allows an early hosted model for prototyping or an on-device model later without changing article and graph data. If the model is remote, explain the data sent and make the service configurable. Never send an entire imported source when selected context suffices.

## Phases

### Phase 0 — Product and technical spike

**Build:** a clickable or coded thin slice of article selection → graph node → return; a small sample workspace; a dependency decision record; and a local storage proof of concept. Use one realistic topic and one PDF. Test whether article anchors survive edits.

**Exit gate:** the interaction is feasible with chosen components, local reopen works, and the storage format does not depend on a canvas package. Document the chosen stack and rejected alternatives before Phase 1.

### Phase 1 — Manual knowledge workspace

**Build:** library, workspace creation, editable Markdown master article with a toggleable heading outline, graph nodes and links, highlight-to-node action, return navigation, autosave, undo/redo, resize controls, and keyboard alternatives. Seed an example article manually; AI is not needed to validate the core loop. Question entry belongs to the later chat interface, not the graph node model.

**Exit gate:** after restarting the app, a user can open a workspace, read and edit the article, create a node from several highlighted sentences, and navigate both ways without broken links or lost data.

### Phase 2 — Three entry points and sources

**Build:** start from topic prompt, pasted text, or local PDF. Add PDF reading, source selection, attachment to nodes, and navigation back to an exact page/passage. Handle missing or moved local files. Topic prompt can create an empty structured workspace until Phase 3 provides generation.

**Exit gate:** all three entry points create usable local workspaces, and a sourced note can be traced to its original passage. Source text and article text remain separate.

### Phase 3 — Article generation and open-ended AI

**Build:** generate a proposed outline and full introductory article from a topic; add freeform Ask on selections and nodes; supply a few suggested prompts; return typed proposals; show provenance and uncertainty. Implement “Put this in the article” as a previewed, reversible edit. Add model configuration and clear unavailable/error states.

**Exit gate:** a user can start with “I want to learn LEAN,” read the generated article, investigate a selected proof step, and accept a useful explanation into a specific article passage. The article does not change when the answer is merely viewed. No citation appears without a real source reference.

### Phase 4 — Research and consolidation

**Build:** lightweight source discovery for selected questions, verified source attachment, compare or merge selected ideas, identify possible contradictions, and a session closeout that records current understanding and open questions. Keep research findings as proposals until reviewed.

**Exit gate:** a learner can attach a source to a question, compare it with an existing idea, and improve the article while preserving the reasoning trail and original source.

### Phase 5 — Revisit and polish

**Build:** article-first return view, recent changes, unresolved questions, search within a workspace, performance improvements for larger graphs/PDFs, accessibility pass, and interface polish guided by observed task failures.

**Exit gate:** after several days, test users can identify the topic's main idea, open a supporting source, and choose a next study step without reading prior AI exchanges.

## Vertical slice to build first

Before broad feature work, implement one end-to-end flow with a seeded article: highlight text → create anchored node → ask a freeform question → receive a sample or real proposal → preview “Put this in the article” → accept → undo → close and reopen. This exposes the hardest integration points: editor selection, anchors, proposal state, revisions, and persistence.

## Decisions still open

Resolve through the Phase 0 spike, not by assumption:

- **App shell:** browser-only local app or desktop wrapper. Compare file access, offline behavior, installation friction, and update path.
- **Model execution:** on-device only or configurable remote model. Compare quality, latency, cost, privacy, and device requirements. Local storage is already decided.
- **Article generation depth:** how long an initial article should be before it becomes repetitive or hard to verify. Test with learners.
- **Source support:** whether textbook PDFs need chapter navigation, OCR, or just standard text-based PDF handling in the first release.
- **Graph layout:** automatic layout for new branches versus manual placement; preserve user positions either way.
- **Export:** decide format after storage is stable and users demonstrate a backup or sharing need.

## Verification and release discipline

- Keep a small set of realistic fixture workspaces: topic-only, pasted text, text PDF, and a PDF with difficult extraction.
- Test anchor survival after editing text before and around a highlight, article revision undo, local reopen, and missing source recovery.
- Review AI output for unsupported claims and fake citations. Verify that a rejected proposal never alters persisted article content.
- Run the usability tasks in [design guidelines](DESIGN_GUIDELINES.md) with actual learners before expanding the feature set.
- At each phase, update the docs when observed behavior changes a product rule or data assumption.

## What is deliberately later

Account systems, cloud sync, real-time collaboration, classroom features, grading, large-scale web research, adaptive curricula, and a general-purpose knowledge platform. They may fit the long-term vision, but the initial product must first prove the article ↔ graph ↔ article learning loop.
