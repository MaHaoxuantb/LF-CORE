export function createWebsiteAppManifest(origin) {
  const url = new URL(origin);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('Manifest origin must be a bare HTTP(S) origin');
  }

  const websiteOrigin = url.origin;
  return {
    schemaVersion: 1,
    id: 'com.linecoflow.lfcore',
    version: 1,
    name: 'LF CORE',
    summary: 'An article-first, local-first workspace for independent learning.',
    description: 'Explore ideas from questions and sources, connect them in a graph, and consolidate what matters into a master article. Projects stay in your browser unless you choose to export them.',
    category: 'productivity',
    tags: ['learning', 'research', 'knowledge management'],
    publisher: {
      name: 'LinecoFlow',
      url: websiteOrigin
    },
    install: {
      url: websiteOrigin,
      displayMode: 'standalone',
      embedPolicy: 'embed',
      defaultZoom: 100,
      rememberWindowBounds: true,
      permissions: ['files:open', 'files:save'],
      fileAssociations: [
        {
          extensions: ['.lfcore'],
          mimeTypes: ['application/vnd.linecoflow.project+json']
        }
      ]
    }
  };
}
