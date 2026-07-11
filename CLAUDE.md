# CLAUDE.md

## 项目定位

Agent 学习仓库。终极目标：能手写出 [pi agent](https://github.com/earendil-works/pi-mono) 的主干代码。

pi agent 是极简但完整的现代 agent 运行时（TypeScript / MIT），本地克隆在 `D:\2026Summer\agent\pi\`。

pi 的 4 层架构：

- `pi-ai` — 统一多厂商 LLM API（30+ provider），`packages/ai/src/`
- `pi-agent-core` — Agent 运行时，`packages/agent/src/agent-loop.ts`（790行）+ `agent.ts`（575行）+ `harness/`（~1600行）
- `pi-coding-agent` — 交互式 CLI 编程 agent
- `pi-tui` / `pi-orchestrator` — 终端 UI / 多 agent 编排

核心：agent loop 是嵌套 while 循环（流式 LLM → 解析 tool call → 执行 → 注入结果 → 继续）。大部分代码在 harness 层。pi 的精华是架构决策（AgentMessage ≠ LLM Message、错误编码进 event stream、EventStream push 模式、AbortSignal 全程传播）。

所有代码用 **TypeScript** 写，与 pi 源码同语言，零翻译成本。

## 开发环境

- Windows 11，bash shell（Git Bash 或 WSL）
- Node.js 18+，npm
- DeepSeek API（OpenAI 兼容），key 放 `.env`
- 运行：`npx tsx learn-pi-agent/stageN-xxx/N.N file.ts`
- 依赖：
  - 阶段 1 + 2.1：Node.js 内置 `fetch`，不依赖第三方 HTTP 库
  - 阶段 2.2 起：`openai` npm 包（`baseURL` 指向 DeepSeek）

```bash
npm install          # 安装所有依赖
npx tsx file.ts     # 直接运行 TypeScript
```

## 目录结构

```
agent/
├── learn-pi-agent/              # ★ 所有阶段代码（TypeScript）
│   ├── notes/                   # 跨阶段架构笔记
│   ├── stage0-ts-basics/        # 阶段 0：TypeScript 入门
│   ├── stage1-llm-basics/
│   ├── ...
│   └── stage8-pi-core/
├── ReAct/                       # ReAct 论文笔记
├── pi/                          # pi 源码（TypeScript，只读参照）
├── package.json                 # Node.js 依赖
├── tsconfig.json                # TypeScript 配置
├── .env                         # API Key（gitignore）
├── CLAUDE.md
└── README.md
```

每个阶段在 `learn-pi-agent/stageN-<topic>/` 下建目录和脚本。

笔记规则：
- 每个阶段目录放一个 `NOTES.md`，记录该阶段学习过程中的发现和问题
- 跨阶段的架构洞察放 `learn-pi-agent/notes/`（如 `architecture.md`、`design-decisions.md`）
- 和 `ReAct/notes/ReAct.md` 保持一致的笔记风格

```
learn-pi-agent/
├── notes/                       # 跨阶段笔记
│   ├── architecture.md
│   └── design-decisions.md
├── stage0-ts-basics/
│   ├── 0.1 hello.ts
│   ├── 0.2 types.ts
│   ├── 0.3 async.ts
│   ├── 0.4 fetch.ts
│   └── NOTES.md
├── stage1-llm-basics/
│   ├── 1.1 raw-api.ts
│   ├── ...
│   └── NOTES.md
├── stage2-tool-call/
│   ├── 2.1 function-call.ts
│   ├── ...
│   └── NOTES.md
├── ...
```

## 两个贯穿全程的核心概念

在你开始之前，记住 pi 的两个关键设计决策——它们贯穿阶段 3~8：

1. **AgentMessage ≠ LLM Message**：agent 内部消息比 LLM 协议丰富（可含 UI 通知、状态消息等），在 LLM 调用边界通过 `convertToLlm()` 转换。这让上下文压缩可以在 AgentMessage 层操作。参见阶段 4。

2. **错误不 throw，编码进 event stream**：LLM 失败不抛异常，而是流式广播 `stopReason="error"` 的 AssistantMessage。loop 检查 stopReason 决定继续或退出。参见阶段 1.3 讨论、阶段 3 实现。

---

## 学习路线

逐层拆解 pi 主干，每阶段用 TypeScript 复刻一层。因为同语言，你可以直接 `code -d` 对比你的实现和 pi 源码。

### 阶段 0：TypeScript 入门
目录：`learn-pi-agent/stage0-ts-basics/`
目的：快速过一遍本项目所需的 TS 基础，不需要深入

| 脚本 | 内容 |
|------|------|
| `0.1 hello.ts` | Node.js + TypeScript 环境。用 `tsx` 运行第一个 TS 文件。`npm install` → `npx tsx hello.ts` |
| `0.2 types.ts` | 类型注解、interface、type、泛型基础。这些是理解 pi 类型系统的前提 |
| `0.3 async.ts` | async/await、Promise、try/catch。agent loop 全程异步 |
| `0.4 fetch.ts` | Node.js 内置 fetch API（对标 Python requests）。GET/POST、headers、JSON 解析、流式读取 |

产出：能用 TypeScript 写异步 HTTP 调用。

### 阶段 1：LLM 调用基础
目录：`learn-pi-agent/stage1-llm-basics/`
对标：pi `packages/ai/src/`

| 脚本 | 内容 | 对标 pi |
|------|------|---------|
| `1.1 raw-api.ts` | POST DeepSeek API，用 fetch 手写，看原始 JSON 往返 | — |
| `1.2 chat-loop.ts` | 多轮对话：messages 列表累积，用户输入 → LLM 回复 → 追加 → 循环 | — |
| `1.3 streaming.ts` | SSE 流式输出，token-by-token。讨论：流中错误 vs 抛异常（pi 选前者） | `streamSimple` |
| `1.4 json-mode.ts` | `response_format: { type: "json_object" }`，tool call 的前身 | — |
| `1.5 retry.ts` | 指数退避重试（~30行） | `utils/retry.ts` |

产出：能写带重试的流式 chat 循环。

### 阶段 2：Tool Call —— 让 LLM 调用函数
目录：`learn-pi-agent/stage2-tool-call/`
对标：pi `types.ts` 的 AgentTool 接口
注意：此阶段只做工具定义+调用+结果返回，不引入 beforeToolCall/afterToolCall hook（那些属于 AgentLoopConfig，推迟到阶段 4）

| 脚本 | 内容 | 对标 pi |
|------|------|---------|
| `2.1 function-call.ts` | 用 fetch 手写一次 function calling。tools 参数定义 → LLM 返回 tool_calls → 执行 → 追加 tool result → 继续。验证 DeepSeek 的 tool call 兼容性 | — |
| `2.2 tool-registry.ts` | **从这里开始切换到 openai SDK。** 工具注册表：schema 定义 → 函数映射 → 校验 → 执行 | `AgentTool` |
| `2.3 parallel-vs-seq.ts` | 并行 vs 串行工具执行。理解"什么时候必须串行" | `executeToolCallsParallel / Sequential` |
| `2.4 tool-loop.ts` | 单轮 tool call 循环：LLM 调用 → 可能返回多个 tool_call → 全部执行 → 结果注入 → LLM 再判断。还差一步到 agent loop | — |

产出：定义工具 → LLM 决定调用 → 并行/串行执行 → 返回结果。

### 阶段 3：Agent Loop —— 手写 pi 核心循环 ★★★★★
目录：`learn-pi-agent/stage3-agent-loop/`
对标：pi `agent-loop.ts`（790行）
背景：这就是 ReAct 论文的工程化实现。ReAct = Thought → Action → Observation 循环。pi 在此基础上增加了 steering 注入、follow-up 队列、abort 传播、stop_reason 处理、事件系统。

| 脚本 | 内容 | 对标 pi |
|------|------|---------|
| `3.1 minimal-loop.ts` | 最简 ReAct agent loop（~80行）：`while True: LLM流式调用 → 解析tool_call → 执行 → 追加结果 → 继续`。不处理边界情况 | `runLoop` 核心结构 |
| `3.2 agent-loop-v1.ts` | 完整复刻 `runLoop()`：双层 while（外层 follow-up，内层 tool+steering）+ streamAssistantResponse + executeToolCalls + stop_reason 处理（endTurn/maxTokens/error/aborted）。引入 AbortSignal 全程传播 + 错误传播（stopReason="error" 不 throw） | `agent-loop.ts` 全文 |
| `3.3 event-stream.ts` | 事件系统。pi 用的是 EventStream（有结束条件+结果提取），不是简单 EventEmitter。AgentEventSink 是 await 的，listener 按注册顺序串行执行。事件类型：agent_start/turn_start/message_*/tool_execution_*/turn_end/agent_end | `types.ts` AgentEvent，`agent-loop.ts` emit |
| `3.4 loop-vs-pi.md` | 逐段对照我们的实现和 pi 源码。同语言下可以直接 `code -d` 对比 | — |

产出：能手写完整 agent loop（~250行 TypeScript）。

### 阶段 4：Agent 类 —— 状态管理 + 消息队列 + Hook
目录：`learn-pi-agent/stage4-agent-class/`
对标：pi `agent.ts`（575行）+ `types.ts` AgentLoopConfig

核心概念：**AgentMessage ≠ LLM Message**。Agent 内部消息比 LLM 协议更丰富，`convertToLlm()` 在 LLM 调用边界过滤非 LLM 消息。`transformContext` 在 AgentMessage 层做上下文管理。

| 脚本 | 内容 | 对标 pi |
|------|------|---------|
| `4.1 agent-v1.ts` | 状态管理：systemPrompt/model/tools/messages + isStreaming/streamingMessage/pendingToolCalls/errorMessage | `AgentState`，`MutableAgentState` |
| `4.2 message-layer.ts` | AgentMessage 体系 + convertToLlm + transformContext。展示自定义消息类型如何融入对话流 | `AgentLoopConfig.convertToLlm` |
| `4.3 steer-follow.ts` | steering 队列（中断注入）+ followUp 队列（结束后继续）+ QueueMode（one-at-a-time / all） | `getSteeringMessages`，`getFollowUpMessages` |
| `4.4 hooks.ts` | beforeToolCall（校验后可 block）、afterToolCall（执行后可覆写 result）、shouldStopAfterTurn、prepareNextTurn。hook 属于 AgentLoopConfig 层，不是 tool 定义层 | `AgentLoopConfig` hooks |
| `4.5 subscriber.ts` | 事件订阅：subscribe() → 多个 listener 按注册顺序 await。agent_end 的 listener 也是 run 的一部分，所有 listener settle 后 agent 才算 idle | `agent.ts` subscribe |
| `4.6 agent-full.ts` | 整合：Agent 类 + prompt/continue/abort/reset。abort() 通过 AbortController 传播到全部层级 | `agent.ts` 全文 |

产出：带状态管理、消息队列、hook 和 abort 的 Agent 类。

### 阶段 5：Harness 层 —— 会话 + 系统提示词 + Skills
目录：`learn-pi-agent/stage5-harness/`
对标：pi `harness/`（不含 compaction，compaction 归阶段 6）

| 脚本 | 内容 | 对标 pi |
|------|------|---------|
| `5.1 session-store.ts` | JSONL append-only 会话存储。每条消息一行 JSON，可增量追加、完整回放 | `harness/session/jsonl-storage.ts`，`session.ts` |
| `5.2 system-prompt.ts` | 系统提示词分层组装：基础 prompt + skills 摘要 + tool 列表 + 环境信息 | `harness/system-prompt.ts` |
| `5.3 skills-loader.ts` | Skill 加载：遍历目录 → 解析 SKILL.md → 校验 frontmatter → 注入 system prompt。支持 ignore 文件 | `harness/skills.ts` |
| `5.4 prompt-templates.ts` | Prompt Template：预定义模板 → 参数填充 → 注入 conversation | `harness/prompt-templates.ts` |
| `5.5 agent-harness-v1.ts` | 整合：AgentHarness = Agent + Session + Skills + SystemPrompt + PromptTemplates | `harness/agent-harness.ts` |

产出：理解 session 持久化、skills 发现与注入、系统提示词组装。

### 阶段 6：上下文工程 —— 窗口管理 + 压缩
目录：`learn-pi-agent/stage6-context/`
对标：pi `harness/compaction/` + `transformContext`

| 脚本 | 内容 | 对标 pi |
|------|------|---------|
| `6.1 token-budget.ts` | tiktoken 计数 + 上下文预算感知。实时追踪 usage，决定是否触发压缩 | — |
| `6.2 sliding-window.ts` | 滑动窗口截断。超过预算 → 丢弃最早消息（保留 system prompt） | — |
| `6.3 summary-compact.ts` | 摘要压缩：旧消息 → LLM 摘要 → 替换。保留摘要 + 最近 N 条完整消息 | `harness/compaction/compaction.ts` |
| `6.4 branch-summary.ts` | 分支摘要（pi 最精妙的部分之一）。一个 assistant 消息可能发起多个 tool call，每个结果是一个"分支"，对每个分支做摘要 → 大幅压缩 tool result | `harness/compaction/branch-summarization.ts` |
| `6.5 progressive.ts` | 渐进式披露。Skills 的核心理念：先加载 description（~100 tokens），按需加载正文。引申到 tool result：先给摘要，LLM 需要细节时再展开 | — |
| `6.6 context-integration.ts` | 通过 transformContext 在每个 turn 前检查预算，超限 → 压缩 → 继续，对 loop 透明 | `AgentLoopConfig.transformContext` |

产出：理解"上下文是 agent 最稀缺的资源"，能手写三种压缩策略。

### 阶段 7：扩展话题 —— 子 Agent + MCP + Orchestrator
目录：`learn-pi-agent/stage7-extensions/`
注意：这些功能不在 pi-agent-core 中，属于 pi 生态体系（coding-agent / orchestrator）或通用模式。

| 脚本 | 内容 | 对标 |
|------|------|------|
| `7.1 sub-agent.ts` | 子 agent：独立上下文 → 只返回摘要 | pi coding-agent 子任务模式 |
| `7.2 mcp-client.ts` | 最小 MCP 客户端（Model Context Protocol，Anthropic 提出）。连接 server → 列出 tools → 注册为 AgentTool | — |
| `7.3 orchestrator.ts` | Orchestrator-Worker 模式 | pi-orchestrator |
| `7.4 hooks-system.ts` | 全局 hook 系统（超越 AgentLoopConfig）。session start/end、agent start/end 等生命周期 | — |

产出：理解 pi 生态的可扩展性基石和常见 agent 设计模式。

### 阶段 8：综合 —— 完整复刻 pi 主干 ★★★★★
目录：`learn-pi-agent/stage8-pi-core/`

| 脚本 | 内容 |
|------|------|
| `8.1 pi-agent.ts` | 完整版（~500行）：AgentLoop（双层 while + stop_reason + error 传播）+ EventStream + Agent 类（状态+消息+hook+abort+convertToLlm）+ Session 持久化 + Skills + Context 压缩 + 扩展。干净、可直接运行 |
| `8.2 diff-with-pi.md` | 逐模块对照我们的实现和 pi 源码。同语言下可以直接 `code -d` 做 diff |
| `8.3 from-scratch.md` | 白板挑战：不看代码，纯手写 agent loop |

完成时你应该能回答：

- 为什么 AgentMessage ≠ LLM Message？（agent 需要更丰富类型，convertToLlm 在边界做映射）
- 为什么 steering 和 followUp 是分开的队列？（steering 在内层循环检查，followUp 在外层）
- 为什么错误不 throw 而是编码进 event stream？（避免中断 loop，UI/listener 统一通过事件感知）
- 为什么用 EventStream 而非 EventEmitter？（有结束条件和结果提取，天然适合"一次运行"语义）
- 为什么工具执行分 before/execute/after 三阶段？（关注点分离，hook 在 AgentLoopConfig 层而非 tool 层）

---

## 当前进度：阶段 0

- [x] ReAct 论文精读（`ReAct/notes/ReAct.md`）
- [x] pi agent 源码结构理解
- [ ] 0.1 `hello.ts`
- [ ] 0.2 `types.ts`
- [ ] 0.3 `async.ts`
- [ ] 0.4 `fetch.ts`

## 协作守则

1. 每个脚本 < 200 行，先给完整可运行代码，再逐段解释
2. 每阶段结束时，指出 pi 的哪个文件/函数对应刚写的东西
3. 阶段 1 + 2.1 用 Node.js 内置 `fetch`，2.2 起用 `openai` SDK。目标不是学 HTTP 而是学 agent 架构
4. 讲新概念时搜索 arXiv/博客/GitHub，标注出处
5. 中文交流：文档、注释、解释用中文
6. 一个概念一个文件，文件名即概念名
7. API Key 放 `.env`，永不硬编码
8. 写脚本前先看对应 pi 源码（TS），重点不是翻译语法而是理解"为什么这样设计"
9. 每完成一个子阶段（如 1.1 raw-api.ts），提醒用户做 git commit，但不代为执行 commit
