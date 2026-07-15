// 1.1 raw-api.ts — 原始 DeepSeek API 调用
// 对标 pi：packages/ai/src/api/openai-completions.ts

import dotenv from "dotenv"
dotenv.config({ override: true })

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY!
const API_URL = "https://api.deepseek.com/chat/completions"

export interface ChatResult {
  content: string
  finishReason: string
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/**
 * 发送一次非流式聊天请求
 * @param messages - OpenAI 格式的消息数组
 * @returns 助手回复 + token 用量
 */
export async function chatOnce(messages: Array<{ role: string; content: string }>): Promise<ChatResult> {
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
    }),
  })

  if (!response.ok) {
    const errBody = await response.text()
    throw new Error(`API 错误 [${response.status}]: ${errBody.slice(0, 200)}`)
  }

  const data = await response.json()
  return {
    content: data.choices[0].message.content,
    finishReason: data.choices[0].finish_reason,
    usage: {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    },
  }
}
