import { createWebsiteAppManifest } from '../src/website-app-manifest.js';

export default function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Cache-Control', 'no-store');

  if (request.method === 'OPTIONS') {
    response.status(204).end();
    return;
  }
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET, OPTIONS');
    response.status(405).send('Method not allowed');
    return;
  }

  try {
    const host = request.headers['x-forwarded-host'] || request.headers.host;
    if (typeof host !== 'string' || !host || /[\s/@]/.test(host)) throw new TypeError('Invalid host');
    const origin = new URL(`https://${host}`).origin;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.status(200).send(JSON.stringify(createWebsiteAppManifest(origin)));
  } catch {
    response.status(400).send('Invalid request host');
  }
}
