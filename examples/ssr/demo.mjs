import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { config } from './config.mjs';

const server = await createServer({ ...config, logLevel: 'silent', server: { middlewareMode: true } });
try {
  const module = await server.ssrLoadModule('/entry-server.mjs');
  const [ko, en] = await Promise.all([module.render('ko'), module.render('en')]);
  assert.equal(JSON.parse(ko.boot).locale, 'ko');
  assert.equal(JSON.parse(en.boot).locale, 'en');
  assert.ok(ko.html.includes('번역을 바꿔도') && en.html.includes('New words. Same input.'));
  console.log('Saylo SSR: independent ko/en requests rendered with matching boot snapshots.');
} finally { await server.close(); }
