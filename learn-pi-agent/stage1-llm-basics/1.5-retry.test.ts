// 1.5 retry.test.ts — 测试重试机制
// 运行：npx tsx learn-pi-agent/stage1-llm-basics/1.5-retry.test.ts

import { withRetry, RetryOptions } from "./1.5-retry"
import { chatOnce } from "./1.1-raw-api"

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log(`  ✅ ${name}`); passed++ }
  else           { console.log(`  ❌ ${name}` + (detail ? ` — ${detail}` : "")); failed++ }
}

async function main() {
  // ─── 测试 1：正常调用不需要重试 ───
  console.log("=== 1. 正常调用（不应重试）===")
  const r1 = await withRetry(
    () => chatOnce([{ role: "user", content: "说 hi" }]),
  )
  check("正常返回结果", r1.content.length > 0)
  check("finishReason 为 stop", r1.finishReason === "stop")

  // ─── 测试 2：不可重试错误直接抛出 ───
  console.log("\n=== 2. 不可重试错误（不重试）===")
  const start2 = Date.now()
  try {
    await withRetry(
      async () => {
        throw new Error("API 错误 [401]: 鉴权失败")
      },
      { maxRetries: 3, baseDelayMs: 500 },
    )
    check("应立即抛出", false, "没有抛异常")
  } catch (e: any) {
    const elapsed = Date.now() - start2
    check("立即抛出（无重试延迟）", elapsed < 200,
      `耗时 ${elapsed}ms（预期 <200ms，401 不应重试）`)
    check("错误信息包含 401", e.message.includes("401"))
  }

  // ─── 测试 3：可重试错误会重试 ───
  console.log("\n=== 3. 可重试错误（应重试）===")
  const start3 = Date.now()
  let callCount = 0
  try {
    await withRetry(
      async () => {
        callCount++
        throw new Error("API 错误 [503]: 服务暂不可用")
      },
      { maxRetries: 2, baseDelayMs: 100 },
    )
    check("应最终抛出", false, "没抛异常")
  } catch (e: any) {
    const elapsed = Date.now() - start3
    check("重试了 2 次后抛出", callCount === 3, `实际调用 ${callCount} 次`)
    check("有一次退避延迟", elapsed >= 200, `耗时 ${elapsed}ms`)
  }

  // ─── 测试 4：重试后成功 ───
  console.log("\n=== 4. 重试后成功 ===")
  let failCount = 0
  const r4 = await withRetry(
    async () => {
      failCount++
      if (failCount <= 2) throw new Error("API 错误 [503]: 服务暂不可用")
      return await chatOnce([{ role: "user", content: "说 ok" }])
    },
    { maxRetries: 3, baseDelayMs: 50 },
  )
  check("前两次失败后第三次成功", failCount === 3, `实际调用 ${failCount} 次`)
  check("最终返回正常结果", r4.content.length > 0)

  // ─── 测试 5：网络错误可重试 ───
  console.log("\n=== 5. 网络错误（无 HTTP 状态码）===")
  try {
    await withRetry(
      async () => { throw new Error("fetch failed") },
      { maxRetries: 1, baseDelayMs: 50 },
    )
    check("应最终抛出", false)
  } catch (e: any) {
    check("网络错误被识别为可重试", e.message.includes("fetch failed"))
  }

  // ─── 结果 ───
  const total = passed + failed
  console.log(`\n${"=".repeat(30)}`)
  console.log(`通过 ${passed}/${total}` + (failed > 0 ? `  ❌ ${failed} 个失败` : "  ✅ 全部通过"))
}

main()
