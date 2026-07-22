// 4.4 hooks.test.ts — 测试 prepareNextTurn hook
// 运行：npx tsx learn-pi-agent/stage4-agent-class/4.4-hooks.test.ts

import {
  createTurnLimitHook,
  type PrepareNextTurnContext,
} from "./4.4-hooks"
import type { AgentMessage } from "./4.1-agent-v1"

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log(`  ✅ ${name}`); passed++ }
  else           { console.log(`  ❌ ${name}` + (detail ? ` — ${detail}` : "")); failed++ }
}

const u = (content: string): AgentMessage =>
  ({ role: "user", content, timestamp: 1 })
const a = (content: string): AgentMessage =>
  ({ role: "assistant", content, timestamp: 1 })

function ctx(overrides: Partial<PrepareNextTurnContext> = {}): PrepareNextTurnContext {
  return {
    messages: [u("你是助手"), u("问题"), a("回答")],
    assistantContent: "回答",
    toolCallCount: 0,
    turnNumber: 1,
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. 未超过限制不干预
// ═══════════════════════════════════════════════════════════════════════════════

async function test_withinLimit() {
  console.log("=== 1. 未超过限制 ===")

  const hook = createTurnLimitHook(5)

  {
    const r = await hook(ctx({ turnNumber: 1 }))
    check("第 1 轮不干预", !r || r.systemPrompt == null)
  }
  {
    const r = await hook(ctx({ turnNumber: 3 }))
    check("第 3 轮不干预", !r || r.systemPrompt == null)
  }
  {
    const r = await hook(ctx({ turnNumber: 5 }))
    check("第 5 轮（等于 max）不干预", !r || r.systemPrompt == null)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. 超过限制时注入提醒
// ═══════════════════════════════════════════════════════════════════════════════

async function test_exceedsLimit() {
  console.log("\n=== 2. 超过限制 ===")

  const hook = createTurnLimitHook(3)

  {
    const c = ctx({ turnNumber: 4, messages: [u("原始 system prompt"), u("q"), a("a")] })
    const r = await hook(c)
    check("超过限制返回了 systemPrompt", r?.systemPrompt != null && r.systemPrompt.length > 0)
    check("systemPrompt 包含原始内容",
      r!.systemPrompt!.includes("原始 system prompt"),
      `实际: "${r?.systemPrompt}"`)
    check("systemPrompt 包含收尾提醒",
      r!.systemPrompt!.includes("收尾") || r!.systemPrompt!.toLowerCase().includes("尽快"),
      `实际: "${r?.systemPrompt}"`)
    check("systemPrompt 比原始长",
      r!.systemPrompt!.length > "原始 system prompt".length,
      `原始: ${"原始 system prompt".length}, 新: ${r?.systemPrompt?.length}`)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. 连续多次超限，每次返回的提醒一致
// ═══════════════════════════════════════════════════════════════════════════════

async function test_consistency() {
  console.log("\n=== 3. 一致性 ===")

  const hook = createTurnLimitHook(2)

  const r1 = await hook(ctx({ turnNumber: 3 }))
  const r2 = await hook(ctx({ turnNumber: 4 }))
  check("连续超限都返回 systemPrompt", r1?.systemPrompt != null && r2?.systemPrompt != null)
  check("两次返回的提醒结构一致（包含收尾）",
    r1!.systemPrompt!.includes("收尾") && r2!.systemPrompt!.includes("收尾"))
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. 不修改其他字段
// ═══════════════════════════════════════════════════════════════════════════════

async function test_noSideEffects() {
  console.log("\n=== 4. 不修改无关字段 ===")

  const hook = createTurnLimitHook(1)
  const r = await hook(ctx({ turnNumber: 2 }))

  check("返回了 systemPrompt", r?.systemPrompt != null)
  check("没有修改 model（不在返回中）",
    !r || (r as any).model === undefined)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. 输入不变时结果不变（纯函数）
// ═══════════════════════════════════════════════════════════════════════════════

async function test_pure() {
  console.log("\n=== 5. 纯函数 ===")

  const hook = createTurnLimitHook(2)
  const c = ctx({ turnNumber: 3, messages: [u("sp"), u("q"), a("a")] })

  // 多次调用不应修改输入
  const msgsBefore = [...c.messages]
  await hook(c)
  await hook(c)
  check("ctx.messages 未被修改", c.messages.length === msgsBefore.length)
  check("ctx 其他字段未被修改", c.turnNumber === 3 && c.toolCallCount === 0)
}

// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  await test_withinLimit()
  await test_exceedsLimit()
  await test_consistency()
  await test_noSideEffects()
  await test_pure()

  const total = passed + failed
  console.log(`\n${"=".repeat(40)}`)
  console.log(`通过 ${passed}/${total}` + (failed > 0 ? `  ❌ ${failed} 个失败` : "  ✅ 全部通过"))
}

main()
