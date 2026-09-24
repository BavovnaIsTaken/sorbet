#!/usr/bin/env node
/**
 * Local mode: serves the app and keeps each map as files on disk.
 *
 *   map/<domain>.md    the map itself: read it, edit it by hand, commit it
 *   map/<domain>.json  the same map for programs, rewritten on every save
 *
 *   node server.js [--port 4321] [--host 127.0.0.1] [--map ./map]
 *
 * No dependencies. The map directory is meant to live under git: one copy
 * is no copy.
 */

import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join, resolve, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { loadBank, parseDomain } from './core/bank.js';
import { toJSON } from './core/export.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port ?? process.env.PORT ?? 4321);
const HOST = args.host ?? '127.0.0.1';
const MAP_DIR = resolve(args.map ?? join(ROOT, 'map'));

const PUBLIC = ['index.html', 'app/', 'core/', 'bank/'];
const DOMAIN = /^[a-z0-9_]+$/;
const MAX_BODY = 2 * 1024 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

// The artifact host wraps index.html in this skeleton when it publishes the
// page; doing the same here keeps one index.html for both.
const wrap = (page) => `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}</style>
</head>
<body>
${page}
</body>
</html>
`;

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname);
    if (path === '/api/health') {
      return send(res, 200, JSON.stringify({ app: 'worldview', map: MAP_DIR }), TYPES['.json']);
    }
    if (path === '/favicon.ico') return send(res, 204, '');
    const map = /^\/api\/map\/([^/]+)$/.exec(path);
    if (map) return await mapRoute(req, res, map[1]);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
    return await staticRoute(res, path);
  } catch (e) {
    console.error(e);
    return send(res, 500, String(e?.message ?? e));
  }
});

async function mapRoute(req, res, domain) {
  if (!DOMAIN.test(domain)) return send(res, 400, 'domain: a-z, 0-9, _');
  const md = join(MAP_DIR, `${domain}.md`);
  if (req.method === 'GET') {
    try {
      return send(res, 200, await readFile(md, 'utf8'), TYPES['.md']);
    } catch (e) {
      // no map yet is a normal state, not an error
      if (e.code === 'ENOENT') return send(res, 204, '');
      throw e;
    }
  }
  if (req.method === 'PUT') {
    const text = await readBody(req);
    await mkdir(MAP_DIR, { recursive: true });
    await writeAtomic(md, text);
    const json = toJSON(text, await domainById(domain));
    await writeAtomic(join(MAP_DIR, `${domain}.json`), `${JSON.stringify(json, null, 2)}\n`);
    const shown = relative(process.cwd(), md);
    console.log(`${new Date().toLocaleTimeString()}  ${shown.startsWith('..') ? md : shown}`);
    return send(res, 204, '');
  }
  return send(res, 405, 'method not allowed');
}

async function staticRoute(res, path) {
  const file = resolve(ROOT, path === '/' ? 'index.html' : `.${path}`);
  const rel = relative(ROOT, file).split(sep).join('/');
  const allowed = PUBLIC.some((p) => rel === p || (p.endsWith('/') && rel.startsWith(p)));
  if (!allowed || rel.startsWith('..')) return send(res, 404, 'not found');
  let data;
  try {
    data = await readFile(file);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EISDIR') return send(res, 404, 'not found');
    throw e;
  }
  if (rel === 'index.html') data = wrap(data.toString('utf8'));
  return send(res, 200, data, TYPES[extname(file)] ?? 'application/octet-stream');
}

async function domainById(id) {
  const readJSON = async (p) => JSON.parse(await readFile(join(ROOT, 'bank', p), 'utf8'));
  try {
    const { domains } = await loadBank(readJSON);
    return domains.find((d) => d.id === id) ?? parseDomain({}, id).domain;
  } catch {
    return parseDomain({}, id).domain;
  }
}

async function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, file);
}

function readBody(req) {
  return new Promise((ok, fail) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        fail(new Error('map file over 2 MB'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(status === 204 ? undefined : body);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(argv[i]);
    if (m) out[m[1]] = m[2] ?? argv[++i];
  }
  return out;
}

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
}

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`Мапа:        http://${shown}:${PORT}/`);
  if (HOST === '0.0.0.0') {
    for (const ip of lanAddresses()) console.log(`з телефона:  http://${ip}:${PORT}/`);
  } else {
    console.log('з телефона:  node server.js --host 0.0.0.0  (мапу тоді бачить уся локальна мережа)');
  }
  console.log(`файли мапи:  ${MAP_DIR}`);
});
