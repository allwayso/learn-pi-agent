// 2.1 function-call.ts — 手写 tool call
// 目的：用 fetch 裸调，走通"定义工具 → LLM 决定调用 → 执行 → 注入结果 → LLM 回复"的完整链路
// 对标 pi：packages/ai/src/types.ts 的 Tool / ToolCall，openai-completions.ts 的 tools 参数
//
// 核心流程：
//   第 1 次 API 调用（带 tools）
//   → LLM 返回 finish_reason="tool_calls" + tool_calls 数组（不是 content）
//   → 你执行这些函数
//   → 第 2 次 API 调用（注入 tool result 消息）
//   → LLM 根据结果回复最终答案

import dotenv from "dotenv"
dotenv.config({ override: true })

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY!
const API_URL = "https://api.deepseek.com/chat/completions"

// ─── 工具定义 ───

/** 工具函数：获取城市天气（模拟） */
function getWeather(city: string): string {
  const weathers: Record<string, string> = {
    "北京": "晴天，25°C，湿度 40%",
    "上海": "多云，28°C，湿度 65%",
    "东京": "小雨，22°C，湿度 80%",
  }
  return weathers[city] ?? `未找到 ${city} 的天气数据`
}

/** 工具函数的 JSON Schema 描述 */
const weatherTool = {
  type: "function" as const,
  function: {
    name: "getWeather",
    description: "获取指定城市的天气信息",
    parameters: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "城市名称，如 北京、上海、东京",
        },
      },
      required: ["city"],
    },
  },
}

// ─── 工具执行映射 ───

/** 根据 tool call 的 name 找到对应函数并执行，返回结果字符串 */
function executeToolCall(name: string, args: Record<string, any>): string {
  // TODO: 根据 name 分发到对应函数，目前只有 getWeather

  // ========== YOUR CODE HERE ==========
  if(name=="getWeather")  return getWeather(args.city)
  // ========== END YOUR CODE==========
  
}

// ─── 主要流程 ───

export interface ToolCallResult {
  finalContent: string     // LLM 最终回复（工具调用完成后）
  toolCalls: Array<{
    id: string
    name: string
    arguments: Record<string, any>
    result: string
  }>
}

/**
 * 完整的一次工具调用流程
 *
 *   第 1 次请求（带 tools）
 *   → 如果 LLM 返回 tool_calls，则逐个执行
 *   → 把 tool result 作为新消息注入 messages
 *   → 第 2 次请求（让 LLM 根据结果生成最终回复）
 */
export async function chatWithTool(userPrompt: string): Promise<ToolCallResult> {
  const messages: any[] = [
    { role: "user", content: userPrompt },
  ]

  // ─── 第 1 次调用：LLM 决定是否调用工具 ───
  // TODO:
  //   - body 中加 tools: [weatherTool]
  //   - 发送请求
  //   - 检查 finish_reason 是否为 "tool_calls"
  //   - 提取 response.choices[0].message.tool_calls（数组）
  //   - 每个 tool_call 包含: id, function.name, function.arguments（是 JSON 字符串需要 parse）
  //   - 把提取到的 tool_calls 数组赋值给下面用到的 toolCallsReceived 变量

  // ========== YOUR CODE HERE (第 1 次调用) ==========

  let toolCallsReceived: any[] = []

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-v4-pro",
      messages,
      stream: false,
      tools: [weatherTool]
    }),
  })

  const Json=await response.json()
  const finishReason=Json.choices[0].finish_reason
  const content_1=Json.choices[0].message.content

  if(finishReason !== "tool_calls") return { finalContent: content_1, toolCalls: [] }
  
  toolCallsReceived=Json.choices[0].message.tool_calls

  let finalContent = ""

  // ========== END YOUR CODE ==========

  const toolResults: ToolCallResult["toolCalls"] = []

  // ─── 执行工具 ───
  for (const tc of toolCallsReceived) {
    const args = JSON.parse(tc.function.arguments)

    // ========== YOUR CODE HERE (执行工具) ==========
    // 调用 executeToolCall(tc.function.name, args)，把结果存入 toolResults

  const result = executeToolCall(tc.function.name, args)
  toolResults.push({
    id: tc.id,
    name: tc.function.name,
    arguments: args,
    result: result
  })

    // ========== END YOUR CODE ==========
  }

  // ─── 第 2 次调用：把 tool result 注入，让 LLM 生成最终回复 ───
  // TODO:
  //   - 先把第 1 次的 assistant 消息（含 tool_calls）push 到 messages
  //   - 再把每个 tool result 作为 role="tool" 的消息 push
  //     { role: "tool", tool_call_id: tc.id, content: result }
  //   - 再次调用 API（不需要 tools 参数，或保留 tools）
  //   - 拿到 finalContent

  // ========== YOUR CODE HERE (第 2 次调用) ==========

  messages.push(Json.choices[0].message)   // 含 tool_calls 的完整 assistant 消息
  for (const tr of toolResults){
    messages.push({role:"tool",tool_call_id:tr.id,content:tr.result})
  }

  const response_2 = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-v4-pro",
      messages,
      stream: false,
      tools: [weatherTool]
    }),
  })

  finalContent=(await response_2.json()).choices[0].message.content

  // ========== END YOUR CODE ==========

  return { finalContent, toolCalls: toolResults }
}
