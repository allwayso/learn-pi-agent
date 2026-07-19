// 3.2 agent-loop-v1.test.ts — 测试完整 agent loop
// 运行：npx tsx learn-pi-agent/stage3-agent-loop/3.2-agent-loop-v1.test.ts

import { agentLoop, AgentMessage, AgentLoopConfig, AgentContext } from "./3.2-agent-loop-v1"
import { createDefaultRegistry } from "../stage2-tool-call/2.2-tool-registry"

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log(`  ✅ ${name}`); passed++ }
  else { console.log(`  ❌ ${name}` + (detail ? ` — ${detail}` : "")); failed++ }
}

// ─── 辅助 ───
function eventCollector() {
  const events: string[] = []
  return {
    events,
    sink: async (e: any) => { events.push(e.type) },
  }
}

/** 共用 convertToLlm：AgentMessage → OpenAI 线格式 */
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

  // ─── 测试 1：单工具调用 ───
  console.log("=== 1. 单工具调用（天气）===")
  {
    const ctx: AgentContext = {
      systemPrompt: "你是一个助手。回答用中文。",
      messages: [], tools: registry,
    }
    const config: AgentLoopConfig = { convertToLlm }
    const messages = await agentLoop("北京今天天气怎么样？", ctx, config)
    const toolMsgs = messages.filter(m => m.role === "toolResult")
    const assistantMsgs = messages.filter(m => m.role === "assistant")
    check("至少一条 toolResult", toolMsgs.length >= 1)
    check("至少一条 assistant 消息", assistantMsgs.length >= 1)
    check("最后一条 assistant 有内容", assistantMsgs.at(-1)!.content.length > 0)
    console.log(`  final: ${assistantMsgs.at(-1)!.content.slice(0, 80)}`)
  }

  // ─── 测试 2：不需要工具 ───
  console.log("\n=== 2. 不需要工具 ===")
  {
    const ctx: AgentContext = {
      systemPrompt: "你是一个助手。回答用中文。",
      messages: [], tools: registry,
    }
    const config: AgentLoopConfig = { convertToLlm }
    const messages = await agentLoop("你好，打个招呼", ctx, config)
    check("零条 toolResult", messages.filter(m => m.role === "toolResult").length === 0)
  }

  // ─── 测试 3：复合请求（天气 + 计算）───
  console.log("\n=== 3. 复合请求 ===")
  {
    const ctx: AgentContext = {
      systemPrompt: "你是一个助手。回答用中文。",
      messages: [], tools: registry,
    }
    const config: AgentLoopConfig = { convertToLlm }
    const messages = await agentLoop("北京天气如何？顺便算 123*456", ctx, config)
    check("至少一次工具调用", messages.filter(m => m.role === "toolResult").length >= 1)
  }

  // ─── 测试 4：事件系统 ───
  console.log("\n=== 4. 事件系统 ===")
  {
    const ctx: AgentContext = {
      systemPrompt: "你是一个助手。回答用中文。",
      messages: [], tools: registry,
    }
    const config: AgentLoopConfig = { convertToLlm }
    const collector = eventCollector()
    await agentLoop("北京天气怎么样？", ctx, config, collector.sink)
    check("turn_start", collector.events.includes("turn_start"))
    check("turn_end", collector.events.includes("turn_end"))
    check("agent_end", collector.events.includes("agent_end"))
    check("tool_start", collector.events.includes("tool_start"))
    check("tool_end", collector.events.includes("tool_end"))
  }

  // ─── 测试 5：steering 注入 ───
  console.log("\n=== 5. steering 注入 ===")
  {
    const ctx: AgentContext = {
      systemPrompt: "你是一个助手。",
      messages: [], tools: registry,
    }
    let steeringCalled = 0
    const config: AgentLoopConfig = {
      convertToLlm,
      getSteeringMessages: async () => { steeringCalled++; return [] },
    }
    await agentLoop("北京天气怎么样？", ctx, config)
    check("getSteeringMessages 被调用过", steeringCalled > 0, `调用了 ${steeringCalled} 次`)
  }

  // ─── 测试 6：follow-up 队列 ───
  console.log("\n=== 6. follow-up 队列 ===")
  {
    const ctx: AgentContext = {
      systemPrompt: "你是一个助手。回答用中文。",
      messages: [], tools: registry,
    }
    let followUpCalled = false
    const config: AgentLoopConfig = {
      convertToLlm,
      getFollowUpMessages: async () => {
        followUpCalled = true
        return []
      },
    }
    await agentLoop("北京天气怎么样？", ctx, config)
    check("getFollowUpMessages 被调用过", followUpCalled)
  }

  // ─── 结果 ───
  const total = passed + failed
  console.log(`\n${"=".repeat(30)}`)
  console.log(`通过 ${passed}/${total}` + (failed > 0 ? `  ❌ ${failed} 个失败` : "  ✅ 全部通过"))
}

main()
