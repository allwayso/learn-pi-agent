# 阶段 3：Agent Loop —— 手写 pi 核心循环 ★★★★★

对标 pi：`packages/agent/src/agent-loop.ts`（790 行）+ `packages/ai/src/utils/event-stream.ts`

## 承上：阶段 2 回顾

阶段 2 让 LLM **能做事**——定义了工具，LLM 可以决定调用哪个函数、传什么参数，你的代码执行后把结果送回 LLM。2.4 的 `toolLoop` 已经把"调 LLM → 执行工具 → 注入结果"包进了 while 循环。

但 2.4 的 loop 是个"独裁者"——没人能中途打断它，它停下来了也不会自问"还有什么要做的"，错误直接崩溃，外部完全感知不到它在干什么。

阶段 3 把它升级为**完整的 Agent Loop**：双层 while（steering 干预 + follow-up 后续任务）、stop_reason 多分支（错误不 throw 而是编码进消息）、EventStream 事件管道（外部可观测每一步）。

这就是 ReAct 论文的工程化实现。

## 概述

四个脚本层层递进：最简流式 ReAct loop → 双层 while + stop_reason + 事件 → EventStream 数据结构 → 整合对齐 pi 接口。做完后你拥有一个可观测、可干预、有生命周期的 agent 运行时。

## 3.1 最简流式 ReAct loop

**核心认知：2.4 是非流式的——一次 API 调用拿到完整回复。3.1 换成流式，token-by-token 输出 + tool_calls 增量拼接。**

### 流式 tool call 的关键挑战

非流式时，tool_calls 是一个完整数组，每个 call 的 arguments 是完整 JSON。流式时它们是**碎片**：

```
Chunk 1:  delta.tool_calls[{ index:0, id:"call_1", function:{ name:"getWeather" } }]
Chunk 2:  delta.tool_calls[{ index:0, function:{ arguments:'{"city"' } }]     ← 增量片段
Chunk 3:  delta.tool_calls[{ index:0, function:{ arguments:':"北京"}' } }]    ← 继续拼接
```

需要按 `index` 分组，`arguments` 逐片拼接，最终 `JSON.parse` 拿到完整参数。

### 架构：ensureToolCall helper

参照 pi 的 `ensureToolCallBlock` 模式，把"确保条目存在 + 更新字段"抽成 helper，主循环只做流程控制：

```ts
// helper：只封最核心的判空 + 拼接
function ensureToolCall(pendingToolCalls, tc) {
  // 按 index 确保 Map 中存在条目 → 覆盖 id/name → 增量拼接 arguments
}

// 主循环：stream 创建 + content 拼接保留在循环里
for await (const chunk of stream) {
  if (delta.content) content += ...
  if (delta.tool_calls) for (const tc of delta.tool_calls) ensureToolCall(...)
}
```

### 和 pi 的对应

| 我们的代码 | pi |
|-----------|-----|
| `ensureToolCall` | `ensureToolCallBlock`（openai-completions.ts） |
| `minimalLoop` while 循环 | `runLoop` 内层 while |
| `finishReason` 分支 | `message.stopReason` 判断 |

## 3.2 完整 agent loop

**核心认知：3.1 是单层 while，LLM 说 stop 就退出。真实 agent 需要：双层 while、stop_reason 多分支、错误不 throw、AbortSignal 传播、事件系统。**

### 双层 while

```
外层 while（follow-up 队列）
  └─ agent 主动停下后，检查是否有后续任务，有就继续

  内层 while（tool + steering）
    └─ LLM 调用 → 工具执行 → 人机中途干预 → 继续或退出
```

### stop_reason 六路分支 + 错误编码

这是阶段 3 最重要的设计决策落地：**错误不 throw，编码进事件流**。

| stopReason | 行为 |
|-----------|------|
| `stop` / `endTurn` | push assistant 消息（含回复文本），退出内层 |
| `toolUse` | 落入脚手架执行工具 |
| `maxTokens` | 不执行工具（参数可能截断），push error tool result 告知 LLM |
| `error` / `aborted` | push error assistant 消息 → emit agent_end → return，全程不抛异常 |

实现上用一个 `shouldExecuteTools` 标志统一控制 switch 后脚手架是否执行，消除了 switch 各分支和底部 scaffolding 之间的职责重叠。

### streamAssistantResponse 的错误处理

LLM 流式调用放在 try/catch 内，异常发生时**不抛**，而是把错误信息和已累积的 partial content 一起编码进返回值：

```ts
try {
  // ...streaming...
} catch (e) {
  // content 在 try 外声明，catch 能拿到已收的 80% 文本
  return { content: content + "\n[错误] " + errorMsg, toolCalls, stopReason: "error" }
}
```

流中断到 80% 时，上层拿到的是"已收文本 + 错误标记"，不丢数据。

### 事件系统（最小版）

`emit(event)` 回调让外部感知 loop 每一步：turn_start/end、message_start/end、tool_start/end、agent_end。3.3 把它升级为 EventStream。

### 和 pi 的对应

| 我们的代码 | pi agent-loop.ts |
|-----------|-----------------|
| 外层 while + follow-up | `runLoop` 外层 `followUpMessages` |
| 内层 while + steering | `runLoop` 内层 `pendingMessages` |
| `shouldExecuteTools` 标志 | pi 无显式标志，靠控制流隐式处理 |
| `streamAssistantResponse` catch | `openai-completions.ts` catch 分支 |
| `emit` 回调 | `AgentEventSink` |

## 3.3 EventStream

**核心认知：3.2 的 emit 是 fire-and-forget。EventStream 是带生命周期的生产者-消费者队列——有结束条件、有结果提取、支持 for-await-of 消费。**

### push/pull 队列

```
生产者 push → 入队 or 直接交给等待的消费者
消费者 pull → 出队 or 挂起等待（Promise + resolve 存入 waiting 列表）
```

### 两个关键方法

- **`push(event)`**：检测 isComplete → 交付给 waiter or 入队 queue
- **`[Symbol.asyncIterator]()`**：queue 有则 yield → done 则 return → 否则挂起等 push 唤醒

### 和 EventEmitter 的本质区别

| | EventEmitter | EventStream |
|---|---|---|
| 结束语义 | 无（fire and forget） | 有（isComplete + result） |
| 消费方式 | `on("event", fn)` 并发 | `for await` 串行 pull |
| 结果提取 | 无 | `await stream.result()` |

**对标 pi**：`packages/ai/src/utils/event-stream.ts`（75 行），完全一致的 push/pull 队列结构。

## 3.4 整合：对齐 pi 接口

3.4 是胶水层：把 3.2 的 `emit` 回调置换成 3.3 的 `stream.push`，对齐 pi 的 `agentLoop() → EventStream` 接口。

```
3.2: agentLoop(prompt, ctx, config, emit) → Promise<AgentMessage[]>
3.4: agentLoop(prompt, ctx, config) → AgentEventStream
      外部用 for-await-of 消费事件 + result() 拿最终消息
```

`AgentEventStream` 预设了 `isComplete: e.type === "agent_end"` 和 `extractResult: e.messages`，一行 new 即可。

此外提供了 `cli.ts`——命令行 agent 入口，实时显示工具调用进度。

---

## 阶段 3 总结：你已经具备的能力

| 脚本 | 能力 | 对标 pi |
|------|------|---------|
| 3.1 minimal-loop | 流式 ReAct loop + tool_calls 增量解析 | `runLoop` 内层 while |
| 3.2 agent-loop-v1 | 双层 while + stop_reason 六路分支 + 错误编码 + 最小事件 | `runLoop` 全文 |
| 3.3 event-stream | 带生命周期的 push/pull 事件队列 | `EventStream` 类 |
| 3.4 agent-loop-integrated | 整合 3.2 + 3.3，对齐 pi 接口 | `agentLoop()` 返回 EventStream |

## 启下：阶段 4 预览

阶段 3 的 agent loop 是一个**函数**。阶段 4 把它封装成**Agent 类**——加上状态管理、消息体系、hook 系统和生命周期。

核心概念落地：**AgentMessage ≠ LLM Message**。Agent 内部消息比 LLM 协议更丰富（可含 UI 通知、状态消息），`convertToLlm()` 在 LLM 调用边界过滤和映射。`transformContext` 在 AgentMessage 层做上下文管理。

六个脚本逐层搭建：

| 脚本 | 内容 |
|------|------|
| 4.1 agent-v1 | 状态管理：systemPrompt/model/tools/messages + 运行时状态 |
| 4.2 message-layer | AgentMessage 体系 + convertToLlm + transformContext |
| 4.3 steer-follow | steering + followUp 队列完整实现 |
| 4.4 hooks | beforeToolCall / afterToolCall / shouldStopAfterTurn |
| 4.5 subscriber | subscribe() → listener 按序 await |
| 4.6 agent-full | Agent 类整合 + prompt/continue/abort/reset |

---

## 贯穿阶段 3 的技术要点

### 错误不 throw：全链路追踪

```
SDK 异常 → streamAssistantResponse catch
  → return { stopReason: "error", content: partial + errorMsg }
  → agentLoop switch 的 error/aborted 分支
  → emit agent_end → return
全程无 throw，loop 不崩溃
```

### shouldExecuteTools 标志

switch 和底部 scaffolding 的职责分离方案——用单一布尔标志控制"是否执行工具"，消除了各 case 与底部代码之间的隐式耦合（双重 turn_end、maxTokens 重复执行等）。

### EventStream 的 waiting 队列

不是 callback 数组，是**Promise resolve 函数**的数组。消费者在 async iterator 里 new Promise 并把 resolve 塞进去，生产者 push 时调 resolve 唤醒。这是 push/pull 队列的核心机制。

### 文件结构

```
stage3-agent-loop/
├── 3.1-minimal-loop.ts
├── 3.1-minimal-loop.test.ts
├── 3.2-agent-loop-v1.ts          ← 导入 2.2 ToolRegistry + shared 类型
├── 3.2-agent-loop-v1.test.ts
├── 3.3-event-stream.ts           ← 独立模块，无外部依赖
├── 3.3-event-stream.test.ts
├── 3.4-agent-loop-integrated.ts  ← 导入 3.2 + 3.3
├── 3.4-agent-loop-integrated.test.ts
├── cli.ts                        ← 命令行入口
└── STAGE3.md
```
