// cli-v2.ts — 阶段 4 命令行 agent（FullAgent 版）
// 运行：npx tsx learn-pi-agent/stage4-agent-class/cli-v2.ts
//
// ★ 阶段 5.1 集成：
//   /sessions  — 列出所有历史 session 文件
//   /resume N  — 恢复指定 session 继续对话
//   /status    — 查看当前 agent 状态
//
// 和阶段 3 cli.ts 的对比（注释中标记 ★ 的是阶段 4 增量）：
//   ★ 对话记忆跨轮保留——不再每次 new 空 messages
//   ★ agent.abort() 支持中断
//   ★ agent.subscribe() 事件监听
//   ★ agent.isRunning 运行时状态可查

import * as readline from "readline"
import * as fs from "fs/promises"
import * as path from "path"
import { FullAgent } from "./4.5-agent-full"
import type { SessionHeader } from "../stage5-harness/5.1-session-store"
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

// ★ 5.1: Session 恢复功能
const SESSIONS_DIR = path.join(process.cwd(), ".sessions")

interface SessionListItem {
  path: string
  timestamp: string
  cwd: string
  /** 首行文件大小估算，简单判断空 session */
  size: number
}

async function listSessions(): Promise<SessionListItem[]> {
  try {
    await fs.mkdir(SESSIONS_DIR, { recursive: true })
    const files = await fs.readdir(SESSIONS_DIR)
    const jsonlFiles = files.filter(f => f.endsWith(".jsonl"))

    const items: SessionListItem[] = []
    for (const file of jsonlFiles) {
      const filePath = path.join(SESSIONS_DIR, file)
      const stat = await fs.stat(filePath)
      try {
        const content = await fs.readFile(filePath, "utf-8")
        const firstLine = content.split("\n")[0]
        const header = JSON.parse(firstLine) as SessionHeader
        items.push({
          path: filePath,
          timestamp: header.timestamp ?? "unknown",
          cwd: header.cwd ?? "?",
          size: stat.size,
        })
      } catch {
        // 跳过损坏的文件
      }
    }
    // 按时间倒序
    items.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    return items
  } catch {
    return []
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

// ★ 事件驱动输入——不阻塞，agent 运行中也能接收
rl.on("line", async (line) => {
  const input = line.trim()
  if (!input) return

  if (input === "/sessions") {
    const sessions = await listSessions()
    if (sessions.length === 0) {
      console.log("\n  (无历史 session)")
    } else {
      console.log(`\n─── 历史 Session (${sessions.length} 个) ───`)
      const currentPath = agent.sessionPath
      sessions.forEach((s, i) => {
        const marker = s.path === currentPath ? " ← 当前" : ""
        const date = new Date(s.timestamp).toLocaleString("zh-CN")
        const kb = (s.size / 1024).toFixed(1)
        console.log(`  [${i}] ${date}  ${kb}KB  ${s.cwd}${marker}`)
      })
      console.log(`  输入 /resume N 恢复指定 session`)
      console.log(`──────────────────────────`)
    }
    process.stdout.write("\n> ")
    return
  }

  if (input.startsWith("/resume")) {
    const parts = input.split(/\s+/)
    const idx = parseInt(parts[1]!, 10)
    if (isNaN(idx)) {
      console.log("  用法: /resume N（N 是 /sessions 列表中的编号）")
      process.stdout.write("\n> ")
      return
    }
    const sessions = await listSessions()
    if (idx < 0 || idx >= sessions.length) {
      console.log(`  编号 ${idx} 无效，共 ${sessions.length} 个 session（0~${sessions.length - 1}）`)
      process.stdout.write("\n> ")
      return
    }
    const target = sessions[idx]!
    console.log(`\n  恢复 session: ${path.basename(target.path)}...`)
    await agent.resumeSession(target.path)
    console.log(`  已加载 ${agent.state.messages.length} 条消息`)
    console.log(`  最后活动: ${new Date(target.timestamp).toLocaleString("zh-CN")}`)
    process.stdout.write("\n> ")
    return
  }

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
  console.log("Agent v2 已就绪（天气 + Wikipedia）。")
  console.log("  /sessions  列出历史 session    /resume N  恢复指定 session")
  console.log("  /status    查看 agent 状态     Ctrl+C    退出")
  console.log("💡 agent 思考时可直接输入下一条——会被 followUp 队列自动处理。")
  console.log(`[状态] 初始消息数: ${agent.state.messages.length}`)
  process.stdout.write("\n> ")
}

main().catch(console.error)
