// 1.3 streaming.test.ts — 测试流式输出（边界情况覆盖）
// 运行：npx tsx learn-pi-agent/stage1-llm-basics/1.3-streaming.test.ts

import { streamChat } from "./1.3-streaming"

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${name}`)
    passed++
  } else {
    console.log(`  ❌ ${name}` + (detail ? ` — ${detail}` : ""))
    failed++
  }
}

async function main() {
  // ─── 测试 1：基本流式输出 ───
  console.log("=== 1. 基本流式输出 ===")
  const tokens1: string[] = []
  const r1 = await streamChat(
    [{ role: "user", content: "用一句话介绍 TypeScript" }],
    (t) => tokens1.push(t),
  )
  check("收到 token", tokens1.length > 0, `实际: ${tokens1.length}`)
  check("content 非空", r1.content.length > 0)
  check("content 等于 token 拼接", r1.content === tokens1.join(""),
    `期望 ${tokens1.length} tokens，实际 content 长度 ${r1.content.length}`)
  check("finishReason 为 stop", r1.finishReason === "stop", `实际: ${r1.finishReason}`)

  // ─── 测试 2：空 content 的 delta ───
  // 某些 delta 只有 reasoning_content 没有 content（DeepSeek V4 思考模式）
  // 这些空 delta 应该被跳过，不影响 content 和 finishReason
  console.log("\n=== 2. 空 delta 处理 ===")
  const r2 = await streamChat(
    [{ role: "user", content: "计算 123 * 456" }],
    () => {},  // 不收集 token，只验证整体
  )
  check("content 非空", r2.content.length > 0)
  check("content 是纯文本（无 JSON 残片）",
    !r2.content.includes('"choices"') && !r2.content.includes('"delta"'),
    `前 50 字符: ${r2.content.slice(0, 50)}`)

  // ─── 测试 3：emoji 和特殊字符 ───
  console.log("\n=== 3. emoji / 特殊字符 ===")
  const r3 = await streamChat(
    [{ role: "user", content: "回复一个 emoji 笑脸" }],
    () => {},
  )
  check("包含 emoji", /[\u{1F600}-\u{1F64F}]/u.test(r3.content) || r3.content.includes("😊"),
    `回复: ${r3.content}`)

  // ─── 测试 4：onToken 回调时序 ───
  console.log("\n=== 4. onToken 回调时序 ===")
  let lastCallTime = 0
  const callTimes: number[] = []
  await streamChat(
    [{ role: "user", content: "说三个词：苹果 香蕉 橘子" }],
    () => {
      const now = Date.now()
      callTimes.push(now)
      lastCallTime = now
    },
  )
  check("至少收到 3 个 token", callTimes.length >= 3, `实际: ${callTimes.length}`)
  // 验证回调是按序调用的（时间单调递增）
  const sorted = [...callTimes].sort()
  check("回调按时序调用", JSON.stringify(callTimes) === JSON.stringify(sorted))

  // ─── 测试 5：超短回复 ───
  console.log("\n=== 5. 超短回复（单 token）===")
  const r5 = await streamChat(
    [{ role: "user", content: "只说一个字：好" }],
    () => {},
  )
  check("content 非空", r5.content.length > 0)

  // ─── 结果 ───
  const total = passed + failed
  console.log(`\n${"=".repeat(30)}`)
  console.log(`通过 ${passed}/${total}` + (failed > 0 ? `  ❌ ${failed} 个失败` : "  ✅ 全部通过"))
}

main()
