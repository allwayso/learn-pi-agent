// 1.2 chat-loop.ts — 多轮对话循环
// 对标 pi：openai-completions.ts 的消息累积机制

import { chatOnce, type ChatResult } from "./1.1-raw-api"

// 规定Message对象
export interface Message {
  role: "system" | "user" | "assistant"
  content: string
}

export class ChatLoop {
  // 消息队列
  messages: Message[]
  totalTokens: number
  // 记录对话轮数
  turnCount: number

  // 构造函数
  constructor(systemPrompt: string) {
    this.messages = [{ role: "system", content: systemPrompt }]
    this.totalTokens = 0
    this.turnCount = 0
  }

  /**
   * 发送用户消息，返回助手回复
   * 自动累积到 messages 数组
   */
  async send(userContent: string): Promise<ChatResult> {
    // TODO: 实现 send()
    
    // 用户请求存入消息队列
    this.messages.push({ role: "user", content: userContent })
    
    // 利用1.1中的chatOnce()发一次请求，返回ChatResult类型结果
    const result = await chatOnce(this.messages)
    
    // 从result中拿出回复内容作为content，存入消息队列
     this.messages.push({ role: "assistant", content: result.content })
    
    this.totalTokens += result.usage.totalTokens   
    this.turnCount += 1
    
    return result
  }
}
