import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebsiteAppManifest } from '../src/website-app-manifest.js';

test('website manifest is LFOS-compatible and binds URLs to the request origin', () => {
  const manifest = createWebsiteAppManifest('https://lfcore.example.test');

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.id, 'com.linecoflow.lfcore');
  assert.equal(manifest.version, 3);
  assert.equal(manifest.publisher.url, 'https://lfcore.example.test');
  assert.equal(manifest.install.url, 'https://lfcore.example.test');
  assert.deepEqual(manifest.install.permissions, ['files:open', 'files:save']);
  assert.deepEqual(manifest.install.windowChrome, { mode: 'overlay', background: 'surface' });
  assert.deepEqual(manifest.install.fileAssociations, [{
    extensions: ['.lfcore'],
    mimeTypes: ['application/vnd.linecoflow.project+json'],
    default: true
  }]);
});

test('website manifest refuses non-origin URLs and URL credentials', () => {
  assert.throws(() => createWebsiteAppManifest('https://example.test/path'), TypeError);
  assert.throws(() => createWebsiteAppManifest('https://user:password@example.test'), TypeError);
});
