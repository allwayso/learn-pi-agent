// 1.2 chat-loop.test.ts — 测试 ChatLoop
// 运行：npx tsx learn-pi-agent/stage1-llm-basics/1.2-chat-loop.test.ts

import { ChatLoop } from "./1.2-chat-loop"

async function main() {
  const chat = new ChatLoop("你是一个有用的助手，每次回复不超过10个字")

  // ─── 第一轮 ───
  console.log(">>> 第 1 轮")
  const r1 = await chat.send("你好，我叫小明")
  console.log("回复:", r1.content)
  console.log("messages:", chat.messages.length) // 预期 3 (system + user + assistant)
  console.log("tokens:", chat.totalTokens)

  if (chat.messages.length !== 3) {
    console.log("❌ messages 数量不对")
    return
  }

  // ─── 第二轮：验证是否记住了上下文 ───
  console.log("\n>>> 第 2 轮")
  const r2 = await chat.send("我叫什么名字？")
  console.log("回复:", r2.content)
  console.log("messages:", chat.messages.length) // 预期 5
  console.log("tokens:", chat.totalTokens)

  // 预期 LLM 能回答出 "小明"
  if (r2.content.includes("小明")) {
    console.log("\n✅ 通过：LLM 记住了上下文")
  } else {
    console.log("\n⚠️ LLM 没提小明，可能没记住（不一定失败，部分模型回复较简洁）")
  }

  console.log(`\n总计 ${chat.turnCount} 轮，${chat.totalTokens} tokens`)
}

main()
