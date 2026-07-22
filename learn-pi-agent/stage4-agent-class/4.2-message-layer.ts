// 4.2 message-layer.ts — AgentMessage 体系 + convertToLlm + transformContext
// 对标 pi：types.ts AgentMessage / CustomAgentMessages，agent.ts defaultConvertToLlm
//
// 核心概念：AgentMessage ≠ LLM Message。
//   Agent 内部消息比 LLM 协议更丰富——可以包含 UI 通知、状态消息等自定义类型。
//   convertToLlm() 在每次 LLM 调用前过滤非 LLM 消息、映射自定义类型。
//   transformContext 是一个 hook 槽位——调用方可以传入裁剪/注入等任意逻辑，
//   在 AgentMessage 层操作上下文，对 loop 透明。
//
// 和阶段 3 的 AgentMessage 区别：
//   阶段 3：role 字段是字符串联合类型（"user" | "assistant" | ...），加新类型要改 union
//   阶段 4：用 discriminated union，每种消息是独立 interface，加新类型不改现有代码
//
// 对标 pi 的设计：
//   AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages]
//   convertToLlm = AgentLoopConfig 的必填回调
//   transformContext = AgentLoopConfig 的可选 hook，默认 undefined
//
// TODO 清单：
//   convertToLlm          — 过滤 + 映射：AgentMessage[] → LLM 线格式
//   prepareLlmMessages    — 管道：可选的 transformContext hook → convertToLlm

// ═══════════════════════════════════════════════════════════════════════════════
// AgentMessage 体系：discriminated union
// ═══════════════════════════════════════════════════════════════════════════════

/** 用户消息——和 LLM UserMessage 一一对应 */
export interface UserMessage {
  type: "user"
  content: string
  timestamp: number
}

/** 助手消息——可能携带 tool_calls */
export interface AssistantMessage {
  type: "assistant"
  content: string
  toolCalls?: { id: string; name: string; arguments: string }[]
  timestamp: number
}

/** 工具执行结果——关联到特定的 tool_call */
export interface ToolResultMessage {
  type: "toolResult"
  toolCallId: string
  toolName: string
  content: string
  timestamp: number
}

/** 通知消息——仅给 UI 看，不传给 LLM */
export interface NotificationMessage {
  type: "notification"
  text: string
  level: "info" | "warn" | "error"
  timestamp: number
}

/** 状态消息——Agent 内部状态快照，不传给 LLM */
export interface StatusMessage {
  type: "status"
  code: "thinking" | "executing" | "idle"
  detail?: string
  timestamp: number
}

/** Agent 内部消息：LLM 消息 + 自定义消息的联合 */
export type AgentMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | NotificationMessage
  | StatusMessage

// ═══════════════════════════════════════════════════════════════════════════════
// LLM 线格式（OpenAI 兼容）
// ═══════════════════════════════════════════════════════════════════════════════

export type LlmMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: LlmToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string }

export interface LlmToolCall {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

// ═══════════════════════════════════════════════════════════════════════════════
// transformContext hook 签名（对标 pi AgentLoopConfig.transformContext）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * transformContext hook：在 AgentMessage 层操作上下文。
 *
 * 对标 pi：AgentLoopConfig.transformContext
 * 契约：不能 throw，异常时返回原 messages（安全兜底）。
 */
export type TransformContextFn = (
  messages: AgentMessage[],
  signal?: AbortSignal,
) => Promise<AgentMessage[]> | AgentMessage[]

// ═══════════════════════════════════════════════════════════════════════════════
// TODO 1: convertToLlm — AgentMessage[] → LLM 线格式
// ═══════════════════════════════════════════════════════════════════════════════
//
// 在每次 LLM 调用前，遍历 AgentMessage[]，过滤掉非 LLM 消息，映射为标准角色。
// 对标 pi：agent.ts defaultConvertToLlm
//
// 契约：不能 throw，异常时返回 []（安全兜底）。

/**
 * 将 Agent 内部消息转换为 LLM 可理解的线格式。
 *
 * 对标 pi：agent.ts defaultConvertToLlm
 */
export function convertToLlm(messages: AgentMessage[]): LlmMessage[] {
  // TODO:
  //   - messages 为 null/undefined 时返回 []
  //   - 遍历 messages，switch 每条消息的 type 字段
  //   - "user" → { role: "user", content }
  //   - "assistant" → { role: "assistant", content, tool_calls }
  //     （toolCalls 映射为 LlmToolCall[]，type 固定 "function"）
  //   - "toolResult" → { role: "tool", tool_call_id, content }
  //   - "notification" / "status" / default → 跳过

  // ========== YOUR CODE HERE ==========
  if(!messages) return []
  const result:LlmMessage[]=[]
  for (const message of messages){
    switch (message.type){
      case "user": {result.push({role:"user",content:message.content});break}
      case "assistant": {
        result.push({role:"assistant",content:message.content,tool_calls:message.toolCalls?.map(tc => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        }))})
        break;
        }
      case "toolResult":
        {result.push({role:"tool",tool_call_id:message.toolCallId,content:message.content})
        break}
      case "notification":
      case "status":
        break
    }
  }
  return result
  // ========== END YOUR CODE ==========
}

// ═══════════════════════════════════════════════════════════════════════════════
// TODO 2: prepareLlmMessages — 管道：transformContext hook → convertToLlm
// ═══════════════════════════════════════════════════════════════════════════════
//
// 对标 pi agent-loop.ts 的这一段：
//   if (config.transformContext) messages = await config.transformContext(messages, signal)
//   const llmMessages = await config.convertToLlm(messages)
//
// transformContext 是可选的——没传就跳过，直接 convertToLlm。

/**
 * 经过可选的 transformContext hook 后，将 AgentMessage 转为 LLM 线格式。
 *
 * 对标 pi：agent-loop.ts runLoop 中的 context transform + convertToLlm 调用
 */
export async function prepareLlmMessages(
  messages: AgentMessage[],
  transformContext?: TransformContextFn,    // hook 函数：逻辑由调用方实现，调用时机由框架决定
  signal?: AbortSignal,
): Promise<LlmMessage[]> {
  // TODO:
  //   - messages 为 null/undefined 时返回 []
  //   - 如果 transformContext 存在：调 transformContext(messages, signal)，用其结果
  //   - 调 convertToLlm，返回结果
  //   - try/catch 兜底：异常时跳过 hook，直接 convertToLlm(messages)

  // ========== YOUR CODE HERE ==========
  
  if(!messages) return []
  if(transformContext) try{
    return convertToLlm(await transformContext(messages,signal))
  }catch(error){
    console.error("prepareLlmMessages 异常: ",error)
    return convertToLlm(messages)
  }
  return convertToLlm(messages)
  
  
  // ========== END YOUR CODE ==========
}

// ═══════════════════════════════════════════════════════════════════════════════
// 示例：pruneContext — 一个满足 TransformContextFn 签名的裁剪 hook
// ═══════════════════════════════════════════════════════════════════════════════
//
// 这是"调用方如何写一个 transformContext hook"的示例。
// 保留首条消息 + 最近 keepRecent 条，其余丢弃。
// 调用方自己决定裁剪策略——Agent 只负责在合适时机调 hook。

/**
 * 示例 transformContext hook：滑动窗口裁剪。
 *
 * 满足 TransformContextFn 签名，可直接传入 prepareLlmMessages。
 */
export function pruneContext(
  keepRecent: number,
): TransformContextFn {
  return (messages: AgentMessage[]) => {
    if (!messages || messages.length === 0) return []
    if (messages.length <= keepRecent + 1) return messages
    const first = messages[0]
    const recent = keepRecent > 0 ? messages.slice(-keepRecent) : []
    return [first, ...recent]
  }
}
