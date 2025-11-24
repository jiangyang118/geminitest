 

📌 Flow 1：项目初始化 —— 完整可执行 Codex Prompt（终极扩展版）

Prompt：Initialize Project（完整扩展版）

你是一名高级全栈架构师，你的任务是为我生成一个名为 notebooklm-ai 的「可运行、可扩展、可维护」的项目脚手架。

要求 Codex 生成完整目录结构、每个文件的空壳内容，并在文件中加入专业注释，说明该文件的职责、后续内容会在后续 Flow 中补充实现。

最终目标：

打造一个 NotebookLM / 企业知识库 / AI 助手类系统的基础工程结构，符合现代大型工程的最佳实践。

⸻

🎯 输出要求（Codex 必须遵守）
	1.	严格按照目录结构生成所有文件
	2.	所有文件内容必须包含：
	•	文件职责注释
	•	TODO 占位
	•	必要的基础代码结构（如 module.exports、import 等）
	3.	代码必须使用 ES Module（import/export） 或 CommonJS（require/module.exports），任选其一，但必须保持风格统一
	4.	注释必须专业、清晰、可维护
	5.	输出格式必须是完整的多文件结构，用 Markdown 代码块标注每个文件路径，例如：

/backend/server.js

<file content>


⸻

📂 需要生成的项目文件结构

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
│   │      └── (空目录，附注释说明)
│   ├── services/
│   │      └── (空目录，附注释说明)
│   ├── routes/
│   │      └── (空目录，附注释说明)
│   └── models/
│          └── (空目录，附注释说明)
│
│── frontend/
│   ├── index.html
│   ├── main.js
│   ├── style.css
│
└── README.md


⸻

📌 具体内容要求（Codex 必须满足）

1. backend/server.js

内容要求：
	•	Express 初始化（但不需要实现路由，只放注释）
	•	CORS & JSON 中间件（可放 TODO）
	•	简单启动逻辑
	•	注释说明后续 Flow 会在此注册路由

示例职责注释：

/**
 * server.js
 * 后端主入口。负责：
 * 1) 初始化 Express 应用
 * 2) 加载全局中间件（JSON, CORS）
 * 3) 注册路由（在 Flow 2~Flow 10 中完成）
 * 4) 启动后端服务
 */


⸻

2. backend/config.js

内容要求：
	•	读取 .env
	•	导出配置
	•	注释说明后续会加入 OpenAI / DB / Model 配置

⸻

3. backend/openai.js

初始内容为：
	•	占位的 OpenAI 调用封装结构
	•	3 个方法 skeleton：generateChat / generateEmbedding / generateTTS
	•	注释说明后续 Flow 将填充真实逻辑

⸻

4. backend/vectordb/

包含四个文件，每个文件必须包含：
	•	顶部职责注释（说明是某个向量库的客户端）
	•	init() 占位
	•	insertEmbedding() 占位
	•	search() 占位

⸻

5. backend/controllers/、services/、routes/、models/

每个目录必须包含：

(空，但必须生成 README.md 或 placeholder.js)

其中写明：
	•	该目录用途
	•	在哪个 Flow 会生成相关代码

例如：

controllers/README.md

内容：

# controllers 目录
这里将存放所有业务控制器逻辑（Flow 6~Flow 11 自动生成）。
此处暂为空。


⸻

6. frontend/index.html

要求：
	•	标准 HTML5 骨架
	•	Vue3 CDN placeholder（后续 Flow 会填充）
	•	NotebookLM 风格布局占位注释

⸻

7. frontend/main.js

要求：
	•	初始化 Vue App 占位
	•	TODO: 挂载组件、请求 API

⸻

8. frontend/style.css

要求：
	•	放入 Token（颜色、间距、阴影）占位
	•	注释明确 UI 将在 Flow 12 自动生成

⸻

9. README.md

内容要求：
	•	项目简介
	•	目录结构说明
	•	Flow 列表（未来自动生成）
	•	TODO 占位
	•	运行步骤（初始化阶段）

⸻

📌 请 Codex 按以下格式输出：

形式如下（必须严格遵守）：

/notebooklm-ai/backend/server.js

<file content>

/notebooklm-ai/backend/config.js

<file content>

……依此类推，直到：

/notebooklm-ai/README.md

<file content>


⸻

📌 Prompt 完成
 