// 2.3 parallel-vs-seq.test.ts — 测试并行/串行工具执行
// 运行：npx tsx learn-pi-agent/stage2-tool-call/2.3-parallel-vs-seq.test.ts

import { ToolRegistry } from "./2.2-tool-registry"
import { ToolCall, executeToolCalls } from "./2.3-parallel-vs-seq"

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log(`  ✅ ${name}`); passed++ }
  else           { console.log(`  ❌ ${name}` + (detail ? ` — ${detail}` : "")); failed++ }
}

// ─── 辅助：模拟延迟执行 ───
const executedOrder: string[] = []

function createRegistry(): ToolRegistry {
  const r = new ToolRegistry()

  // 并行工具：带延迟的查询
  r.register({
    name: "fastQuery",
    description: "快查询",
    parameters: { type: "object", properties: { id: { type: "string" } } },
    execute: async (args) => {
      executedOrder.push(args.id as string)
      await new Promise((r) => setTimeout(r, 50))
      return `result-${args.id}`
    },
  })

  // 串行工具：标记 sequential
  r.register({
    name: "writeLog",
    description: "写日志",
    parameters: { type: "object", properties: { msg: { type: "string" } } },
    executionMode: "sequential",
    execute: async (args) => {
      executedOrder.push(`log:${args.msg}`)
      return `wrote: ${args.msg}`
    },
  })

  return r
}

async function main() {
  // ─── 测试 1：纯并行 — 3 个无依赖查询 ───
  console.log("=== 1. 纯并行工具（Promise.all）===")
  {
    const registry = createRegistry()
    const calls: ToolCall[] = [
      { id: "1", name: "fastQuery", arguments: { id: "A" } },
      { id: "2", name: "fastQuery", arguments: { id: "B" } },
      { id: "3", name: "fastQuery", arguments: { id: "C" } },
    ]
    const start = Date.now()
    const results = await executeToolCalls(calls, registry)
    const elapsed = Date.now() - start

    check("返回 3 条结果", results.length === 3)
    check("并行耗时 < 200ms", elapsed < 200, `实际: ${elapsed}ms`)
    // 如果串行执行 ≈ 3×50 = 150ms 起步，并行 ≈ 50ms
    check("所有结果正确", results.every((r, i) =>
      r.name === "fastQuery" && r.result === `result-${["A","B","C"][i]}`))
  }

  // ─── 测试 2：混入 sequential 工具 → 整批串行 ───
  console.log("\n=== 2. 含 sequential 工具 → 整批串行 ===")
  {
    executedOrder.length = 0
    const registry = createRegistry()
    const calls: ToolCall[] = [
      { id: "1", name: "fastQuery", arguments: { id: "X" } },
      { id: "2", name: "writeLog", arguments: { msg: "hello" } },
      { id: "3", name: "fastQuery", arguments: { id: "Y" } },
    ]
    const results = await executeToolCalls(calls, registry)

    check("返回 3 条结果", results.length === 3)
    // 串行执行顺序应该和 calls 顺序一致
    check("执行顺序正确", executedOrder[0] === "X" && executedOrder[1] === "log:hello" && executedOrder[2] === "Y",
      `实际: ${executedOrder.join(" → ")}`)
  }

  // ─── 测试 3：空工具列表 ───
  console.log("\n=== 3. 空工具列表 ===")
  {
    const registry = createRegistry()
    const results = await executeToolCalls([], registry)
    check("返回空数组", Array.isArray(results) && results.length === 0)
  }

  // ─── 测试 4：单个 sequential 工具 ───
  console.log("\n=== 4. 单个 sequential 工具 ===")
  {
    const registry = createRegistry()
    const calls: ToolCall[] = [
      { id: "99", name: "writeLog", arguments: { msg: "solo" } },
    ]
    const results = await executeToolCalls(calls, registry)
    check("返回 1 条结果", results.length === 1)
    check("结果正确", results[0].name === "writeLog" && results[0].result === "wrote: solo")
  }

  // ─── 结果 ───
  const total = passed + failed
  console.log(`\n${"=".repeat(30)}`)
  console.log(`通过 ${passed}/${total}` + (failed > 0 ? `  ❌ ${failed} 个失败` : "  ✅ 全部通过"))
}

main()
