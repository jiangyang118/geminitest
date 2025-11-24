// Minimal HTTP server for NotebookLM-style app (no external deps)
// - Serves static web UI from ../web/public
// - Provides JSON APIs: /api/sources, /api/ask, /api/generate

const http = require('http');
try { require('dotenv').config(); } catch {}
const { readFileSync, writeFileSync, existsSync, mkdirSync, createReadStream, statSync } = require('fs');
const { join, resolve, extname } = require('path');

const PORT = process.env.PORT || 8787;
const DATA_DIR = join(__dirname, 'data');
const DATA_FILE = join(DATA_DIR, 'data.json');
const STATIC_DIR = resolve(__dirname, '../web/public');
const VECTOR_BACKEND = process.env.VECTOR_BACKEND || 'sqlite';
const VECTOR_DB_PATH = process.env.VECTOR_DB_PATH || join(DATA_DIR, 'index.db');
const VECTOR_DIM_ENV = parseInt(process.env.VECTOR_DIM || '', 10) || null;

function tryRequire(name) {
  try { return require(name); } catch (e) { return null; }
}

function ensureData() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DATA_FILE)) {
    writeFileSync(DATA_FILE, JSON.stringify({ sources: [], flows: { presets: [] }, settings: {}, jobs: [], createdAt: new Date().toISOString() }, null, 2));
  }
}

// --- System Prompt loading (from prompt/init.md) ---
const PROMPT_INIT_PATH = resolve(__dirname, '../../prompt/init.md');
function loadSystemPromptText() {
  try {
    let txt = readFileSync(PROMPT_INIT_PATH, 'utf8');
    // Keep reasonably sized to avoid exceeding model limits in small requests
    if (txt.length > 120000) txt = txt.slice(0, 120000);
    return txt;
  } catch (e) {
    return '你是NotebookLM-style 知识蒸馏与跨媒体生成引擎。基于来源证据回答，提供短/中/长摘要与学生/专家/儿童版本，所有输出结构清晰并附引用。';
  }
}
let SYSTEM_PROMPT_TEXT = loadSystemPromptText();
function systemHeader(extra) {
  return [SYSTEM_PROMPT_TEXT, extra].filter(Boolean).join('\n\n');
}

// Flows registry
const FLOWS_PATH = resolve(__dirname, '../../prompt/flows.json');
function loadFlowsRegistry() {
  try {
    const raw = readFileSync(FLOWS_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.flows)) return [];
    return data.flows;
  } catch (e) {
    return [];
  }
}
let FLOWS_REGISTRY = loadFlowsRegistry();

function loadData() {
  ensureData();
  try {
    const raw = readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.sources)) data.sources = [];
    if (!data.flows) data.flows = { presets: [] };
    if (!Array.isArray(data.flows.presets)) data.flows.presets = [];
    if (!data.settings) data.settings = {};
    if (!Array.isArray(data.jobs)) data.jobs = [];
    return data;
  } catch (e) {
    return { sources: [], flows: { presets: [] }, settings: {}, jobs: [] };
  }
}

function saveData(data) {
  ensureData();
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const json = body ? JSON.parse(body) : {};
        resolve(json);
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, data, headers = {}) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(payload);
}

function notFound(res) {
  send(res, 404, { error: 'Not Found' });
}

function ok(res, data) {
  send(res, 200, data);
}

function bad(res, message, code = 400) {
  send(res, code, { error: message });
}

function contentTypeByExt(p) {
  const ext = extname(p).toLowerCase();
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.ico': 'image/x-icon',
      '.txt': 'text/plain; charset=utf-8',
      '.md': 'text/markdown; charset=utf-8',
    }[ext] || 'application/octet-stream'
  );
}

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Naive text utilities
function splitParagraphs(text) {
  return (text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitSentences(text, max = 3) {
  const parts = (text || '')
    .split(/(?<=[.!?。！？])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.slice(0, max).join(' ');
}

function topKeywords(text, k = 8) {
  const stop = new Set('the a an and or of to in is are for with on by from at as this that these those it be was were been being i you he she they we our your their its not no yes do does did done have has had can could may might must shall should will would if then else than when where who what why how which about into over under more less most least many few very just also even only other another some any each every because so therefore thus hence include including such per via across among between before after during within without'.split(/\s+/));
  const freq = Object.create(null);
  for (const w of (text || '').toLowerCase().match(/[a-zA-Z0-9\u4e00-\u9fa5]+/g) || []) {
    if (stop.has(w)) continue;
    freq[w] = (freq[w] || 0) + 1;
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([w]) => w);
}

// --- Retrieval utilities (TF-IDF cosine) ---
function tokenize(text) {
  return (text || '').toLowerCase().match(/[a-z0-9\u4e00-\u9fa5]+/g) || [];
}

function buildIdf(chunks) {
  const df = Object.create(null);
  const N = chunks.length || 1;
  for (const c of chunks) {
    const seen = new Set(tokenize(c.text));
    for (const t of seen) df[t] = (df[t] || 0) + 1;
  }
  const idf = Object.create(null);
  for (const [t, n] of Object.entries(df)) {
    idf[t] = Math.log(1 + N / (1 + n));
  }
  return idf;
}

function vectorize(text, idf) {
  const tf = Object.create(null);
  for (const t of tokenize(text)) tf[t] = (tf[t] || 0) + 1;
  let max = 0;
  for (const t in tf) if (tf[t] > max) max = tf[t];
  const vec = Object.create(null);
  for (const [t, f] of Object.entries(tf)) {
    if (!idf[t]) continue;
    const w = (0.5 + 0.5 * (f / (max || 1))) * idf[t];
    vec[t] = w;
  }
  return vec;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (const [t, w] of Object.entries(a)) {
    dot += w * (b[t] || 0);
    na += w * w;
  }
  for (const w of Object.values(b)) nb += w * w;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function retrieveTopChunks(query, sources, k = 8) {
  const allChunks = sources.flatMap((s) => s.chunks || []);
  if (!allChunks.length) return [];
  const idf = buildIdf(allChunks);
  const qv = vectorize(query, idf);
  const scored = allChunks.map((c) => ({ c, score: cosine(vectorize(c.text, idf), qv) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((x) => x.c);
}

// Multipart parser (simple)
function parseMultipart(body, boundary) {
  const parts = [];
  const dash = Buffer.from('--' + boundary);
  const end = Buffer.from('--' + boundary + '--');
  let idx = body.indexOf(dash);
  if (idx === -1) return parts;
  idx += dash.length + 2; // skip initial CRLF
  while (idx < body.length) {
    const nextDash = body.indexOf(dash, idx);
    const nextEnd = body.indexOf(end, idx);
    const next = nextDash === -1 ? nextEnd : Math.min(nextDash, nextEnd);
    if (next === -1) break;
    let part = body.slice(idx, next);
    // Trim leading CRLF
    if (part[0] === 13 && part[1] === 10) part = part.slice(2);
    // Split headers and data
    const sep = Buffer.from('\r\n\r\n');
    const hEnd = part.indexOf(sep);
    if (hEnd === -1) break;
    const hBuf = part.slice(0, hEnd);
    let dBuf = part.slice(hEnd + 4);
    // Trim trailing CRLF
    if (dBuf[dBuf.length - 2] === 13 && dBuf[dBuf.length - 1] === 10) dBuf = dBuf.slice(0, -2);
    const headers = hBuf.toString('utf8').split(/\r\n/);
    const disp = headers.find((h) => /^content-disposition/i.test(h)) || '';
    const ctype = headers.find((h) => /^content-type/i.test(h)) || '';
    const nameMatch = disp.match(/name="([^"]+)"/i);
    const fileMatch = disp.match(/filename="([^"]*)"/i);
    const item = {
      name: nameMatch ? nameMatch[1] : undefined,
      filename: fileMatch ? fileMatch[1] : undefined,
      contentType: ctype.split(':')[1]?.trim(),
      data: dBuf,
    };
    if (!item.filename) {
      item.text = dBuf.toString('utf8');
    }
    parts.push(item);
    idx = next + dash.length + 2; // skip to after boundary CRLF
  }
  return parts;
}

// Simple in-memory LLM fallback (deterministic) if no API keys
async function mockLLMGenerate({ system, user, format = 'text' }) {
  const prompt = [system, user].filter(Boolean).join('\n\n');
  const summary = splitSentences(prompt, 4);
  if (format === 'json') {
    return JSON.stringify({ summary, notes: topKeywords(prompt), mock: true });
  }
  return `Mock Response\n\n${summary}`;
}

async function openaiChat(messages, { model = 'gpt-4o-mini', response_format } = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model, messages, temperature: 0.3, response_format }),
    });
    if (!r.ok) throw new Error(`OpenAI ${r.status}`);
    const data = await r.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (e) {
    return null;
  }
}

async function googleGenAI(prompt, { model = 'gemini-1.5-flash', json = false } = {}) {
  const key = process.env.GOOGLE_GENAI_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: json ? 'application/json' : 'text/plain', temperature: 0.3 } }),
    });
    if (!r.ok) throw new Error(`Gemini ${r.status}`);
    const data = await r.json();
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    return text;
  } catch (e) {
    return null;
  }
}

async function llmGenerate({ system, user, expect = 'text' }) {
  // Try OpenAI, then Gemini, else mock
  const messages = [
    system ? { role: 'system', content: system } : null,
    { role: 'user', content: user },
  ].filter(Boolean);
  const response_format = expect === 'json' ? { type: 'json_object' } : undefined;
  const openai = await openaiChat(messages, { response_format });
  if (openai) return openai;
  const gemini = await googleGenAI([system, user].filter(Boolean).join('\n\n'), { json: expect === 'json' });
  if (gemini) return gemini;
  return mockLLMGenerate({ system, user, format: expect });
}

// Embeddings
function normalizeVec(vec) {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

function hashNgrams(text, dim = 768) {
  const v = new Float32Array(dim);
  const s = (text || '').toLowerCase();
  const n = 3;
  for (let i = 0; i < s.length - n + 1; i++) {
    const g = s.slice(i, i + n);
    let h = 2166136261;
    for (let j = 0; j < g.length; j++) {
      h ^= g.charCodeAt(j);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    const idx = Math.abs(h) % dim;
    v[idx] += 1;
  }
  return Array.from(normalizeVec(Array.from(v)));
}

async function openaiEmbedBatch(texts, { model = 'text-embedding-3-small' } = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ input: texts, model })
    });
    if (!r.ok) throw new Error(`OpenAI Embeddings ${r.status}`);
    const data = await r.json();
    const embeds = data.data?.map((d) => d.embedding);
    const dim = embeds?.[0]?.length || 0;
    return { vectors: embeds, dim, provider: model };
  } catch (e) {
    return null;
  }
}

async function geminiEmbedBatch(texts, { model = 'text-embedding-004' } = {}) {
  const key = process.env.GOOGLE_GENAI_API_KEY;
  if (!key) return null;
  try {
    // Try batch endpoint
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: texts.map((t) => ({ content: { parts: [{ text: t }] } })) })
    });
    if (!r.ok) throw new Error(`Gemini Embeddings ${r.status}`);
    const data = await r.json();
    const embeds = data.embeddings?.map((e) => e.values) || [];
    const dim = embeds?.[0]?.length || 0;
    return { vectors: embeds, dim, provider: model };
  } catch (e) {
    // Fallback: single calls
    try {
      const vectors = [];
      let dim = 0;
      for (const t of texts) {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: { parts: [{ text: t }] } })
        });
        if (!r.ok) throw new Error(`Gemini Embeddings single ${r.status}`);
        const data = await r.json();
        const v = data.embedding?.values || [];
        dim = dim || v.length;
        vectors.push(v);
      }
      return { vectors, dim, provider: model };
    } catch (e2) {
      return null;
    }
  }
}

async function embedBatch(texts, db) {
  // Prefer OpenAI, then Gemini, else local hash
  const openai = await openaiEmbedBatch(texts);
  if (openai) return openai;
  const gemini = await geminiEmbedBatch(texts);
  if (gemini) return gemini;
  const dim = 768;
  return { vectors: texts.map((t) => hashNgrams(t, dim)), dim, provider: 'local-hash-3gram' };
}

async function embedWithProvider(texts, provider) {
  if (!provider || provider === 'local-hash-3gram') {
    const dim = 768;
    return { vectors: texts.map((t) => hashNgrams(t, dim)), dim, provider: 'local-hash-3gram' };
  }
  if (/text-embedding-3/.test(provider)) {
    const r = await openaiEmbedBatch(texts, { model: provider });
    if (r) return r;
    // Fallback: local to avoid dimension mismatch
    const dim = 768;
    return { vectors: texts.map((t) => hashNgrams(t, dim)), dim, provider: 'local-hash-3gram' };
  }
  if (/text-embedding-004/.test(provider)) {
    const r = await geminiEmbedBatch(texts, { model: provider });
    if (r) return r;
    const dim = 768;
    return { vectors: texts.map((t) => hashNgrams(t, dim)), dim, provider: 'local-hash-3gram' };
  }
  // Unknown provider: fallback local
  const dim = 768;
  return { vectors: texts.map((t) => hashNgrams(t, dim)), dim, provider: 'local-hash-3gram' };
}

function cosineVec(a, b) {
  let dot = 0, na = 0, nb = 0;
  const L = Math.min(a.length, b.length);
  for (let i = 0; i < L; i++) { const x = a[i] || 0, y = b[i] || 0; dot += x * y; na += x * x; nb += y * y; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// Simple LRU cache for single-text embeddings
const EMB_CACHE = new Map();
const EMB_CACHE_MAX = 200;
async function cachedEmbedSingle(text, dbOrProvider) {
  const provider = typeof dbOrProvider === 'string' ? dbOrProvider : (dbOrProvider?.embedding?.provider || 'local-hash-3gram');
  const key = provider + '::' + (text || '').slice(0, 512);
  if (EMB_CACHE.has(key)) {
    const val = EMB_CACHE.get(key);
    EMB_CACHE.delete(key); EMB_CACHE.set(key, val);
    return val;
  }
  const emb = await (dbOrProvider?.embedding ? embedWithProvider([text], provider) : embedWithProvider([text], provider));
  const vec = emb.vectors[0];
  EMB_CACHE.set(key, vec);
  if (EMB_CACHE.size > EMB_CACHE_MAX) {
    const first = EMB_CACHE.keys().next().value; EMB_CACHE.delete(first);
  }
  return vec;
}

// Ingestion: naive chunking and metadata
function ingestSource(data, { type, name, content, url, meta }) {
  const now = new Date().toISOString();
  const id = uid('src');
  const text = content || `Pending fetch for ${type}${url ? ' → ' + url : ''}`;
  const paragraphs = splitParagraphs(text);
  const chunks = paragraphs.map((p, i) => ({ id: uid('chk'), index: i, text: p, sourceId: id }));
  const keywords = topKeywords(text);
  const source = { id, type, name: name || id, url: url || null, meta: meta || {}, text, chunks, keywords, createdAt: now, updatedAt: now };
  data.sources.push(source);
  return source;
}

function findSources(data, ids) {
  const set = new Set(ids || []);
  const list = data.sources.filter((s) => !ids || set.has(s.id));
  return list;
}

function pickCitations(sources, question, answer, max = 4) {
  const qk = new Set(topKeywords(`${question} ${answer}`, 16));
  const cites = [];
  for (const s of sources) {
    for (const c of s.chunks) {
      const words = new Set((c.text.toLowerCase().match(/[a-zA-Z0-9\u4e00-\u9fa5]+/g) || []));
      const overlap = [...qk].filter((w) => words.has(w)).length;
      if (overlap > 0) {
        cites.push({ sourceId: s.id, sourceName: s.name, snippet: c.text.slice(0, 280), score: overlap });
      }
    }
  }
  cites.sort((a, b) => b.score - a.score);
  return cites.slice(0, max);
}

function formatAnswerWithVariants({ base, question, sources, citations }) {
  // Multi-length summaries and audience styles
  const shortSum = splitSentences(base, 2);
  const midSum = splitSentences(base, 5);
  const longSum = base;
  const audiences = {
    学生版: `${shortSum} 关键点：${topKeywords(base, 6).join('、')}。`,
    专家版: `${midSum} 方法学与假设已在答案中体现。`,
    儿童版: `${shortSum} 你可以把它想象成一个简单的故事。`,
  };
  return {
    question,
    answer: base,
    summaries: { 短: shortSum, 中: midSum, 长: longSum },
    audiences,
    citations,
    sources: sources.map((s) => ({ id: s.id, name: s.name })),
  };
}

function buildPromptFromSources({ question, sources }) {
  const header = systemHeader('基于提供的资料，给出严谨回答并附引用标注。先短再中再长总结，并提供学生/专家/儿童版本。');
  const ctx = sources
    .map((s, i) => `【来源${i + 1}: ${s.name} (${s.type})】\n${s.text.slice(0, 4000)}`)
    .join('\n\n');
  const user = `问题：${question}\n\n请给出：\n1) 严谨回答（带关键依据）\n2) 多层次总结（短/中/长）\n3) 不同受众版本（学生/专家/儿童）\n4) 用中文回答。`;
  return { system: header, user: `${ctx}\n\n${user}` };
}

function buildPromptFromContexts({ question, chunks, sources }) {
  const header = systemHeader('严格基于提供片段进行回答并标注依据；先短再中再长总结，并提供不同受众版本。');
  const bySource = new Map();
  for (const ch of chunks) {
    const s = sources.find((x) => x.id === ch.sourceId);
    const key = s ? s.name : ch.sourceId;
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key).push(ch.text);
  }
  const ctx = [...bySource.entries()]
    .map(([name, arr], i) => `【来源${i + 1}: ${name}】\n${arr.map((t, j) => `片段${j + 1}: ${t}`).join('\n')}`)
    .join('\n\n');
  const user = `问题：${question}\n\n约束：\n- 仅使用给定片段作为证据\n- 回答要点化、条理化，避免臆测\n\n输出：\n1) 严谨回答（带关键依据）\n2) 多层次总结（短/中/长）\n3) 不同受众版本（学生/专家/儿童）\n4) 用中文回答。`;
  return { system: header, user: `${ctx}\n\n${user}` };
}

// URL & PDF parsing
async function parseURLToText(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'NotebookLM-Web/0.1' } });
    const html = await r.text();
    let title = '';
    try {
      const { JSDOM } = require('jsdom');
      const { Readability } = require('@mozilla/readability');
      const dom = new JSDOM(html, { url });
      title = dom.window.document.title || '';
      const reader = new Readability(dom.window.document);
      const article = reader.parse();
      if (article?.textContent) return { title: article.title || title, text: article.textContent };
    } catch (e) {
      // Fallback: strip tags
    }
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return { title, text };
  } catch (e) {
    return { title: '', text: '' };
  }
}

async function fetchBinary(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch ${r.status}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

async function parsePDFBuffer(buf) {
  try {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    const data = new Uint8Array(buf);
    const task = pdfjsLib.getDocument({ data });
    const pdf = await task.promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      const strings = tc.items.map((it) => it.str).filter(Boolean);
      pages.push(strings.join(' '));
    }
    return pages.join('\n\n');
  } catch (e) {
    return '';
  }
}

function parseCSVBuffer(buf) {
  const s = buf.toString('utf8');
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; }
        else { inQ = false; }
      } else { cell += ch; }
      continue;
    }
    if (ch === '"') { inQ = true; continue; }
    if (ch === ',' || ch === '\t') { row.push(cell); cell = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (cell.length || row.length) { row.push(cell); rows.push(row); row = []; cell = ''; }
      if (ch === '\r' && s[i + 1] === '\n') i++; // CRLF
      continue;
    }
    cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  // Format to text
  let headers = null;
  if (rows.length && rows[0].every((v) => v && v.trim().length)) headers = rows.shift();
  const lines = rows.map((r, idx) => {
    if (headers) return `${idx + 1}. ` + headers.map((h, i) => `${h}: ${r[i] ?? ''}`).join(' | ');
    return `${idx + 1}. ` + r.join(' | ');
  });
  return lines.join('\n');
}

async function parseXLSXBuffer(buf) {
  try {
    const XLSX = require('xlsx');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.SheetNames[0];
    if (!ws) return '';
    const data = XLSX.utils.sheet_to_json(wb.Sheets[ws], { defval: '' });
    if (!Array.isArray(data) || data.length === 0) return '';
    const headers = Object.keys(data[0]);
    const lines = data.map((row, i) => `${i + 1}. ` + headers.map((h) => `${h}: ${row[h]}`).join(' | '));
    return lines.join('\n');
  } catch (e) {
    return '';
  }
}

function parseSRTBuffer(buf) {
  const s = buf.toString('utf8');
  const blocks = s.split(/\n\s*\n/);
  const out = [];
  for (const b of blocks) {
    const lines = b.split(/\n/).map((x) => x.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const time = lines[1];
    const txt = lines.slice(2).join(' ');
    if (txt) out.push(`${time} ${txt}`);
  }
  return out.join('\n');
}

function parseVTTBuffer(buf) {
  const s = buf.toString('utf8');
  const lines = s.split(/\n/);
  const out = [];
  let cur = null;
  for (const line of lines) {
    if (/-->/.test(line)) { cur = line; continue; }
    if (!line.trim()) { cur = null; continue; }
    if (cur) out.push(`${cur} ${line.trim()}`);
  }
  return out.join('\n');
}

async function ensureChunkEmbeddings(db, chunks) {
  // Collect chunks without vectors
  const pending = chunks.filter((c) => !Array.isArray(c.vector));
  if (pending.length === 0) return db;
  const texts = pending.map((c) => c.text.slice(0, 2000));
  const emb = db.embedding ? await embedWithProvider(texts, db.embedding.provider) : await embedBatch(texts, db);
  const { vectors, dim, provider } = emb;
  if (!db.embedding) db.embedding = { provider, dim };
  if (db.embedding.dim !== dim || db.embedding.provider !== provider) db.embedding = { provider, dim };
  pending.forEach((c, i) => { c.vector = vectors[i]; });
  saveData(db);
  return db;
}

function retrieveTopChunksVector(query, sources, db, k = 12) {
  const chunks = sources.flatMap((s) => s.chunks || []);
  if (!db.embedding || chunks.length === 0 || !chunks[0].vector) return null;
  return (async () => {
    const provider = db.embedding?.provider;
    const emb = db.embedding ? await embedWithProvider([query], provider) : await embedBatch([query], db);
    const { dim } = emb;
    const qv = db.embedding ? await cachedEmbedSingle(query, provider) : emb.vectors[0];
    const scored = chunks
      .filter((c) => Array.isArray(c.vector) && c.vector.length === (db.embedding?.dim || dim))
      .map((c) => ({ c, score: cosineVec(c.vector, qv) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map((x) => x.c);
  })();
}

// --- SQLite vector index backend ---
let sqliteDB = null;
function initSQLite() {
  const mod = tryRequire('better-sqlite3');
  if (!mod) return null;
  ensureData();
  const db = new mod(VECTOR_DB_PATH);
  try { db.pragma('journal_mode = WAL'); } catch {}
  db.exec(
    `CREATE TABLE IF NOT EXISTS chunk_vectors (
      chunk_id TEXT PRIMARY KEY,
      source_id TEXT,
      text TEXT,
      vector BLOB,
      dim INTEGER,
      updated_at TEXT
    );`
  );
  return db;
}

function encVec(vec) {
  const buf = Buffer.allocUnsafe(vec.length * 4);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let i = 0; i < vec.length; i++) view.setFloat32(i * 4, vec[i], true);
  return buf;
}
function decVec(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = Math.floor(buf.byteLength / 4);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

function sqliteUpsertChunkVectors(rows) {
  if (!sqliteDB) return;
  const stmt = sqliteDB.prepare(
    `INSERT INTO chunk_vectors (chunk_id, source_id, text, vector, dim, updated_at)
     VALUES (@chunk_id, @source_id, @text, @vector, @dim, @updated_at)
     ON CONFLICT(chunk_id) DO UPDATE SET
       source_id=excluded.source_id,
       text=excluded.text,
       vector=excluded.vector,
       dim=excluded.dim,
       updated_at=excluded.updated_at`
  );
  const tx = sqliteDB.transaction((arr) => { for (const r of arr) stmt.run(r); });
  tx(rows.map((r) => ({
    chunk_id: r.id,
    source_id: r.sourceId,
    text: r.text,
    vector: encVec(r.vector),
    dim: r.dim,
    updated_at: new Date().toISOString(),
  })));
}

function sqliteQueryTopKByVector(sourceIds, qv, k) {
  if (!sqliteDB) return [];
  const hasFilter = Array.isArray(sourceIds) && sourceIds.length > 0;
  const where = hasFilter ? `WHERE source_id IN (${sourceIds.map(() => '?').join(',')})` : '';
  const rows = sqliteDB.prepare(`SELECT chunk_id, source_id, text, vector, dim FROM chunk_vectors ${where}`).all(...(hasFilter ? sourceIds : []));
  const scored = [];
  for (const r of rows) {
    if (!r.vector) continue;
    const v = decVec(r.vector);
    const score = cosineVec(v, qv);
    scored.push({ id: r.chunk_id, sourceId: r.source_id, text: r.text, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

function sqliteCount() {
  if (!sqliteDB) return 0;
  try { return sqliteDB.prepare('SELECT COUNT(*) as c FROM chunk_vectors').get().c || 0; } catch { return 0; }
}

function sqliteReset() {
  if (!sqliteDB) return;
  try { sqliteDB.exec('DELETE FROM chunk_vectors'); } catch {}
}

// --- Postgres pgvector backend (optional) ---
let pgClient = null;
let PG_DIM = VECTOR_DIM_ENV || 1536;
async function initPgVector() {
  const pg = tryRequire('pg');
  if (!pg) return null;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    // Table with pgvector type; assumes extension installed
    const dim = PG_DIM;
    await client.query(`CREATE TABLE IF NOT EXISTS chunk_vectors (
      chunk_id TEXT PRIMARY KEY,
      source_id TEXT,
      text TEXT,
      embedding vector(${dim}),
      updated_at TIMESTAMPTZ DEFAULT now()
    );`);
    return client;
  } catch (e) {
    try { await client.end(); } catch {}
    return null;
  }
}

async function pgUpsertChunkVectors(rows) {
  if (!pgClient) return;
  const text = `INSERT INTO chunk_vectors (chunk_id, source_id, text, embedding, updated_at)
                VALUES ($1,$2,$3,$4::vector, now())
                ON CONFLICT (chunk_id) DO UPDATE SET
                  source_id = EXCLUDED.source_id,
                  text = EXCLUDED.text,
                  embedding = EXCLUDED.embedding,
                  updated_at = now()`;
  for (const r of rows) {
    const vec = '[' + r.vector.map((x) => (Number.isFinite(x) ? x : 0)).join(',') + ']';
    try { await pgClient.query(text, [r.id, r.sourceId, r.text, vec]); } catch (e) { /* ignore */ }
  }
}

async function pgQueryTopKByVector(sourceIds, qv, k) {
  if (!pgClient) return [];
  const qvec = '[' + qv.map((x) => (Number.isFinite(x) ? x : 0)).join(',') + ']';
  const filter = Array.isArray(sourceIds) && sourceIds.length ? `WHERE source_id = ANY($3)` : '';
  const sql = `SELECT chunk_id, source_id, text FROM chunk_vectors ${filter}
               ORDER BY embedding <#> $1::vector LIMIT $2`;
  const params = Array.isArray(sourceIds) && sourceIds.length ? [qvec, k, sourceIds] : [qvec, k];
  const r = await pgClient.query(sql, params);
  return r.rows.map((row) => ({ id: row.chunk_id, sourceId: row.source_id, text: row.text }));
}

async function pgCount() {
  if (!pgClient) return 0;
  const r = await pgClient.query('SELECT COUNT(*)::int AS c FROM chunk_vectors');
  return r.rows[0]?.c || 0;
}

async function pgReset() {
  if (!pgClient) return;
  await pgClient.query('TRUNCATE TABLE chunk_vectors');
}

function buildGeneratorPrompt(type, { sources, options = {} }) {
  const base = sources
    .map((s, i) => `【来源${i + 1}: ${s.name}】\n${s.text.slice(0, 4000)}`)
    .join('\n\n');
  const sys = systemHeader('跨媒体生成器与教学设计专家；输出严格遵循所需结构，标注来源引用片段；使用中文。');
  const reqs = {
    audio_overview: `生成音频概览：\n- 封面标题\n- 章节结构\n- 讲解稿（可直接朗读）\n- 时长估计\n- 可选多语言版本（如需要）`,
    video_overview: `生成视频概览：\n- 视频脚本（含旁白）\n- 镜头脚本（镜头语言）\n- 视频结构大纲\n- 视觉素材建议\n- 时间轴（Timeline）`,
    mind_map: `生成思维导图：\n- 层级结构（中心思想/一级/二级/三级）\n- Mermaid 版本（mindmap）`,
    report: `生成结构化报告：摘要/背景/关键洞察/逻辑链条/数据引用/结论与建议。支持风格：${options.style || '企业报告'}`,
    flashcards: `生成闪卡（Q/A）：包含概念卡、关键事实卡、高阶问题（Bloom）。`,
    quiz: `生成测验：单选/多选/判断/填空/简答；附正确答案与解释。`,
    slides: `生成PPT大纲：按 # Slide 标题 + 要点，支持模板风格：${options.template || '商务'}`,
  }[type];
  const user = `${base}\n\n请基于以上资料生成：\n${reqs}\n\n输出需结构清晰、可复制粘贴、可扩展、带引用。`;
  return { system: sys, user };
}

function buildGeneratorPromptWithExtraContext(type, { sources, options = {}, extra }) {
  const base = buildGeneratorPrompt(type, { sources, options });
  const prefix = extra ? `【上一步上下文】\n${extra}\n\n` : '';
  return { system: base.system, user: `${prefix}${base.user}` };
}

function buildFlowSummaryPrompt({ sources, chunks }) {
  const header = systemHeader('将多来源内容压缩为多层次摘要与关键概念，并给出不同受众版本。');
  const ctx = (chunks && chunks.length
    ? chunks.map((c, i) => `片段${i + 1}: ${c.text}`).join('\n')
    : sources.map((s, i) => `【来源${i + 1}: ${s.name}】\n${s.text.slice(0, 2000)}`).join('\n\n'));
  const user = `${ctx}\n\n请输出：\n- 摘要（短/中/长）\n- 关键概念（不少于6个）\n- 适合学生/专家/儿童的解释版本`;
  return { system: header, user };
}

async function runFlowSteps({ flowId, steps, sources, db, options = {} }) {
  const result = { id: uid('flow'), steps: [], aggregateCitations: [] };
  // Prepare relevant chunks for context
  await ensureChunkEmbeddings(db, sources.flatMap((s) => s.chunks || []));
  const k = 16;
  let chunks = null;
  try {
    if (pgClient && db.embedding) {
      const emb = db.embedding ? await embedWithProvider(['总体概览要点'], db.embedding.provider) : await embedBatch(['总体概览要点'], db);
      const qv = emb.vectors[0];
      const ids = sources.map((s) => s.id);
      const rows = await pgQueryTopKByVector(ids, qv, k);
      if (rows?.length) chunks = rows.map((r, i) => ({ id: r.id, index: i, text: r.text, sourceId: r.sourceId }));
    } else if (sqliteDB && db.embedding) {
      const emb = db.embedding ? await embedWithProvider(['总体概览要点'], db.embedding.provider) : await embedBatch(['总体概览要点'], db);
      const qv = emb.vectors[0];
      const ids = sources.map((s) => s.id);
      const rows = sqliteQueryTopKByVector(ids, qv, k);
      if (rows?.length) chunks = rows.map((r, i) => ({ id: r.id, index: i, text: r.text, sourceId: r.sourceId }));
    }
  } catch {}
  if (!chunks) chunks = retrieveTopChunks('总体概览要点', sources, k);

  // Decide step sequence
  const seq = steps && steps.length ? steps : (flowId === 'summary_slides_quiz' ? ['summary', 'slides', 'quiz'] : steps || []);
  let lastText = '';
  for (const raw of seq) {
    const step = typeof raw === 'string' ? raw : (raw?.type || '');
    const sopts = typeof raw === 'object' && raw ? (raw.options || {}) : {};
    if (step === 'summary') {
      const { system, user } = buildFlowSummaryPrompt({ sources, chunks });
      const text = await llmGenerate({ system, user, expect: 'text' });
      const naive = `【短】${splitSentences(sources.map((s)=>s.text).join('\n'), 2)}\n【中】${splitSentences(sources.map((s)=>s.text).join('\n'), 5)}\n【长】${splitSentences(sources.map((s)=>s.text).join('\n'), 12)}`;
      const out = text || naive;
      lastText = out;
      const cites = pickCitations(sources, 'summary', out, 6);
      result.steps.push({ id: 'summary', output: { text: out }, citations: cites });
      result.aggregateCitations.push(...cites);
      continue;
    }
    if (step === 'slides') {
      const merged = { ...(options.slides || {}), ...(sopts || {}) };
      const { system, user } = buildGeneratorPromptWithExtraContext('slides', { sources, options: merged, extra: lastText });
      let text = await llmGenerate({ system, user, expect: 'text' });
      if (!text || text.trim().length < 20) {
        const mock = mockGenerate('slides', { sources, options: merged });
        text = mock.text;
      }
      const cites = pickCitations(sources, 'slides', text, 6);
      result.steps.push({ id: 'slides', output: { text }, citations: cites });
      result.aggregateCitations.push(...cites);
      lastText = text;
      continue;
    }
    if (step === 'quiz') {
      const merged = { ...(options.quiz || {}), ...(sopts || {}) };
      const { system, user } = buildGeneratorPromptWithExtraContext('quiz', { sources, options: merged, extra: lastText });
      let text = await llmGenerate({ system, user, expect: 'text' });
      if (!text || text.trim().length < 20) {
        const mock = mockGenerate('quiz', { sources, options: merged });
        text = (mock.items || []).map((it,i)=>`[${it.kind}] ${i+1}. ${it.q}\n答案：${Array.isArray(it.answer)?it.answer.join(', '):it.answer}\n解释：${it.explain}`).join('\n\n');
      }
      const cites = pickCitations(sources, 'quiz', text, 6);
      result.steps.push({ id: 'quiz', output: { text }, citations: cites });
      result.aggregateCitations.push(...cites);
      lastText = text;
      continue;
    }
    // Fallback: use /api/generate types
    const merged = { ...(options[step] || {}), ...(sopts || {}) };
    const { system, user } = buildGeneratorPromptWithExtraContext(step, { sources, options: merged, extra: lastText });
    let text = await llmGenerate({ system, user, expect: 'text' });
    if (!text || text.trim().length < 20) {
      const mock = mockGenerate(step, { sources, options: merged });
      text = typeof mock.text === 'string' ? mock.text : JSON.stringify(mock, null, 2);
    }
    const cites = pickCitations(sources, step, text, 6);
    result.steps.push({ id: step, output: { text }, citations: cites });
    result.aggregateCitations.push(...cites);
    lastText = text;
  }
  // Deduplicate citations by sourceId + snippet
  const seen = new Set();
  result.aggregateCitations = result.aggregateCitations.filter((c)=>{ const k = c.sourceId + '|' + c.snippet; if (seen.has(k)) return false; seen.add(k); return true; });
  result.sources = sources.map((s)=>({ id: s.id, name: s.name }));
  return result;
}

// Mock generators to ensure offline usability
function mockGenerate(type, { sources, options }) {
  const title = options?.title || (sources[0]?.name || '概览');
  const basis = sources.map((s) => s.text).join('\n\n');
  const cites = pickCitations(sources, title, basis, 6);
  if (type === 'audio_overview') {
    const chapters = sources.map((s, i) => ({ title: `章节 ${i + 1}：${s.name}`, summary: splitSentences(s.text, 3) }));
    return {
      type,
      title: `音频概览：${title}`,
      durationEstimate: `${Math.max(3, chapters.length * 2)} 分钟`,
      chapters,
      script: chapters.map((c, i) => `第${i + 1}章：${c.title}\n${c.summary}`).join('\n\n'),
      citations: cites,
    };
  }
  if (type === 'video_overview') {
    const scenes = sources.map((s, i) => ({
      scene: i + 1,
      voiceover: splitSentences(s.text, 3),
      shot: '中景 推进 / 特写 切换',
      visuals: ['要点图示', '关键词字幕'],
      duration: '00:20',
    }));
    return { type, title: `视频概览：${title}`, outline: scenes.map((s) => `S${s.scene} ${s.voiceover}`), scenes, citations: cites };
  }
  if (type === 'mind_map') {
    const root = title;
    const level1 = sources.map((s) => s.name);
    const structure = {
      center: root,
      children: level1.map((l, i) => ({ label: l, children: splitParagraphs(sources[i].text).slice(0, 3).map((p) => ({ label: splitSentences(p, 1) })) })),
    };
    const mermaid = ['mindmap', `  root)${root}`]
      .concat(
        structure.children.flatMap((c) => [
          `    ${c.label}`,
          ...c.children.map((cc) => `      ${cc.label}`),
        ])
      )
      .join('\n');
    return { type, structure, mermaid, citations: cites };
  }
  if (type === 'report') {
    return {
      type,
      style: options?.style || '企业报告',
      摘要: splitSentences(basis, 5),
      背景: splitSentences(basis, 6),
      关键洞察: topKeywords(basis, 6).map((k) => `洞察：${k}`),
      逻辑链条: ['前提', '方法', '发现', '结论'],
      数据引用: cites.map((c) => `[${c.sourceName}] ${c.snippet}`),
      结论与建议: ['结论：...', '建议：...'],
      citations: cites,
    };
  }
  if (type === 'flashcards') {
    const facts = topKeywords(basis, 8);
    return {
      type,
      cards: facts.map((f, i) => ({
        type: i % 3 === 0 ? '概念' : i % 3 === 1 ? '关键事实' : '高阶问题',
        q: `什么是：${f}？`,
        a: `围绕“${f}”的核心定义与要点。`,
      })),
      citations: cites,
    };
  }
  if (type === 'quiz') {
    return {
      type,
      items: [
        { kind: '单选', q: '本资料的核心主题是？', options: ['A', 'B', 'C', 'D'], answer: 'A', explain: '依据来源要点。' },
        { kind: '判断', q: '结论具有普适性。', answer: false, explain: '条件有限。' },
        { kind: '填空', q: '关键概念是____。', answer: '见来源关键词', explain: '来自关键词提取。' },
        { kind: '简答', q: '请概述主要发现。', answer: splitSentences(basis, 4), explain: '由段落摘要而来。' },
      ],
      citations: cites,
    };
  }
  if (type === 'slides') {
    const slides = [
      { title: `${title} 概览`, points: topKeywords(basis, 5) },
      ...sources.map((s) => ({ title: s.name, points: splitParagraphs(s.text).slice(0, 3).map((p) => splitSentences(p, 1)) })),
      { title: '结论与下一步', points: ['关键洞察', '行动建议', '开放问题'] },
    ];
    const text = slides
      .map((sl, i) => `# Slide ${i + 1} ${sl.title}\n${sl.points.map((p) => `- ${p}`).join('\n')}`)
      .join('\n\n');
    return { type, template: options?.template || '商务', text, citations: cites };
  }
  return { type, note: 'Unsupported type' };
}

// Router
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    // API: sources
    if (req.method === 'GET' && path === '/api/health') return ok(res, { ok: true });
    if (req.method === 'GET' && path === '/api/meta') {
      let version = '0.0.0';
      try {
        const rootPkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8'));
        version = rootPkg.version || version;
      } catch {}
      return ok(res, {
        version,
        vectorBackend: pgClient ? 'pgvector' : (sqliteDB ? 'sqlite' : 'memory'),
        embedding: db?.embedding || null,
        env: {
          OPENAI: !!process.env.OPENAI_API_KEY,
          GEMINI: !!process.env.GOOGLE_GENAI_API_KEY,
        },
        systemPromptBytes: (SYSTEM_PROMPT_TEXT || '').length,
      });
    }

    if (req.method === 'POST' && path === '/api/prompts/reload') {
      SYSTEM_PROMPT_TEXT = loadSystemPromptText();
      return ok(res, { reloaded: true, systemPromptBytes: (SYSTEM_PROMPT_TEXT || '').length });
    }

    if (path.startsWith('/api/')) {
      const db = loadData();

      if (req.method === 'GET' && path === '/api/sources') {
        return ok(res, { sources: db.sources.map(({ text, ...rest }) => rest) });
      }

      if (req.method === 'GET' && path.startsWith('/api/sources/')) {
        const id = path.split('/').pop();
        const src = db.sources.find((s) => s.id === id);
        if (!src) return notFound(res);
        return ok(res, src);
      }

      if (req.method === 'POST' && path === '/api/sources') {
        const payload = await readJson(req).catch(() => null);
        if (!payload || !payload.type) return bad(res, 'Missing type');
        // Enrich content for URL/PDF
        if (payload.type === 'url' && payload.url) {
          const parsed = await parseURLToText(payload.url);
          payload.content = parsed.text || payload.content;
          payload.name = payload.name || parsed.title || payload.url;
        }
        if (payload.type === 'pdf' && payload.url) {
          try {
            const bin = await fetchBinary(payload.url);
            payload.content = await parsePDFBuffer(bin);
          } catch (e) {
            // leave content as-is
          }
        }
        const src = ingestSource(db, payload);
        // Build embeddings for new chunks (if provider available)
        await ensureChunkEmbeddings(db, src.chunks);
        if (sqliteDB && Array.isArray(src.chunks)) {
          const vectors = (src.chunks || []).filter((c) => Array.isArray(c.vector));
          const dim = db.embedding?.dim || (vectors[0]?.vector?.length || null);
          if (vectors.length && dim) {
            sqliteUpsertChunkVectors(vectors.map((c) => ({ id: c.id, sourceId: c.sourceId, text: c.text, vector: c.vector, dim })));
          }
        }
        if (pgClient && Array.isArray(src.chunks)) {
          const vectors = (src.chunks || []).filter((c) => Array.isArray(c.vector));
          if (vectors.length) await pgUpsertChunkVectors(vectors.map((c) => ({ id: c.id, sourceId: c.sourceId, text: c.text, vector: c.vector })));
        }
        saveData(db);
        return ok(res, { source: src });
      }

      if (req.method === 'POST' && path === '/api/sources/upload') {
        const ctype = req.headers['content-type'] || '';
        const match = ctype.match(/boundary=(.*)$/);
        if (!match) return bad(res, 'Missing multipart boundary');
        const boundary = match[1];
        const body = await readRawBody(req);
        const parts = parseMultipart(body, boundary);
        let filePart = parts.find((p) => p.filename);
        let namePart = parts.find((p) => p.name === 'name');
        const name = namePart ? namePart.text : undefined;
        if (!filePart) return bad(res, 'No file');
        const filename = filePart.filename || 'upload.bin';
        const isPDF = /\.pdf$/i.test(filename) || /application\/pdf/.test(filePart.contentType || '');
        const isXLSX = /\.(xlsx|xlsm)$/i.test(filename);
        const isCSV = /\.csv$/i.test(filename);
        const isSRT = /\.srt$/i.test(filename);
        const isVTT = /\.vtt$/i.test(filename);
        const isJSON = /\.json$/i.test(filename);
        let content = '';
        let type = 'text';
        if (isPDF) { content = await parsePDFBuffer(filePart.data); type = 'pdf'; }
        else if (isXLSX) { content = await parseXLSXBuffer(filePart.data); type = 'table'; }
        else if (isCSV) { content = parseCSVBuffer(filePart.data); type = 'table'; }
        else if (isSRT) { content = parseSRTBuffer(filePart.data); type = 'subtitle'; }
        else if (isVTT) { content = parseVTTBuffer(filePart.data); type = 'subtitle'; }
        else if (isJSON) {
          try {
            const obj = JSON.parse(filePart.data.toString('utf8'));
            if (Array.isArray(obj)) {
              const rows = obj;
              const headers = Array.from(rows.reduce((set, r) => { Object.keys(r||{}).forEach(k=>set.add(k)); return set; }, new Set()));
              content = rows.map((r,i)=> `${i+1}. ` + headers.map((h)=> `${h}: ${r?.[h] ?? ''}`).join(' | ')).join('\n');
              type = 'table';
            } else {
              content = JSON.stringify(obj, null, 2);
              type = 'text';
            }
          } catch { content = filePart.data.toString('utf8'); type = 'text'; }
        }
        else { content = filePart.data.toString('utf8'); type = 'text'; }
        const src = ingestSource(db, { type, name: name || filename, content });
        await ensureChunkEmbeddings(db, src.chunks);
        if (sqliteDB && Array.isArray(src.chunks)) {
          const vectors = (src.chunks || []).filter((c) => Array.isArray(c.vector));
          const dim = db.embedding?.dim || (vectors[0]?.vector?.length || null);
          if (vectors.length && dim) {
            sqliteUpsertChunkVectors(vectors.map((c) => ({ id: c.id, sourceId: c.sourceId, text: c.text, vector: c.vector, dim })));
          }
        }
        if (pgClient && Array.isArray(src.chunks)) {
          const vectors = (src.chunks || []).filter((c) => Array.isArray(c.vector));
          if (vectors.length) await pgUpsertChunkVectors(vectors.map((c) => ({ id: c.id, sourceId: c.sourceId, text: c.text, vector: c.vector })));
        }
        saveData(db);
        return ok(res, { source: src });
      }

      if (req.method === 'POST' && path === '/api/ask') {
        const { question, sourceIds, topK } = await readJson(req).catch(() => ({}));
        if (!question) return bad(res, 'Missing question');
        const sources = findSources(db, sourceIds);
        // Ensure embeddings for selected sources (if possible)
        await ensureChunkEmbeddings(db, sources.flatMap((s) => s.chunks || []));
        const defaultTopK = Math.max(4, Math.min(32, (db.settings?.defaultTopK || 12)));
        const k = Math.max(4, Math.min(32, topK || defaultTopK));
        let chunks = null;
        // Prefer DB-backed vector search (pgvector → sqlite)
        if (pgClient && db.embedding) {
          const provider = db.embedding?.provider;
          const emb = db.embedding ? await embedWithProvider([question], provider) : await embedBatch([question], db);
          const qv = db.embedding ? await cachedEmbedSingle(question, provider) : emb.vectors[0];
          const ids = sources.map((s) => s.id);
          const rows = await pgQueryTopKByVector(ids, qv, k);
          if (rows && rows.length) {
            chunks = rows.map((r, i) => ({ id: r.id, index: i, text: r.text, sourceId: r.sourceId }));
          }
        } else if (sqliteDB && db.embedding) {
          const provider = db.embedding?.provider;
          const emb = db.embedding ? await embedWithProvider([question], provider) : await embedBatch([question], db);
          const qv = db.embedding ? await cachedEmbedSingle(question, provider) : emb.vectors[0];
          const ids = sources.map((s) => s.id);
          const rows = sqliteQueryTopKByVector(ids, qv, k);
          if (rows && rows.length) {
            chunks = rows.map((r, i) => ({ id: r.id, index: i, text: r.text, sourceId: r.sourceId }));
          }
        }
        if (!chunks) {
          const maybeVec = await retrieveTopChunksVector(question, sources, db, k);
          if (maybeVec && Array.isArray(maybeVec)) chunks = maybeVec;
        }
        if (!chunks) chunks = retrieveTopChunks(question, sources, k);
        const { system, user } = buildPromptFromContexts({ question, chunks, sources });
        const base = await llmGenerate({ system, user, expect: 'text' });
        const citedSources = sources.filter((s) => chunks.some((c) => c.sourceId === s.id));
        const citations = pickCitations(citedSources, question, base, 6);
        const result = formatAnswerWithVariants({ base, question, sources: citedSources, citations });
        return ok(res, result);
      }

      if (req.method === 'GET' && path.startsWith('/api/sources/') && path.endsWith('/summary')) {
        const id = path.split('/')[3];
        const src = db.sources.find((s) => s.id === id);
        if (!src) return notFound(res);
        const system = '你是知识蒸馏引擎，请对资料做多层次总结与关键词提取。';
        const user = `资料名称：${src.name}\n\n正文：\n${src.text.slice(0, 6000)}\n\n请输出：\n- 摘要（短/中/长）\n- 关键概念\n- 适合学生/专家/儿童的解释版本`;
        const out = await llmGenerate({ system, user, expect: 'text' });
        const naive = {
          summaries: { 短: splitSentences(src.text, 2), 中: splitSentences(src.text, 5), 长: splitSentences(src.text, 12) },
          keywords: topKeywords(src.text, 10),
          notes: 'LLM 不可用时的占位摘要',
        };
        return ok(res, { id: src.id, name: src.name, summary: out || naive });
      }

      if (req.method === 'POST' && path === '/api/reindex') {
        const { provider, batch } = await readJson(req).catch(() => ({}));
        const B = Math.max(8, Math.min(256, batch || 64));
        const all = db.sources.flatMap((s) => s.chunks || []);
        // Reset vectors if provider requested differs
        if (provider && db.embedding?.provider !== provider) {
          db.sources.forEach((s) => (s.chunks || []).forEach((c) => delete c.vector));
          delete db.embedding;
          sqliteReset();
          await pgReset();
        }
        // Identify pending
        const pending = all.filter((c) => !Array.isArray(c.vector));
        let done = 0;
        while (done < pending.length) {
          const slice = pending.slice(done, done + B);
          const texts = slice.map((c) => c.text.slice(0, 2000));
          const emb = db.embedding ? await embedWithProvider(texts, db.embedding.provider) : (provider ? await embedWithProvider(texts, provider) : await embedBatch(texts, db));
          const { vectors, dim, provider: used } = emb;
          if (!db.embedding) db.embedding = { provider: used, dim };
          if (sqliteDB) {
            sqliteUpsertChunkVectors(slice.map((c, i) => ({ id: c.id, sourceId: c.sourceId, text: c.text, vector: vectors[i], dim })));
          }
          if (pgClient) {
            await pgUpsertChunkVectors(slice.map((c, i) => ({ id: c.id, sourceId: c.sourceId, text: c.text, vector: vectors[i] })));
          }
          slice.forEach((c, i) => (c.vector = vectors[i]));
          done += slice.length;
          saveData(db);
        }
        return ok(res, { ok: true, total: all.length, indexed: all.length - pending.length + pending.length, provider: db.embedding?.provider, dim: db.embedding?.dim, backend: sqliteDB ? 'sqlite' : 'memory' });
      }

      if (req.method === 'GET' && path === '/api/index/status') {
        const total = db.sources.reduce((n, s) => n + (s.chunks?.length || 0), 0);
        const withVec = db.sources.reduce((n, s) => n + (s.chunks?.filter((c) => Array.isArray(c.vector)).length || 0), 0);
        const rows = sqliteCount();
        const pgrows = pgClient ? await pgCount() : 0;
        return ok(res, { totalChunks: total, withVectors: withVec, sqliteRows: rows, pgRows: pgrows, embedding: db.embedding || null, backend: pgClient ? 'pgvector' : (sqliteDB ? 'sqlite' : 'memory') });
      }

      if (req.method === 'POST' && path === '/api/generate') {
        const { type, sourceIds, options } = await readJson(req).catch(() => ({}));
        if (!type) return bad(res, 'Missing type');
        const sources = findSources(db, sourceIds);
        // Try LLM first for better output; fall back to mock
        const { system, user } = buildGeneratorPrompt(type, { sources, options });
        const expect = type === 'mind_map' || type === 'report' ? 'text' : 'text';
        let llmOut = await llmGenerate({ system, user, expect });
        // Normalize minimal structure if LLM not available
        if (!llmOut || typeof llmOut !== 'string' || llmOut.trim().length < 30) {
          const mock = mockGenerate(type, { sources, options });
          return ok(res, mock);
        }
        // Return raw text with citations separately (best-effort)
        const citations = pickCitations(sources, options?.title || type, llmOut, 6);
        return ok(res, { type, text: llmOut, citations });
      }

      // Flows and presets
      if (req.method === 'GET' && path === '/api/flows') {
        const builtins = [
          { id: 'summary_slides_quiz', name: '摘要 → PPT → 测验', steps: ['summary','slides','quiz'] },
        ];
        // Merge registry flows; prefer registry definitions
        const ids = new Set(FLOWS_REGISTRY.map(f => f.id));
        const flows = [...FLOWS_REGISTRY, ...builtins.filter(b => !ids.has(b.id))];
        return ok(res, { flows, presets: db.flows.presets || [] });
      }

      if (req.method === 'POST' && path === '/api/flows/run') {
        const { flowId, steps, sourceIds, options } = await readJson(req).catch(() => ({}));
        const sources = findSources(db, sourceIds);
        if (!sources.length) return bad(res, 'No sources selected');
        // If flowId in registry and steps not provided, load from registry
        let useSteps = steps;
        if ((!steps || steps.length === 0) && flowId) {
          const reg = FLOWS_REGISTRY.find(f => f.id === flowId);
          if (reg) useSteps = reg.steps;
        }
        const out = await runFlowSteps({ flowId, steps: useSteps, sources, db, options });
        return ok(res, out);
      }

      if (req.method === 'POST' && path === '/api/flows/reload') {
        FLOWS_REGISTRY = loadFlowsRegistry();
        return ok(res, { reloaded: true, count: FLOWS_REGISTRY.length });
      }

      if (req.method === 'GET' && path === '/api/settings') {
        return ok(res, db.settings || {});
      }

      if (req.method === 'POST' && path === '/api/settings') {
        const body = await readJson(req).catch(() => ({}));
        db.settings = { ...(db.settings || {}), ...(body || {}) };
        saveData(db);
        return ok(res, db.settings);
      }

      if (req.method === 'GET' && path === '/api/flows/presets') {
        return ok(res, { presets: db.flows.presets || [] });
      }

      if (req.method === 'POST' && path === '/api/flows/presets') {
        const body = await readJson(req).catch(() => ({}));
        if (!body || !body.name) return bad(res, 'Missing name');
        const preset = { id: uid('preset'), name: body.name, steps: body.steps || ['summary','slides','quiz'], options: body.options || {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        db.flows.presets = db.flows.presets || [];
        db.flows.presets.push(preset);
        saveData(db);
        return ok(res, { preset });
      }

      if (req.method === 'PUT' && path.startsWith('/api/flows/presets/')) {
        const id = path.split('/').pop();
        const body = await readJson(req).catch(() => ({}));
        const list = db.flows.presets || [];
        const idx = list.findIndex((p) => p.id === id);
        if (idx === -1) return notFound(res);
        list[idx] = { ...list[idx], ...body, id, updatedAt: new Date().toISOString() };
        saveData(db);
        return ok(res, { preset: list[idx] });
      }

      if (req.method === 'DELETE' && path.startsWith('/api/flows/presets/')) {
        const id = path.split('/').pop();
        const list = db.flows.presets || [];
        const idx = list.findIndex((p) => p.id === id);
        if (idx === -1) return notFound(res);
        const removed = list.splice(idx, 1)[0];
        saveData(db);
        return ok(res, { removed });
      }

      if (req.method === 'POST' && path === '/api/flows/run-batch') {
        const { jobs, sequential = true } = await readJson(req).catch(() => ({}));
        if (!Array.isArray(jobs) || jobs.length === 0) return bad(res, 'Missing jobs');
        const batchId = uid('batch');
        const results = [];
        for (const j of jobs) {
          const preset = j.presetId ? (db.flows.presets || []).find((p) => p.id === j.presetId) : null;
          const steps = j.steps || preset?.steps || undefined;
          const options = j.options || preset?.options || {};
          const sources = findSources(db, j.sourceIds);
          const out = await runFlowSteps({ flowId: j.flowId || (preset ? 'preset' : undefined), steps, sources, db, options });
          const job = { id: uid('job'), batchId, status: 'completed', createdAt: new Date().toISOString(), result: out };
          db.jobs.push(job);
          results.push(job);
          if (!sequential) {
            // In demo, still sequential
          }
        }
        saveData(db);
        return ok(res, { batchId, results });
      }

      if (req.method === 'GET' && path === '/api/jobs') {
        return ok(res, { jobs: db.jobs.slice(-100) });
      }

      if (req.method === 'GET' && path.startsWith('/api/jobs/')) {
        const id = path.split('/').pop();
        const job = (db.jobs || []).find((j) => j.id === id);
        if (!job) return notFound(res);
        return ok(res, job);
      }

      return notFound(res);
    }

    // Static files (web UI)
    let filePath = path === '/' ? join(STATIC_DIR, 'index.html') : join(STATIC_DIR, decodeURIComponent(path));
    try {
      const stat = statSync(filePath);
      if (stat.isDirectory()) filePath = join(filePath, 'index.html');
      const stream = createReadStream(filePath);
      res.writeHead(200, { 'Content-Type': contentTypeByExt(filePath) });
      stream.pipe(res);
    } catch (e) {
      notFound(res);
    }
  } catch (e) {
    bad(res, e.message || 'Server error', 500);
  }
});

server.listen(PORT, () => {
  (async () => {
    if (VECTOR_BACKEND === 'pgvector') {
      pgClient = await initPgVector();
      if (pgClient) console.log('[vector] pgvector backend connected');
      else console.log('[vector] pgvector unavailable (missing pg or connection failed)');
    }
    if (VECTOR_BACKEND === 'sqlite' || (!pgClient && VECTOR_BACKEND !== 'none')) {
      sqliteDB = initSQLite();
      if (sqliteDB) console.log(`[vector] SQLite index at ${VECTOR_DB_PATH}`);
      else console.log('[vector] SQLite not available (better-sqlite3 not installed).');
    }
    console.log(`NotebookLM-like server running at http://localhost:${PORT}`);
  })();
});

// Basic process-level error logging
process.on('unhandledRejection', (err) => {
  try { console.error('[unhandledRejection]', err?.stack || err); } catch {}
});
process.on('uncaughtException', (err) => {
  try { console.error('[uncaughtException]', err?.stack || err); } catch {}
});

// (moved misplaced route handlers into the /api/ block above)
