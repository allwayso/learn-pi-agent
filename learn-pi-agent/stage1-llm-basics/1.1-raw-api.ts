// 1.1 raw-api.ts — 原始 DeepSeek API 调用
// 目的：用 Node.js 内置 fetch 裸调 API，看懂 JSON 往返全貌
// 对标 pi：packages/ai/src/api/openai-completions.ts

import dotenv from "dotenv"
dotenv.config({ override: true })

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY!
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/chat/completions"

async function main() {

  // step 1: 构造请求体 { model, messages, stream: false }
  const body = {
    "model":"deepseek-v4-pro",
    "messages":[
      {"role":"system","content":"you're a helpful assistant",},
      {"role":"user","content":"hello",},
    ],
    "stream":false
  }

  // step 2: 发 POST，拿到 response
  const response = await fetch(DEEPSEEK_BASE_URL,{
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body:JSON.stringify(body),
  })

  // step 3: 检查 HTTP 状态码，不是 2xx 就读 error body 并抛异常
  if (!response.ok) {
    const errBody = await response.text()
    throw new Error(`API 错误 [${response.status}]: ${errBody.slice(0, 200)}`);
  }

  // step 4: 解析 JSON → 打印完整响应（看看 choices/usage/finish_reason 长什么样）
  const data = await response.json()
  console.log("=== 完整响应 ===")
  console.log(JSON.stringify(data, null, 2))

  // step 5: 提取关键字段：回复文本 + token 用量
  
  console.log("\n=== 关键字段 ===")
  console.log("回复:",data.choices[0].message.content)
  console.log("输入 tokens:", data.usage.prompt_tokens)
  console.log("输出 tokens:", data.usage.completion_tokens)
  console.log("总 tokens:", data.usage.total_tokens)
  console.log("停止原因:", data.choices[0].finish_reason)
  
}

main()
