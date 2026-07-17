// shared/types.ts — stage2 统一类型定义
// 2.1 / 2.2 / 2.3 共用

/** LLM 返回的一次工具调用请求 */
export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, any>
}

/** 一次工具调用的执行结果 */
export interface ToolResult {
  toolCallId: string
  name: string
  result: string
}

/** 完整对话结果（LLM 最终回复 + 所有工具调用记录） */
export interface ChatResult {
  content: string
  steps: ToolResult[]
}
