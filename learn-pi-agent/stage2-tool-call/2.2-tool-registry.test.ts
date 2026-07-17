// 2.2 tool-registry.test.ts — 测试 ToolRegistry
// 运行：npx tsx learn-pi-agent/stage2-tool-call/2.2-tool-registry.test.ts

import { ToolRegistry, createDefaultRegistry, chatWithTools, RegisteredTool } from "./2.2-tool-registry"

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log(`  ✅ ${name}`); passed++ }
  else           { console.log(`  ❌ ${name}` + (detail ? ` — ${detail}` : "")); failed++ }
}

async function main() {
  // ─── 测试 1：ToolRegistry 基本功能 ───
  console.log("=== 1. ToolRegistry 基本功能 ===")
  const r1 = new ToolRegistry()
  check("初始 size 为 0", r1.size === 0)

  r1.register({
    name: "echo",
    description: "回显输入",
    parameters: { type: "object", properties: { text: { type: "string" } } },
    execute: (args) => `Echo: ${args.text}`,
  })
  check("注册后 size 为 1", r1.size === 1)

  const defs = r1.getDefinitions()
  check("getDefinitions 返回数组", Array.isArray(defs))
  check("数组长度 1", defs.length === 1)
  check("type 为 function", defs[0].type === "function")
  check("function.name 为 echo", defs[0].function.name === "echo")

  const result = await r1.execute("echo", { text: "hello" })
  check("execute 返回结果", result === "Echo: hello", `实际: ${result}`)

  // ─── 测试 2：默认注册表 ───
  console.log("\n=== 2. 默认注册表 ===")
  const registry = createDefaultRegistry()
  check("包含至少 2 个工具", registry.size >= 2, `实际: ${registry.size}`)

  // ─── 测试 3：天气工具调用 ───
  console.log("\n=== 3. 天气工具调用 ===")
  const r3 = await chatWithTools("北京今天天气怎么样？", registry)
  const weatherStep = r3.steps.find(s => s.name === "getWeather")
  check("调用了 getWeather", weatherStep != null, `steps: ${r3.steps.map(s => s.name)}`)
  if (weatherStep) {
    check("参数包含城市", weatherStep.arguments.city != null)
    check("结果非空", weatherStep.result.length > 0)
  }
  check("最终回复非空", r3.content.length > 0)
  console.log(`  LLM: ${r3.content}`)

  // ─── 测试 4：计算器工具调用 ───
  console.log("\n=== 4. 计算器工具调用 ===")
  const r4 = await chatWithTools("计算 123 * 456 等于多少？", registry)
  const calcStep = r4.steps.find(s => s.name === "calculator")
  check("调用了 calculator", calcStep != null, `steps: ${r4.steps.map(s => s.name)}`)
  if (calcStep) {
    check("结果正确", calcStep.result.includes("56088"),
      `实际: ${calcStep.result}`)
  }
  console.log(`  LLM: ${r4.content}`)

  // ─── 结果 ───
  const total = passed + failed
  console.log(`\n${"=".repeat(30)}`)
  console.log(`通过 ${passed}/${total}` + (failed > 0 ? `  ❌ ${failed} 个失败` : "  ✅ 全部通过"))
}

main()
