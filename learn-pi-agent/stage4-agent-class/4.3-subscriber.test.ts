// 4.3 subscriber.test.ts — 测试 EventBus
// 运行：npx tsx learn-pi-agent/stage4-agent-class/4.3-subscriber.test.ts

import { EventBus, createEventHistory } from "./4.3-subscriber"

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log(`  ✅ ${name}`); passed++ }
  else           { console.log(`  ❌ ${name}` + (detail ? ` — ${detail}` : "")); failed++ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. subscribe + emit 基本功能
// ═══════════════════════════════════════════════════════════════════════════════

async function test_basic() {
  console.log("=== 1. subscribe + emit ===")

  const bus = new EventBus<string>()
  const received: string[] = []

  bus.subscribe((e) => { received.push(`a:${e}`) })
  bus.subscribe((e) => { received.push(`b:${e}`) })

  await bus.emit("hello")

  check("两个 listener 都收到事件", received.length === 2)
  check("第 1 个 listener 先执行", received[0] === "a:hello")
  check("第 2 个 listener 后执行", received[1] === "b:hello")
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. unsubscribe
// ═══════════════════════════════════════════════════════════════════════════════

async function test_unsubscribe() {
  console.log("\n=== 2. unsubscribe ===")

  const bus = new EventBus<string>()
  const received: string[] = []

  const unsub = bus.subscribe((e) => received.push(e))
  bus.subscribe((e) => received.push(`second:${e}`))

  unsub()  // 取消第一个
  await bus.emit("test")

  check("取消后只剩 1 个 listener", received.length === 1)
  check("剩余的是第二个", received[0] === "second:test")
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. 多次 unsubscribe 不崩溃
// ═══════════════════════════════════════════════════════════════════════════════

async function test_unsubscribe_idempotent() {
  console.log("\n=== 3. 多次 unsubscribe ===")

  const bus = new EventBus<string>()
  let count = 0
  const unsub = bus.subscribe(() => count++)
  unsub()
  unsub()        // 第二次调用不应崩溃
  await bus.emit("x")
  check("多次取消不崩溃，listener 不再被调用", count === 0)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. emit 过程中 listener 注册新 listener——不应影响当前 emit
// ═══════════════════════════════════════════════════════════════════════════════

async function test_emit_add_during() {
  console.log("\n=== 4. emit 中注册新 listener ===")

  const bus = new EventBus<string>()
  const received: string[] = []

  bus.subscribe((e) => {
    received.push(`first:${e}`)
    bus.subscribe((e2) => received.push(`added:${e2}`))  // emit 中注册
  })

  await bus.emit("trigger")
  check("原有 listener 收到", received.length === 1)
  check("新注册的不应在本次 emit 中执行", received[0] === "first:trigger")

  // 下一次 emit 新 listener 才生效
  await bus.emit("second")
  check("新 listener 在下次 emit 时生效", received.length === 3)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. emit 过程中 listener 取消自己——不应影响当前 emit
// ═══════════════════════════════════════════════════════════════════════════════

async function test_emit_remove_self() {
  console.log("\n=== 5. emit 中取消自己 ===")

  const bus = new EventBus<string>()
  const received: string[] = []
  let unsubB: () => void

  bus.subscribe((e) => received.push(`a:${e}`))
  unsubB = bus.subscribe((e) => {
    received.push(`b:${e}`)
    unsubB()  // 取消自己
  })
  bus.subscribe((e) => received.push(`c:${e}`))

  await bus.emit("x")
  check("三个都执行了", received.length === 3)

  // 第二次 emit，b 已被取消
  received.length = 0
  await bus.emit("y")
  check("第二次 emit b 不再执行", received.length === 2)
  check("a 还在", received[0] === "a:y")
  check("c 还在", received[1] === "c:y")
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. 异步 listener 被 await
// ═══════════════════════════════════════════════════════════════════════════════

async function test_async_listener() {
  console.log("\n=== 6. 异步 listener ===")

  const bus = new EventBus<string>()
  const order: string[] = []

  bus.subscribe(async (e) => {
    order.push("start1")
    await new Promise(r => setTimeout(r, 50))
    order.push("end1")
  })
  bus.subscribe((e) => {
    order.push("start2")
    order.push("end2")
  })

  await bus.emit("x")
  check("listener 1 先开始", order[0] === "start1")
  check("listener 1 先结束", order[1] === "end1")
  check("listener 2 在 1 之后", order[2] === "start2" && order[3] === "end2")
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. 空 listener 不崩溃
// ═══════════════════════════════════════════════════════════════════════════════

async function test_empty() {
  console.log("\n=== 7. 空 listener ===")

  const bus = new EventBus<string>()
  let threw = false
  try { await bus.emit("x") } catch { threw = true }
  check("没有 listener 时 emit 不崩溃", !threw)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. createEventHistory — 收集事件历史
// ═══════════════════════════════════════════════════════════════════════════════

async function test_eventHistory() {
  console.log("\n=== 8. createEventHistory ===")

  // 8a: 基本收集
  {
    const bus = new EventBus<string>()
    const { getHistory, cancel } = createEventHistory(bus, 3)

    await bus.emit("a")
    await bus.emit("b")
    check("收集到 2 条", getHistory().length === 2)
    check("顺序正确: a", getHistory()[0] === "a")
    check("顺序正确: b", getHistory()[1] === "b")
    cancel()
  }

  // 8b: 超过 maxSize 时自动丢弃最旧的
  {
    const bus = new EventBus<number>()
    const { getHistory, cancel } = createEventHistory(bus, 2)

    await bus.emit(1)
    await bus.emit(2)
    await bus.emit(3)  // 1 应被 shift 掉

    const log = getHistory()
    check("保持 maxSize 条", log.length === 2)
    check("保留 [2, 3]", log[0] === 2 && log[1] === 3,
      `实际: [${log}]`)
    cancel()
  }

  // 8c: cancel 后不再收集
  {
    const bus = new EventBus<string>()
    const { getHistory, cancel } = createEventHistory(bus, 10)

    await bus.emit("before")
    cancel()
    await bus.emit("after")

    check("cancel 后不再记录", getHistory().length === 1)
    check("只有 cancel 前的事件", getHistory()[0] === "before")
  }

  // 8d: 多个 history 监听同一个 bus，互不干扰
  {
    const bus = new EventBus<string>()
    const h1 = createEventHistory(bus, 3)
    const h2 = createEventHistory(bus, 3)

    await bus.emit("x")
    check("h1 收到", h1.getHistory().length === 1)
    check("h2 也收到", h2.getHistory().length === 1)
    h1.cancel()
    await bus.emit("y")
    check("h1 cancel 后不再收到", h1.getHistory().length === 1)
    check("h2 继续收到", h2.getHistory().length === 2)
    h2.cancel()
  }
}

// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  await test_basic()
  await test_unsubscribe()
  await test_unsubscribe_idempotent()
  await test_emit_add_during()
  await test_emit_remove_self()
  await test_async_listener()
  await test_empty()

  await test_eventHistory()

  const total = passed + failed
  console.log(`\n${"=".repeat(40)}`)
  console.log(`通过 ${passed}/${total}` + (failed > 0 ? `  ❌ ${failed} 个失败` : "  ✅ 全部通过"))
}

main()
