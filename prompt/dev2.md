📌《NotebookLM‑style 全栈实现 Prompt（Dev v3.5：RAG + Flows + Providers）》

你是一名资深全栈技术负责人。请基于统一的系统规范（见 prompt/init.md 与 prompt/ui.md），构建一个可运行且可部署的 NotebookLM 风格 Web 应用，集成真实模型（OpenAI/Gemini 可切换），支持多来源解析、向量检索（SQLite/pgvector）、严谨问答、多模态生成、Flow 编排与预设/批量任务。

交付物（必须）
- 前端：NotebookLM 风格 UI（可 SPA / 纯 HTML / Vue3 CDN）
- 后端：Node.js 服务（可原生 http / Express/Fastify/Koa）
- 存储：SQLite（默认）/ PostgreSQL（可切换）
- 向量索引：SQLite 表或 pgvector（可选）
- 解析能力：URL/PDF/CSV/Excel/JSON/SRT/VTT
- RAG：OpenAI/Gemini Embeddings；无 Key 时用本地 3‑gram 哈希向量
- LLM：OpenAI Chat / Google Generative Language；无 Key 时用 Mock
- Flow：内置 summary→slides→quiz，支持预设 CRUD 与批量执行
- README：安装运行、环境变量、API、索引策略、Flow 用法

—— 1) 技术栈

后端
- Node.js 20+
- 原生 http 或 Express/Fastify（任选）
- dotenv（配置）
- better‑sqlite3 或 pg + pgvector（可选）
- pdfjs-dist、@mozilla/readability、xlsx（解析）

前端
- 纯 HTML/CSS/JS 或 Vue3(CDN)
- fetch/axios 任选；UI 对齐 prompt/ui.md 的 Tokens 与组件

—— 2) 建议目录

notebooklm/
│── backend/
│   ├── server.js               # Web 服务与路由
│   ├── llm/
│   │    ├── openai.js          # OpenAI 封装（Chat/Embeddings）
│   │    ├── gemini.js          # Google GenAI 封装
│   │    └── mock.js            # Mock LLM/Embeddings
│   ├── parse/
│   │    ├── url.js             # Readability 抽正文
│   │    ├── pdf.js             # pdfjs-dist 提取文本
│   │    ├── tabular.js         # CSV/Excel/JSON 数组
│   │    └── subtitle.js        # SRT/VTT
│   ├── rag/
│   │    ├── tfidf.js           # TF‑IDF 召回
│   │    ├── vectors-sqlite.js  # SQLite 存取向量
│   │    ├── vectors-pg.js      # pgvector 存取向量
│   │    └── retrieve.js        # 检索优先级策略
│   ├── prompts/
│   │    ├── system.md          # 来自 prompt/init.md（可复制）
│   │    └── templates.js       # 组合 system + 任务约束
│   └── storage/
│        ├── db.json            # 元数据（简易）
│        └── index.db           # SQLite 索引（可选）
│
│── frontend/
│   ├── index.html
│   ├── app.js
│   └── styles.css
│
└── README.md

—— 3) 核心功能

3.1 来源管理与解析
- API：`GET/POST /api/sources`、`GET /api/sources/:id`、`GET /api/sources/:id/summary`
- 上传：`POST /api/sources/upload`（multipart：file + name?），支持 pdf/xlsx/csv/json/srt/vtt/txt/md
- 解析策略：URL→Readability；PDF→pdfjs；表格/JSON 数组→行扁平化；字幕→时间轴合并；文本直存
- 分块：按段落/行切分；提取关键词

3.2 嵌入与索引
- 提供方：OpenAI text-embedding-3-small/large 或 Gemini text-embedding-004；无 Key → 本地 3‑gram 哈希
- 记录 provider+dim；向量存储：SQLite(BLOB Float32) 或 pgvector(vector(DIM))
- 重建：`POST /api/reindex`（{ provider?, batch? }），状态：`GET /api/index/status`

3.3 检索与问答（RAG）
- API：`POST /api/ask`（{ question, sourceIds?, topK? }）
- 检索优先级：pgvector → SQLite → TF‑IDF
- 生成：遵循系统 Prompt（prompt/init.md），严谨回答 + 多层摘要（短/中/长）+ 场景化（学生/专家/儿童）+ 引用

3.4 多模态生成
- API：`POST /api/generate`（{ type, sourceIds?, options? }）
- type：audio_overview | video_overview | mind_map | report | flashcards | quiz | slides
- 结构：
  - mind_map 含 Mermaid
  - report 按“摘要/背景/关键洞察/逻辑链条/数据引用/结论与建议”
  - slides 按 `# Slide N 标题` + 要点
- 无 LLM 时生成结构化 Mock 占位（可复制）

3.5 Flow 编排 / 预设 / 批量
- 内置流程：summary → slides → quiz
- 运行：`POST /api/flows/run`（flowId 或 steps），后续步骤可携带上一步输出为 extra context
- 预设：`GET/POST/PUT/DELETE /api/flows/presets`（保存步骤与参数，如 slides 模板）
- 批量：`POST /api/flows/run-batch`（jobs[]）；任务：`GET /api/jobs`、`GET /api/jobs/:id`

—— 4) 前端 NotebookLM UI（要点）
- Sources：来源表单（类型选择/文本/URL/文件上传）+ 列表（复选/摘要）
- Ask：问题输入、提问、复制回答，展示“回答/多层摘要/场景化/引用”
- Generators：7 类生成器按钮，输出区支持复制/下载（MD/JSON）
- Flow：流程选择、步骤输入、预设CRUD、逐条来源批跑、任务列表、导出（MD/JSON）
- Tokens/交互：对齐 prompt/ui.md（深浅主题、动效、焦点/ARIA）

—— 5) 安全与限流
- 简易限流（每 IP 每分钟 30 次）与体积限制（上传/JSON 解析）
- 错误处理与日志（unhandledRejection/uncaughtException）

—— 6) 配置（.env）
- OPENAI_API_KEY=...
- GOOGLE_GENAI_API_KEY=...
- VECTOR_BACKEND=sqlite | pgvector | none
- VECTOR_DB_PATH=... # sqlite 路径
- DATABASE_URL=postgres://... # pgvector
- VECTOR_DIM=1536 # 与模型维度一致

—— 7) README 要点
- 安装/运行、环境变量配置
- 解析/索引/检索策略与回退（向量/TF‑IDF）
- API 列表与入参/出参示例
- Flow/预设/批量示例（含导出）
- 健康/Meta：`GET /api/health`、`GET /api/meta`、`POST /api/prompts/reload`

—— 启动信号
当接收到资料或任务时，以一句话回应：
“已载入，正在构建 NotebookLM-style 智能知识空间。”
随后根据请求执行最优策略。

