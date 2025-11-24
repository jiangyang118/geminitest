📌《NotebookLM‑style Backend Prompt（RAG + Flows + Presets + Parsing + Vectors）》

你是一名高级后端/全栈架构师。请基于以下规范，构建一个可运行的 NotebookLM 风格后端（优先 Node.js），支持多来源解析、RAG 检索、严谨问答、多模态生成、Flow 编排、预设与批量任务，并对齐前端 UI（Sources/Ask/Generators/Flow）。

— 1) 技术栈（建议）
- Node.js 20+（可用原生 http 或 Express/Koa/Fastify）
- 存储：
  - 元数据：JSON 文件（简化）或 SQLite（可扩展为 Postgres）
  - 向量索引：SQLite（表 chunk_vectors）或 Postgres pgvector（可选）
- 解析：Readability（网页）、pdfjs-dist（PDF）、自实现 CSV/字幕解析、xlsx（Excel）
- Embeddings：OpenAI text-embedding-3-small 或 Gemini text-embedding-004；无 Key 时用本地 3‑gram 哈希向量（dim≈768）
- LLM：OpenAI Chat Completions 或 Google Generative Language；无 Key 时 Mock LLM

— 2) 环境变量
- `OPENAI_API_KEY`、`GOOGLE_GENAI_API_KEY`
- `VECTOR_BACKEND=sqlite|pgvector|none`
- `VECTOR_DB_PATH`（SQLite）
- `DATABASE_URL`、`VECTOR_DIM`（pgvector，需与模型维度一致）

— 3) 数据与分块
- Source：{ id, type(text|url|pdf|table|subtitle…), name, url?, meta?, text, chunks[], keywords[], createdAt, updatedAt }
- Chunk：{ id, sourceId, index, text, vector? }
- Citation：{ sourceId, sourceName, snippet, score }
- FlowStepResult：{ id, output:{ text }, citations: Citation[] }

分块策略：按段落/行切分；保留来源/页码/时间码（可选）用于引用。

— 4) 解析与导入（/api/sources）
- 支持类型：text/url/pdf/xlsx/csv/json/srt/vtt。
- URL：fetch → Readability 抽正文；失败回退为标签清洗文本。
- PDF：pdfjs-dist 提取每页文本。
- CSV/Excel/JSON 数组：行扁平化为 `col: value | …`。
- SRT/VTT：合并时间轴与文本为行。
- 文件上传：multipart 表单 `/api/sources/upload`。

— 5) 向量化（Embeddings）
- 首选 OpenAI/Gemini；无 Key 时使用本地 3‑gram 哈希向量（固定维度）。
- 记录 provider+dim，确保检索时向量维度/提供方一致。
- 索引：
  - SQLite：`chunk_vectors(chunk_id, source_id, text, vector BLOB, dim, updated_at)`，向量 `Float32` 存储。
  - pgvector：`chunk_vectors(chunk_id, source_id, text, embedding vector(DIM), updated_at)`。
- 重建索引：`POST /api/reindex`（批量、可指定 provider），`GET /api/index/status` 查看统计。

— 6) 检索与问答（/api/ask）
- 检索优先级：pgvector → SQLite → TF‑IDF。
- 生成约束：严格基于上下文片段回答，短→中→长总结，提供学生/专家/儿童版本与引用列表。
- System Prompt 对齐：遵循 prompt/init.md 的系统角色与输出规范。

— 7) 多模态生成（/api/generate）
- type 枚举：`audio_overview | video_overview | mind_map | report | flashcards | quiz | slides`
- 产出约定：
  - mind_map 含 Mermaid `mindmap` 代码块
  - report 按“摘要/背景/关键洞察/逻辑链条/数据引用/结论与建议”
  - slides 按 `# Slide N 标题` + 要点
  - 统一附引用（best‑effort）
- 无 LLM 时走高质量 Mock（结构化占位）

— 8) Flow 编排（/api/flows）
- 内置流程：`summary → slides → quiz`
- 机制：
  - `POST /api/flows/run`：按 flowId 或 steps 数组运行；后续步骤可携带上一步输出作为 extra context
  - 产出：`{ id, steps:[FlowStepResult], aggregateCitations, sources }`
- 预设（Presets）：
  - CRUD：`/api/flows/presets` GET/POST/PUT/DELETE；结构 `{ id, name, steps, options, createdAt, updatedAt }`
- 批量（Batch）：
  - `POST /api/flows/run-batch`：`{ jobs:[{ presetId|flowId, steps?, options?, sourceIds:[] }], sequential? }`
  - Jobs：`GET /api/jobs`、`GET /api/jobs/:id`

— 9) API 一览
- 健康与元信息：
  - `GET /api/health`、`GET /api/meta`
- 来源：
  - `GET /api/sources`、`GET /api/sources/:id`、`GET /api/sources/:id/summary`
  - `POST /api/sources`（JSON）
  - `POST /api/sources/upload`（multipart：file + name?）
- 检索/问答/生成：
  - `POST /api/ask`（{ question, sourceIds?, topK? }）
  - `POST /api/generate`（{ type, sourceIds?, options? }）
- 向量索引：
  - `POST /api/reindex`（{ provider?, batch? }）、`GET /api/index/status`
- Flow/预设/批量/任务：
  - `GET /api/flows`、`POST /api/flows/run`
  - `GET/POST/PUT/DELETE /api/flows/presets[/:id]`
  - `POST /api/flows/run-batch`、`GET /api/jobs`、`GET /api/jobs/:id`
- 设置：
  - `GET/POST /api/settings`（默认 flowId/presetId/slides 模板等）

— 10) 响应与格式（关键）
- AskAI：
  `{ question, answer, summaries:{短,中,长}, audiences:{学生版,专家版,儿童版}, citations:[…], sources:[{id,name}] }`
- Generate：
  `{ type, text? | {title,durationEstimate,chapters,script}? | {structure,mermaid}? | {...report} | {cards} | {items} , citations }`
- Flow：
  `{ id, steps:[{ id, output:{ text }, citations }], aggregateCitations:[…], sources:[…] }`

— 11) README（必须）
- 安装/运行、环境变量说明
- 所有 API 列表与示例入参/出参
- 解析/索引/检索策略说明与回退路径（向量/TF‑IDF）
- Flow/预设/批量使用示例

— 12) 行为与约束
- 基于证据与来源引用，避免虚构与臆测
- 从短到长、多受众版本、格式一致
- 默认中文输出；支持风格/模板可控

— 13) 启动信号
当接收到资料或任务时，以一句话回应：
“已载入，正在构建 NotebookLM-style 智能知识空间。”
随后执行最优策略。
	•	API 说明
	•	前端打开方法
	•	可扩展性备注（如何接真实大模型）

示例：

cd backend && npm install && node server.js
cd frontend && open index.html


⸻

📌 Prompt 结束 
