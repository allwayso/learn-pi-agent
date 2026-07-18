// 3.1 minimal-loop.ts — 最简 ReAct agent loop（流式）
// 对标 pi：agent-loop.ts 的 runLoop 核心结构（内层 while）
//
// 和 2.4 tool-loop 的区别：
//   1. 流式调用 — token-by-token 输出 + tool_calls arguments 增量拼接
//      2.4 用非流式 SDK create，拿到完整 tool_calls 再执行
//      3.1 用 stream: true，边收 token 边累积 tool_calls
//   2. 引入 AgentContext — systemPrompt + tools 统一管理，不再散落参数
//   3. stopReason 感知 — 不再只看 finish_reason === "stop"，为阶段 3.2 的 error/aborted 多分支铺垫
//
// 流式 tool call 的关键挑战：
//   LLM 的 tool_calls arguments 是增量 JSON 片段，按 chunk 到达。
//   每个 chunk 的 delta.tool_calls[index] 可能只包含一个属性（id/name/arguments 之一）。
//   需要按 index 分组：id 和 name 只在首次出现时记录，arguments 逐片拼接。
//
// 架构：参照 pi 的 ensureToolCallBlock，把"确保条目存在 + 更新字段"抽成 ensureToolCall helper。
//   stream 创建和 content 拼接保留在主循环，只封装最核心的判空 + 拼接逻辑。
//
// TODO 清单：
//   ensureToolCall       — 按 index 确保 Map 中存在条目，覆盖更新 id/name，增量拼接 arguments
//   minimalLoop 流式消费 — for await 遍历 stream，从 delta 中提取 content / tool_calls / finish_reason
//   minimalLoop 分支     — finish_reason 判断：stop → 退出 / tool_calls → 继续执行
//   minimalLoop 注入结果  — 构造 assistant 消息 + tool 结果消息并 push 到 messages

import dotenv from "dotenv"
dotenv.config({ override: true })
import OpenAI from "openai"

import { ToolResult, ChatResult } from "../shared/types"
import { ToolRegistry } from "../stage2-tool-call/2.2-tool-registry"

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY!

const client = new OpenAI({
  apiKey: DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
})

// ─── Agent 上下文（简化版）───

/** Agent 的初始上下文：系统提示词 + 可用工具 */
export interface AgentContext {
  systemPrompt: string
  tools: ToolRegistry
}

// ─── 流式 tool call 解析辅助 ───

/**
 * 从流式 chunk 中增量累积的 tool call 条目。
 * arguments 是逐片拼接的 JSON 字符串，需要在外层 JSON.parse。
 */
interface PendingToolCall {
  id: string
  name: string
  arguments: string
}

/**
 * 确保 pendingToolCalls 中存在 tc.index 对应的条目，并更新字段。
 *
 * 对标 pi openai-completions.ts 的 ensureToolCallBlock：
 *   - 首次出现的 index → 创建空条目
 *   - id / name 有值则覆盖
 *   - arguments 增量拼接
 */
function ensureToolCall(
  pendingToolCalls: Map<number, PendingToolCall>,
  tc: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall,
): void {
  // TODO:
  //   - 取 tc.index 作为 key
  //   - key 不存在则 set 一个空条目
  //   - 通过 get 取 existing 引用
  //   - tc.id 有值则覆盖，tc.function.name 同理
  //   - tc.function.arguments 有值则拼接到末尾

  // ========== YOUR CODE HERE ==========
    const idx = tc.index
    if (!pendingToolCalls.has(idx)) {
      pendingToolCalls.set(idx, { id: "", name: "", arguments: "" })
    }
    const existing = pendingToolCalls.get(idx)!
    if (tc.id) existing.id = tc.id
    if (tc.function?.name) existing.name = tc.function.name
    if (tc.function?.arguments) existing.arguments += tc.function.arguments
  // ========== END YOUR CODE ==========
}

// ─── 最简 ReAct Loop ★ ───

/**
 * 最简流式 agent loop：LLM 流式回复 → 解析 tool_call → 执行 → 注入 → 继续。
 *
 * 流程：
 *   while true:
 *     流式调用 LLM（stream: true）
 *     for await 累积 content + 调 ensureToolCall 拼接 tool_calls + 记录 finishReason
 *     if stop → 返回最终回复
 *     if tool_calls → 执行工具 → 注入结果 → 继续循环
 */
export async function minimalLoop(
  userPrompt: string,
  context: AgentContext,
): Promise<ChatResult> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: context.systemPrompt },
    { role: "user", content: userPrompt },
  ]

  const steps: ToolResult[] = []

  // ─── Agent Loop ───
  while (true) {
    const stream = await client.chat.completions.create({
      model: "deepseek-v4-pro",
      messages,
      tools: context.tools.getDefinitions(),
      stream: true,
    })

    let content = ""
    const pendingToolCalls = new Map<number, PendingToolCall>()
    let finishReason: string | null = null

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta

      // TODO:
      //   - delta.content 有值则追加到 content
      //   - delta.tool_calls 非空则遍历，每个调 ensureToolCall(pendingToolCalls, tc)
      //   - finishReason 更新

      // ========== YOUR CODE HERE ==========
      if (delta?.content) content += delta.content
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          ensureToolCall(pendingToolCalls, tc)
        }
      }
      if (chunk.choices[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason
      // ========== END YOUR CODE ==========
    }

    // 如果 LLM 判定结束或工具调用为空，则退出循环
    if(finishReason=="stop" || pendingToolCalls.size==0) return {content,steps}
    const toolCalls=Array.from(pendingToolCalls.values())

    // TODO:
    //   - assistant 消息（含全部 tool_calls），只 push 一次
    //   - 遍历 toolCalls：逐个执行 → push 到 steps → push tool 结果消息（每条带 tool_call_id）

    // ========== YOUR CODE HERE ==========

    // 1. assistant 消息（只 push 一次，放在循环外面）
    messages.push({
      role: "assistant",
      content: content || null,
      tool_calls: toolCalls.map(tc => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments }
      }))
    })

    // 2. 逐条执行 tool call，push tool result
    for (const tc of toolCalls) {
      const result = await context.tools.execute(tc.name, JSON.parse(tc.arguments))
      steps.push({ toolCallId: tc.id, name: tc.name, result })

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result
      })
    }
    // ========== END YOUR CODE ==========
  }
}
