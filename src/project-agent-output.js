const text = { type: 'string' }, integer = { type: 'integer', minimum: 0 }, number = { type: 'number' }, boolean = { type: 'boolean' };
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: true });
const array = items => ({ type: 'array', items });
const strings = array(text), cursor = { type: ['integer', 'null'], minimum: 0 };
const rect = object({ x: number, y: number, width: number, height: number }, ['x', 'y', 'width', 'height']);
const edge = object({ id: text, fromId: text, toId: text, label: { type: ['string', 'null'] }, direction: { type: 'string', enum: ['forward', 'reverse', 'both'] }, fromSide: text, toSide: text }, ['id', 'fromId', 'toId']);
const passage = object({ passageToken: text, sourceId: text, title: text, page: { type: ['integer', 'null'] }, text, start: integer, end: integer }, ['passageToken', 'sourceId', 'text']);
const artifact = object({ id: text, title: text, mimeType: text, byteLength: integer, width: integer, height: integer, provenance: object({ taskId: text, operationId: text }, ['taskId', 'operationId']) }, ['id', 'title', 'mimeType', 'byteLength']);
const fields = {
  verify_changes: { verifiedOperations: strings, mismatches: strings, checkedRecords: strings },
  get_project_index: { workspace: object({ id: text, title: text }, ['id', 'title']), article: object({ id: text, revision: integer, headings: array(object({ line: integer, text })) }, ['id', 'revision']), nodes: array(object({ id: text, title: text, parentId: { type: ['string', 'null'] }, type: text }, ['id', 'title'])), sources: array(object({ id: text, title: text, type: text, indexStatus: text }, ['id', 'title', 'type'])), edges: array(edge), nextCursor: cursor, nextSourceCursor: cursor, researchCounts: object({ questions: integer, findings: integer, comparisons: integer, closeouts: integer }) },
  read_document: { targetId: text, startLine: integer, endLine: integer, totalLines: integer, text, truncated: boolean },
  search_sources: { matches: array(passage) }, read_source_passage: passage.properties,
  search_project: { matches: array(object({ targetId: text, kind: text, excerpt: text }, ['targetId', 'excerpt'])), nextCursor: cursor },
  list_relationships: { edges: array(edge), highlights: array(object({ id: text, targetId: text, start: integer, end: integer, quote: text }, ['id', 'targetId'])), nextCursor: cursor },
  get_view: { viewRevision: text, viewport: rect, camera: object({ x: number, y: number, zoom: number }, ['x', 'y', 'zoom']), selection: strings, visibleEntities: array(object({ id: text, bounds: rect }, ['id', 'bounds'])), regions: array(object({ id: text, bounds: rect }, ['id', 'bounds'])) },
  get_save_status: { localSaved: boolean, linked: boolean, linkedSaved: boolean, projectRevision: integer, error: { type: ['string', 'null'] } },
  save_project: { localSaved: boolean, linkedSaved: boolean, cancelled: boolean, savedRevision: integer },
  set_view: { viewRevision: text }, set_node_layout: { nodeId: text }, add_highlight: { highlightId: text },
  undo: { restored: boolean }, redo: { restored: boolean }, capture_region: { artifacts: array(artifact) }, export_artifact: { exported: boolean, cancelled: boolean, artifactId: text },
  read_research: { records: array(object({ id: text, text, status: text, sourceIds: strings }, ['id'])), nextCursor: cursor },
  update_research: { recordId: text }, compare_ideas: { recordId: text }, record_closeout: { recordId: text }, rename_project: { title: text },
  create_node: { nodeId: text, operationId: text }, create_source_node: { nodeId: text }, create_edge: { edgeId: text, operationId: text }, update_edge: { edgeId: text, operationId: text },
  edit_markdown: { targetId: text, operationId: text }, replace_markdown: { targetId: text, operationId: text }, set_parent: { nodeId: text, parentId: { type: ['string', 'null'] } },
  attach_source_reference: { nodeId: text, sourceReferenceId: text }, import_source: { sourceId: text }, import_attachment: { sourceId: text },
  read_attachment: { sourceId: text, title: text, offset: integer, totalBytes: integer, encoding: { type: 'string', enum: ['base64'] }, data: text },
  export_project: { sourceId: text, fileName: text, bytes: integer, mimeType: text },
};
export function projectOutput(tool) {
  const properties = tool.startsWith('delete_') ? { deletedId: text } : fields[tool];
  if (!properties) throw new Error(`Missing output contract: ${tool}`);
  return object({ ...properties, revision: integer, verificationRequired: boolean, changes: array(object({ id: text, title: text, before: text, after: text, truncated: boolean })), moreChanges: boolean }, ['revision', ...Object.keys(properties).filter(k => !['operationId', 'parentId', 'page'].includes(k))]);
}

// Validate at the provider boundary too, so UI callers cannot bypass tool contracts.
export function validateValue(schema, value, path = 'value') {
  const invalid = message => { throw Object.assign(new Error(`${path}: ${message}`), { code: 'INVALID_ARGUMENT' }); };
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (schema.type && !types.some(type => type === actual || type === 'integer' && Number.isInteger(value))) invalid(`expected ${types.join(' or ')}`);
  if (schema.enum && !schema.enum.includes(value)) invalid('unsupported value');
  if (typeof value === 'number' && (!Number.isFinite(value) || schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum)) invalid('number is out of range');
  if (typeof value === 'string' && schema.maxLength !== undefined && value.length > schema.maxLength) invalid('text is too long');
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) invalid('too many items');
    if (schema.items) value.forEach((item, i) => validateValue(schema.items, item, `${path}[${i}]`));
  } else if (value && typeof value === 'object') {
    for (const name of schema.required || []) if (!Object.hasOwn(value, name)) invalid(`missing ${name}`);
    for (const [name, child] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(name)) invalid('unsafe property');
      if (Object.hasOwn(schema.properties || {}, name)) validateValue(schema.properties[name], child, `${path}.${name}`);
      else if (schema.additionalProperties === false) invalid(`unknown property ${name}`);
    }
  }
}
