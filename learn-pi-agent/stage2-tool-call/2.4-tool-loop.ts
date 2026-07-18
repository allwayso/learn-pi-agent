// 2.4 tool-loop.ts — 单轮 tool call 循环
// 对标 pi：agent-loop.ts 的内层 while（tool + steering）
//
// 2.2 的 chatWithTools 只处理"1 次 tool call + 1 次最终回复"。
// 但 LLM 可能连续要求多次工具调用：查天气 → 拿到结果 → 还想算个数 → 再调 calculator → 才回复。
// 这就是 tool loop：LLM 不 stop 就不退出，持续"调工具 → 注入 → 再判断"。
//
// 和 2.2 的唯一区别：把 2 次固定调用换成 while 循环。
//
// TODO 清单：
//   toolLoop — while 循环：调 LLM → stop 则退出 → 执行工具 → 注入结果 → 继续

import dotenv from "dotenv"
dotenv.config({ override: true })
import OpenAI from "openai"

import { ToolResult, ChatResult, ToolCall } from "../shared/types"
import { ToolRegistry } from "./2.2-tool-registry"

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY!

const client = new OpenAI({
  apiKey: DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
})

// ─── Tool Loop ★ ───

/**
 * 工具调用循环：持续调用 LLM，直到它不再要求工具为止。
 *
 * 流程（和 2.2 相同的步骤，只是包了一层 while）：
 *   while true:
 *     调 LLM（带 tools）
 *     if finish_reason === "stop" → 退出循环，返回 content
 *     执行所有 tool_call
 *     注入 assistant 消息 + tool 结果到 messages
 *     // 下一轮循环，LLM 看到新结果后决定：继续调工具 or 回复 stop
 */
export async function toolLoop(
  userMessage: string,
  registry: ToolRegistry,
): Promise<ChatResult> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "user", content: userMessage },
  ]

  const steps: ToolResult[] = []

  // TODO: while true → SDK create（带 tools）→ stop 则返回 → 执行工具 → 注入结果 → 继续

  // ========== YOUR CODE HERE (while 循环) ==========

  while (true) {
    const response = await client.chat.completions.create({
      model: "deepseek-v4-pro",
      messages,
      tools: registry.getDefinitions(),
    })

    const choice = response.choices[0]

    if (choice.finish_reason === "stop") {
      return { content: choice.message.content ?? "", steps }
    }

    const toolCalls = choice.message.tool_calls ?? []
    const batchStart = steps.length
    for (const tc of toolCalls) {
      const args = typeof tc.function.arguments === "string"
        ? JSON.parse(tc.function.arguments)
        : tc.function.arguments
      const result = await registry.execute(tc.function.name, args)
      steps.push({ toolCallId: tc.id, name: tc.function.name, result })
    }

    messages.push(choice.message)
    for (const step of steps.slice(batchStart)) {
      messages.push({ role: "tool", tool_call_id: step.toolCallId, content: step.result })
    }
  }

  // ========== END YOUR CODE ==========
}
