import { isSourceNode, nodeLabel } from './node-content.js';

export const AGENT_LIMITS = Object.freeze({
  maxTurns: 6,
  maxCallsPerTurn: 8,
  maxMutations: 24,
  maxCreatedNodes: 12,
  maxMarkdownChars: 100_000,
  maxContextChars: 40_000,
  maxReadChars: 12_000
});

const READ_TOOLS = new Set(['get_project_index', 'read_document', 'search_sources', 'read_source_passage']);
const MUTATION_TOOLS = new Set(['create_node', 'replace_markdown', 'set_parent', 'create_edge', 'update_edge', 'attach_source_reference']);
export const AGENT_TOOLS = Object.freeze([...READ_TOOLS, ...MUTATION_TOOLS]);

function object(value, message = 'Tool arguments must be an object.') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value;
}

function boundedInteger(value, fallback, min, max) {
  const number = value == null ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`Expected an integer from ${min} to ${max}.`);
  return number;
}

function markdownHeadings(markdown) {
  return String(markdown || '').split('\n').flatMap((line, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    return match ? [{ level: match[1].length, text: match[2], line: index + 1 }] : [];
  });
}

function safeLabel(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 200) throw new Error('Edge labels must be at most 200 characters.');
  return value;
}

function direction(value) {
  const result = value || 'forward';
  if (!['forward', 'backward', 'both'].includes(result)) throw new Error('Edge direction must be forward, backward, or both.');
  return result;
}

export function parseAgentResponse(raw) {
  let parsed;
  try { parsed = JSON.parse(String(raw).replace(/^```(?:json)?\s*|\s*```$/g, '').trim()); }
  catch { throw new Error('The model returned an invalid agent response.'); }
  if (!parsed || !['continue', 'ready'].includes(parsed.status) || typeof parsed.message !== 'string' || !Array.isArray(parsed.calls)) {
    throw new Error('The model returned an invalid agent response.');
  }
  if (parsed.calls.length > AGENT_LIMITS.maxCallsPerTurn) throw new Error(`The model requested more than ${AGENT_LIMITS.maxCallsPerTurn} tools at once.`);
  const ids = new Set();
  const calls = parsed.calls.map((call) => {
    object(call, 'Every agent call must be an object.');
    if (typeof call.id !== 'string' || !call.id.trim() || ids.has(call.id)) throw new Error('Agent call IDs must be unique non-empty strings.');
    if (!AGENT_TOOLS.includes(call.tool)) throw new Error(`Unsupported agent tool: ${String(call.tool)}.`);
    ids.add(call.id);
    return { id: call.id, tool: call.tool, args: object(call.args || {}) };
  });
  if (parsed.status === 'ready' && calls.length) throw new Error('A ready agent response cannot request more tools.');
  return { status: parsed.status, message: parsed.message.trim(), calls };
}

export class WorkspaceAgentService {
  constructor(workspace, {
    uuid = () => crypto.randomUUID(),
    now = () => new Date().toISOString(),
    searchSources = async () => [],
    readSource = async () => null,
    sourceIndexStatus = async (source) => source.type === 'text' ? 'ready' : 'unknown',
    selectionAnchor = null
  } = {}) {
    this.base = structuredClone(workspace);
    this.draft = structuredClone(workspace);
    this.baseUpdatedAt = workspace.updatedAt;
    this.uuid = uuid;
    this.now = now;
    this.searchSources = searchSources;
    this.readSource = readSource;
    this.sourceIndexStatus = sourceIndexStatus;
    this.selectionAnchor = selectionAnchor ? structuredClone(selectionAnchor) : null;
    this.aliases = new Map();
    this.passages = new Map();
    this.operations = [];
    this.mutationCount = 0;
    this.createdNodeCount = 0;
  }

  _fork() {
    const fork = Object.create(WorkspaceAgentService.prototype);
    Object.assign(fork, this, {
      draft: structuredClone(this.draft),
      aliases: new Map(this.aliases),
      passages: new Map(this.passages),
      operations: structuredClone(this.operations)
    });
    return fork;
  }

  _commit(fork) {
    this.draft = fork.draft;
    this.aliases = fork.aliases;
    this.passages = fork.passages;
    this.operations = fork.operations;
    this.mutationCount = fork.mutationCount;
    this.createdNodeCount = fork.createdNodeCount;
  }

  _nodeId(value, { optional = false } = {}) {
    if (value == null && optional) return null;
    const id = this.aliases.get(value) || value;
    const node = this.draft.nodes.find((entry) => entry.id === id && !isSourceNode(entry));
    if (!node) throw new Error(`Markdown node not found: ${String(value)}.`);
    return id;
  }

  _endpoint(value) { return this._nodeId(value); }

  _sourceReference(token) {
    const passage = this.passages.get(token);
    if (!passage) throw new Error('The source passage token was not issued by this agent run.');
    const text = passage.fullText || passage.text;
    const start = passage.start ?? 0;
    const end = passage.end ?? text.length;
    const quote = text.slice(start, end);
    if (!quote.trim()) throw new Error('The source passage is empty.');
    return {
      id: this.uuid(), sourceId: passage.sourceId, page: passage.page ?? null,
      anchor: {
        id: this.uuid(), targetId: passage.sourceId, start, end, quote,
        prefix: text.slice(Math.max(0, start - 40), start), suffix: text.slice(end, end + 40)
      },
      agentRunId: null
    };
  }

  _record(tool, args, before, after, ids = {}) {
    const operation = { id: this.uuid(), tool, args: structuredClone(args), before, after, ...ids };
    this.operations.push(operation);
    this.mutationCount++;
    return operation;
  }

  async executeCalls(calls) {
    if (!Array.isArray(calls) || calls.length > AGENT_LIMITS.maxCallsPerTurn) throw new Error('Invalid agent call batch.');
    const ids = new Set();
    for (const call of calls) {
      if (!call || typeof call.id !== 'string' || ids.has(call.id) || !AGENT_TOOLS.includes(call.tool)) throw new Error('Invalid agent call batch.');
      ids.add(call.id); object(call.args || {});
    }
    const fork = this._fork();
    const results = [];
    for (const call of calls) {
      try { results.push({ callId: call.id, ok: true, result: await fork._execute(call.tool, call.args || {}) }); }
      catch (error) { throw new Error(`${call.tool}: ${error.message}`); }
    }
    this._commit(fork);
    return results;
  }

  async _execute(tool, args) {
    if (MUTATION_TOOLS.has(tool) && this.mutationCount >= AGENT_LIMITS.maxMutations) throw new Error('The agent mutation limit was reached.');
    if (tool === 'get_project_index') {
      const cursor = boundedInteger(args.cursor, 0, 0, Math.max(0, this.draft.nodes.length));
      const limit = boundedInteger(args.limit, 50, 1, 100);
      const markdownNodes = this.draft.nodes.filter((node) => !isSourceNode(node));
      const nodes = markdownNodes.slice(cursor, cursor + limit).map((node) => ({
        id: node.id, title: nodeLabel(node, this.draft.sources), parentId: node.parentId ?? null,
        sourceReferenceCount: node.sourceRefs?.length || 0
      }));
      const pageIds = new Set(nodes.map((node) => node.id));
      const allEdges = this.draft.edges || [];
      return {
        workspace: { id: this.draft.id, title: this.draft.title, updatedAt: this.draft.updatedAt },
        article: { id: 'article', revision: this.draft.article.revision, headings: markdownHeadings(this.draft.article.markdown) },
        nodes, nextCursor: cursor + limit < markdownNodes.length ? cursor + limit : null,
        edgeCount: allEdges.length,
        edges: allEdges.filter((edge) => pageIds.has(edge.fromId) || pageIds.has(edge.toId)).slice(0, 200)
          .map(({ id, fromId, toId, label, direction, structural }) => ({ id, fromId, toId, label: label ?? null, direction: direction || 'forward', structural: !!structural })),
        sources: await Promise.all((this.draft.sources || []).map(async ({ id, type, title, pages, checksum, ...source }) => ({
          id, type, title, pages: pages ?? null, checksum: checksum ?? null,
          indexStatus: await this.sourceIndexStatus({ id, type, title, pages, checksum, ...source })
        })))
      };
    }
    if (tool === 'read_document') {
      const targetId = args.targetId === 'article' ? 'article' : this._nodeId(args.targetId);
      const markdown = targetId === 'article' ? this.draft.article.markdown : this.draft.nodes.find((node) => node.id === targetId).document.markdown;
      const lines = markdown.split('\n');
      const startLine = boundedInteger(args.startLine, 1, 1, Math.max(1, lines.length));
      const endLine = boundedInteger(args.endLine, Math.min(lines.length, startLine + 199), startLine, lines.length);
      let text = lines.slice(startLine - 1, endLine).map((line, index) => `${startLine + index}: ${line}`).join('\n');
      const truncated = text.length > AGENT_LIMITS.maxReadChars;
      if (truncated) text = text.slice(0, AGENT_LIMITS.maxReadChars);
      return { targetId, startLine, endLine, totalLines: lines.length, text, truncated };
    }
    if (tool === 'search_sources') {
      if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 500) throw new Error('Source search needs a query of at most 500 characters.');
      const limit = boundedInteger(args.limit, 8, 1, 20);
      const matches = await this.searchSources(args.query.trim(), { sourceIds: args.sourceIds, limit });
      return { matches: matches.slice(0, limit).map((match) => this._issuePassage(match)) };
    }
    if (tool === 'read_source_passage') {
      if (typeof args.sourceId !== 'string') throw new Error('A source ID is required.');
      const passage = await this.readSource(args.sourceId, { page: args.page, start: args.start, end: args.end });
      if (!passage) throw new Error('The requested source passage is unavailable.');
      return this._issuePassage(passage);
    }
    if (tool === 'create_node') {
      if (this.createdNodeCount >= AGENT_LIMITS.maxCreatedNodes) throw new Error('The created-node limit was reached.');
      if (typeof args.markdown !== 'string' || !args.markdown.trim() || args.markdown.length > AGENT_LIMITS.maxMarkdownChars) throw new Error('Node Markdown is empty or too large.');
      if (args.clientId != null && (typeof args.clientId !== 'string' || !args.clientId.trim() || this.aliases.has(args.clientId))) throw new Error('clientId must be a unique non-empty string.');
      const parentId = this._nodeId(args.parentId, { optional: true });
      const id = this.uuid();
      const sourceRefs = args.sourcePassageToken ? [this._sourceReference(args.sourcePassageToken)] : [];
      const anchor = args.anchorSelection && this.selectionAnchor ? structuredClone(this.selectionAnchor) : null;
      const node = { id, parentId, document: { type: 'markdown', markdown: args.markdown }, anchor, sourceRefs, collapsed: false, provenance: 'ai', origins: [] };
      this.draft.nodes.push(node);
      if (args.clientId) this.aliases.set(args.clientId, id);
      this.createdNodeCount++;
      const operation = this._record(tool, args, null, structuredClone(node), { targetId: id });
      return { nodeId: id, operationId: operation.id };
    }
    if (tool === 'replace_markdown') {
      if (typeof args.markdown !== 'string' || !args.markdown.trim() || args.markdown.length > AGENT_LIMITS.maxMarkdownChars) throw new Error('Replacement Markdown is empty or too large.');
      const targetId = args.targetId === 'article' ? 'article' : this._nodeId(args.targetId);
      const target = targetId === 'article' ? this.draft.article : this.draft.nodes.find((node) => node.id === targetId).document;
      const before = target.markdown;
      target.markdown = args.markdown;
      const operation = this._record(tool, args, before, args.markdown, { targetId });
      return { targetId, operationId: operation.id };
    }
    if (tool === 'set_parent') {
      const nodeId = this._nodeId(args.nodeId), parentId = this._nodeId(args.parentId, { optional: true });
      if (nodeId === parentId) throw new Error('A node cannot be its own parent.');
      let cursor = parentId;
      while (cursor) {
        if (cursor === nodeId) throw new Error('Parent change would create a cycle.');
        cursor = this.draft.nodes.find((node) => node.id === cursor)?.parentId ?? null;
      }
      const node = this.draft.nodes.find((entry) => entry.id === nodeId);
      const before = node.parentId ?? null; node.parentId = parentId;
      const operation = this._record(tool, args, before, parentId, { targetId: nodeId });
      return { nodeId, parentId, operationId: operation.id };
    }
    if (tool === 'create_edge') {
      const fromId = this._endpoint(args.fromId), toId = this._endpoint(args.toId);
      if (fromId === toId) throw new Error('An edge cannot connect a node to itself.');
      if ((this.draft.edges || []).some((edge) => edge.fromId === fromId && edge.toId === toId || edge.fromId === toId && edge.toId === fromId)) throw new Error('Those nodes are already connected.');
      const edge = { id: this.uuid(), fromId, toId, label: safeLabel(args.label), direction: direction(args.direction), provenance: 'ai', origins: [] };
      (this.draft.edges ||= []).push(edge);
      const operation = this._record(tool, args, null, structuredClone(edge), { targetId: edge.id });
      return { edgeId: edge.id, operationId: operation.id };
    }
    if (tool === 'update_edge') {
      const edge = (this.draft.edges || []).find((entry) => entry.id === args.edgeId);
      if (!edge) throw new Error('Edge not found.');
      const before = structuredClone(edge);
      const fromId = args.fromId == null ? edge.fromId : this._endpoint(args.fromId);
      const toId = args.toId == null ? edge.toId : this._endpoint(args.toId);
      if (fromId === toId) throw new Error('An edge cannot connect a node to itself.');
      if (this.draft.edges.some((entry) => entry.id !== edge.id && (entry.fromId === fromId && entry.toId === toId || entry.fromId === toId && entry.toId === fromId))) throw new Error('Those nodes are already connected.');
      Object.assign(edge, { fromId, toId });
      if ('label' in args) edge.label = safeLabel(args.label);
      if ('direction' in args) edge.direction = direction(args.direction);
      const operation = this._record(tool, args, before, structuredClone(edge), { targetId: edge.id });
      return { edgeId: edge.id, operationId: operation.id };
    }
    if (tool === 'attach_source_reference') {
      const nodeId = this._nodeId(args.nodeId), reference = this._sourceReference(args.passageToken);
      const node = this.draft.nodes.find((entry) => entry.id === nodeId);
      (node.sourceRefs ||= []).push(reference);
      const operation = this._record(tool, args, null, structuredClone(reference), { targetId: nodeId });
      return { nodeId, sourceReferenceId: reference.id, operationId: operation.id };
    }
    throw new Error(`Unsupported agent tool: ${tool}.`);
  }

  _issuePassage(match) {
    object(match, 'Source search returned an invalid passage.');
    if (typeof match.sourceId !== 'string' || typeof match.text !== 'string' || !match.text.trim()) throw new Error('Source search returned an invalid passage.');
    const fullText = typeof match.fullText === 'string' ? match.fullText : match.text;
    const start = Number.isInteger(match.start) ? match.start : Math.max(0, fullText.indexOf(match.text));
    const end = Number.isInteger(match.end) ? match.end : start + match.text.length;
    const token = this.uuid();
    const stored = { ...match, fullText, start, end };
    this.passages.set(token, stored);
    return { passageToken: token, sourceId: match.sourceId, title: match.title || 'Untitled source', page: match.page ?? null, text: fullText.slice(start, end), start, end };
  }

  proposal(message = '', status = 'ready') {
    return {
      id: this.uuid(), kind: 'agent', status: 'proposed', runStatus: status,
      message, baseUpdatedAt: this.baseUpdatedAt, operations: structuredClone(this.operations),
      before: structuredClone(this.base), after: structuredClone(this.draft), createdAt: this.now()
    };
  }
}

export function applyAgentProposal(workspace, proposal, { runId = proposal.id, acceptedAt = new Date().toISOString() } = {}) {
  if (!proposal || proposal.kind !== 'agent' || proposal.status !== 'proposed') throw new Error('This agent proposal is not available to apply.');
  if (workspace.updatedAt !== proposal.baseUpdatedAt) throw new Error('The workspace changed after this agent run. Rerun it on the current workspace.');
  const next = structuredClone(proposal.after);
  const operationIds = new Set(proposal.operations.map((operation) => operation.id));
  for (const node of next.nodes || []) {
    const touched = proposal.operations.some((operation) => operation.targetId === node.id || operation.after?.id === node.id);
    if (touched) (node.origins ||= []).push({ kind: 'agent', runId, operationIds: [...operationIds], acceptedAt });
    for (const reference of node.sourceRefs || []) if (reference.agentRunId === null) reference.agentRunId = runId;
  }
  for (const edge of next.edges || []) {
    if (proposal.operations.some((operation) => operation.targetId === edge.id || operation.after?.id === edge.id)) {
      (edge.origins ||= []).push({ kind: 'agent', runId, operationIds: [...operationIds], acceptedAt });
    }
  }
  if (proposal.operations.some((operation) => operation.targetId === 'article')) {
    (next.article.origins ||= []).push({ kind: 'agent', runId, operationIds: [...operationIds], acceptedAt });
    next.article.revision = (workspace.article.revision || 0) + 1;
  }
  next.updatedAt = acceptedAt;
  return next;
}
