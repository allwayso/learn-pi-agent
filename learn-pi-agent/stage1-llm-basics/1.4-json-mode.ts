// 1.4 json-mode.ts — JSON 模式
// 目的：response_format: { type: "json_object" } → LLM 强制输出 JSON
// 对标 pi：无直接对应（pi 直接上 tool call，阶段 2），但 JSON mode 是 tool call 的前身
//
// 为什么学这个：tool call 本质上就是"你必须输出符合这个 schema 的 JSON，我来解析并执行"。
// JSON mode 让你先理解约束输出的机制，阶段 2 再引入 schema + 自动执行。

import dotenv from "dotenv"
dotenv.config({ override: true })

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY!
const API_URL = "https://api.deepseek.com/chat/completions"

/**
 * 请求 LLM 以 JSON 格式返回结构化数据
 *
 * @param prompt  - 描述需要什么数据
 * @param schema  - 期望的 JSON 结构描述（自然语言即可）
 * @returns 解析后的 JS 对象
 */
export async function jsonChat(
  prompt: string,
  schema: string,
): Promise<Record<string, any>> {

  // ========== YOUR CODE HERE ==========

  const messages = [
  { role: "system", content: `你是一个 JSON 提取器。严格按照以下 schema 返回 JSON，不要包含任何解释文字：${schema}` },
  { role: "user", content: prompt },
  ]

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-v4-pro",
      messages,
      stream: false,
      response_format: { type: "json_object" },
    }),
  })

  if (!response.ok) {
    const errBody = await response.text()
    throw new Error(`API 错误 [${response.status}]: ${errBody.slice(0, 200)}`)
  }

  const data = await response.json()
  let text = data.choices[0].message.content

  // 清洗：去掉 markdown 代码块标记
  text = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim()

  // 裁剪：取第一个 { 或 [ 到最后一个 } 或 ]
  const startObj = text.indexOf("{")
  const startArr = text.indexOf("[")
  const start = startObj === -1 ? startArr : startArr === -1 ? startObj : Math.min(startObj, startArr)
  const endObj = text.lastIndexOf("}")
  const endArr = text.lastIndexOf("]")
  const end = Math.max(endObj, endArr)
  if (start === -1 || end === -1) {
    throw new Error(`未找到 JSON 对象: ${text.slice(0, 100)}`)
  }
  text = text.slice(start, end + 1)

  return JSON.parse(text)

  // ========== END YOUR CODE ==========

}
