// 2.1 function-call.test.ts — 测试 tool call
// 运行：npx tsx learn-pi-agent/stage2-tool-call/2.1-function-call.test.ts

import { chatWithTool } from "./2.1-function-call"
import { ChatResult } from "../shared/types"

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log(`  ✅ ${name}`); passed++ }
  else           { console.log(`  ❌ ${name}` + (detail ? ` — ${detail}` : "")); failed++ }
}

async function main() {
  // ─── 测试 1：基础工具调用 ───
  console.log("=== 1. 基础工具调用 ===")
  const r1 = await chatWithTool("北京今天天气怎么样？")
  check("至少调用了一次工具", r1.steps.length >= 1,
    `实际: ${r1.steps.length}`)
  check("工具名是 getWeather", r1.steps[0]?.name === "getWeather",
    `实际: ${r1.steps[0]?.name}`)
  check("工具结果非空", r1.steps[0]?.result.length > 0)
  check("最终回复非空", r1.content.length > 0)
  console.log(`  工具结果: ${r1.steps[0]?.result}`)
  console.log(`  LLM 回复: ${r1.content}`)

  // ─── 测试 2：不需要工具的提问 ───
  console.log("\n=== 2. 不需要工具的提问 ===")
  const r2 = await chatWithTool("你好，1+1 等于几？")
  // 这种问题 LLM 可能不调工具，直接回复
  check("最终回复非空", r2.content.length > 0)
  console.log(`  LLM 回复: ${r2.content}`)

  // ─── 测试 3：另一座城市 ───
  console.log("\n=== 3. 另一座城市 ===")
  const r3 = await chatWithTool("东京的天气如何？")
  check("工具名是 getWeather", r3.steps[0]?.name === "getWeather")
  check("结果包含东京", r3.steps[0]?.result.toLowerCase().includes("东京") || r3.steps[0]?.result.includes("雨"),
    `实际: ${r3.steps[0]?.result}`)
  console.log(`  LLM 回复: ${r3.content}`)

  // ─── 结果 ───
  const total = passed + failed
  console.log(`\n${"=".repeat(30)}`)
  console.log(`通过 ${passed}/${total}` + (failed > 0 ? `  ❌ ${failed} 个失败` : "  ✅ 全部通过"))
}

main()
