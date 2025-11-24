const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const statusEl = $('#status');

async function api(path, init) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

function setStatus(s) { statusEl.textContent = s; }

async function loadSources() {
  const { sources } = await api('/api/sources');
  renderSources(sources);
}

function renderSources(sources) {
  const box = $('#source-list');
  box.innerHTML = '';
  sources.forEach((s) => {
    const el = document.createElement('div');
    el.className = 'source-item';
    el.innerHTML = `
      <h4>${s.name} <span class="pill muted">${s.type}</span></h4>
      <div class="muted">${s.url ? s.url : ''}</div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap;">
        <label style="display:flex;gap:6px;align-items:center;">
          <input type="checkbox" data-id="${s.id}" class="pick-src" /> 选择此来源
        </label>
        <button class="btn-sum" data-id="${s.id}">摘要</button>
        <span class="muted" id="sum-${s.id}"></span>
      </div>
    `;
    box.appendChild(el);
  });
  updateSelectedCount();
}

function selectedSources() {
  return $$('.pick-src:checked').map((c) => c.getAttribute('data-id'));
}

function updateSelectedCount(){ $('#selected-count').textContent = selectedSources().length; }

async function addSource() {
  try {
    const name = $('#src-name').value.trim() || undefined;
    const type = $('#src-type').value;
    const content = $('#src-content').value.trim() || undefined;
    const url = $('#src-url').value.trim() || undefined;
    const payload = { name, type, content, url };
    setStatus('添加来源中...');
    const { source } = await api('/api/sources', { method: 'POST', body: JSON.stringify(payload) });
    setStatus('来源已添加');
    $('#src-content').value = '';
    $('#src-url').value = '';
    loadSources();
  } catch (e) {
    setStatus('添加失败: ' + e.message);
  }
}

async function ask() {
  const q = $('#question').value.trim();
  if (!q) return alert('请输入问题');
  const sourceIds = selectedSources();
  try {
    setStatus('AI 回答中...');
    const res = await api('/api/ask', { method: 'POST', body: JSON.stringify({ question: q, sourceIds }) });
    renderAnswer(res);
    setStatus('已完成');
  } catch (e) {
    setStatus('回答失败: ' + e.message);
  }
}

function renderAnswer(data) {
  const box = $('#answer');
  const citeLines = (data.citations || []).map((c, i) => `【引用${i+1} | ${c.sourceName}】${c.snippet}`).join('\n');
  const audience = data.audiences || {};
  box.textContent = '';
  box.innerText = `【回答】\n${data.answer}\n\n【多层次总结】\n- 短：${data.summaries?.['短']}\n- 中：${data.summaries?.['中']}\n- 长：${data.summaries?.['长']}\n\n【场景化】\n- 学生版：${audience['学生版']}\n- 专家版：${audience['专家版']}\n- 儿童版：${audience['儿童版']}\n\n【引用】\n${citeLines}`;
}

async function generate(type) {
  const sourceIds = selectedSources();
  try {
    setStatus('生成中...');
    const out = await api('/api/generate', { method: 'POST', body: JSON.stringify({ type, sourceIds, options: {} }) });
    renderGen(type, out);
    setStatus('已完成');
  } catch (e) {
    setStatus('生成失败: ' + e.message);
  }
}

function renderGen(type, out) {
  const box = $('#gen-output');
  const citeLines = (out.citations || []).map((c, i) => `【引用${i+1} | ${c.sourceName}】${c.snippet}`).join('\n');
  let text = '';
  if (out.text) text = out.text;
  else if (type === 'audio_overview') {
    text = `【标题】${out.title}\n【时长】${out.durationEstimate}\n【章节】\n${(out.chapters||[]).map((c,i)=>`${i+1}. ${c.title} - ${c.summary}`).join('\n')}\n\n【讲解稿】\n${out.script}`;
  } else if (type === 'video_overview') {
    text = `【标题】${out.title}\n【结构】\n${(out.outline||[]).map((l)=>`- ${l}`).join('\n')}\n\n【镜头脚本】\n${(out.scenes||[]).map(s=>`S${s.scene} ${s.duration}\n旁白：${s.voiceover}\n镜头：${s.shot}\n视觉：${s.visuals?.join(' / ')}`).join('\n\n')}`;
  } else if (type === 'mind_map') {
    text = `【层级结构】\n中心：${out.structure?.center}\n${(out.structure?.children||[]).map(c=>`- ${c.label} -> ${(c.children||[]).map(x=>x.label).join('，')}`).join('\n')}\n\n【Mermaid】\n${out.mermaid}`;
  } else if (type === 'report') {
    text = `【摘要】\n${out['摘要']}\n\n【背景】\n${out['背景']}\n\n【关键洞察】\n${(out['关键洞察']||[]).map(i=>`- ${i}`).join('\n')}\n\n【逻辑链条】\n${(out['逻辑链条']||[]).map(i=>`- ${i}`).join('\n')}\n\n【数据引用】\n${(out['数据引用']||[]).join('\n')}\n\n【结论与建议】\n${(out['结论与建议']||[]).map(i=>`- ${i}`).join('\n')}`;
  } else if (type === 'flashcards') {
    text = (out.cards||[]).map((c,i)=>`Q${i+1}(${c.type}): ${c.q}\nA: ${c.a}`).join('\n\n');
  } else if (type === 'quiz') {
    text = (out.items||[]).map((it,i)=>`[${it.kind}] ${i+1}. ${it.q}\n答案：${Array.isArray(it.answer)?it.answer.join(', '):it.answer}\n解释：${it.explain}`).join('\n\n');
  } else if (type === 'slides') {
    text = out.text || '';
  }
  box.textContent = '';
  box.innerText = `${text}\n\n【引用】\n${citeLines}`;
}

// Bindings
$('#btn-add-src').addEventListener('click', addSource);
$('#btn-ask').addEventListener('click', ask);
$('#source-list').addEventListener('change', (e) => { if (e.target.classList.contains('pick-src')) updateSelectedCount(); });
$$('.gen-actions button').forEach((b)=> b.addEventListener('click', ()=> generate(b.getAttribute('data-type'))));

// Init
loadSources().catch((e)=> setStatus('加载失败: ' + e.message));

// File upload: read as text and put into textarea
const fileInput = document.getElementById('file-input');
async function uploadToServer(file){
  try{
    setStatus('上传并解析中...');
    const fd = new FormData();
    fd.append('file', file);
    const name = $('#src-name').value.trim();
    if (name) fd.append('name', name);
    const r = await fetch('/api/sources/upload', { method: 'POST', body: fd });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    await r.json();
    setStatus('解析完成');
    loadSources();
  }catch(e){ setStatus('上传失败: ' + e.message); }
}
if (fileInput) fileInput.addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const nameBox = $('#src-name');
  nameBox.value ||= f.name;
  if (/\.(pdf|xlsx|csv|json|srt|vtt)$/i.test(f.name)){
    await uploadToServer(f);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result || '';
    $('#src-content').value = typeof text === 'string' ? text : '';
    $('#src-type').value = 'text';
    document.getElementById('content-wrap').style.display='';
    document.getElementById('url-wrap').style.display='none';
  };
  reader.readAsText(f, 'utf-8');
});

// Copy buttons
function copyText(el){
  const text = el.innerText || el.textContent || '';
  navigator.clipboard?.writeText(text).then(()=> setStatus('已复制到剪贴板')).catch(()=> setStatus('复制失败'));
}
$('#btn-copy-answer').addEventListener('click', ()=> copyText($('#answer')));
$('#btn-copy-gen').addEventListener('click', ()=> copyText($('#gen-output')));

// Download generator output as Markdown
$('#btn-dl-gen').addEventListener('click', ()=>{
  const text = $('#gen-output').innerText || '';
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'notebooklm-output.md';
  document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
});

// Per-source summary
document.getElementById('source-list').addEventListener('click', async (e)=>{
  const btn = e.target.closest('.btn-sum');
  if (!btn) return;
  const id = btn.getAttribute('data-id');
  const hint = document.getElementById('sum-' + id);
  try {
    hint.textContent = '摘要中...';
    const res = await api(`/api/sources/${id}/summary`);
    const s = res.summary;
    const short = s?.summaries?.['短'] || (typeof s === 'string' ? s.slice(0,120) : '');
    hint.textContent = `短摘要：${short}`;
  } catch (err) {
    hint.textContent = '摘要失败';
  }
});

// Reindex button
document.getElementById('btn-reindex').addEventListener('click', async ()=>{
  if (!confirm('将重建缺失的向量索引（可能消耗API配额）。是否继续？')) return;
  try{
    setStatus('重建索引中...');
    const out = await api('/api/reindex', { method: 'POST', body: JSON.stringify({ batch: 64 }) });
    setStatus(`索引完成: provider=${out.provider}, dim=${out.dim}`);
  } catch(e){ setStatus('重建失败: ' + e.message); }
});
