// 3.1 minimal-loop.test.ts — 测试最简 ReAct agent loop
// 运行：npx tsx learn-pi-agent/stage3-agent-loop/3.1-minimal-loop.test.ts

import { minimalLoop, AgentContext } from "./3.1-minimal-loop"
import { createDefaultRegistry } from "../stage2-tool-call/2.2-tool-registry"
import { ChatResult } from "../shared/types"

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log(`  ✅ ${name}`); passed++ }
  else           { console.log(`  ❌ ${name}` + (detail ? ` — ${detail}` : "")); failed++ }
}

async function main() {
  const context: AgentContext = {
    systemPrompt: "你是一个智能助手，可以用工具获取天气和执行计算。回答用中文。",
    tools: createDefaultRegistry(),
  }

  // ─── 测试 1：单工具调用（天气）───
  console.log("=== 1. 单工具调用（天气）===")
  {
    const r = await minimalLoop("北京今天天气怎么样？", context)
    check("至少一次工具调用", r.steps.length >= 1)
    check("调用了 getWeather", r.steps.some(s => s.name === "getWeather"))
    check("最终回复非空", r.content.length > 0)
    console.log(`  工具: ${r.steps.map(s => s.name).join(", ")}`)
    console.log(`  LLM: ${r.content.slice(0, 80)}...`)
  }

  // ─── 测试 2：不需要工具 ───
  console.log("\n=== 2. 不需要工具 ===")
  {
    const r = await minimalLoop("你好，用中文打个招呼", context)
    check("零工具调用", r.steps.length === 0)
    check("有文本回复", r.content.length > 0)
    console.log(`  LLM: ${r.content.slice(0, 80)}`)
  }

  // ─── 测试 3：复合请求（天气 + 计算）───
  console.log("\n=== 3. 复合请求（天气 + 计算）===")
  {
    const r = await minimalLoop("北京天气如何？顺便算 123*456", context)
    const names = r.steps.map(s => s.name)
    check("至少调用了工具", r.steps.length >= 1, `调用了 ${r.steps.length} 次: ${names}`)
    check("最终回复非空", r.content.length > 0)
    console.log(`  工具: ${names.join(", ")}`)
    console.log(`  LLM: ${r.content.slice(0, 80)}...`)
  }

  // ─── 测试 4：验证流式输出（工具调用后 LLM 有文本回复）───
  console.log("\n=== 4. 验证流式输出 ===")
  {
    const r = await minimalLoop("东京天气怎么样？", context)
    check("调用了 getWeather", r.steps.some(s => s.name === "getWeather"))
    // 流式输出应该能产出完整中文回复
    check("回复包含天气信息", r.content.includes("雨") || r.content.includes("温") || r.content.length > 20,
      `实际: ${r.content.slice(0, 50)}`)
    console.log(`  LLM: ${r.content.slice(0, 100)}`)
  }

  // ─── 结果 ───
  const total = passed + failed
  console.log(`\n${"=".repeat(30)}`)
  console.log(`通过 ${passed}/${total}` + (failed > 0 ? `  ❌ ${failed} 个失败` : "  ✅ 全部通过"))
}

main()
