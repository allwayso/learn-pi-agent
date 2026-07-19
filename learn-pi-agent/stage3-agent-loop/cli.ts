// cli-real.ts — 命令行 agent（真实工具版）
// 运行：npx tsx learn-pi-agent/stage3-agent-loop/cli-real.ts

import * as readline from "readline"
import { agentLoop, AgentContext, AgentLoopConfig } from "./3.4-agent-loop-integrated"
import { ToolRegistry } from "../stage2-tool-call/2.2-tool-registry"
import { AgentMessage } from "./3.2-agent-loop-v1"
import { realWeatherTool, wikipediaTool } from "../shared/real-tools"

// ─── 注册真实工具 ───
const registry = new ToolRegistry()
registry.register(realWeatherTool)
registry.register(wikipediaTool)

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

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

function ask(): Promise<string> {
  return new Promise((resolve) => rl.question("\n> ", resolve))
}

async function main() {
  console.log("Agent 已就绪（真实工具：天气 + Wikipedia）。输入消息开始，Ctrl+C 退出。")

  const systemPrompt = `你是一个有用的 AI 助手，可以获取实时天气和搜索 Wikipedia。回答用中文。

工具：
- getWeather(city): 获取城市实时天气（温度、湿度、天气状况、风速）
- searchWikipedia(query): 搜索 Wikipedia 获取词条摘要`

  while (true) {
    const prompt = await ask()
    if (!prompt.trim()) continue

    const ctx: AgentContext = { systemPrompt, messages: [], tools: registry }
    const config: AgentLoopConfig = { convertToLlm }
    const stream = agentLoop(prompt, ctx, config)

    process.stdout.write("🤖 ")
    let lastContent = ""
    for await (const event of stream) {
      if (event.type === "message_update") {
        // 只打印增量部分
        const delta = (event.message.content || "").slice(lastContent.length)
        process.stdout.write(delta)
        lastContent = event.message.content || ""
      } else if (event.type === "tool_start") {
        process.stdout.write(`\n  🔧 ${event.toolName}...`)
      } else if (event.type === "tool_end") {
        process.stdout.write(" 完成\n\n")
      }
    }
    console.log()
  }
}

main().catch(console.error)
