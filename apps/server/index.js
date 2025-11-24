// Minimal HTTP server for NotebookLM-style app (no external deps)
// - Serves static web UI from ../web/public
// - Provides JSON APIs: /api/sources, /api/ask, /api/generate

const http = require('http');
const { readFileSync, writeFileSync, existsSync, mkdirSync, createReadStream, statSync } = require('fs');
const { join, resolve, extname } = require('path');

const PORT = process.env.PORT || 8787;
const DATA_DIR = join(__dirname, 'data');
const DATA_FILE = join(DATA_DIR, 'data.json');
const STATIC_DIR = resolve(__dirname, '../web/public');

function ensureData() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DATA_FILE)) {
    writeFileSync(DATA_FILE, JSON.stringify({ sources: [], createdAt: new Date().toISOString() }, null, 2));
  }
}

function loadData() {
  ensureData();
  try {
    const raw = readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { sources: [] };
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
  const header = '你是“NotebookLM-style 知识蒸馏引擎”。基于提供的资料，给出严谨回答并附引用标注。先短再中再长总结。';
  const ctx = sources
    .map((s, i) => `【来源${i + 1}: ${s.name} (${s.type})】\n${s.text.slice(0, 4000)}`)
    .join('\n\n');
  const user = `问题：${question}\n\n请给出：\n1) 严谨回答（带关键依据）\n2) 多层次总结（短/中/长）\n3) 不同受众版本（学生/专家/儿童）\n4) 用中文回答。`;
  return { system: header, user: `${ctx}\n\n${user}` };
}

function buildPromptFromContexts({ question, chunks, sources }) {
  const header = '你是“NotebookLM-style 知识蒸馏引擎”。请严格基于提供片段进行回答并标注依据。先短再中再长总结。';
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

function buildGeneratorPrompt(type, { sources, options = {} }) {
  const base = sources
    .map((s, i) => `【来源${i + 1}: ${s.name}】\n${s.text.slice(0, 4000)}`)
    .join('\n\n');
  const sys = '你是跨媒体生成器与教学设计专家。输出严格遵循所需结构，且标注来源引用片段。全部使用中文。';
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
        const src = ingestSource(db, payload);
        saveData(db);
        return ok(res, { source: src });
      }

      if (req.method === 'POST' && path === '/api/ask') {
        const { question, sourceIds, topK } = await readJson(req).catch(() => ({}));
        if (!question) return bad(res, 'Missing question');
        const sources = findSources(db, sourceIds);
        const chunks = retrieveTopChunks(question, sources, Math.max(4, Math.min(20, topK || 12)));
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
  console.log(`NotebookLM-like server running at http://localhost:${PORT}`);
});
