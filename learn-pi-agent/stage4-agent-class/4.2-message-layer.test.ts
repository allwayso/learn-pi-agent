// 4.2 message-layer.test.ts — 测试 AgentMessage 体系 + convertToLlm + prepareLlmMessages
// 运行：npx tsx learn-pi-agent/stage4-agent-class/4.2-message-layer.test.ts

import {
  convertToLlm,
  prepareLlmMessages,
  pruneContext,
  type AgentMessage,
  type LlmMessage,
  type TransformContextFn,
} from "./4.2-message-layer"

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log(`  ✅ ${name}`); passed++ }
  else           { console.log(`  ❌ ${name}` + (detail ? ` — ${detail}` : "")); failed++ }
}

// 辅助工厂
const u = (content: string, ts = 1): AgentMessage =>
  ({ type: "user", content, timestamp: ts })
const tr = (toolCallId: string, toolName: string, content: string, ts = 1): AgentMessage =>
  ({ type: "toolResult", toolCallId, toolName, content, timestamp: ts })
const notif = (text: string, ts = 1): AgentMessage =>
  ({ type: "notification", text, level: "info", timestamp: ts })
const status = (code: "thinking" | "executing" | "idle", ts = 1): AgentMessage =>
  ({ type: "status", code, timestamp: ts })

// ═══════════════════════════════════════════════════════════════════════════════
// 1. convertToLlm — 正常映射
// ═══════════════════════════════════════════════════════════════════════════════

function test_convertToLlm_normal() {
  console.log("=== 1. convertToLlm — 正常映射 ===")

  {
    const msgs: AgentMessage[] = [u("你好")]
    const result = convertToLlm(msgs)
    check("user → role:user", result.length === 1 && result[0].role === "user")
    check("user 内容正确", (result[0] as any).content === "你好")
  }
  {
    const msgs: AgentMessage[] = [{
      type: "assistant", content: "回答", timestamp: 1,
    }]
    const result = convertToLlm(msgs)
    check("assistant 无 toolCalls", result.length === 1 && result[0].role === "assistant")
    check("assistant 无 tool_calls 字段", (result[0] as any).tool_calls === undefined)
  }
  {
    const msgs: AgentMessage[] = [{
      type: "assistant", content: "",
      toolCalls: [
        { id: "c1", name: "getWeather", arguments: '{"city":"北京"}' },
        { id: "c2", name: "calculator", arguments: '{"expr":"1+2"}' },
      ],
      timestamp: 1,
    }]
    const result = convertToLlm(msgs)
    const tc = (result[0] as any).tool_calls
    check("tool_calls 数量", tc?.length === 2, `实际: ${tc?.length}`)
    check("tc[0] id", tc?.[0]?.id === "c1")
    check("tc[0] type", tc?.[0]?.type === "function")
    check("tc[0] function.name", tc?.[0]?.function?.name === "getWeather")
    check("tc[0] function.arguments", tc?.[0]?.function?.arguments === '{"city":"北京"}')
    check("tc[1] id", tc?.[1]?.id === "c2")
  }
  {
    const msgs: AgentMessage[] = [tr("c1", "getWeather", "晴，25°C")]
    const result = convertToLlm(msgs)
    check("toolResult → role:tool", result.length === 1 && result[0].role === "tool")
    check("tool_call_id 正确", (result[0] as any).tool_call_id === "c1")
    check("tool content 正确", (result[0] as any).content === "晴，25°C")
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. convertToLlm — 过滤
// ═══════════════════════════════════════════════════════════════════════════════

function test_convertToLlm_filter() {
  console.log("\n=== 2. convertToLlm — 过滤 ===")

  {
    const result = convertToLlm([notif("提醒")])
    check("notification 被过滤", result.length === 0)
  }
  {
    const result = convertToLlm([status("thinking")])
    check("status 被过滤", result.length === 0)
  }
  {
    const msgs: AgentMessage[] = [u("问题"), notif("提示"), u("追问"), status("idle"), tr("c1", "t", "结果")]
    const result = convertToLlm(msgs)
    check("混合消息过滤后 3 条", result.length === 3,
      `实际 ${result.length}: ${result.map(m => m.role).join(", ")}`)
    check("顺序: user → user → tool",
      result[0].role === "user" && result[1].role === "user" && result[2].role === "tool")
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. convertToLlm — 边界
// ═══════════════════════════════════════════════════════════════════════════════

function test_convertToLlm_edge() {
  console.log("\n=== 3. convertToLlm — 边界 ===")

  check("空数组", convertToLlm([]).length === 0)
  check("全部非 LLM", convertToLlm([notif("a"), status("idle")]).length === 0)

  {
    let threw = false
    try { convertToLlm(null as any) } catch { threw = true }
    check("null 不 throw", !threw)
  }
  {
    const msgs: AgentMessage[] = [{
      type: "assistant", content: "",
      toolCalls: [{ id: "c1", name: "t", arguments: "{}" }],
      timestamp: 1,
    }]
    const result = convertToLlm(msgs)
    check("content 为空时 tool_calls 仍映射", (result[0] as any).tool_calls?.length === 1)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. prepareLlmMessages — 无 hook（transformContext 未传）
// ═══════════════════════════════════════════════════════════════════════════════

async function test_prepare_noHook() {
  console.log("\n=== 4. prepareLlmMessages — 无 hook ===")

  const msgs: AgentMessage[] = [u("问题"), notif("提示"), u("追问")]
  const result = await prepareLlmMessages(msgs)
  check("无 hook 时行为等于 convertToLlm", result.length === 2)
  check("notification 被过滤", result.every(m => m.role !== "notification" as any))
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. prepareLlmMessages — 有 hook（传入 pruneContext）
// ═══════════════════════════════════════════════════════════════════════════════

async function test_prepare_withHook() {
  console.log("\n=== 5. prepareLlmMessages — 有 hook ===")

  const msgs: AgentMessage[] = [
    u("你是助手"),       // [0] 首条
    u("msg1"),          // [1]
    u("msg2"),          // [2]
    notif("提醒"),      // [3]
    u("msg3"),          // [4]
    u("msg4"),          // [5]
    u("msg5"),          // [6]
  ]

  // 传入 pruneContext(2)：保留首条 + 最近 2 条 → [0, 5, 6]
  // 其中 [3] notification 被留下来了（hook 不区分消息类型），
  // 但 convertToLlm 会过滤掉 notification
  const result = await prepareLlmMessages(msgs, pruneContext(2))
  // 预期 LLM 消息: [0]=user:你是助手, [5]=user:msg4, [6]=user:msg5
  // [3] notification 被 convertToLlm 过滤
  check("裁剪 + 过滤后 3 条", result.length === 3,
    `实际 ${result.length}: ${result.map(m => m.role).join(", ")}`)
  check("首条是 system", (result[0] as any).content === "你是助手")
  check("第二条是 msg4", (result[1] as any).content === "msg4")
  check("第三条是 msg5", (result[2] as any).content === "msg5")
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. prepareLlmMessages — 边界
// ═══════════════════════════════════════════════════════════════════════════════

async function test_prepare_edge() {
  console.log("\n=== 6. prepareLlmMessages — 边界 ===")

  check("null 不 throw", (await prepareLlmMessages(null as any)).length === 0)
  check("空数组", (await prepareLlmMessages([])).length === 0)

  // hook 抛异常时不应传播，降级为跳过 hook 直接 convertToLlm
  const badHook: TransformContextFn = () => { throw new Error("boom") }
  const result = await prepareLlmMessages([u("test")], badHook)
  check("hook 异常时降级为原消息", result.length === 1 && (result[0] as any).content === "test")
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. pruneContext — 示例 hook 行为验证
// ═══════════════════════════════════════════════════════════════════════════════

function test_pruneContext() {
  console.log("\n=== 7. pruneContext — 示例 hook ===")

  const hook = pruneContext(2)

  {
    const msgs = [u("s"), u("a"), u("b"), u("c"), u("d")]
    const result = hook(msgs) as AgentMessage[]
    check("裁剪后 3 条（首条 + 最近 2）", result.length === 3)
    check("首条保留", result[0].content === "s")
    check("尾 1", result[1].content === "c")
    check("尾 2", result[2].content === "d")
  }
  {
    const msgs = [u("s"), u("a")]
    const result = hook(msgs) as AgentMessage[]
    check("小于阈值不裁剪", result.length === 2)
  }
  {
    const hook0 = pruneContext(0)
    const msgs = [u("s"), u("a"), u("b")]
    const result = hook0(msgs) as AgentMessage[]
    check("keepRecent=0 只保留首条", result.length === 1)
    check("首条内容正确", result[0].content === "s")
  }
  {
    const result = pruneContext(3)([]) as AgentMessage[]
    check("空数组返回空数组", result.length === 0)
  }
  {
    const result = pruneContext(3)(null as any) as AgentMessage[]
    check("null 安全", Array.isArray(result) && result.length === 0)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  test_convertToLlm_normal()
  test_convertToLlm_filter()
  test_convertToLlm_edge()
  await test_prepare_noHook()
  await test_prepare_withHook()
  await test_prepare_edge()
  test_pruneContext()

  const total = passed + failed
  console.log(`\n${"=".repeat(40)}`)
  console.log(`通过 ${passed}/${total}` + (failed > 0 ? `  ❌ ${failed} 个失败` : "  ✅ 全部通过"))
}

main()
