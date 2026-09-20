import { completionUrl } from './model-settings.js';

export function cleanGeneratedText(value) {
  if (typeof value !== 'string') throw new Error('The model did not return text.');
  // Model prose alone cannot authenticate external sources or citations.
  return value.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gi, '$1')
    .replace(/^\s*\[\^?[^\]]+\]:\s*https?:\/\/.*$/gm, '')
    .replace(/\[(?:\d+|source[^\]]*)\]/gi, '')
    .trim();
}

export async function complete(settings, key, messages, { signal, fetcher = fetch } = {}) {
  if (!settings.selectedModel || !settings.models.includes(settings.selectedModel)) throw new Error('Choose a model in Settings.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  signal?.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const response = await fetcher(completionUrl(settings.endpoint), {
      method: 'POST', mode: 'cors', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: settings.selectedModel, messages, stream: false })
    });
    if (!response.ok) throw new Error(`Model request failed (HTTP ${response.status}). Check your endpoint, key, and model.`);
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter((part) => part.type === 'text').map((part) => part.text).join('\n') : '';
    if (!text.trim()) throw new Error('The model returned an empty response.');
    return text.trim();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Model request timed out or was canceled.');
    if (error instanceof TypeError) throw new Error('Could not reach the endpoint. Check the address, network, and CORS policy.');
    throw error;
  } finally { clearTimeout(timer); }
}

export async function generateArticle(settings, key, topic, options) {
  const text = await complete(settings, key, [
    { role: 'system', content: 'Write an introductory learning article in Markdown with a clear outline of headings, substantive explanations, concrete examples, and open questions. Begin with an H1 title. Distinguish uncertainty explicitly. Do not invent citations, URLs, references, or source claims. Return only Markdown.' },
    { role: 'user', content: `Topic: ${topic.slice(0, 500)}. Write a self-contained introductory article (roughly 700–1200 words).` }
  ], options);
  const markdown = cleanGeneratedText(text);
  if (!/^#\s+\S/m.test(markdown) || markdown.length < 200) throw new Error('The model returned an incomplete article. Try again.');
  return markdown + '\n';
}

export async function askModel(settings, key, question, context, options) {
  const answer = cleanGeneratedText(await complete(settings, key, [
    { role: 'system', content: 'Help a learner investigate a specific idea. Clearly distinguish what is known from uncertainty. Use only the provided excerpt as context; do not claim to have seen the rest of the article or source. Do not invent citations or links. Return a useful explanation in Markdown.' },
    { role: 'user', content: `Context (${context.kind}):\n${context.text.slice(0, 6000)}\n\nQuestion: ${question.slice(0, 2000)}` }
  ], options));
  if (!answer) throw new Error('The model returned an empty answer.');
  return answer;
}

export function proposeInsertion(markdown, answer, target) {
  if (target?.kind === 'article' && target.quote) {
    const offset = markdown.indexOf(target.quote);
    if (offset >= 0) {
      const end = offset + target.quote.length;
      return { before: markdown, after: `${markdown.slice(0, end)}\n\n${answer.trim()}${markdown.slice(end)}`, location: `After “${target.quote.slice(0, 90)}”` };
    }
  }
  return { before: markdown, after: `${markdown.trimEnd()}\n\n## Further understanding\n\n${answer.trim()}\n`, location: 'New section at the end of the article' };
}
