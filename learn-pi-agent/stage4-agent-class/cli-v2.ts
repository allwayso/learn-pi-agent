// cli-v2.ts — 阶段 4 命令行 agent（FullAgent 版）
// 运行：npx tsx learn-pi-agent/stage4-agent-class/cli-v2.ts
//
// 和阶段 3 cli.ts 的对比（注释中标记 ★ 的是阶段 4 增量）：
//   ★ 对话记忆跨轮保留——不再每次 new 空 messages
//   ★ convertToLlm 注入一次，不在 CLI 里手写
//   ★ agent.abort() 支持中断
//   ★ agent.subscribe() 事件监听
//   ★ agent.isRunning 运行时状态可查
//   ★ 消息类型从字符串 role 升级为 discriminated union（4.2 AgentMessage）
//   ★ convertToLlm 不在 CLI 里手写——stage 3 用内置 defaultConvertToLlm

import * as readline from "readline"
import { FullAgent } from "./4.5-agent-full"
import { ToolRegistry } from "../stage2-tool-call/2.2-tool-registry"
import { realWeatherTool, wikipediaTool } from "../shared/real-tools"

// ─── 工具注册 ───
const registry = new ToolRegistry()
registry.register(realWeatherTool)
registry.register(wikipediaTool)

// ★ 阶段 4：Agent 构造一次，后续只调 prompt()
//    systemPrompt / tools / messages 全在对象里，CLI 不用管
const agent = new FullAgent(
  {
    systemPrompt: `你是一个有用的 AI 助手，可以获取实时天气和搜索 Wikipedia。回答用中文。

工具：
- getWeather(city): 获取城市实时天气（温度、湿度、天气状况、风速）
- searchWikipedia(query): 搜索 Wikipedia 获取词条摘要`,
    tools: registry,
  },
  {
    // 不传 convertToLlm——让 stage 3 用内置的 defaultConvertToLlm（处理 role 字段）
    // 阶段 4 的 convertToLlm 处理 type 字段，和阶段 3 消息格式不兼容
  },
)

// ★ 阶段 4：subscribe 事件监听——UI 渲染和状态追踪各管各的
let lastContent = ""
agent.subscribeLoop((event) => {
  switch (event.type) {
    case "message_update":
      const content = event.message.content || ""
      const delta = content.slice(lastContent.length)
      process.stdout.write(delta)
      lastContent = content
      break
    case "tool_start":
      process.stdout.write(`\n  🔧 ${event.toolName}...`)
      break
    case "tool_end":
      process.stdout.write(` 完成\n  📋 ${event.result.slice(0, 100)}${event.result.length > 100 ? "..." : ""}\n\n`)
      lastContent = ""
      break
    case "message_start":
      if (event.message.type === "assistant") {
        process.stdout.write("🤖 ")
        lastContent = ""
      }
      break
  }
})

// ★ 阶段 4：subscribe 监听 Agent 生命周期事件
agent.subscribe((event) => {
  if (event.type === "agent_end") {
    console.log(`\n─── Agent 内部状态 ───`)
    console.log(`  isRunning        : ${agent.isRunning}`)
    console.log(`  messages         : ${agent.state.messages.length} 条`)
    console.log(`  errorMessage     : ${agent.state.errorMessage ?? "(无)"}`)
    console.log(`  pendingToolCalls : ${agent.state.pendingToolCalls.size} 个`)
    console.log(`  streamingMessage : ${agent.state.streamingMessage ? "有" : "(无)"}`)
    console.log(`  tools            : ${(agent.state.tools as any).size ?? "?"} 个`)
    console.log(`  systemPrompt     : ${agent.state.systemPrompt.length} 字`)
  }
})

// ★ 阶段 4：Ctrl+C → abort() 优雅中断，不清空对话历史
process.on("SIGINT", () => {
  console.log("\n[中断] 正在停止当前 run...")
  agent.abort()
  // 不退出进程——下一次 prompt 可以继续
})

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

// ★ 事件驱动输入——不阻塞，agent 运行中也能接收
rl.on("line", async (line) => {
  const input = line.trim()
  if (!input) return

  if (input === "/status") {
    console.log(`\n─── Agent 完整状态 ───`)
    console.log(`  isRunning        : ${agent.isRunning}`)
    console.log(`  messages 总数    : ${agent.state.messages.length}`)
    console.log(`  errorMessage     : ${agent.state.errorMessage ?? "(无)"}`)
    console.log(`  pendingToolCalls : ${agent.state.pendingToolCalls.size}`)
    console.log(`  streamingMessage : ${agent.state.streamingMessage?.content?.slice(0, 50) ?? "(无)"}`)
    console.log(`  systemPrompt     : ${agent.state.systemPrompt.length} 字`)
    console.log(`  tools 数量       : ${(agent.state.tools as any).size ?? "?"}`)
    const msgs = agent.state.messages
    if (msgs.length > 0) {
      console.log(`  ─ 最近消息 ─`)
      msgs.slice(-3).forEach(m => {
        const role = (m as any).role ?? (m as any).type ?? "?"
        const preview = ((m as any).content || "").slice(0, 40)
        console.log(`    [${role}] ${preview}${preview.length >= 40 ? "..." : ""}`)
      })
    }
    console.log(`──────────────────────`)
    process.stdout.write("\n> ")
    return
  }

  // ★ agent 运行中 → 塞入 followUp 队列
  if (agent.isRunning) {
    console.log("[已加入 followUp 队列，agent 本次 run 内会处理]")
    agent.followUp(input)
    return
  }

  // agent 空闲 → 启动新 run
  await agent.prompt(input)
  process.stdout.write("> ")
})

async function main() {
  console.log("Agent v2 已就绪（天气 + Wikipedia）。输入 /status 查看状态，Ctrl+C 退出。")
  console.log("💡 agent 思考时可直接输入下一条——会被 followUp 队列自动处理。")
  console.log(`[状态] 初始消息数: ${agent.state.messages.length}`)
  process.stdout.write("\n> ")
}

main().catch(console.error)
