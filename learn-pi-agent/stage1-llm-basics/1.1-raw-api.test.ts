// 1.1 raw-api.test.ts — 测试 chatOnce
// 运行：npx tsx learn-pi-agent/stage1-llm-basics/1.1-raw-api.test.ts

import { chatOnce } from "./1.1-raw-api"

async function main() {
  const result = await chatOnce([
    { role: "system", content: "你是一个有用的助手" },
    { role: "user", content: "你好" },
  ])

  console.log("=== 1.1 测试结果 ===")
  console.log("回复:", result.content)
  console.log("停止原因:", result.finishReason)
  console.log("token 用量:", result.usage)
  console.log()

  // 自检
  const pass =
    typeof result.content === "string" && result.content.length > 0 &&
    result.finishReason === "stop" &&
    result.usage.totalTokens > 0
  console.log(pass ? "✅ 通过" : "❌ 失败")
}

main()
