
📌《NotebookLM Web UI 套件生成 Prompt（对齐 System Prompt + Flow + RAG）》

你是一名高级前端架构师。请基于以下 UI 规范生成一套 NotebookLM 风格的 Web UI 组件库 Demo（单文件 HTML 或组件展示页），覆盖来源管理、AI 问答、生成器、Flow 编排、预设与批量任务、复制/导出等关键交互。输出需包含：
- Figma 组件命名
- Design Tokens
- 组件层级结构
- 状态（default / hover / active / disabled）与交互动效
- 可直接运行的 index.html（HTML+CSS+JS）

— 1) Design Tokens（CSS variables）
- Color（深色/浅色预设，示例）：
  --bg:#0b0f12; --surface:#12171b; --muted:#6b7280; --text:#e5e7eb; --accent:#60a5fa; --border:#1f2937;
  浅色等价：--bg:#fff; --surface:#fafafa; --text:#1f2937; --border:#e5e7eb; …
- Radius: --radius-sm:6px; --radius-md:8px; --radius-lg:12px;
- Shadow: --shadow-sm:0 1px 2px rgba(0,0,0,.05); --shadow-md:0 4px 12px rgba(0,0,0,.12);
- Font: --font-family:"Inter","Noto Sans SC",system-ui; --font-h1:28px; --font-h2:18px; --font-body:14px;
- Spacing: --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-6:24px;
- Motion: --dur-fast:.15s; --dur-med:.25s; --easing:cubic-bezier(.2,.8,.2,1);

— 2) 信息架构与布局（IA）
- Layout/ThreeColumnLayout
  ThreeColumnLayout
   ├── Topbar
   ├── Sidebar/SourcesPanel
   │    ├── SourceForm（名称、类型 text/url/pdf、文本区/URL、文件上传：pdf/xlsx/csv/json/srt/vtt/txt/md）
   │    └── SourceList
   │         └── SourceItem（Tag/Type、选择复选框、摘要按钮、短摘要占位）
   └── Content
        ├── AskPanel（问题输入、提问、复制回答）
        ├── GeneratorsPanel（按钮组：audio/video/mind_map/report/flashcards/quiz/slides，复制/下载）
        └── FlowPanel（流程选择、模板、步骤输入、运行、保存默认、预设CRUD、批量执行、JSON/MD 导出、任务查看）

— 3) 组件（Figma 命名 + 树）
Atoms
- Button/PrimaryButton, Button/GhostButton（含图标）
- Input/TextInput, Input/SearchInput, Input/Select, Input/Checkbox
- Badge/TypePill, Tag/SourceTag
- Card/BaseCard

Molecules
- SourceForm（Name, TypeSelect, Textarea, URLInput, FileInput, AddButton）
- SourceItem（TypePill, Title, URL, PickCheckbox, SummarizeButton, SummaryHint）
- AskControls（QuestionTextarea, AskButton, CopyButton, SelectedCount）
- GeneratorButtons（7 个生成类型按钮）
- FlowControls（FlowSelect, SlidesTemplateSelect, StepsInput, RunFlowButton, RunStepsButton, Copy/Download/SaveDefaults）
- PresetControls（PresetNameInput, SavePreset, PresetSelect, DeletePreset, UpdatePreset, PerSourceCheckbox, RunPreset, DownloadBatch）
- JobsList（JobItem 可点击查看详情）

Organisms
- SourcesPanel（SourceForm + SourceList）
- AskPanel（问答输出区域：AnswerCard 包含“回答/多层次总结/场景化/引用”四块）
- GeneratorsPanel（输出区域 + 引用）
- FlowPanel（Flow 输出 + 批处理输出 + 任务列表）
- Topbar（品牌、状态栏、重建索引按钮、健康/Meta 指示可选）

— 4) 交互（Interactions）
- 按钮：hover 提升边框/阴影；active scale(0.98)；过渡 `all var(--dur-med) var(--easing)`。
- 卡片：hover 使用 `--shadow-md`；可复制内容（navigator.clipboard）。
- 文件上传：PDF/表格/字幕走“服务端解析”提示；文本类读取后填充 textarea。
- 提问：展示回答 + 多层摘要 + 场景化 + 引用；提供复制。
- 生成器：点击生成对应类型；mind_map 附 Mermaid 代码块；均支持复制/下载 Markdown。
- Flow：
  - 流程：选择内置流程（summary_slides_quiz）或手填 `steps`（逗号分隔）。
  - 预设：保存/选择/删除/更新；“逐条来源批跑”将每个来源作为独立 Job 运行。
  - 导出：Flow 输出与批处理支持 Markdown/JSON 下载；任务列表可点击查看 Job 详情。
- 状态栏：展示“添加来源中 / AI 回答中 / 生成中 / 重建索引中 / 已完成”等。

— 5) 输出区域结构（规范）
- AnswerCard：
  【回答】…
  【多层次总结】短/中/长…
  【场景化】学生/专家/儿童…
  【引用】列表（来源名 + 片段）
- GeneratorOutput：按类型拼装，mind_map 增 Mermaid，report 按“摘要/背景/关键洞察/逻辑链条/数据引用/结论与建议”；slides 按 `# Slide N 标题` 行文；附【引用】。
- FlowOutput：分节展示各步骤；BatchOutput：按 Job 展开；均可复制/下载（MD/JSON）。

— 6) 无障碍与响应式
- 提供清晰的 focus 样式与 aria-label（按钮/输入）。
- 常见断点下（≥1200px 桌面，≤768px 折叠为上下布局）保持可用性。

— 7) Mock / API（可选）
- 可使用本地 `fetch` 调用约定 API（/api/sources、/api/ask、/api/generate、/api/flows 等），或在 Demo 中提供 mock 数据与延迟模拟。

— 8) 最终输出要求
- 产物：一个可直接运行的 index.html（含 Tokens/组件/交互/示例数据/JS 逻辑）。
- 代码：结构清晰、注释标注关键组件树，语义化标签（section/aside/main/nav）。
- 体验：默认深色主题；可切换浅色（可选）。
 
