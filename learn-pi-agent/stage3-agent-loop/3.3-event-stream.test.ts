// 3.3 event-stream.test.ts — 测试 EventStream
// 运行：npx tsx learn-pi-agent/stage3-agent-loop/3.3-event-stream.test.ts

import { EventStream } from "./3.3-event-stream"

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log(`  ✅ ${name}`); passed++ }
  else { console.log(`  ❌ ${name}` + (detail ? ` — ${detail}` : "")); failed++ }
}

async function main() {
  // ─── 测试 1：push + for await 消费 ───
  console.log("=== 1. 基本 push + for await ===")
  {
    const stream = new EventStream<string, string>(
      (e) => e === "done",    // "done" 事件标志流结束
      (e) => e,               // 结果就是事件本身
    )

    // 生产者：模拟异步 push
    setTimeout(() => { stream.push("a"); stream.push("b"); }, 10)
    setTimeout(() => { stream.push("done"); }, 30)

    const received: string[] = []
    for await (const event of stream) {
      received.push(event)
    }

    check("收到 3 个事件", received.length === 3, `实际: ${received.length}`)
    check("顺序正确", received[0] === "a" && received[1] === "b" && received[2] === "done",
      `实际: ${received.join(", ")}`)

    const result = await stream.result()
    check("result 是 done", result === "done")
  }

  // ─── 测试 2：end() 显式结束 ───
  console.log("\n=== 2. end() 显式结束 ===")
  {
    const stream = new EventStream<number, string>(
      (e) => false,           // 永远不自动结束
      () => "ended",
    )

    stream.push(1)
    stream.push(2)
    stream.end("finished")

    const received: number[] = []
    for await (const event of stream) {
      received.push(event)
    }

    check("收到 2 个事件", received.length === 2)

    const result = await stream.result()
    check("result 是 finished", result === "finished")
  }

  // ─── 测试 3：先 push 再消费（队列缓存）───
  console.log("\n=== 3. 先 push 再消费 ===")
  {
    const stream = new EventStream<number, number>(
      (e) => e === -1,
      (e) => e,
    )

    // 消费前就 push 完
    stream.push(10)
    stream.push(20)
    stream.push(-1)  // 结束信号

    const received: number[] = []
    for await (const event of stream) {
      received.push(event)
    }

    check("收到 3 个事件", received.length === 3)
    check("顺序 10,20,-1", received[0] === 10 && received[1] === 20 && received[2] === -1)
  }

  // ─── 测试 4：push 到已关闭流应被忽略 ───
  console.log("\n=== 4. push 到已关闭流 ===")
  {
    const stream = new EventStream<string, string>(
      (e) => e === "end",
      (e) => e,
    )

    stream.push("first")
    stream.push("end")  // 触发结束
    stream.push("after_end")  // 应被忽略

    const received: string[] = []
    for await (const event of stream) {
      received.push(event)
    }

    check("只收到 2 个事件", received.length === 2)
    check("after_end 被忽略", !received.includes("after_end"))
  }

  // ─── 结果 ───
  const total = passed + failed
  console.log(`\n${"=".repeat(30)}`)
  console.log(`通过 ${passed}/${total}` + (failed > 0 ? `  ❌ ${failed} 个失败` : "  ✅ 全部通过"))
}

main()
