export function createWebsiteAppManifest(origin) {
  const url = new URL(origin);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('Manifest origin must be a bare HTTP(S) origin');
  }

  const websiteOrigin = url.origin;
  return {
    schemaVersion: 1,
    id: 'com.linecoflow.lfcore',
    version: 5,
    name: 'LF CORE',
    summary: 'LF-Core is a mind-map-like tool for explorers.',
    description: 'LF-Core is a mind-map-like tool for explorers.',
    category: 'productivity',
    tags: ['learning', 'research', 'knowledge management'],
    publisher: {
      name: 'LinecoFlow LLC',
      url: websiteOrigin
    },
    install: {
      url: websiteOrigin,
      displayMode: 'standalone',
      embedPolicy: 'embed',
      defaultZoom: 100,
      rememberWindowBounds: true,
      windowChrome: { mode: 'overlay', background: 'surface' },
      permissions: ['files:open', 'files:save', 'ai:generate', 'agent:use', 'agent:provide'],
      fileAssociations: [
        {
          extensions: ['.lfcore'],
          mimeTypes: ['application/vnd.linecoflow.project+json'],
          default: true
        }
      ]
    }
  };
}
