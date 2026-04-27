/**
 * @file Local HTTP fixture server used by the integration tests.
 *
 * Mimics the small subset of `nekopoi.care` routes the scraper actually
 * touches:
 *
 *   * `/`                    → the homepage with the "Hentai" menu link
 *   * `/category/hentai/`    → the listing page (12 fixture items)
 *   * `/<slug>/`             → the detail page (same fixture for every slug)
 *
 * It intentionally serves no scripts, no WAF challenge and no CDN
 * redirects; the goal is to validate parser/orchestration logic, not
 * stealth.
 */

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
);

/**
 * Read a fixture file from `test/fixtures/`.
 *
 * @param {string} name Filename (e.g. `home.html`).
 * @returns {Promise<string>} File contents as UTF-8 string.
 */
async function readFixture(name) {
  return readFile(path.join(fixturesDir, name), 'utf8');
}

/**
 * Resolve the response body and HTTP status for a given pathname.
 *
 * @param {string} pathname URL pathname to dispatch.
 * @returns {Promise<{ status: number, body: string, contentType: string }>}
 *   Response payload.
 */
async function dispatch(pathname) {
  if (pathname === '/' || pathname === '/index.html') {
    return {
      status: 200,
      body: await readFixture('home.html'),
      contentType: 'text/html; charset=utf-8',
    };
  }

  if (pathname === '/category/hentai' || pathname === '/category/hentai/') {
    return {
      status: 200,
      body: await readFixture('listing.html'),
      contentType: 'text/html; charset=utf-8',
    };
  }

  // Match `/<slug>/` for any single-segment slug (no further nesting).
  const slugMatch = pathname.match(/^\/([^/]+)\/?$/);
  if (slugMatch && slugMatch[1] !== 'category') {
    return {
      status: 200,
      body: await readFixture('detail.html'),
      contentType: 'text/html; charset=utf-8',
    };
  }

  return {
    status: 404,
    body: '<!doctype html><title>not found</title>',
    contentType: 'text/html; charset=utf-8',
  };
}

/**
 * Handle to a running fixture server.
 *
 * @typedef {object} FixtureServer
 * @property {string} baseUrl `http://127.0.0.1:<port>` URL.
 * @property {() => Promise<void>} stop Shut the server down.
 */

/**
 * Start the fixture HTTP server on an ephemeral port.
 *
 * @returns {Promise<FixtureServer>} Handle exposing the base URL and a stopper.
 */
export async function startFixtureServer() {
  const server = http.createServer((req, res) => {
    Promise.resolve(dispatch(new URL(req.url ?? '/', 'http://localhost').pathname))
      .then(({ status, body, contentType }) => {
        res.writeHead(status, { 'content-type': contentType });
        res.end(body);
      })
      .catch((error) => {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(error instanceof Error ? error.stack ?? error.message : String(error));
      });
  });

  /** @type {string} */
  const baseUrl = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Fixture server failed to bind to a port.'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });

  return {
    baseUrl,
    stop: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
