const STOP_WORDS = new Set('about after again against also among because been before being between both could does doing during each from further have having into itself more most other over same should some such than that their theirs them themselves then there these they this those through under very what when where which while will with would your'.split(' '));
const NEGATIONS = /\b(?:no|not|never|neither|cannot|can't|without|fails?|false|unlikely|decrease[sd]?|lower)\b/i;

export function normalizeResearch(workspace) {
  workspace.research ||= {};
  workspace.research.questions ||= [];
  workspace.research.findings ||= [];
  workspace.research.comparisons ||= [];
  workspace.research.closeouts ||= [];
  return workspace.research;
}

export function createResearchQuestion(text, context = {}, now = new Date().toISOString(), uuid = () => crypto.randomUUID()) {
  const question = String(text || '').trim();
  if (!question) throw new Error('Enter a research question.');
  return {
    id: uuid(), text: question.slice(0, 2_000), status: 'open',
    context: { targetIds: [...new Set(context.targetIds || [])], quote: String(context.quote || '').slice(0, 4_000) },
    sourceIds: [], createdAt: now, updatedAt: now
  };
}

function authorNames(authorships = []) {
  return authorships.map((entry) => entry?.author?.display_name).filter(Boolean).slice(0, 12);
}

export function parseOpenAlexResults(payload) {
  if (!payload || !Array.isArray(payload.results)) throw new Error('The discovery service returned an invalid response.');
  return payload.results.map((work) => {
    const location = work.primary_location || {};
    const url = work.doi || location.landing_page_url || work.id;
    if (!work.id || !work.display_name || !url) return null;
    return {
      providerId: work.id, title: work.display_name, url,
      authors: authorNames(work.authorships), publishedAt: work.publication_date || (work.publication_year ? String(work.publication_year) : ''),
      venue: location.source?.display_name || '', type: work.type || 'work', citedByCount: Number(work.cited_by_count) || 0,
      openAccessUrl: location.pdf_url || work.best_oa_location?.pdf_url || ''
    };
  }).filter(Boolean);
}

export async function discoverSources(query, { fetcher = fetch, signal } = {}) {
  const text = String(query || '').trim();
  if (!text) throw new Error('Enter a question or search terms.');
  const url = new URL('https://api.openalex.org/works');
  url.searchParams.set('search', text.slice(0, 500));
  url.searchParams.set('per-page', '8');
  url.searchParams.set('select', 'id,display_name,doi,publication_date,publication_year,type,authorships,primary_location,best_oa_location,cited_by_count');
  let response;
  try { response = await fetcher(url.toString(), { signal, headers: { Accept: 'application/json' } }); }
  catch (error) {
    if (error.name === 'AbortError') throw new Error('Source discovery was canceled.');
    throw new Error('Could not reach the source discovery service. Check the network and try again.');
  }
  if (!response.ok) throw new Error(`Source discovery failed (HTTP ${response.status}).`);
  return parseOpenAlexResults(await response.json());
}

export function verifiedSourceFromResult(result, now = new Date().toISOString(), uuid = () => crypto.randomUUID()) {
  if (!result?.providerId || !result?.title || !/^https?:\/\//i.test(result.url || '')) throw new Error('This result cannot be verified or attached.');
  return {
    id: uuid(), type: 'web', title: result.title, url: result.url, authors: result.authors || [],
    publishedAt: result.publishedAt || '', venue: result.venue || '', sourceType: result.type || 'work',
    citedByCount: Number(result.citedByCount) || 0, openAccessUrl: result.openAccessUrl || '',
    discovery: { provider: 'OpenAlex', providerId: result.providerId, verifiedAt: now },
    addedAt: now
  };
}

export function attachSourceToQuestion(workspace, questionId, source) {
  const research = normalizeResearch(workspace);
  const question = research.questions.find((entry) => entry.id === questionId);
  if (!question) throw new Error('The research question no longer exists.');
  const existing = (workspace.sources ||= []).find((entry) => entry.id === source.id
    || (source.discovery?.providerId && entry.discovery?.providerId === source.discovery.providerId));
  const attached = existing || source;
  if (!existing) workspace.sources.push(attached);
  if (!question.sourceIds.includes(attached.id)) question.sourceIds.push(attached.id);
  question.updatedAt = new Date().toISOString();
  return attached;
}

function keywords(text) {
  return new Set(String(text || '').toLowerCase().match(/[a-z][a-z-]{3,}/g)?.filter((word) => !STOP_WORDS.has(word)) || []);
}

function excerpt(text, length = 240) {
  const clean = String(text || '').replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim();
  return clean.length > length ? `${clean.slice(0, length - 1).trimEnd()}…` : clean;
}

export function compareIdeas(ideas, now = new Date().toISOString(), uuid = () => crypto.randomUUID()) {
  if (!Array.isArray(ideas) || ideas.length < 2) throw new Error('Select at least two ideas to compare.');
  const normalized = ideas.slice(0, 8).map((idea) => ({ id: idea.id, title: idea.title || idea.id, text: String(idea.text || '') }));
  const shared = [...keywords(normalized[0].text)].filter((word) => normalized.slice(1).some((idea) => keywords(idea.text).has(word))).slice(0, 12);
  const polarities = normalized.map((idea) => NEGATIONS.test(idea.text));
  const possibleContradiction = shared.length > 0 && new Set(polarities).size > 1;
  return {
    id: uuid(), ideaIds: normalized.map((idea) => idea.id), createdAt: now, sharedTerms: shared,
    possibleContradictions: possibleContradiction ? [{
      kind: 'polarity', terms: shared.slice(0, 6),
      note: `Possible contradiction: the selected ideas use different positive/negative wording around ${shared.slice(0, 3).join(', ')}. Review the original wording and sources.`
    }] : [],
    markdown: [
      '## Compared ideas',
      ...normalized.map((idea) => `### ${idea.title}\n\n${excerpt(idea.text) || '_No content_'}`),
      '### Synthesis',
      shared.length ? `The ideas overlap around ${shared.slice(0, 6).join(', ')}. Their relationship still needs learner review.` : 'The ideas use little shared terminology. Their relationship still needs learner review.',
      ...(possibleContradiction ? [`> ${`Possible contradiction: the wording differs in polarity around ${shared.slice(0, 3).join(', ')}. This flag is a prompt to inspect the sources, not a conclusion.`}`] : [])
    ].join('\n\n')
  };
}

export function createResearchProposal(workspace, { text, questionId = null, sourceIds = [], comparisonId = null, title = 'Research consolidation' }, now = new Date().toISOString(), uuid = () => crypto.randomUUID()) {
  const finding = String(text || '').trim();
  if (!finding) throw new Error('Write a finding or synthesis to review.');
  const before = workspace.article.markdown;
  const heading = String(title || 'Research consolidation').replace(/[\r\n#]+/g, ' ').trim();
  const section = /^#{1,6}\s/m.test(finding) ? finding : `## ${heading}\n\n${finding}`;
  const after = `${before.trimEnd()}\n\n${section}\n`;
  return {
    id: uuid(), kind: 'article-edit', status: 'proposed', targetId: 'article', before, after, text: finding,
    questionId, sourceIds: [...new Set(sourceIds)], comparisonId, createdAt: now
  };
}

export function recordCloseout({ understanding, openQuestions }, now = new Date().toISOString(), uuid = () => crypto.randomUUID()) {
  const summary = String(understanding || '').trim();
  const questions = String(openQuestions || '').split(/\n+/).map((line) => line.replace(/^[-*]\s*/, '').trim()).filter(Boolean);
  if (!summary && !questions.length) throw new Error('Record an understanding or an open question.');
  return { id: uuid(), understanding: summary.slice(0, 10_000), openQuestions: questions.slice(0, 50), createdAt: now };
}
