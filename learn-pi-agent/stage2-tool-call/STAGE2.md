# 阶段 2：Tool Call —— 让 LLM 调用函数

对标 pi：`packages/agent/src/types.ts` 的 `AgentTool`，`agent-loop.ts` 的 `executeToolCalls`

## 承上：阶段 1 回顾

阶段 1 建立了和 LLM 的通信能力——从单次 HTTP POST 到流式多轮对话，从裸 JSON 往返到带重试的生产级可靠性。但阶段 1 的 LLM 只会**说话**：所有回复都是文本，LLM 无法感知外部世界。

阶段 2 的核心突破：让 LLM **做事**。通过 Tool Call（函数调用），LLM 不再只输出文本，而是输出一个 JSON 对象描述"我要调用哪个函数，传什么参数"。你的代码执行这个函数，把结果送回 LLM，LLM 根据结果继续推理。

这是 ReAct 循环的**引擎**——阶段 3 只是把它包进 while 循环。

## 概述

四个脚本层层递进：先用裸 fetch 手写工具调用验证 DeepSeek 兼容性 → 切换到 openai SDK 建立工具注册表体系 → 解决"一次多个 tool call 怎么执行"的问题 → 用 while 循环替代固定调用次数。完成后你将拥有一个能调任意函数的 LLM agent 雏形。

## 2.1 原始 function call

**核心认知：Tool call 不是魔法——LLM 返回的不是 content 而是 tool_calls JSON 数组，你执行函数、把结果作为 `role: "tool"` 消息注入回去，LLM 再据此回复。**

### 完整链路：2 次 API 调用

```
第 1 次调用（带 tools 定义）
  你发出: { model, messages, tools: [weatherTool] }
      ↓
  LLM 返回: finish_reason="tool_calls"
            choices[0].message.tool_calls = [{ id, function: { name: "getWeather", arguments: '{"city":"北京"}' } }]

你执行 getWeather("北京") → "晴天，25°C，湿度 40%"

第 2 次调用（注入 tool result）
  你发出: { model, messages: [...原消息, assistant(tool_calls), tool(result)] }
      ↓
  LLM 返回: finish_reason="stop"
            choices[0].message.content = "北京今天晴天，气温 25°C..."
```

### 消息结构变化

这是阶段 1 从未出现的新消息角色：

```ts
// 阶段 1 只有 3 种角色
{ role: "system" }      // 系统提示词
{ role: "user" }        // 用户输入
{ role: "assistant" }   // LLM 回复（纯文本）

// 阶段 2 新增了 tool 结果 + assistant 携带 tool_calls
{ role: "assistant", tool_calls: [{ id, function: { name, arguments } }] }
{ role: "tool", tool_call_id: "xxx", content: "工具执行结果" }
```

### 关键细节

- `finish_reason === "tool_calls"` 表示 LLM 要求调用工具（而非 `"stop"` 表示对话结束）
- `tc.function.arguments` 是 JSON 字符串，需要 `JSON.parse` 才能拿到活的 JS 对象
- 第 2 次调用注入 tool result 时，每条消息必须带上 `tool_call_id` 关联到对应的 tool call
- 这一步**用 fetch 裸调**，目的是验证 DeepSeek 完全兼容 OpenAI 的 tool call 协议

**对标 pi**：`AgentTool` 接口的 `execute` 函数，`openai-completions.ts` 中构造 tools 参数的逻辑。

## 2.2 工具注册表 + 切换到 openai SDK

**核心认知：工具不再散落在外，注册到 ToolRegistry 统一管理。同时从裸 fetch 切换到 openai SDK，让 SDK 处理序列化和协议细节。**

### 从 fetch 到 SDK

```ts
// 2.1 的方式（裸 fetch）
const response = await fetch(API_URL, {
  method: "POST",
  headers: { "Authorization": `Bearer ${key}` },
  body: JSON.stringify({ model, messages, tools })
})

// 2.2 的方式（openai SDK）
const client = new OpenAI({
  apiKey: DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",   // ← 指向 DeepSeek
})
const response = await client.chat.completions.create({
  model: "deepseek-v4-pro",
  messages,
  tools: registry.getDefinitions(),       // ← 工具定义由 registry 统一产出
})
```

SDK 自动处理 token 管理、request/response 序列化、类型推导。后续阶段全部基于 SDK。

### ToolRegistry 的三个核心方法

```ts
class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map()

  register(tool)       // 存入 Map
  getDefinitions()     // 遍历 → 转为 OpenAI 线格式 { type: "function", function: { name, description, parameters } }
  execute(name, args)  // Map.get → 调 tool.execute(args)
}
```

### RegisteredTool 接口

```ts
interface RegisteredTool {
  name: string
  description: string
  parameters: Record<string, any>            // JSON Schema
  executionMode?: "parallel" | "sequential"  // 执行模式（2.3 用）
  execute: (args) => Promise<string> | string
}
```

### 设计思想

`RegisteredTool` 同时包含**声明**（name / description / parameters）和**实现**（execute）。这和 pi 的 `AgentTool` 设计完全一致：工具定义跟着工具走，注册表只管"存"和"查"，不关心工具具体做什么。新增工具只需 `registry.register(myTool)`，对话流程代码零改动。

**对标 pi**：`AgentTool` 接口，`types.ts` 的 tool 相关类型定义。

## 2.3 并行 vs 串行执行

**核心认知：LLM 一次可以返回多个 tool_call。怎么执行取决于工具之间有没依赖——互不依赖可以并行（Promise.all），有副作用的必须串行（for + await）。**

### 为什么需要两种模式

```
场景 A（可并行）：查北京天气 + 查上海天气 + 查东京天气
  → 三个查询互不依赖，Promise.all 同时发出 → ~50ms 全搞定
  → 串行要 150ms 起步

场景 B（必须串行）：查北京天气 + 写文件记录查询时间
  → writeFile 有副作用，如果和查天气并行执行，记录的时间可能不准
  → 必须串行：先查天气 → 再写文件
```

### pi 的策略

默认并行。如果**任何一个** tool 标记了 `executionMode === "sequential"`，整批降级为串行。

```ts
function shouldRunSequential(toolCalls, registry): boolean {
  return toolCalls.some(tc => registry.get(tc.name)?.executionMode === "sequential")
}

function executeToolCalls(toolCalls, registry) {  // 分发器
  if (shouldRunSequential(toolCalls, registry))
    return executeSequential(toolCalls, registry)   // for + await
  else
    return executeParallel(toolCalls, registry)     // Promise.all
}
```

### 为什么"整批降级"而非"混合执行"

标记 sequential 的工具可能有全局副作用（写文件、发邮件）。如果它和另一个查询工具并行，查询的结果可能在副作用生效前就被返回。整批降级保证执行顺序确定、可预期。

**对标 pi**：`agent-loop.ts` 的 `executeToolCalls` / `executeToolCallsParallel` / `executeToolCallsSequential`。

## 2.4 Tool Loop

**核心认知：2.2 固定 2 次调用不够——LLM 可能连续要求多次工具调用。解决方案：把"调 LLM → 执行工具 → 注入结果"包进 while(true)，直到 finish_reason === "stop"。**

### 从 2 次固定调用到 while 循环

```
2.2 的方式（固定 2 次）:
  第 1 次调用 → 执行工具 → 第 2 次调用 → 返回

2.4 的方式（while 循环）:
  while true:
    调 LLM（带 tools）
    if finish_reason === "stop" → 退出，返回 content
    执行所有 tool_call
    注入 assistant 消息 + tool 结果到 messages
    // 继续循环，LLM 看到新结果后决定：再调工具 or 回复 stop
```

### 为什么需要这个

LLM 的推理可能是多步的。例如：

```
用户: "北京天气如何？顺便算 123*456"

第 1 轮: LLM 返回 [getWeather("北京"), calculator("123*456")]  ← 一次要多个工具
第 2 轮: LLM 看到两个结果，综合后回复: "北京晴天25°C，123*456=56088"
```

更复杂的场景：LLM 可能先查天气 → 发现温度异常 → 再查历史数据 → 综合分析 → 回复。没有 while 循环，多步推理无法实现。

### 距 agent loop 还差一步

tool loop 只处理"LLM 要求工具 → 执行 → 继续"这一种循环。完整 agent loop（阶段 3）还需要：

- **steering 队列**：在工具执行间隙注入干预消息（人机协作）
- **follow-up 队列**：LLM stop 后检查是否有后续任务
- **stop_reason 分支**：处理 endTurn / maxTokens / error / aborted
- **事件系统**：每一步广播 event 给 UI / 日志 / subscriber

**对标 pi**：内层 while（tool + steering），`agent-loop.ts` 的 `consumeToolCalls` + steering 注入逻辑。

---

## 阶段 2 总结：你已经具备的能力

| 脚本 | 能力 | 对标 pi |
|------|------|---------|
| 2.1 function-call | 裸 fetch 走通 tool call 完整链路 | `AgentTool.execute` |
| 2.2 tool-registry | 工具注册表 + openai SDK 切换 | `AgentTool` 接口 |
| 2.3 parallel-vs-seq | 并行/串行执行 + 分发器 | `executeToolCalls` |
| 2.4 tool-loop | while 循环替代 2 次固定调用 | agent loop 内层 while |

## 启下：阶段 3 预览

阶段 2 让 LLM **能做事**。阶段 3 把 `toolLoop` 扩展为完整的 **Agent Loop**——ReAct 论文的工程化实现。

```
阶段 2 的 tool loop:
  while (finish_reason !== "stop"):
    LLM → 执行工具 → 注入结果

阶段 3 的 agent loop:
  外层 while（follow-up 队列）:
    内层 while（steering + tool）:
      stream LLM → emit 事件
      if stop → 检查 stop_reason
      if tool_call → 并行/串行执行 → emit 事件 → 注入结果 → 继续
```

核心新增：事件系统（`AgentEvent`）、steering 注入、follow-up 队列、`AbortSignal` 全程传播、`stop_reason` 多分支处理。

---

## 关于 TS 中访问控制的思考

TS 的访问控制有两个层次：类级和成员级，设计方向恰好相反————类级可见通过 export 前缀控制——不 export 的类对外界不存在，默认隐藏。这种类默认私有、成员默认公开的访问控制思想与之前学的 cpp 类恰恰相反————cpp没有类级可见，也就是说类强制公开，成员默认私有。

> 这是 ES6 模块系统从零设计带来的红利。C++ 用 #include 文本复制来共享声明，所以类天然公开且无法隐藏。JS/TS 没有这个历史包袱，选择了"默认私有，选择性公开"。Rust 的 pub、Python 的 __all__ 做了同样的选择——模块系统现代化的趋势。

比较神奇的是，TS/JS 的访问控制似乎有点松弛：在 ES2022 引入 # 强制私有属性前，TS/JS 仅通过 _前缀 约定私有属性，public 限定符只在编译期检查，在运行时访问私有对象并不报错。这并不是因为 JS/TS 不想做成员访问控制，而是因为 class 是 原型链 prototype 的语法糖，原型上的属性天然暴露在对象上，语法糖并不能改变底层语义，导致访问控制无法实现。

真正运行时刻隔离要到 ES2022 的 # 前缀才解决——foo.#secret 在类外部直接 SyntaxError，编译器加运行时双重保障。当然引入访问控制并不是没有代价的，由于其改动了底层设计，导致 ES2022 并不能向上兼容，旧引擎遇到 # 直接报错。

> 为什么选择 # 作为前缀？
TC39 委员会看了一圈，发现 # 是唯一一个"全平台、全版本、全引擎都从来不让用"的字符——所有旧 JS 引擎都把它当语法错误。用它做新语法，不会误伤任何合法的老代码。顺便说个反面案例：Python 2 选了 @ 做装饰器，但 @ 在此之前不是非法字符——它只是"没人用过"。结果确实和老代码零冲突。JS 选 # 更稳妥：不是"没人用"，是"一直非法"。

### 文件结构

```
stage2-tool-call/
├── 2.1-function-call.ts           ← 导出 chatWithTool()，fetch 裸调
├── 2.1-function-call.test.ts
├── 2.2-tool-registry.ts           ← 导出 ToolRegistry / chatWithTools()，SDK
├── 2.2-tool-registry.test.ts
├── 2.3-parallel-vs-seq.ts         ← 导出 executeToolCalls / executeParallel / executeSequential
├── 2.3-parallel-vs-seq.test.ts
├── 2.4-tool-loop.ts               ← 导出 toolLoop()
├── 2.4-tool-loop.test.ts
└── STAGE2.md
```

共用模块（跨阶段共享）：

```
shared/
├── types.ts           ← ToolCall / ToolResult / ChatResult 类型
└── tool-fixtures.ts   ← getWeatherTool / calculatorTool / writeFileTool
```
