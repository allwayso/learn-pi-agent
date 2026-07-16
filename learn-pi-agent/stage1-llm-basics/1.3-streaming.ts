// 1.3 streaming.ts — SSE 流式输出
// 目的：stream: true → 解析 SSE → token-by-token 消费
// 对标 pi：packages/ai/src/api/openai-completions.ts 的 stream() 函数
//
// 核心设计讨论（pi 的关键决策）：
//   传统做法：流中出错 → throw → try/catch 捕获
//   pi 的做法：流中出错 → 广播 stopReason="error" → loop 检查后决定
//   为什么？agent 是长时运行的流式过程。LLM 在第 80% token 后断开，
//   你不想丢失已收到的文本。把错误编码进事件流，loop 可以消费部分结果。
//   这个讨论在 1.3 种下种子，阶段 3 agent loop 中全面实现。

import dotenv from "dotenv"
dotenv.config({ override: true })

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY!
const API_URL = "https://api.deepseek.com/chat/completions"

export interface StreamResult {
  content: string       // 完整回复文本
  finishReason: string  // 停止原因
}

/**
 * 流式调用 DeepSeek，通过回调逐个 token 推送
 *
 * @param messages  - 消息数组
 * @param onToken   - 每收到一个 token 就回调
 * @returns 汇总结果
 */
export async function streamChat(
  messages: Array<{ role: string; content: string }>,
  onToken: (token: string) => void,
): Promise<StreamResult> {
  // TODO:
  // 1. 发 fetch，body 中 stream: true（参考 1.1 的 chatOnce）
  // 2. 拿到 response.body（ReadableStream）
  // 3. 逐行读取，解析 SSE 格式：
  //    - 每行以 "data: " 开头
  //    - "data: [DONE]" 表示结束
  //    - 其余行 JSON.parse，取 choices[0].delta.content（可能为 undefined）
  // 4. 每收到一个 token 就调用 onToken(token)
  // 5. 返回 { content: 完整文本, finishReason, tokens: 所有token数组 }

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-v4-pro",
      messages,
      stream: true,
    }),
  })

  if (!response.ok) {
    const errBody = await response.text()
    throw new Error(`API 错误 [${response.status}]: ${errBody.slice(0, 200)}`)
  }

  if(!response.body){
    throw new Error("响应体为空")
  }

  const reader=response.body.getReader()
  const decoder=new TextDecoder()
  let buffer=""
  let content=""
  let finishReason="done"

  // 每次read()会从数据队列中出队一个chunk，本示例中每读到一个chunk就解码并渲染
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // decode结果是一个chunk，其中包含多行SSE，每行固定用\n\n标记结束
    // SSE的基本格式：data: {"choices":[{"delta":{"content":"{token}"}}]} 或 data: [DONE]
    const events=buffer.split("\n\n")
    buffer = events.pop()!  // 切完的残块留下下次处理

    for(const event of events){
      if(event.startsWith("data:")){
        const data=event.slice(6)   //切除data:开头
        if(data=="[DONE]") break
        const json=JSON.parse(data)
        const token=json.choices[0].delta.content
        finishReason=json.choices[0].finish_reason
        if(token) {
          onToken(token)
          content+=token
        }
      }
    }
  }

  // 排空 buffer 残片
  const remaining = buffer.split("\n\n")
  for (const event of remaining) {
    if (event.startsWith("data:") && event.slice(6).trim() !== "[DONE]") {
      const json = JSON.parse(event.slice(6).trim())
      const token = json.choices[0]?.delta?.content
      if (token) { onToken(token); content += token }
      finishReason = json.choices[0]?.finish_reason ?? finishReason
    }
  }
  return {content,finishReason}
}

