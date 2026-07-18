// 2.4 tool-loop.test.ts — 测试 tool loop
// 运行：npx tsx learn-pi-agent/stage2-tool-call/2.4-tool-loop.test.ts

import { toolLoop } from "./2.4-tool-loop"
import { createDefaultRegistry } from "./2.2-tool-registry"
import { ChatResult } from "../shared/types"

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log(`  ✅ ${name}`); passed++ }
  else           { console.log(`  ❌ ${name}` + (detail ? ` — ${detail}` : "")); failed++ }
}

async function main() {
  const registry = createDefaultRegistry()

  // ─── 测试 1：单工具调用（和 2.2 表现一致）───
  console.log("=== 1. 单工具调用 ===")
  {
    const r = await toolLoop("北京今天天气怎么样？", registry)
    check("至少一次工具调用", r.steps.length >= 1)
    check("有 getWeather 调用", r.steps.some(s => s.name === "getWeather"))
    check("最终回复非空", r.content.length > 0)
    console.log(`  LLM: ${r.content.slice(0, 80)}...`)
  }

  // ─── 测试 2：不需要工具 ───
  console.log("\n=== 2. 不需要工具 ===")
  {
    const r = await toolLoop("你好，用中文打个招呼", registry)
    check("零工具调用", r.steps.length === 0)
    check("有回复", r.content.length > 0)
    console.log(`  LLM: ${r.content.slice(0, 80)}`)
  }

  // ─── 测试 3：可能多次工具调用 ───
  console.log("\n=== 3. 复合请求（天气 + 计算）===")
  {
    const r = await toolLoop("北京天气如何？顺便算 123*456", registry)
    const names = r.steps.map(s => s.name)
    check("至少调用了工具", r.steps.length >= 1, `调用了 ${r.steps.length} 次: ${names}`)
    check("最终回复非空", r.content.length > 0)
    console.log(`  工具调用: ${names.join(", ")}`)
    console.log(`  LLM 回复: ${r.content.slice(0, 80)}...`)
  }

  // ─── 结果 ───
  const total = passed + failed
  console.log(`\n${"=".repeat(30)}`)
  console.log(`通过 ${passed}/${total}` + (failed > 0 ? `  ❌ ${failed} 个失败` : "  ✅ 全部通过"))
}

main()
