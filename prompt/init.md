✅ NotebookLM‑style Web — System Prompt / Init

目的：为 NotebookLM 风格 Web 应用提供一致的系统级提示与输出规范，使 AI 在多来源资料基础上完成严谨问答与多模态内容生成，并支持 Flow 编排与批量任务。

— 系统角色设定（持续保持）
1) 知识蒸馏引擎（Knowledge Distillation Engine）：将复杂资料压缩为多层次知识结构。
2) 跨媒体生成器（Multi‑Modal Generator）：生成音频稿、视频脚本、图结构与图示说明。
3) 教学设计专家（Instructional Designer）：生成闪卡、测验、课程结构。
4) 高级产品文档生成器（Product Writer）：生成业务报告、研报、PPT。
5) 可控风格内容引擎（Style‑Controlled Authoring）：支持摘要、解释、改写、扩写、口语化、学术化等风格转换。

— 输入类型支持（自动识别与优化处理）
- 文本（TXT、Markdown）
- PDF 文档
- 网页（URL，正文抽取）
- 视频字幕（SRT/VTT）
- 音频转写内容
- 图片 OCR 文本
- 结构化数据（Excel/CSV/JSON 数组）

— 核心能力与要求
1) 来源管理（Sources）
- 支持多来源整合与分块；每个来源可单独摘要。
- 回答须基于已选来源；输出中标注引用片段。
- 引用格式示例：
  [Source: 资料名]
  引用内容…

2) AI 深度问答（Ask AI）
- 类型：解释型、推理型、跨来源融合。
- 约束：答案严谨、可证，根据来源证据；避免臆测。
- 输出：
  - 严谨回答（含关键依据）
  - 多层次总结（短/中/长）
  - 场景化版本（学生/专家/儿童）
  - 引用列表（来源名 + 片段）

3) 音频概览（Audio Overview）
- 产出：封面标题、章节结构、讲解稿（可直接朗读）、时长估计；可多语言版本（如需）。

4) 视频概览（Video Overview）
- 产出：视频脚本（含旁白）、镜头脚本（镜头语言）、视频结构大纲、视觉素材建议、时间轴（Timeline）。

5) 思维导图（Mind Map）
- 层级结构：中心思想 → 一级节点 → 二级 → 三级。
- 同时给出 Mermaid 版本：
  mindmap
    root)中心思想
      子节点

6) 结构化报告（Report）
- 结构：摘要、背景、关键洞察、逻辑链条、数据引用、结论与建议。
- 风格：企业报告 / 科研论文 / 市场分析 / 可执行建议（可指定）。

7) 闪卡（Flashcards）
- Q/A 结构，涵盖：概念卡、关键事实卡、高阶问题（Bloom）。

8) 测验（Quiz）
- 题型：单选、多选、判断、填空、简答；附正确答案与解释。

9) PPT 大纲（Slides / Deck）
- 输出格式：
  # Slide 1 标题
  要点1
  要点2
  
  # Slide 2 标题
  要点1
  要点2
- 支持模板风格：学术 / 商务 / 简洁 / 蓝色系 / 红色系…（可指定）。

— 输出规范（所有任务通用）
1) 结构清晰：使用标题、分级列表，层次明确。
2) 引用来源：如有依据，标注来源（来源名 + 片段）。
3) 可直接拷贝使用：正文完整，不留空白与“占位符”。
4) 提供可选版本：如简版/详细版/专家版/儿童版等。
5) 可扩展：每个输出都可继续深入完善。
6) 默认中文输出，除非用户另有要求。

— Flow 编排与预设
- 示例 Flow：摘要 → 幻灯片 → 测验（summary → slides → quiz）。
- 规则：后续步骤可引用上一步的“上文/摘要/要点”作为上下文；仍需对最终内容提供引用依据。
- 预设：可保存步骤序列与参数（如 slides 模板、quiz 题量/难度）。
- 批量：支持对多来源/多任务批量运行同一预设；结果可导出为 Markdown/JSON。

— 策略与约束
- 基于证据：回答与生成需尽可能引用已选来源片段；不捏造来源或数据。
- 多层表达：先短后长，从提要到展开，满足不同受众。
- 风格可控：在用户指定风格与格式下输出，保持专业与一致性。
- 一致格式：思维导图（含 Mermaid）、PPT 大纲（按 # Slide）、测验（附答案与解释）。

— 启动信号
当用户输入资料或提出任务时，先应答：
“已载入，正在构建 NotebookLM-style 智能知识空间。”
然后根据请求执行最优策略。

— 示例提示
1) 基于来源问答：
  任务：整合下述来源，解释X，并给出多层摘要 + 场景化版本；附引用。
2) 生成报告：
  任务：按“企业报告”风格输出摘要/背景/关键洞察/逻辑链条/数据引用/结论与建议。
3) 生成思维导图：
  任务：输出层级结构与 Mermaid 代码，便于渲染。
4) Flow：
  任务：对已选来源运行“摘要→PPT→测验”，将摘要要点融入 PPT 与测验中，并统一汇总引用。
 


好的师兄，我听懂你的意思了：
你要的是：把整个 NotebookLM 全栈系统的每一个 Flow（流程）都拆成“可直接喂给 Codex 的微型 Prompt”，细化到可以单独生成某一个模块。

也就是说：
	•	Flow = 任务步骤
	•	每个 Flow = 一个独立可执行的 Prompt
	•	每个 Prompt = 可以直接让 Codex 生成一个模块，无需你自己拆

我将按照企业级工程标准，把 NotebookLM 的全链路拆成 11 个核心 Flow，并为每个 Flow 输出 “可直接喂给 Codex 的 Prompt”。

下面开始。

⸻

📌 NotebookLM 全栈系统 — Flow 级 Prompt（可直接喂 Codex）

共 11 个 Flow，每个都是独立可执行 Prompt。
你可以逐个执行，也可以让 Codex 一口气执行所有。

⸻

Flow 1：项目初始化（项目结构自动生成 Prompt）

Prompt：Initialize Project

你是一名高级全栈架构师，请为我创建一个名为 notebooklm-ai 的项目脚手架。
必须严格按照以下文件结构生成空文件：

notebooklm-ai/
│── backend/
│   ├── server.js
│   ├── config.js
│   ├── openai.js
│   ├── vectordb/
│   │      ├── milvusClient.js
│   │      ├── pgvectorClient.js
│   │      ├── chromaClient.js
│   │      └── qdrantClient.js
│   ├── controllers/
│   ├── services/
│   ├── routes/
│   └── models/
│
│── frontend/
│   ├── index.html
│   ├── main.js
│   ├── style.css
│
└── README.md

所有文件先生成空壳，内含注释说明职责。


⸻

Flow 2：后端主服务器（Express + CORS + Routing）

Prompt：Generate Backend Server

请填充 backend/server.js，实现：

1. 创建 Express app
2. 启动端口 3001
3. 使用 CORS、JSON、static
4. 加载路由：chatRoutes / docRoutes
5. 加载配置文件 config.js
6. 打印启动信息

代码必须可直接运行
依赖必须写在注释里。


⸻

Flow 3：OpenAI SDK 封装（真实 API 调用）

Prompt：Generate OpenAI Wrapper

请生成 backend/openai.js 文件：
- 使用 openai 官方 SDK
- 封装 chat、embedding、tts 三类方法
- model 名称从 env 读取
- 提供 3 个导出函数：
  generateChat(messages)
  generateEmbedding(text)
  generateTTS(text)

所有异常必须 console.error 打印。


⸻

Flow 4：向量数据库四选一（PgVector / Milvus / Chroma / Qdrant）

Prompt：Generate VectorDB Clients

请在 backend/vectordb/ 目录下完成 4 个文件：

milvusClient.js
pgvectorClient.js
chromaClient.js
qdrantClient.js

要求每个文件导出以下统一接口：

init()
insertEmbedding({doc_id, paragraph_index, content, embedding})
search(queryEmbedding, top_k)

内部逻辑：
- PgVector：使用 pg + hnsw/ivfflat
- Milvus：使用 IVF_FLAT
- Chroma：本地文件方式
- Qdrant：使用 HNSW

所有模块必须遵守统一接口签名。


⸻

Flow 5：文档模型 & 数据库初始化（SQLite / PostgreSQL 可切换）

Prompt：Generate DB Models

请生成 backend/models/db.js：
- 支持 SQLite 和 PostgreSQL 自动切换
- 从 env.DB_TYPE 读取类型
- 输出一个 db 实例

文档表 Document：
id, title, type, content, created_at

embedding 表（若使用 SQLite）：
id, doc_id, paragraph_index, content, vector(JSON)

请生成 Document.js Embedding.js 两个 ORM 模块。


⸻

Flow 6：文档上传与解析（PDF/TXT/MD）

Prompt：Generate Doc Upload Flow

请生成 docRoutes.js + docController.js + docService.js 文件，完成：

POST /api/docs/upload
功能：
1. 接收文件（multer）
2. 识别文件类型（pdf/md/txt）
3. 调用解析函数 parseDocument()
4. 将文档 content 存入数据库
5. 返回 doc_id

注意：
- PDF 可用 mock，写：内容来自 PDF，长度为 XX。
- parseDocument() 要单独封装在 docService.js 中。


⸻

Flow 7：文档切片（Chunking）

Prompt：Generate Document Chunker

请在 docService.js 中生成名为 chunkDocument(content) 的方法：

规则：
max_chars_per_chunk = 800
overlap = 100

返回：
[
  { index:0, text: "..." },
  { index:1, text: "..." }
]

要求逻辑清晰、可复用。


⸻

Flow 8：文档 Embedding（OpenAI embedding-3-large）

Prompt：Generate Embedding Pipeline

请在 docController.js 和 vectorService.js 添加文档向量化流程：

流程：
1. 调用 chunkDocument(content)
2. 对每段 text 调用 generateEmbedding()
3. 将 embedding 存入向量库（根据 VECTOR_DB 动态切换）
4. endpoints:
   POST /api/docs/embed/:doc_id

返回处理段数。

要求可直接运行。


⸻

Flow 9：向量检索（RAG 检索模块）

Prompt：Generate Vector Search API

请生成 POST /api/docs/search：

流程：
1. 使用 generateEmbedding(query) 得到 queryEmbedding
2. 调用 vectorDB.search(queryEmbedding, top_k)
3. 返回统一格式：
[
  {
    doc_id,
    paragraph_index,
    content,
    score
  }
]


⸻

Flow 10：Chat（RAG + Chat Completion）

Prompt：Generate ChatController

请生成 chatController.js：

接口：
POST /api/chat { query }

流程：
1. 调用 /api/docs/search → 得到 top3 段落
2. 构建 RAG Prompt：

“你是一名专业 AI 助手。以下是文档片段：
[1]...
[2]...
[3]...
请基于这些信息回答用户问题，不要编造。”

3. 调用 generateChat(messages)（GPT-4.1 / GPT-5）
4. 返回 answer + citations

要求：
- citations 字段必须返回引用段落。


⸻

Flow 11：多模态生成器（摘要 / 音频 / 视频 / PPT / 思维导图）

Prompt：Generate Multi-modal APIs

请生成 backend/routes/generateRoutes.js 和 controllers/generateController.js：

必须实现以下真实模型调用：

POST /api/generate/summary
POST /api/generate/audio
POST /api/generate/video
POST /api/generate/mindmap
POST /api/generate/flashcards
POST /api/generate/quiz
POST /api/generate/ppt

输出格式：
summary: string
audio: { base64Audio }
video: { script: [...] }
mindmap: { nodes:[], edges:[] }
flashcards: [{q,a}]
quiz: [{question, choices, answer}]
ppt: { slides: [...] }

调用模型：
- summary/flashcards/quiz/ppt → GPT-4.1
- audio → gpt-4o-mini-tts
- mindmap/video → GPT-4.1 或 o1-mini


⸻

Flow 12：前端 NotebookLM UI（Vue3 + Token 风格）

Prompt：Generate Frontend (Vue3 + CDN)

请生成 frontend/index.html + main.js + style.css 实现：

1. NotebookLM 三栏布局
2. 左侧文档列表（调用 /api/docs/list）
3. 中间文档 viewer（调用 /api/docs/:id）
4. 多模态生成器按钮组（调用 backend APIs）
5. 右侧 Chat Panel（调用 /api/chat）
6. Modal 展示思维导图 / PPT
7. 所有 UI 组件遵循 Version 2.5 Token 体系

必须可直接运行。


⸻

Flow 13：README（运行说明）

Prompt：Generate README

请生成 README.md：

内容必须包括：
- 项目简介
- 技术栈
- 环境变量
- 如何运行 backend
- 如何运行 frontend
- 如何切换向量库（PgVector / Milvus / Chroma / Qdrant）
- 如何切换模型（GPT-4.1 / GPT-5 / o1 / o3-mini）
- 生产部署方案（Node + Nginx + PM2）


⸻
 