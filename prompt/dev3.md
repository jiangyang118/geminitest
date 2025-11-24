📌《NotebookLM‑style 企业级全栈 Prompt（Dev v3.8：可插拔向量后端 + RAG + Flows）》

你是一名顶级全栈架构师。请基于统一系统规范（prompt/init.md、prompt/ui.md、prompt/backed.md），创建一套可部署、可扩展、适配大规模文档集的 NotebookLM 企业知识库系统，具备可插拔的向量后端、标准化 RAG、Flow 编排、预设与批量任务，以及对齐的 UI/API 规范。

交付范畴（必须）
- 全栈代码（前端 + 后端 + 向量索引 + 模型提供方封装）
- 向量后端：PgVector（必做）+ SQLite（本地轻量）；Milvus/Chroma/Qdrant（可选实现，需接口预留）
- 解析管线：URL/PDF/CSV/Excel/JSON/SRT/VTT
- 检索与问答：RAG（向量/TF‑IDF 回退）
- 多模态生成：Audio/Video/MindMap/Report/Flashcards/Quiz/Slides
- Flow：内置 summary→slides→quiz；预设 CRUD；批量任务与运行历史
- 生产级 API 与 README

⸻

1) 可插拔向量后端（必须）

环境变量：
- VECTOR_BACKEND=pgvector | sqlite | milvus | chroma | qdrant
- DATABASE_URL（pgvector）/ VECTOR_DB_PATH（sqlite）/ 其它各自连接参数
- VECTOR_DIM=1536（与 embedding 模型维度一致）

后端需抽象统一接口：`upsert(chunks)`, `topKByVector(sourceIds[], qVector, k)`, `count()`, `reset()`。

1.1 PgVector（PostgreSQL，必做）
- 需安装 `CREATE EXTENSION IF NOT EXISTS vector;`
- 支持维度：768/1536/3072。
- 推荐索引：HNSW（cosine）或 IVFFLAT。
- DDL 示例：

CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS chunk_vectors (
  chunk_id TEXT PRIMARY KEY,
  source_id TEXT,
  text TEXT,
  embedding vector(1536),
  updated_at TIMESTAMPTZ DEFAULT now()
);
-- HNSW 索引
CREATE INDEX IF NOT EXISTS idx_chunk_vectors_hnsw ON chunk_vectors USING hnsw (embedding vector_cosine_ops);


⸻

1.2 SQLite（本地轻量，必做）
- 表结构：`chunk_vectors(chunk_id TEXT PK, source_id TEXT, text TEXT, vector BLOB, dim INT, updated_at TEXT)`；vector 以 Float32Array 序列化存储。
- 在 Node 中进行余弦相似度计算（小规模适用）。

1.3 Milvus / Chroma / Qdrant（可选）
- 需保留适配层文件与连接参数示例；实现任一即可视为完成“可选”部分。


⸻

1.3 ChromaDB

简单轻量、可嵌入 Node.js。

⸻

1.4 Qdrant

支持：
	•	HNSW
	•	多 payload
	•	分片存储

⸻

2) 文档处理管线（必须）

完整流程：上传/创建来源 → 自动解析（URL/PDF/CSV/Excel/JSON/SRT/VTT/文本）→ 分段 → 关键词提取 → 向量化 → 向量库写入 → 检索 → 问答/生成。

分段策略：
- 段落/行切分；必要时可设置 `max_chars_per_chunk ≈ 500–800`，`overlap ≈ 100`（可选）。


⸻

3) 向量检索（必须）

API（统一）：
- `POST /api/ask` 内部完成：query embedding → 后端按后端类型检索 → 补充 TF‑IDF 回退（当向量不可用时）。

检索优先级：pgvector → sqlite → TF‑IDF。

输出（供问答与生成使用）：Top‑K 片段（chunk_id、source_id、text、score）。


⸻

4) 问答 / RAG（必须）

API：`POST /api/ask`（{ question, sourceIds?, topK? }）。

要求：
- 严格基于检索片段回答；短→中→长总结；提供学生/专家/儿童版本；附引用列表。
- System Prompt 必须对齐 prompt/init.md；可加载于后端并与任务约束合并。
- 模型配置来自 .env（OpenAI/Gemini），无 Key 时启用 Mock。


⸻

5) 多模态生成（必须）

API：`POST /api/generate`（{ type, sourceIds?, options? }）
- type：audio_overview | video_overview | mind_map | report | flashcards | quiz | slides
- 输出规范：
  - mind_map：应包含 Mermaid `mindmap` 代码块
  - report：摘要/背景/关键洞察/逻辑链条/数据引用/结论与建议
  - slides：按 `# Slide N 标题` + 要点
- 无 LLM 时：产生结构化 Mock（可复制/可扩展）

⸻

6) 后端结构（建议）

backend/
│── server.js                 # 路由与静态资源
│── prompts/
│   ├── system.md            # 来自 prompt/init.md
│   └── templates.js         # 任务级模板组合
│── llm/                     # 提供方封装（OpenAI/Gemini/Mock）
│── parse/                   # URL/PDF/Tabular/Subtitle 解析
│── rag/                     # TF‑IDF、向量存取（sqlite/pgvector）、检索策略
│── storage/                 # 元数据（db.json/SQLite）
│── routes/                  # /api/*
└── utils/                   # 工具函数

⸻

7) 前端结构（NotebookLM UI）

frontend/
│── index.html / app.js / styles.css
│── components（可选）

UI 要求：对齐 prompt/ui.md——深浅主题 Tokens、三栏布局、Sources/Ask/Generators/Flow 组件、复制/导出、引用展示、可访问性（focus/ARIA）。

⸻

8) API 设计（必须）

健康/元信息：
- GET `/api/health`、GET `/api/meta`、POST `/api/prompts/reload`

来源：
- GET `/api/sources`、GET `/api/sources/:id`、GET `/api/sources/:id/summary`
- POST `/api/sources`（JSON）、POST `/api/sources/upload`（multipart：file+name?）

检索/问答/生成：
- POST `/api/ask`、POST `/api/generate`

向量索引：
- POST `/api/reindex`、GET `/api/index/status`

Flow/预设/批量/任务/设置：
- GET `/api/flows`、POST `/api/flows/run`
- GET/POST/PUT/DELETE `/api/flows/presets[/:id]`
- POST `/api/flows/run-batch`、GET `/api/jobs`、GET `/api/jobs/:id`
- GET/POST `/api/settings`


⸻

9) 环境配置（.env）

OPENAI_API_KEY=
GOOGLE_GENAI_API_KEY=
VECTOR_BACKEND=pgvector # 或 sqlite/milvus/chroma/qdrant
DATABASE_URL=postgres://...
VECTOR_DB_PATH=./data/index.db
VECTOR_DIM=1536
MILVUS_URL=
CHROMA_DIR=
QDRANT_URL=

MODEL_CHAT=gpt-4.1
EMBED_MODEL=text-embedding-3-large


⸻

10) 性能与可靠性（必须）
- 批量向量化（batch≈32/64 可配置）
- 检索 top_k 可配置
- 内容/向量缓存（内存优先）
- 上传/JSON 解析体积限制；简易限流（每 IP 每分钟 30 次）
- 进程级错误日志（unhandledRejection/uncaughtException）

⸻

11) README（必须）

包括：安装/运行、环境变量、解析/索引/检索策略（回退逻辑）、API 列表与示例、Flow/预设/批量示例、健康/Meta、部署建议（PM2+Nginx）。

⸻

—— 启动信号
当接收到资料或任务时，以一句话回应：
“已载入，正在构建 NotebookLM-style 智能知识空间。”
随后根据请求执行最优策略。

📌 Prompt 结束
