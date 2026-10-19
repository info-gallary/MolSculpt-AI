// MolSculpt server: serves the web app and hosts the Groq agent so the API key
// never reaches the browser. Zero dependencies (Node.js >= 18.17).
//   npm start            -> http://127.0.0.1:5173

import http from 'node:http';
import { readFile, stat, appendFile, mkdir } from 'node:fs/promises';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.js';
import { runAgent, runOffline } from './agent.js';
import { listModels } from './groq.js';
import { analyzeSmiles, summarize } from '../public/js/chem/index.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
loadEnv(join(ROOT, '.env'));

const PUBLIC = join(ROOT, 'public');
const LOG_DIR = join(ROOT, 'logs');
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';
const DEFAULT_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const FALLBACK_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
const MAX_BODY = 64 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
};

function apiKeyFor(req) {
  const header = req.headers['x-groq-key'];
  if (typeof header === 'string' && /^[A-Za-z0-9_-]{20,200}$/.test(header.trim())) return header.trim();
  return process.env.GROQ_API_KEY || null;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Request body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

let modelCache = null;
async function availableModels(key) {
  if (!key) return FALLBACK_MODELS;
  if (modelCache && Date.now() - modelCache.t < 10 * 60 * 1000) return modelCache.models;
  try {
    const models = await listModels(key);
    modelCache = { t: Date.now(), models: models.length ? models : FALLBACK_MODELS };
  } catch {
    modelCache = { t: Date.now(), models: FALLBACK_MODELS };
  }
  return modelCache.models;
}

async function logRun(entry) {
  try {
    await mkdir(LOG_DIR, { recursive: true });
    await appendFile(join(LOG_DIR, 'agent-runs.jsonl'), `${JSON.stringify(entry)}\n`);
  } catch { /* logging is best effort */ }
}

async function handleAgent(req, res) {
  const body = await readBody(req);
  const smiles = typeof body.smiles === 'string' ? body.smiles.trim() : '';
  if (!smiles || smiles.length > 1000) return sendJson(res, 400, { error: 'A SMILES string (max 1000 chars) is required' });
  try { analyzeSmiles(smiles); } catch (err) { return sendJson(res, 400, { error: `Invalid structure: ${err.message}` }); }

  const mode = body.mode === 'chat' ? 'chat' : 'analyze';
  const key = apiKeyFor(req);
  const model = typeof body.model === 'string' && /^[\w./:-]{1,80}$/.test(body.model) ? body.model : DEFAULT_MODEL;
  if (mode === 'chat' && !key) return sendJson(res, 400, { error: 'Follow-up questions need a Groq API key', code: 'no_key' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...SECURITY_HEADERS,
  });
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  let done = null;
  const emit = (event, data) => {
    if (event === 'done') done = data;
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const t0 = Date.now();
  let error = null;
  try {
    if (key) {
      await runAgent({
        smiles, mode, model, apiKey: key, emit, signal: controller.signal,
        question: body.question, history: body.history, focus: body.focus, reportContext: body.reportContext,
      });
    } else {
      await runOffline({ smiles, emit });
    }
  } catch (err) {
    error = err;
    if (!controller.signal.aborted) emit('error', { message: err.message, code: err.code ?? 'agent_error' });
  }
  res.end();
  logRun({
    t: new Date().toISOString(), mode, model: key ? model : 'offline', smiles,
    ok: !error, error: error?.message, ms: Date.now() - t0, usage: done?.usage,
  });
  console.log(`[agent] ${mode} ${key ? model : 'offline'} ${error ? 'ERROR ' + error.message : 'ok'} ${Date.now() - t0} ms`);
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + sep) && file !== PUBLIC) return sendJson(res, 403, { error: 'Forbidden' });
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ...SECURITY_HEADERS,
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end('Not found');
  }
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, groqConfigured: Boolean(process.env.GROQ_API_KEY), model: DEFAULT_MODEL });
    }
    if (url.pathname === '/api/models' && req.method === 'GET') {
      return sendJson(res, 200, { models: await availableModels(apiKeyFor(req)), default: DEFAULT_MODEL });
    }
    if (url.pathname === '/api/descriptors' && req.method === 'POST') {
      const { smiles } = await readBody(req);
      try { return sendJson(res, 200, summarize(analyzeSmiles(String(smiles ?? '')))); }
      catch (err) { return sendJson(res, 400, { error: err.message }); }
    }
    if (url.pathname === '/api/agent' && req.method === 'POST') return await handleAgent(req, res);
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Unknown endpoint' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
    return await serveStatic(req, res, url.pathname);
  } catch (err) {
    if (!res.headersSent) sendJson(res, err.status ?? 500, { error: err.message });
    else res.end();
  }
});

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  server.listen(PORT, HOST, () => {
    console.log(`MolSculpt running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(process.env.GROQ_API_KEY
      ? `Groq agent enabled (default model ${DEFAULT_MODEL})`
      : 'No GROQ_API_KEY found: the agent runs in offline tool-only mode (add a key in .env or in the app settings).');
  });
}
