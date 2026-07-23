// 4.5 agent-full.test.ts — 测试 FullAgent 生命周期 + Session 持久化
// 运行：npx tsx learn-pi-agent/stage4-agent-class/4.5-agent-full.test.ts

import { FullAgent, type AgentEvent } from "./4.5-agent-full"
import type { AgentMessage } from "./4.1-agent-v1"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log(`  ✅ ${name}`); passed++ }
  else           { console.log(`  ❌ ${name}` + (detail ? ` — ${detail}` : "")); failed++ }
}

const msg = (content: string): AgentMessage =>
  ({ role: "user", content, timestamp: Date.now() })

// ═══════════════════════════════════════════════════════════════════════════════
// 1. 构造 + 状态代理
// ═══════════════════════════════════════════════════════════════════════════════

function test_construction() {
  console.log("=== 1. 构造 + 状态 ===")

  {
    const agent = new FullAgent()
    check("无参构造成功", agent != null)
    check("初始 isRunning = false", !agent.isRunning)
    check("state 可访问", agent.state != null)
    check("state.messages 为空", agent.state.messages.length === 0)
    check("state.systemPrompt 为空", agent.state.systemPrompt === "")
  }

  {
    const agent = new FullAgent({
      systemPrompt: "你是助手",
      messages: [msg("你好")],
    })
    check("systemPrompt 透传", agent.state.systemPrompt === "你是助手")
    check("messages 透传", agent.state.messages.length === 1)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. subscribe / 事件
// ═══════════════════════════════════════════════════════════════════════════════

function test_subscribe() {
  console.log("\n=== 2. subscribe ===")

  {
    const agent = new FullAgent()
    const events: AgentEvent[] = []
    const cancel = agent.subscribe((e) => events.push(e))

    check("subscribe 返回取消函数", typeof cancel === "function")
    cancel()
  }

  {
    // 同一个 agent 多个 subscriber
    const agent = new FullAgent()
    const a: string[] = []
    const b: string[] = []
    agent.subscribe((e) => a.push(e.type))
    agent.subscribe((e) => b.push(e.type))

    check("多个 subscriber 可同时注册", true)  // 不报错即可
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. abort
// ═══════════════════════════════════════════════════════════════════════════════

async function test_abort() {
  console.log("\n=== 3. abort ===")

  // 3a: 无 run 时 abort 不崩溃
  {
    const agent = new FullAgent()
    let threw = false
    try { agent.abort() } catch { threw = true }
    check("无 run 时 abort 不崩溃", !threw)
  }

  // 3b: abort 后 isRunning 应变 false
  {
    const agent = new FullAgent()
    // 启动一个 prompt（不会真正跑 loop，只测生命周期）
    const p = agent.prompt("test")
    // 立即 abort
    agent.abort()
    // prompt 应该快速结束
    await p
    check("abort 后 isRunning = false", !agent.isRunning)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. reset
// ═══════════════════════════════════════════════════════════════════════════════

async function test_reset() {
  console.log("\n=== 4. reset ===")

  {
    const agent = new FullAgent({
      systemPrompt: "你是助手",
      messages: [msg("a"), msg("b"), msg("c")],
    })
    check("reset 前 messages 有 3 条", agent.state.messages.length === 3)

    await agent.reset()
    check("reset 后 messages 清空", agent.state.messages.length === 0)
    check("reset 后 systemPrompt 保留", agent.state.systemPrompt === "你是助手")
    check("reset 后 isRunning = false", !agent.isRunning)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. prompt 生命周期
// ═══════════════════════════════════════════════════════════════════════════════

async function test_prompt_lifecycle() {
  console.log("\n=== 5. prompt 生命周期 ===")

  // 5a: prompt 启动后 isRunning = true — 通过 subscriber 捕获
  {
    const agent = new FullAgent({ systemPrompt: "test" })
    let runningDuringStart = false

    agent.subscribe((e) => {
      if (e.type === "agent_start") {
        runningDuringStart = agent.isRunning  // 在 agent_start 事件中检查
      }
    })

    await agent.prompt("你好")
    check("prompt 启动时 isRunning = true", runningDuringStart)
    check("prompt 结束后 isRunning = false", !agent.isRunning)
    check("prompt 结束后 isRunning = false", !agent.isRunning)
  }

  // 5b: prompt 结束后 emit agent_end
  {
    const agent = new FullAgent()
    let ended = false
    agent.subscribe((e) => {
      if (e.type === "agent_end") ended = true
    })

    await agent.prompt("test")
    check("prompt 结束后 emit agent_end", ended)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. prompt 时已有 run 在跑——先 abort 旧的
// ═══════════════════════════════════════════════════════════════════════════════

async function test_prompt_aborts_previous() {
  console.log("\n=== 6. prompt 打断旧 run ===")

  const agent = new FullAgent()
  const order: string[] = []

  agent.subscribe((e) => order.push(e.type))

  // 启动第一个 prompt（不 await）
  const p1 = agent.prompt("first")
  await new Promise(r => setTimeout(r, 10))

  // 启动第二个 prompt——应该先 abort p1
  const p2 = agent.prompt("second")
  await Promise.all([p1, p2])

  // 两个 prompt 都应该产生 agent_start + agent_end
  check("收到两次 agent_start", order.filter(t => t === "agent_start").length === 2)
  check("收到两次 agent_end", order.filter(t => t === "agent_end").length === 2)
  check("最终 isRunning = false", !agent.isRunning)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Session 持久化
// ═══════════════════════════════════════════════════════════════════════════════

async function test_session_persistence() {
  console.log("\n=== 7. Session 持久化 ===")

  const tmpDir = path.join(os.tmpdir(), `pi-test-session-${Date.now()}`)
  let agent: FullAgent | null = null

  try {
    // 7a: ensureStore — 首次 prompt 创建 session 文件
    {
      agent = new FullAgent({ systemPrompt: "be brief" }, {}, tmpDir)
      await agent.prompt("hello")

      const files = await fs.readdir(tmpDir)
      const jsonlFiles = files.filter(f => f.endsWith(".jsonl"))
      check("7a: 首次 prompt 创建 .jsonl 文件", jsonlFiles.length === 1,
        `期望 1 个，实际 ${jsonlFiles.length} 个`)
    }

    // 7b: JSONL 文件结构正确
    {
      const files = await fs.readdir(tmpDir)
      const jsonlPath = path.join(tmpDir, files.find(f => f.endsWith(".jsonl"))!)
      const content = await fs.readFile(jsonlPath, "utf-8")
      const lines = content.split("\n").filter(l => l.trim())

      check("7b: 首行是 session header", lines[0]?.includes('"type":"session"'),
        `首行内容: ${lines[0]?.slice(0, 80)}`)
      check("7b: header 含 version", lines[0]?.includes('"version":3'))
      check("7b: 文件含 message entry", lines.some(l => l.includes('"type":"message"')))
      check("7b: 包含用户消息内容", content.includes("hello"))
      check("7b: 每行都是合法 JSON", lines.every(l => {
        try { JSON.parse(l); return true } catch { return false }
      }))
    }

    // 7c: loadHistory — 同一 agent 的第二次 prompt 加载历史
    {
      const countBefore = agent!.state.messages.length
      await agent!.prompt("what time is it")
      const countAfter = agent!.state.messages.length

      check("7c: 第二次 prompt 后 messages 增长", countAfter > countBefore,
        `before=${countBefore}, after=${countAfter}`)

      // 检查 JSONL 文件行数也增加了
      const files = await fs.readdir(tmpDir)
      const jsonlPath = path.join(tmpDir, files.find(f => f.endsWith(".jsonl"))!)
      const content = await fs.readFile(jsonlPath, "utf-8")
      const lines = content.split("\n").filter(l => l.trim())
      check("7c: JSONL 行数 > 2（header + 多条 entry）", lines.length > 2,
        `实际 ${lines.length} 行`)
    }

    // 7d: reset 清空游标
    {
      const files = await fs.readdir(tmpDir)
      const jsonlPath = path.join(tmpDir, files.find(f => f.endsWith(".jsonl"))!)
      const contentBefore = await fs.readFile(jsonlPath, "utf-8")

      await agent!.reset()
      check("7d: reset 后 messages 清空", agent!.state.messages.length === 0)

      // 文件仍有旧数据，但多了 leaf(null) 标记
      const contentAfter = await fs.readFile(jsonlPath, "utf-8")
      check("7d: 文件未删除（数据保留）", contentAfter.length >= contentBefore.length)

      // 再跑一个 prompt，验证从空开始
      const msgsBeforeNew = agent!.state.messages.length
      await agent!.prompt("new conversation")
      check("7d: reset 后新 prompt 从空开始", msgsBeforeNew === 0)
      // 新消息不应该包含第一次 prompt 的 "hello"
      check("7d: 新对话不包含旧消息内容",
        !agent!.state.messages.some(m =>
          "content" in m && typeof m.content === "string" && m.content === "hello"
        ),
        "旧消息 'hello' 不应出现在新对话中"
      )
    }

  } finally {
    // 清理临时目录
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  test_construction()
  test_subscribe()
  await test_abort()
  await test_reset()
  await test_prompt_lifecycle()
  await test_prompt_aborts_previous()
  await test_session_persistence()

  const total = passed + failed
  console.log(`\n${"=".repeat(40)}`)
  console.log(`通过 ${passed}/${total}` + (failed > 0 ? `  ❌ ${failed} 个失败` : "  ✅ 全部通过"))
}

main()
