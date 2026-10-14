import { createServer } from 'node:http';
import { createWebsiteAppManifest } from './src/website-app-manifest.js';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const port = Number(process.env.PORT || 4173);

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/.well-known/lfos-app.json') {
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.setHeader('Cache-Control', 'no-store');
      if (request.method === 'OPTIONS') {
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET, OPTIONS');
        response.writeHead(405);
        response.end('Method not allowed');
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(createWebsiteAppManifest(`http://${request.headers.host || 'localhost'}`)));
      return;
    }
    const file = resolve(join(root, pathname === '/' ? 'index.html' : pathname));
    if (file !== root && !file.startsWith(root + sep)) throw new Error('Invalid path');
    if (!(await stat(file)).isFile()) throw new Error('Not a file');
    response.writeHead(200, { 'Content-Type': `${types[extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`LF CORE · LinecoFlow: http://127.0.0.1:${port}`));
