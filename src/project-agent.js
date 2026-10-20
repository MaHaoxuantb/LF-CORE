import { WorkspaceAgentService } from './agent-service.js';
import { isSourceNode, nodeLabel, sourceNode } from './node-content.js';
import { createResearchQuestion, recordCloseout, normalizeResearch, compareIdeas } from './research.js';

const string = { type: 'string', maxLength: 100_000 };
const id = { type: 'string', maxLength: 200 };
const integer = { type: 'integer', minimum: 0 };
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const definitions = {
  verify_changes: ['Verify committed operations against current project records; return mismatches and verified operation IDs', 'read', { operationIds: { type: 'array', items: id, minItems: 1, maxItems: 100 } }, ['operationIds']],
  get_project_index: ['Read the project index', 'read', { cursor: integer, sourceCursor: integer, limit: { type: 'integer', minimum: 1, maximum: 100 } }, []],
  search_project: ['Search project documents and research records', 'read', { query: string, cursor: integer, limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['query']],
  read_document: ['Read a Markdown document', 'read', { targetId: id, startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 } }, ['targetId']],
  search_sources: ['Search imported source passages', 'read', { query: string, sourceIds: { type: 'array', items: id }, limit: { type: 'integer', minimum: 1, maximum: 20 } }, ['query']],
  read_source_passage: ['Read an imported source passage', 'read', { sourceId: id, page: integer, start: integer, end: integer }, ['sourceId']],
  create_source_node: ['Place an existing source on the canvas', 'write', { sourceId: id }, ['sourceId']],
  create_node: ['Create a Markdown node', 'write', { clientId: id, parentId: { type: ['string', 'null'] }, markdown: string, sourcePassageToken: id }, ['markdown']],
  replace_markdown: ['Replace a complete Markdown document', 'write', { targetId: id, markdown: string }, ['targetId', 'markdown']],
  edit_markdown: ['Replace an exact, unique text passage while preserving the rest', 'write', { targetId: id, before: string, after: string }, ['targetId', 'before', 'after']],
  set_parent: ['Move a node or branch', 'write', { nodeId: id, parentId: { type: ['string', 'null'] } }, ['nodeId', 'parentId']],
  create_edge: ['Connect two Markdown nodes', 'write', { fromId: id, toId: id, label: string, direction: { type: 'string', enum: ['forward', 'backward', 'both'] } }, ['fromId', 'toId']],
  update_edge: ['Edit a graph connection', 'write', { edgeId: id, fromId: id, toId: id, label: { type: ['string', 'null'] }, direction: { type: 'string', enum: ['forward', 'backward', 'both'] } }, ['edgeId']],
  delete_node: ['Delete a node; keep children by reparenting them to its parent', 'destructive', { nodeId: id }, ['nodeId']],
  delete_edge: ['Delete a graph connection', 'destructive', { edgeId: id }, ['edgeId']],
  attach_source_reference: ['Attach a passage returned by a source read/search in this task', 'write', { nodeId: id, passageToken: id }, ['nodeId', 'passageToken']],
  import_attachment: ['Import supplied attachment bytes as a source (base64, up to 750 KB)', 'write', { fileName: { type: 'string', maxLength: 255 }, mimeType: { type: 'string', maxLength: 200 }, dataBase64: { type: 'string', maxLength: 1_000_000 } }, ['fileName', 'mimeType', 'dataBase64']],
  import_source: ['Import pasted text or a web source with its supplied content; does not fetch URLs', 'write', { title: string, text: string, url: string, type: { type: 'string', enum: ['text', 'web'] } }, ['title', 'text']],
  delete_source: ['Remove a source and its project references', 'destructive', { sourceId: id }, ['sourceId']],
  read_research: ['Read paginated research records', 'read', { kind: { type: 'string', enum: ['questions', 'findings', 'comparisons', 'closeouts'] }, cursor: integer, limit: { type: 'integer', minimum: 1, maximum: 50 } }, ['kind']],
  update_research: ['Create or update a research question or finding', 'write', { kind: { type: 'string', enum: ['questions', 'findings'] }, id, text: string, status: { type: 'string', enum: ['open', 'closed'] }, sourceIds: { type: 'array', items: id } }, ['kind', 'text']],
  compare_ideas: ['Compare selected Markdown nodes and record a comparison', 'write', { nodeIds: { type: 'array', items: id, maxItems: 8 } }, ['nodeIds']],
  delete_research: ['Delete a research record', 'destructive', { kind: { type: 'string', enum: ['questions', 'findings', 'comparisons', 'closeouts'] }, id }, ['kind', 'id']],
  record_closeout: ['Record understanding and remaining open questions', 'write', { understanding: string, openQuestions: string }, ['understanding', 'openQuestions']],
  rename_project: ['Rename the project', 'write', { title: { type: 'string', maxLength: 500 } }, ['title']],
  read_attachment: ['Read a bounded attachment byte range as base64', 'read', { sourceId: id, offset: integer, length: { type: 'integer', minimum: 1, maximum: 24_000 } }, ['sourceId']],
  export_project: ['Create an export artifact for the current project and return its metadata', 'write', {}, []],
};
export function projectSession(workspace) {
  return { id: `lfcore:${workspace.id}`, projectId: workspace.id, title: workspace.title, revision: workspace.projectRevision || 0, providerId: 'com.linecoflow.lfcore' };
}
export function projectCapabilities(workspace) {
  return Object.entries(definitions).map(([tool, [description, effect, properties, required]]) => ({ id: `com.linecoflow.lfcore.${tool}`, title: description, description, effect, input: schema(properties, required), output: { type: 'object' }, available: true, cancellable: true, sessionId: projectSession(workspace).id }));
}
const error = (code, message) => Object.assign(new Error(message), { code });

// The UI and provider use the same commit path. No whole-workspace proposal is applied.
export class ProjectAgentService {
  constructor({ getWorkspace, commit, searchSources, readSource, sourceIndexStatus, readAttachment, exportProject, importAttachment, lock = async (_id, action) => action() }) {
    Object.assign(this, { getWorkspace, commit, searchSources, readSource, sourceIndexStatus, readAttachment, exportProject, importAttachment, lock });
    this.queue = Promise.resolve(); this.taskSources = new Map(); this.taskAliases = new Map();
  }
  workspace(sessionId) {
    const workspace = this.getWorkspace(sessionId);
    if (!workspace) throw error('UNAVAILABLE', 'The original project is not available.');
    return workspace;
  }
  forgetTask(taskId) { for (const key of this.taskSources.keys()) if (key.startsWith(`${taskId}:`)) { this.taskSources.delete(key); this.taskAliases.delete(key); } }
  async operationStatus({ sessionId, operationId }) {
    // A lost reply must not turn an in-flight commit into an absent receipt.
    await this.queue;
    const receipt = this.workspace(sessionId).agentReceipts?.[operationId];
    return receipt ? { status: 'committed', result: receipt.result } : { status: 'absent' };
  }
  invoke(call, { signal, reportProgress = () => {} } = {}) {
    const tool = call.capability?.replace('com.linecoflow.lfcore.', '');
    if (definitions[tool]?.[1] === 'read') return this.execute(call, signal, reportProgress);
    const run = () => this.lock(call.sessionId, () => this.execute(call, signal, reportProgress));
    const pending = this.queue.then(run); this.queue = pending.catch(() => {}); return pending;
  }
  async execute(call, signal, reportProgress) {
    if (signal?.aborted) throw error('CANCELLED', 'Project operation cancelled.');
    const prefix = 'com.linecoflow.lfcore.';
    if (!call.capability?.startsWith(prefix)) throw error('NOT_SUPPORTED', 'Unknown project capability.');
    const tool = call.capability.slice(prefix.length), definition = definitions[tool];
    if (!definition) throw error('NOT_SUPPORTED', 'Unknown project capability.');
    const workspace = this.workspace(call.sessionId), revision = workspace.projectRevision || 0;
    const mutation = definition[1] !== 'read';
    let requestFingerprint;
    if (mutation) {
      if (typeof call.operationId !== 'string' || !call.operationId || typeof call.taskId !== 'string') throw error('INVALID_ARGUMENT', 'Writes require task and operation IDs.');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ capability: call.capability, arguments: call.arguments, taskId: call.taskId })));
      requestFingerprint = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      const receipt = workspace.agentReceipts?.[call.operationId];
      if (receipt) {
        if (receipt.request !== requestFingerprint) throw error('INVALID_ARGUMENT', 'Operation ID was already used for a different request.');
        return structuredClone(receipt.result);
      }
      if (!Number.isInteger(call.expectedRevision) || call.expectedRevision !== revision || (this.workspace(call.sessionId).projectRevision || 0) !== revision) throw error('CONFLICT', `Project revision changed. Read the project again; current revision is ${revision}.`);
    }
    const service = new WorkspaceAgentService(workspace, { searchSources: this.searchSources && ((query, options) => this.searchSources(workspace, query, { ...options, signal, onProgress: ({ page, pages }) => reportProgress?.(`Indexing source · page ${page} of ${pages}`) })), readSource: this.readSource && ((sourceId, range) => this.readSource(workspace, sourceId, range, { signal, onProgress: ({ page, pages }) => reportProgress?.(`Indexing source · page ${page} of ${pages}`) })), sourceIndexStatus: this.sourceIndexStatus });
    service._endpoint = value => { const nodeId = service.aliases.get(value) || value; if (!service.draft.nodes.some(node => node.id === nodeId)) throw error('NOT_FOUND', 'Graph endpoint not found.'); return nodeId; };
    const passageKey = `${call.taskId}:${workspace.id}`;
    service.passages = new Map(this.taskSources.get(passageKey) || []);
    service.aliases = new Map(this.taskAliases.get(passageKey) || []);
    const args = { ...call.arguments };
    let result;
    if (tool === 'verify_changes') {
      const requested = new Set(args.operationIds);
      const history = (workspace.agentHistory || []).filter(entry => entry.runId === call.taskId && entry.operationIds.some(id => requested.has(id)));
      const expected = new Map();
      for (const transaction of history) for (const change of transaction.changes || []) expected.set(change.id, change.after);
      // Later changes in the same task supersede earlier versions of a record.
      for (const transaction of workspace.agentHistory || []) if (transaction.runId === call.taskId) for (const change of transaction.changes || []) if (expected.has(change.id)) expected.set(change.id, change.after);
      const actual = projectRecords(workspace);
      const mismatches = [...expected].filter(([id, value]) => JSON.stringify(actual.get(id) ?? null) !== JSON.stringify(value)).map(([id]) => id);
      const found = new Set(history.flatMap(entry => entry.operationIds));
      for (const id of requested) if (!found.has(id)) mismatches.push(`Unknown operation: ${id}`);
      result = { verifiedOperations: mismatches.length ? [] : [...requested], mismatches, checkedRecords: [...expected.keys()] };
    } else if (tool === 'get_project_index') {
      const cursor = args.cursor || 0, sourceCursor = args.sourceCursor || 0, limit = Math.min(args.limit || 50, 100);
      result = {
        workspace: { id: workspace.id, title: workspace.title },
        article: { id: 'article', revision: workspace.article.revision, headings: workspace.article.markdown.split('\n').flatMap((line, index) => /^(#{1,6})\s+(.+)/.test(line) ? [{ line: index + 1, text: line.replace(/^#+\s*/, '') }] : []).slice(0, 100) },
        nodes: workspace.nodes.slice(cursor, cursor + limit).map(node => ({ id: node.id, title: nodeLabel(node, workspace.sources), parentId: node.parentId ?? null, type: isSourceNode(node) ? 'source' : 'markdown', ...(isSourceNode(node) ? { sourceId: node.document.sourceId } : {}) })),
        nextCursor: cursor + limit < workspace.nodes.length ? cursor + limit : null,
        sources: await Promise.all(workspace.sources.slice(sourceCursor, sourceCursor + limit).map(async source => ({ id: source.id, title: source.title, type: source.type, pages: source.pages, fileName: source.fileName, byteLength: source.byteLength, indexStatus: await this.sourceIndexStatus?.(source) || 'unknown' }))),
        nextSourceCursor: sourceCursor + limit < workspace.sources.length ? sourceCursor + limit : null,
        edges: workspace.edges.filter(edge => workspace.nodes.slice(cursor, cursor + limit).some(node => node.id === edge.fromId || node.id === edge.toId)).slice(0, 200),
        researchCounts: Object.fromEntries(Object.entries(normalizeResearch(service.draft)).map(([key, records]) => [key, records.length])),
      };
    } else if (tool === 'create_source_node') {
      const source = service.draft.sources.find(entry => entry.id === args.sourceId);
      if (!source) throw error('NOT_FOUND', 'Source not found.');
      const node = sourceNode(source); node.provenance = 'ai';
      service.draft.nodes.push(node); service._record(tool, args, null, structuredClone(node), { targetId: node.id });
      result = { nodeId: node.id };
    } else if (tool === 'set_parent') {
      const nodeId = service.aliases.get(args.nodeId) || args.nodeId, parentId = service.aliases.get(args.parentId) || args.parentId;
      const node = service.draft.nodes.find(entry => entry.id === nodeId);
      if (!node || parentId && !service.draft.nodes.some(entry => entry.id === parentId)) throw error('NOT_FOUND', 'Node or parent not found.');
      const before = node.parentId; node.parentId = parentId ?? null;
      service._record(tool, args, before, node.parentId, { targetId: node.id }); result = { nodeId, parentId: node.parentId };
    } else if (tool === 'edit_markdown') {
      args.targetId = service.aliases.get(args.targetId) || args.targetId;
      const target = args.targetId === 'article' ? service.draft.article : service.draft.nodes.find(node => node.id === args.targetId)?.document;
      if (!target || typeof args.before !== 'string' || !args.before || typeof args.after !== 'string' || target.markdown.split(args.before).length !== 2) throw error('CONFLICT', 'The passage must match exactly once. Read the document again.');
      result = await service._execute('replace_markdown', { targetId: args.targetId, markdown: target.markdown.replace(args.before, () => args.after) });
    } else if (tool === 'search_project') {
      const query = String(args.query || '').toLocaleLowerCase();
      if (!query.trim()) throw error('INVALID_ARGUMENT', 'Enter search text.');
      const entries = [{ id: 'article', markdown: workspace.article.markdown }, ...workspace.nodes.filter(node => !isSourceNode(node)).map(node => ({ id: node.id, markdown: node.document.markdown })), ...['questions', 'findings', 'comparisons', 'closeouts'].flatMap(kind => (workspace.research?.[kind] || []).map(record => ({ id: record.id, markdown: JSON.stringify(record), kind })))];
      const matches = entries.filter(entry => entry.markdown.toLocaleLowerCase().includes(query));
      const cursor = args.cursor || 0, limit = Math.min(args.limit || 20, 100);
      result = { matches: matches.slice(cursor, cursor + limit).map(entry => { const start = entry.markdown.toLocaleLowerCase().indexOf(query); return { targetId: entry.id, kind: entry.kind || 'document', excerpt: entry.markdown.slice(Math.max(0, start - 100), start + 500) }; }), nextCursor: cursor + limit < matches.length ? cursor + limit : null };
    } else if (tool === 'delete_node') {
      const node = service.draft.nodes.find(item => item.id === args.nodeId);
      if (!node) throw error('NOT_FOUND', 'Node not found.');
      service.draft.nodes = service.draft.nodes.filter(item => item.id !== node.id);
      for (const child of service.draft.nodes) if (child.parentId === node.id) child.parentId = node.parentId ?? null;
      const highlights = new Set((service.draft.highlights || []).filter(highlight => highlight.targetId === node.id).map(highlight => `h:${highlight.id}`));
      service.draft.highlights = (service.draft.highlights || []).filter(highlight => highlight.targetId !== node.id);
      for (const remaining of service.draft.nodes) if (remaining.anchor?.targetId === node.id) remaining.anchor = null;
      service.draft.edges = service.draft.edges.filter(edge => edge.fromId !== node.id && edge.toId !== node.id && !highlights.has(edge.fromId) && !highlights.has(edge.toId));
      delete service.draft.layout?.positions?.[node.id]; delete service.draft.layout?.sizes?.[node.id];
      result = { deletedId: node.id };
    } else if (tool === 'delete_edge') {
      if (!service.draft.edges.some(edge => edge.id === args.edgeId)) throw error('NOT_FOUND', 'Edge not found.');
      service.draft.edges = service.draft.edges.filter(edge => edge.id !== args.edgeId); result = { deletedId: args.edgeId };
    } else if (tool === 'rename_project') {
      if (!String(args.title || '').trim()) throw error('INVALID_ARGUMENT', 'Project title cannot be empty.');
      service.draft.title = args.title.trim(); result = { title: service.draft.title };
    } else if (tool === 'import_attachment') {
      if (typeof args.fileName !== 'string' || !args.fileName.trim() || typeof args.dataBase64 !== 'string' || args.dataBase64.length > 1_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(args.dataBase64)) throw error('INVALID_ARGUMENT', 'Invalid attachment data.');
      if (!this.importAttachment) throw error('UNAVAILABLE', 'Attachment import is unavailable.');
      const source = await this.importAttachment(args);
      source.provenance = 'ai'; service.draft.sources.push(source); result = { sourceId: source.id };
    } else if (tool === 'import_source') {
      if (!String(args.text || '').trim() || !String(args.title || '').trim()) throw error('INVALID_ARGUMENT', 'Source title and content are required.');
      if (args.type === 'web' && !/^https?:\/\//i.test(args.url || '')) throw error('INVALID_ARGUMENT', 'A web source needs an HTTP(S) URL.');
      const source = { id: crypto.randomUUID(), type: args.type || 'text', title: args.title, text: args.text, ...(args.url ? { url: args.url } : {}), addedAt: new Date().toISOString(), provenance: 'ai' };
      service.draft.sources.push(source); result = { sourceId: source.id };
    } else if (tool === 'delete_source') {
      if (!service.draft.sources.some(source => source.id === args.sourceId)) throw error('NOT_FOUND', 'Source not found.');
      const removedNodes = new Set(service.draft.nodes.filter(node => node.document?.sourceId === args.sourceId).map(node => node.id));
      service.draft.sources = service.draft.sources.filter(source => source.id !== args.sourceId);
      service.draft.nodes = service.draft.nodes.filter(node => !removedNodes.has(node.id));
      for (const node of service.draft.nodes) { node.sourceRefs = (node.sourceRefs || []).filter(ref => ref.sourceId !== args.sourceId); if (removedNodes.has(node.parentId)) node.parentId = null; }
      const removedHighlights = new Set((service.draft.highlights || []).filter(highlight => removedNodes.has(highlight.targetId)).map(highlight => `h:${highlight.id}`));
      service.draft.highlights = (service.draft.highlights || []).filter(highlight => !removedNodes.has(highlight.targetId));
      for (const node of service.draft.nodes) if (removedNodes.has(node.anchor?.targetId)) node.anchor = null;
      for (const nodeId of removedNodes) { delete service.draft.layout?.positions?.[nodeId]; delete service.draft.layout?.sizes?.[nodeId]; }
      service.draft.edges = service.draft.edges.filter(edge => !removedNodes.has(edge.fromId) && !removedNodes.has(edge.toId) && !removedHighlights.has(edge.fromId) && !removedHighlights.has(edge.toId));
      for (const records of Object.values(normalizeResearch(service.draft))) for (const record of records) if (record.sourceIds) record.sourceIds = record.sourceIds.filter(sourceId => sourceId !== args.sourceId);
      // Keep bytes in the existing attachment store so Undo can restore the source.
      result = { deletedId: args.sourceId };
    } else if (tool === 'read_research') {
      const records = normalizeResearch(service.draft)[args.kind];
      if (!Array.isArray(records)) throw error('INVALID_ARGUMENT', 'Unknown research collection.');
      const cursor = args.cursor || 0, limit = Math.min(args.limit || 20, 50);
      result = { records: records.slice(cursor, cursor + limit), nextCursor: cursor + limit < records.length ? cursor + limit : null };
    } else if (tool === 'update_research') {
      if (!['questions', 'findings'].includes(args.kind) || !String(args.text || '').trim()) throw error('INVALID_ARGUMENT', 'A research question or finding needs text.');
      for (const sourceId of args.sourceIds || []) if (!service.draft.sources.some(source => source.id === sourceId)) throw error('NOT_FOUND', 'Research source does not exist.');
      const records = normalizeResearch(service.draft)[args.kind];
      let record = args.id && records.find(item => item.id === args.id);
      if (args.id && !record) throw error('NOT_FOUND', 'Research record not found.');
      if (!record) { record = args.kind === 'questions' ? createResearchQuestion(args.text) : { id: crypto.randomUUID(), createdAt: new Date().toISOString() }; records.push(record); }
      Object.assign(record, { text: args.text, updatedAt: new Date().toISOString(), ...(args.status ? { status: args.status } : {}), ...(args.sourceIds ? { sourceIds: args.sourceIds } : {}) });
      result = { recordId: record.id };
    } else if (tool === 'compare_ideas') {
      const nodes = [...new Set(args.nodeIds)].map(nodeId => service.draft.nodes.find(node => node.id === nodeId && !isSourceNode(node)));
      if (nodes.some(node => !node)) throw error('NOT_FOUND', 'A selected Markdown node is unavailable.');
      const record = compareIdeas(nodes.map(node => ({ id: node.id, title: nodeLabel(node), text: node.document.markdown })));
      normalizeResearch(service.draft).comparisons.push(record); result = { recordId: record.id };
    } else if (tool === 'delete_research') {
      const research = normalizeResearch(service.draft);
      if (!Array.isArray(research[args.kind]) || !research[args.kind].some(record => record.id === args.id)) throw error('NOT_FOUND', 'Research record not found.');
      research[args.kind] = research[args.kind].filter(record => record.id !== args.id); result = { deletedId: args.id };
    } else if (tool === 'record_closeout') {
      const record = recordCloseout(args); normalizeResearch(service.draft).closeouts.push(record); result = { recordId: record.id };
    } else if (tool === 'read_attachment') result = await this.readAttachment(workspace, args);
    else if (tool === 'export_project') {
      result = await this.exportProject(workspace, call);
      (service.draft.agentArtifacts ||= []).push({ id: result.sourceId, type: 'file', title: result.fileName, fileName: result.fileName, mimeType: result.mimeType, byteLength: result.bytes, addedAt: new Date().toISOString(), provenance: 'ai' });
    }
    else result = await service._execute(tool, args);
    if (signal?.aborted) throw error('CANCELLED', 'Project operation cancelled before commit.');
    this.taskSources.set(passageKey, new Map([...(this.taskSources.get(passageKey) || []), ...service.passages]));
    if (!mutation) return { ...result, revision };
    // Async source reads/export preparation may have allowed a user edit.
    if ((this.workspace(call.sessionId).projectRevision || 0) !== revision) throw error('CONFLICT', 'Project changed while the operation was being prepared.');
    validateProject(service.draft);
    const next = service.draft;
    next.projectRevision = revision + 1; next.updatedAt = new Date().toISOString();
    if (next.article.markdown !== workspace.article.markdown) next.article.revision = (workspace.article.revision || 0) + 1;
    result = { ...result, revision: next.projectRevision, verificationRequired: true };
    const origin = { kind: 'agent', runId: call.taskId, operationIds: [call.operationId], acceptedAt: next.updatedAt };
    if (result.sourceId) { const source = next.sources.find(entry => entry.id === result.sourceId); if (source) (source.origins ||= []).push(origin); }
    if (result.recordId) for (const records of Object.values(next.research || {})) { const record = records.find(entry => entry.id === result.recordId); if (record) (record.origins ||= []).push(origin); }
    for (const operation of service.operations) {
      const target = operation.targetId === 'article' ? next.article : next.nodes.find(node => node.id === operation.targetId) || next.edges.find(edge => edge.id === operation.targetId);
      if (target) (target.origins ||= []).push(origin);
    }
    for (const node of next.nodes) for (const reference of node.sourceRefs || []) if (reference.agentRunId === null) reference.agentRunId = call.taskId;
    const changes = projectChanges(workspace, next);
    (next.agentHistory ||= []).push({ ...origin, tool, before: mutationSummary(workspace), after: mutationSummary(next), changes });
    result.changes = changes.slice(0, 10).map(change => {
      const text = record => record == null ? '' : record.document?.markdown ?? record.markdown ?? JSON.stringify(record, null, 2);
      const before = text(change.before), after = text(change.after);
      return { id: change.id, title: change.after?.title || change.before?.title || change.id, before: before.slice(0, 1500), after: after.slice(0, 1500), truncated: before.length > 1500 || after.length > 1500 };
    });
    result.moreChanges = changes.length > 10;

    (next.agentReceipts ||= {})[call.operationId] = { request: requestFingerprint, result };
    await this.commit(workspace, next, call);
    this.taskAliases.set(passageKey, service.aliases);
    return result;
  }
}
function projectRecords(project) {
  return new Map([
    ['article', project.article], ['project', { title: project.title }],
    ...['nodes', 'edges', 'sources'].flatMap(kind => project[kind].map(record => [`${kind}:${record.id}`, record])),
    ...Object.entries(project.research || {}).flatMap(([kind, records]) => records.map(record => [`research:${kind}:${record.id}`, record])),
  ]);
}
export function projectChanges(before, after) {
  const previous = projectRecords(before), next = projectRecords(after);
  return [...new Set([...previous.keys(), ...next.keys()])].flatMap(id => {
    const old = previous.get(id), value = next.get(id);
    if (JSON.stringify(old) === JSON.stringify(value)) return [];
    return [{ id, before: old ? structuredClone(old) : null, after: value ? structuredClone(value) : null }];
  });
}
function mutationSummary(workspace) { return { revision: workspace.projectRevision || 0, title: workspace.title, nodes: workspace.nodes.length, edges: workspace.edges.length, sources: workspace.sources.length }; }
export function validateProject(workspace) {
  const ids = new Set(workspace.nodes.map(node => node.id));
  if (ids.size !== workspace.nodes.length) throw error('INVALID_ARGUMENT', 'Duplicate node IDs.');
  const sourceIds = new Set(workspace.sources.map(source => source.id));
  for (const node of workspace.nodes) {
    for (const ref of node.sourceRefs || []) if (!sourceIds.has(ref.sourceId)) throw error('INVALID_ARGUMENT', 'A source reference points to a missing source.');
    const parents = new Set([node.id]); let cursor = node.parentId;
    while (cursor) {
      if (!ids.has(cursor) || parents.has(cursor)) throw error('INVALID_ARGUMENT', 'Invalid parent relationship or cycle.');
      parents.add(cursor); cursor = workspace.nodes.find(item => item.id === cursor)?.parentId;
    }
  }
  const highlights = new Set((workspace.highlights || []).map(highlight => `h:${highlight.id}`));
  for (const edge of workspace.edges) if (![edge.fromId, edge.toId].every(endpoint => ids.has(endpoint) || highlights.has(endpoint))) throw error('INVALID_ARGUMENT', 'An edge references a missing node.');
}


export async function readAgentAttachment(workspace, { sourceId, offset = 0, length = 24_000 }, { getPdf, getMedia }) {
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length < 1 || length > 24_000) throw error('INVALID_ARGUMENT', 'Attachment ranges require a non-negative offset and length from 1 to 24000.');
  const source = [...workspace.sources, ...(workspace.agentArtifacts || [])].find(entry => entry.id === sourceId);
  if (!source || !['pdf', 'image', 'video', 'file'].includes(source.type)) throw error('NOT_FOUND', 'Attachment not found.');
  const stored = await (source.type === 'pdf' ? getPdf(sourceId) : getMedia(sourceId));
  if (stored == null) throw error('NOT_FOUND', 'Attachment bytes are unavailable. Restore or import the original file.');
  let bytes;
  if (stored instanceof Blob) bytes = new Uint8Array(await stored.arrayBuffer());
  else if (stored instanceof ArrayBuffer) bytes = new Uint8Array(stored);
  else if (ArrayBuffer.isView(stored)) bytes = new Uint8Array(stored.buffer, stored.byteOffset, stored.byteLength);
  else throw error('STORAGE', 'Attachment bytes could not be read.');
  return { sourceId, title: source.title, offset, totalBytes: bytes.length, encoding: 'base64', data: btoa(String.fromCharCode(...bytes.subarray(offset, offset + length))) };
}
