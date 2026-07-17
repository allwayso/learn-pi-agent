# 阶段 1：LLM 调用基础

对标 pi：`packages/ai/src/api/openai-completions.ts`

## 承上：阶段 0 回顾

阶段 0 建立了 TypeScript 语言基础——类型系统（interface/type/泛型/Discriminated Union）、异步编程（Promise/async-await/AbortController）、HTTP 调用（fetch/流式读取/dotenv）。阶段 1 把这些基础能力组合成完整的 LLM 通信层：从单次 HTTP 调用到流式多轮对话，从裸 JSON 返回到带重试的生产级可靠性。

## 概述

阶段 1 的目标：从零建立起和 DeepSeek 的通信能力。四个脚本层层递进，从单次 HTTP 调用到流式多轮对话，最终具备写一个命令行版 ChatGPT 的能力。

## 1.1 原始 API 调用

**核心认知：LLM API 就是一个 HTTP POST，没有魔法。**

```
你发出                           你收到
{ model, messages, stream }  →  { choices[0].message.content, usage, finish_reason }
```

```ts
const response = await fetch(API_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
  },
  body: JSON.stringify({
    model: "deepseek-v4-pro",
    messages: [
      { role: "system", content: "你是一个有用的助手" },
      { role: "user", content: "你好" },
    ],
    stream: false,
  }),
})
```

请求发 JSON，响应收 JSON，`response.json()` 之后就是普通 JS 对象。`data.choices[0].message.content` 就是回复文本，`data.usage` 记录 token 消耗，`data.choices[0].finish_reason` 告诉你为什么停了。

**输出**：导出 `chatOnce(messages) → ChatResult`，被后续模块复用。

## 1.2 多轮对话

**核心认知：LLM 没有记忆，每次对话靠客户端把完整历史全发过去。**

```ts
class ChatLoop {
  messages: Message[]  // system + user + assistant + user + assistant ...
  totalTokens: number
  turnCount: number

  async send(userContent: string): Promise<ChatResult> {
    this.messages.push({ role: "user", content: userContent })          // 1. 记录用户输入
    const result = await chatOnce(this.messages)                         // 2. 带上全部历史调 API
    this.messages.push({ role: "assistant", content: result.content })   // 3. 记录 LLM 回复
    this.totalTokens += result.usage.totalTokens                         // 4. 累计 token
    this.turnCount += 1
    return result
  }
}
```

流程：push user → chatOnce(全部历史) → push assistant → 重复。这就是 agent loop 的消息累积雏形——阶段 3 只是把 LLM 回复从纯文本换成了 tool call。

## 1.3 流式输出

**核心认知：stream: true → 解析 SSE → token-by-token 消费回调。**

### SSE 格式

```
data: {"choices":[{"delta":{"content":"你"}}]}

data: {"choices":[{"delta":{"content":"好"}}]}

data: [DONE]
```

### 处理流程

```ts
const reader = response.body!.getReader()     // ReadableStream
const decoder = new TextDecoder()
let buffer = ""

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buffer += decoder.decode(value, { stream: true })   // 二进制 → 文本 → 拼接

  const events = buffer.split("\n\n")                  // SSE 事件间用空行分隔
  buffer = events.pop()!                               // 残片留回

  for (const event of events) {
    if (event.startsWith("data:") && event.slice(6) !== "[DONE]") {
      const token = JSON.parse(event.slice(6)).choices[0].delta.content
      if (token) { onToken(token); content += token }
    }
  }
}
// while 结束后排空 buffer 残片
```

### 实时打字效果

```ts
await streamChat(messages, (token) => process.stdout.write(token))
```

### 关键设计讨论：流中错误 vs 抛异常

| 传统做法 | pi 的做法 |
|----------|-----------|
| 流中出错 → throw → try/catch 捕获 | 流中出错 → 广播 stopReason="error" → loop 检查 |
| 已收到的 token 全部丢失 | 已收到的 token 可以消费 |

agent 是长时运行的流式过程，LLM 在第 80% token 后断开，你不想丢失已收内容。把错误编码进事件流，loop 可以消费部分结果后再决定。

### buffer 截断问题

`while` 循环的最后一次 `read()` 可能留下一段不完整的 SSE 事件在 buffer 中。循环结束后必须排空：

```ts
// 排空 buffer 残片
const remaining = buffer.split("\n\n")
for (const event of remaining) {
  if (event.startsWith("data:") && event.slice(6).trim() !== "[DONE]") {
    // 处理最后的事件...
  }
}
```

## 1.4 JSON 模式

**核心认知：`response_format: { type: "json_object" }` 约束输出格式。这是 tool call 的前身。**

### 与流式模式的区别

```
streamChat:  body.stream = true          → 流式 token
jsonChat:    body.response_format = ...  → JSON 字符串
```

只需在 body 中加一行，其余结构完全一致。

### 返回值的清洗链路

LLM 返回的 content 需要清洗才能喂给 `JSON.parse`：

```
原始 content:  "```json\n{\"name\":\"张三\",\"age\":25}\n```"
      ↓ 去掉 markdown 代码块标记
              "{\"name\":\"张三\",\"age\":25}"
      ↓ 裁取第一个 { 到最后一个 }
              "{\"name\":\"张三\",\"age\":25}"
      ↓ JSON.parse
              { name: "张三", age: 25 }           ← 活的 JS 对象
```

### JSON mode vs Tool call

| | JSON mode（1.4） | Tool call（阶段 2） |
|---|---|---|
| schema 在哪 | system prompt 里自然语言 | `tools[].function.parameters` 里 JSON Schema |
| 谁校验 | 手动 `JSON.parse` | API 层强约束 |
| 可靠性 | 口头约定 | 合同条款 |

## 1.5 重试机制

**核心认知：网络不可靠，但错误分两类——能重试的和不能重试的。**

### 指数退避 + 随机抖动

```
失败 → 等 1s  → 重试 → 又失败 → 等 2s  → 重试 → 又失败 → 等 4s  → 重试
       ↑ 指数增长                              ↑ 随机偏移 ±25%
       避免反复捶打服务器                      避免所有客户端同时重试（雪崩）
```

```ts
const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs)
const jitter = delay * 0.25 * (Math.random() * 2 - 1)  // ±25%
await sleep(delay + jitter)
```

### 错误分类

```ts
function isRetryableError(error: Error): boolean {
  const statusMatch = error.message.match(/API 错误 \[(\d+)\]/)
  const status = statusMatch ? parseInt(statusMatch[1]) : 0

  if (status) {
    if (status === 429 || status >= 500) return true   // 限流 / 服务端故障
    return false                                        // 401, 403, 402 等客户端错误
  }
  return true  // 无状态码 = 网络错误（fetch failed、ECONNREFUSED 等）→ 可重试
}
```

### 通用包装器

```ts
const result = await withRetry(
  () => chatOnce(messages),  // 任何异步函数
  { maxRetries: 3 }          // 可选配置
)
```

### 对照 pi

pi 的 retry 不发生在 HTTP 层，而是作用于 `AssistantMessage` 层：错误通过 event stream 传递后，由 agent loop 调用 `isRetryableAssistantError()` 判断是否重试整个 assistant turn。阶段 3 引入 event stream 后我们将对齐这种设计。

---

## 阶段 1 总结：你已经具备的能力

| 脚本 | 能力 | 对 pi |
|------|------|-------|
| 1.1 raw-api | HTTP POST → JSON 往返 | `openai-completions.ts` 请求构造 |
| 1.2 chat-loop | 消息累积 → 多轮对话 | agent loop 的消息队列雏形 |
| 1.3 streaming | SSE 解析 → token-by-token + buffer 排空 | `openai-completions.ts` stream() |
| 1.4 json-mode | 约束输出 + 清洗解析 | tool call 的前身 |
| 1.5 retry | 指数退避 + jitter + 可重试分类 | `utils/retry.ts` |

## 启下：阶段 2 预览

阶段 1 让 LLM **说话**。阶段 2 让 LLM **做事**。

核心概念 **Tool Call（函数调用）**：LLM 不再只输出文本，而是输出一个 JSON 对象描述"我要调用哪个函数，传什么参数"。你的代码执行这个函数，把结果送回给 LLM，LLM 根据结果继续推理。

```
阶段 1 的对话：
  用户: "北京今天天气怎么样？"
  LLM:  "抱歉，我不知道实时天气。"

阶段 2 的对话（加了天气查询工具）：
  用户: "北京今天天气怎么样？"
  LLM:  [调用 getWeather({ city: "北京" })]
  系统:  [执行 getWeather → 返回 { temp: 25, condition: "晴" }]
  LLM:  "北京今天晴天，气温 25°C。"
```

阶段 2 做完后，阶段 3 把它串成一个 while 循环 → 就得到了 ReAct agent loop。

---

## 贯穿阶段 1 的技术要点

### DeepSeek API Key 冲突

系统环境变量 `DEEPSEEK_API_KEY` 会覆盖 `.env` 中的新 key。**必须**在所有脚本中使用：

```ts
import dotenv from "dotenv"
dotenv.config({ override: true })   // ← 强制 .env 覆盖系统环境变量
```

### 文件结构

```
stage1-llm-basics/
├── 1.1-raw-api.ts            ← 导出 chatOnce()
├── 1.1-raw-api.test.ts
├── 1.2-chat-loop.ts          ← 导出 ChatLoop，复用 1.1
├── 1.2-chat-loop.test.ts
├── 1.3-streaming.ts          ← 导出 streamChat()
├── 1.3-streaming.test.ts
├── 1.4-json-mode.ts          ← 导出 jsonChat()
├── 1.4-json-mode.test.ts
├── 1.5-retry.ts              ← 待完成
└── 1.5-retry.test.ts
```

每个子阶段拆分实现与测试，测试文件独立运行自检。
