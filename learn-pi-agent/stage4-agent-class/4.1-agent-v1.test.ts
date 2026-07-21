// 4.1 agent-v1.test.ts — 测试 Agent 状态管理
// 运行：npx tsx learn-pi-agent/stage4-agent-class/4.1-agent-v1.test.ts
//
// 测试覆盖：
//   1. createMutableAgentState — 默认值、构造选项、getter/setter 拷贝保护
//   2. Agent 类 — 构造函数、state getter、通过 state 的 setter 保护
//   3. 边界条件 — 空数组、undefined 选项、多次赋值不互相干扰
//
// 每个 TODO 至少 2 条对应用例，覆盖正常路径 + 边界条件。

import { ToolRegistry } from "../stage2-tool-call/2.2-tool-registry"
import {
  createMutableAgentState,
  Agent,
  type AgentOptions,
  type AgentMessage,
} from "./4.1-agent-v1"

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log(`  ✅ ${name}`); passed++ }
  else           { console.log(`  ❌ ${name}` + (detail ? ` — ${detail}` : "")); failed++ }
}

function msg(content: string): AgentMessage {
  return { role: "user", content, timestamp: Date.now() }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 测试组 1: createMutableAgentState 默认值
// ═══════════════════════════════════════════════════════════════════════════════

function test_createDefaultValues() {
  console.log("=== 1. createMutableAgentState — 默认值 ===")

  const state = createMutableAgentState()

  check("systemPrompt 默认为空字符串", state.systemPrompt === "")
  check("tools 是 ToolRegistry 实例", state.tools != null, `类型: ${typeof state.tools}`)
  check("messages 是空数组", Array.isArray(state.messages) && state.messages.length === 0)
  check("isStreaming 初始为 false", state.isStreaming === false)
  check("streamingMessage 初始为 undefined", state.streamingMessage === undefined)
  check("errorMessage 初始为 undefined", state.errorMessage === undefined)
  check("pendingToolCalls 是空 Set", state.pendingToolCalls instanceof Set && state.pendingToolCalls.size === 0)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 测试组 2: createMutableAgentState 构造选项
// ═══════════════════════════════════════════════════════════════════════════════

function test_createWithOptions() {
  console.log("\n=== 2. createMutableAgentState — 构造选项 ===")

  // 2a: 传入 systemPrompt
  const s1 = createMutableAgentState({ systemPrompt: "你是助手" })
  check("systemPrompt 正确传入", s1.systemPrompt === "你是助手")

  // 2b: 传入 messages
  const m1 = msg("你好")
  const s2 = createMutableAgentState({ messages: [m1] })
  check("messages 传入后 length 为 1", s2.messages.length === 1)
  check("messages 内容正确", s2.messages[0].content === "你好")
  check("messages 元素是原始引用", s2.messages[0] === m1)

  // 2c: 部分选项——未传的应有默认值
  const s3 = createMutableAgentState({ systemPrompt: "test" })
  check("只传 systemPrompt 时 messages 仍为空数组",
    Array.isArray(s3.messages) && s3.messages.length === 0)
  check("只传 systemPrompt 时 isStreaming 仍为 false", s3.isStreaming === false)

  // 2d: 传入 undefined 选项
  const s4 = createMutableAgentState(undefined)
  check("undefined 选项不崩溃，systemPrompt 为空", s4.systemPrompt === "")
  check("undefined 选项，messages 为空数组", Array.isArray(s4.messages) && s4.messages.length === 0)

  // 2e: 空对象选项
  const s5 = createMutableAgentState({})
  check("空对象选项不崩溃", s5.systemPrompt === "" && s5.isStreaming === false)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 测试组 3: messages getter/setter 拷贝保护（核心机制）
// ═══════════════════════════════════════════════════════════════════════════════

function test_messagesCopyProtection() {
  console.log("\n=== 3. messages getter/setter 拷贝保护 ===")

  // 3a: getter 返回原始引用（不拷贝）
  {
    const state = createMutableAgentState({ messages: [msg("a"), msg("b")] })
    const ref = state.messages
    ref.push(msg("c"))
    check("getter 返回原始引用 — push 会影响内部", state.messages.length === 3,
      `期望 3，实际 ${state.messages.length}`)
  }

  // 3b: setter 在赋值时 slice（拷贝保护）
  {
    const state = createMutableAgentState()
    const external: AgentMessage[] = [msg("x"), msg("y")]
    state.messages = external
    // 赋值后修改外部数组
    external.push(msg("z"))
    external[0] = msg("modified")
    check("setter slice 后外部 push 不影响内部 length",
      state.messages.length === 2, `期望 2，实际 ${state.messages.length}`)
    check("setter slice 后外部修改元素不影响内部",
      state.messages[0].content === "x",
      `期望 "x"，实际 "${state.messages[0].content}"`)
  }

  // 3c: 多次赋值不互相干扰
  {
    const state = createMutableAgentState()
    const a1: AgentMessage[] = [msg("first")]
    const a2: AgentMessage[] = [msg("second"), msg("third")]

    state.messages = a1
    state.messages = a2
    // 修改第一次赋值的数组不应影响
    a1.push(msg("sneaky"))
    check("多次赋值后旧数组修改不影响内部",
      state.messages.length === 2, `期望 2，实际 ${state.messages.length}`)
    check("多次赋值后内容正确",
      state.messages[0].content === "second" && state.messages[1].content === "third")
  }

  // 3d: 赋值空数组
  {
    const state = createMutableAgentState({ messages: [msg("a"), msg("b")] })
    state.messages = []
    check("赋值空数组后 length 为 0", state.messages.length === 0)
    // 确保是真·空数组，不是 undefined
    check("赋值空数组后 messages 仍为数组", Array.isArray(state.messages))
  }

  // 3e: 从有到无再到有
  {
    const state = createMutableAgentState({ messages: [msg("init")] })
    state.messages = []
    state.messages = [msg("restored")]
    check("空→恢复后 length 为 1", state.messages.length === 1)
    check("空→恢复后内容正确", state.messages[0].content === "restored")
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 测试组 4: tools getter/setter
// ═══════════════════════════════════════════════════════════════════════════════

function test_toolsGetterSetter() {
  console.log("\n=== 4. tools getter/setter ===")

  // 4a: getter 返回 ToolRegistry 实例
  {
    const state = createMutableAgentState()
    check("tools getter 返回对象", typeof state.tools === "object" && state.tools != null)
  }

  // 4b: setter 直接替换
  {
    const state = createMutableAgentState()
    const original = state.tools
    const newTools = new ToolRegistry()
    state.tools = newTools
    check("setter 替换后 getter 返回新实例", state.tools === newTools)
    check("新实例不等于旧实例", state.tools !== original)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 测试组 5: Agent 类 — 构造函数
// ═══════════════════════════════════════════════════════════════════════════════

function test_agentConstructor() {
  console.log("\n=== 5. Agent 构造函数 ===")

  // 5a: 无参构造不崩溃
  {
    const agent = new Agent()
    check("无参构造成功", agent != null)
    check("state 可访问", agent.state != null)
  }

  // 5b: 传入 systemPrompt
  {
    const agent = new Agent({ systemPrompt: "你是助手" })
    check("systemPrompt 正确", agent.state.systemPrompt === "你是助手")
  }

  // 5c: 传入 messages
  {
    const agent = new Agent({ messages: [msg("你好"), msg("世界")] })
    check("messages length 正确", agent.state.messages.length === 2)
    check("messages 内容正确",
      agent.state.messages[0].content === "你好" &&
      agent.state.messages[1].content === "世界")
  }

  // 5d: 传入全部选项
  {
    const agent = new Agent({
      systemPrompt: "sp",
      messages: [msg("m1")],
    })
    check("全选项构造成功", agent.state.systemPrompt === "sp" && agent.state.messages.length === 1)
  }

  // 5e: 空对象构造
  {
    const agent = new Agent({})
    check("空对象构造成功", agent.state.systemPrompt === "" && agent.state.messages.length === 0)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 测试组 6: Agent.state — 运行时字段可见 + setter 保护
// ═══════════════════════════════════════════════════════════════════════════════

function test_agentState() {
  console.log("\n=== 6. Agent.state 运行时字段 + setter 保护 ===")

  // 6a: 运行时字段初始值
  {
    const agent = new Agent()
    check("isStreaming 初始 false", agent.state.isStreaming === false)
    check("streamingMessage 初始 undefined", agent.state.streamingMessage === undefined)
    check("errorMessage 初始 undefined", agent.state.errorMessage === undefined)
    check("pendingToolCalls 是空 Set",
      agent.state.pendingToolCalls instanceof Set && agent.state.pendingToolCalls.size === 0)
  }

  // 6b: 通过 setter 赋值 messages（验证切片保护）
  {
    const agent = new Agent()
    const external: AgentMessage[] = [msg("hello")]
    agent.state.messages = external
    external.push(msg("sneaky"))
    check("Agent.state setter slice 保护生效", agent.state.messages.length === 1,
      `期望 1，实际 ${agent.state.messages.length}`)
  }

  // 6c: getter 返回原始引用（通过 Agent.state 访问）
  {
    const agent = new Agent({ messages: [msg("a")] })
    const ref = agent.state.messages
    ref.push(msg("b"))
    check("Agent.state getter 返回原始引用 — push 生效",
      agent.state.messages.length === 2,
      `期望 2，实际 ${agent.state.messages.length}`)
  }

  // 6d: messages 初始值独立于构造传入的数组
  {
    const input: AgentMessage[] = [msg("input")]
    const agent = new Agent({ messages: input })
    input.push(msg("after construction"))
    // 构造时内部应该已经 slice 过
    check("构造后修改传入数组不影响内部 messages",
      agent.state.messages.length === 1,
      `期望 1，实际 ${agent.state.messages.length}`)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 测试组 7: 多个 Agent 实例互相独立
// ═══════════════════════════════════════════════════════════════════════════════

function test_agentIsolation() {
  console.log("\n=== 7. 多实例隔离 ===")

  const a1 = new Agent({ systemPrompt: "agent1", messages: [msg("a1")] })
  const a2 = new Agent({ systemPrompt: "agent2", messages: [msg("a2")] })

  // 修改 a1 不影响 a2
  a1.state.messages = [msg("a1-modified")]
  check("a1 修改后 a2 不受影响 — systemPrompt",
    a2.state.systemPrompt === "agent2")
  check("a1 修改后 a2 不受影响 — messages.length",
    a2.state.messages.length === 1)
  check("a1 修改后 a2 不受影响 — messages 内容",
    a2.state.messages[0].content === "a2")
}

// ═══════════════════════════════════════════════════════════════════════════════

function main() {
  test_createDefaultValues()
  test_createWithOptions()
  test_messagesCopyProtection()
  test_toolsGetterSetter()
  test_agentConstructor()
  test_agentState()
  test_agentIsolation()

  const total = passed + failed
  console.log(`\n${"=".repeat(40)}`)
  console.log(`通过 ${passed}/${total}` + (failed > 0 ? `  ❌ ${failed} 个失败` : "  ✅ 全部通过"))
}

main()
