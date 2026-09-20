# Core concepts

## Product definition

LF CORE by LinecoFlow helps an independent learner turn a subject or source into a coherent, revisitable body of knowledge. The **master article** is the primary artifact. A graph expands outward from passages in that article so the learner can investigate questions without losing the main narrative. Sources remain inspectable. AI helps explore and propose changes, while the learner chooses what becomes part of the article.

The product cycle is **explore → understand → consolidate → revisit**. A session succeeds when the article, its supporting material, or its open questions are clearer than at the start.

### Intended user and boundaries

- Independent learners studying a topic at their own pace.
- Entry points: “I want to learn …”, pasted text, a PDF, or a textbook PDF.
- Local-first, single-user prototype. Workspace data and imported files live on the user's device. Cloud sync, classroom workflows, assignments, and multi-user collaboration are outside the first release.
- “Local-first” describes storage and availability. Whether model inference is on-device or uses an external service is **open**; if external, the interface must show what selected content will be sent and require configuration before use.

## The objects a learner sees

| Object | Purpose | Key behavior |
| --- | --- | --- |
| Workspace | One learning subject | Opens to the master article and remembers reading position |
| Master article | Coherent current understanding | One Markdown document with LaTeX formulas and a heading outline; AI changes are previewed before application; PDF is not an article format |
| Graph node | One idea, explanation, or research lead | Can anchor to an article passage, a source passage, or another node; questions are handled by the later chat interface |
| Link | Relationship between two items | May have a short label such as “supports,” “contradicts,” or “extends” |
| Source | Imported PDF or pasted material | Original content stays separate from generated content |
| Source anchor | Precise reference to a passage | Opens the original file and location where possible |
| AI proposal | Suggested answer or workspace change | Can be accepted, edited, discarded, or kept as an exploration note |

The graph is the workspace surface. The article remains fully visible on it, so promoted knowledge is always available without switching views.

## Primary journey

1. Enter “I want to learn LEAN.” The system proposes an outline and a full introductory article. The draft is visibly AI-generated. Claims without verified sources are not presented as sourced facts.
2. Read the article. Highlight several sentences and drag outward to create a graph node anchored to that passage. Keyboard and menu equivalents provide the same action.
3. Ask a freeform question on that selection or node, such as “Why is this proof step sufficient?” Suggested actions are shortcuts, not a fixed command vocabulary.
4. Inspect the answer and any cited or attached source. Optionally pin a PDF, highlight its relevant passage, and link it to the node.
5. Choose **Put this in the article**. The system proposes a specific insertion or revision and shows a before/after diff. Accept, edit, or cancel it.
6. Return later to the article, with a concise view of unresolved questions and the supporting graph.

## Product rules

1. **Article first.** The complete article remains readable on the graph canvas.
2. **Explore freely; consolidate deliberately.** AI answers and graph branches do not silently rewrite the article.
3. **Selection provides context, language provides intent.** A request may apply to a passage, heading, node, link, source excerpt, or multiple selected items. Common prompts are discoverable shortcuts.
4. **Provenance survives editing.** Original source, learner writing, and AI-generated text have distinct records. An accepted AI edit retains its origin even when the visible article reads naturally.
5. **No invented citations.** A generated article can contain unsourced sections; they must remain identifiable. A citation is attached only when the referenced source and location exist.
6. **Every connection is navigable and directly editable.** From a graph node, the learner can return to its article or source anchor; from an anchored passage, they can find its nodes. Clicking a connection exposes on-canvas handles; moving either end changes where it meets its node. Bidirectional links must work symmetrically at both ends, without a side-selection menu.
7. **Local work remains usable.** Reading and editing saved workspaces works without network access. AI actions can report that a configured model is unavailable.
8. **Revisiting is a first-class task.** On return, show the current article and a short list of open questions or recent changes, not a conversation transcript.

## Conceptual data model

Use stable IDs and persist content separately from visual layout. This is a proposed domain model; storage technology can be chosen during implementation.

| Entity | Minimum fields |
| --- | --- |
| `Workspace` | `id`, `title`, `createdAt`, `updatedAt`, `articleId` |
| `Article` | `id`, `workspaceId`, Markdown source, `revision`; heading outline is derived |
| `Node` | `id`, `workspaceId`, title, body, status, provenance |
| `Edge` | `id`, `fromId`, `toId`, `label` |
| `Anchor` | `id`, target type/ID, location, quoted-text fallback, `sourceId` if applicable |
| `Source` | `id`, `workspaceId`, type, title, local file reference or pasted text, metadata |
| `Proposal` | `id`, request, selected-context references, output type, payload, status, createdAt |
| `ArticleRevision` | `id`, articleId, applied proposal ID if any, timestamp, change summary |
| `CanvasLayout` | workspaceId, node IDs, positions and sizes, viewport, article size |

An anchor should use structural positions plus a quoted-text fallback; pure character offsets break when the article changes. If an anchor cannot be resolved after editing, mark it for repair rather than silently pointing elsewhere. Imported source bytes must never be overwritten by an AI operation.

### Provenance model

Each passage or node records one or more origins: `learner`, `ai`, or `source`. A source origin includes source ID and anchor. AI origin includes the request and proposal ID. An accepted edit may have both learner acceptance and AI origin. Visible UI can keep this subtle, but the information must be inspectable.

## AI request and change flow

The request system should support open-ended instructions. The implementation can route a request to one or more output types: answer, node, link, source lead, article edit, or a combination. The selection and nearby context are explicit inputs. The AI returns a **proposal**, not an unreviewed mutation.

For article edits, present the target passage or heading, proposed text, and diff; apply only after acceptance. For research, distinguish a lead to investigate from a verified source attachment. A model response alone does not count as proof that a paper or claim exists.

## Files, folders, and portability

Do not require learners to manage a file tree. The initial library shows workspaces and sources. Internally, use separate records and imported source files so a large PDF does not sit inside one ever-growing document. The master article's editable and portable format is Markdown (`.md`); do not offer PDF as a master article format or export. A separate portable workspace export may be added later if it proves useful. Its format is independent of the article format and internal storage model.

## Success signals

- A learner can reopen a workspace after several days and explain its main idea and next question without reading an AI transcript.
- They can trace a sourced claim to the original passage.
- They can turn one useful AI answer into a reviewed article improvement.
- They can create a graph branch from highlighted text and return to the article without losing context.
