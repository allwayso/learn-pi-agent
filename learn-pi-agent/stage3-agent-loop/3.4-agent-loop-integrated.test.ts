// 3.4 agent-loop-integrated.test.ts — 测试整合版 agentLoop
// 运行：npx tsx learn-pi-agent/stage3-agent-loop/3.4-agent-loop-integrated.test.ts

import { agentLoop, AgentContext, AgentLoopConfig } from "./3.4-agent-loop-integrated"
import { createDefaultRegistry } from "../stage2-tool-call/2.2-tool-registry"
import { AgentMessage } from "./3.2-agent-loop-v1"

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log(`  ✅ ${name}`); passed++ }
  else { console.log(`  ❌ ${name}` + (detail ? ` — ${detail}` : "")); failed++ }
}

function convertToLlm(msgs: AgentMessage[]): any[] {
  const result: any[] = []
  for (const m of msgs) {
    if (m.role === "user" || m.role === "steering" || m.role === "followUp") {
      result.push({ role: "user", content: m.content })
    } else if (m.role === "assistant") {
      result.push({
        role: "assistant", content: m.content,
        tool_calls: m.toolCalls?.map(tc => ({
          id: tc.id, type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        })),
      })
    } else if (m.role === "toolResult") {
      result.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content })
    }
  }
  return result
}

async function main() {
  const registry = createDefaultRegistry()

  // ─── 测试 1：for-await 消费事件 ───
  console.log("=== 1. for-await 消费事件 ===")
  {
    const ctx: AgentContext = {
      systemPrompt: "你是一个助手。回答用中文。",
      messages: [], tools: registry,
    }
    const config: AgentLoopConfig = { convertToLlm }
    const stream = agentLoop("北京天气怎么样？", ctx, config)

    const eventTypes: string[] = []
    for await (const event of stream) {
      eventTypes.push(event.type)
    }

    check("收到 turn_start", eventTypes.includes("turn_start"))
    check("收到 turn_end", eventTypes.includes("turn_end"))
    check("收到 agent_end", eventTypes.includes("agent_end"))
    check("agent_end 是最后一个事件", eventTypes.at(-1) === "agent_end")
  }

  // ─── 测试 2：result() 拿最终消息 ───
  console.log("\n=== 2. result() 拿最终消息 ===")
  {
    const ctx: AgentContext = {
      systemPrompt: "你是一个助手。回答用中文。",
      messages: [], tools: registry,
    }
    const config: AgentLoopConfig = { convertToLlm }
    const stream = agentLoop("北京天气怎么样？", ctx, config)

    // 不消费事件，直接等结果
    const messages = await stream.result()
    check("result 返回消息数组", Array.isArray(messages) && messages.length > 0)
    check("包含 assistant 消息", messages.some(m => m.role === "assistant"))
    check("包含 toolResult 消息", messages.some(m => m.role === "toolResult"))
  }

  // ─── 结果 ───
  const total = passed + failed
  console.log(`\n${"=".repeat(30)}`)
  console.log(`通过 ${passed}/${total}` + (failed > 0 ? `  ❌ ${failed} 个失败` : "  ✅ 全部通过"))
}

main()
