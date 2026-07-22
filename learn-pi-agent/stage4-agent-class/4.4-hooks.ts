// 4.4 hooks.ts — AgentLoopConfig hook 体系
// 对标 pi：types.ts AgentLoopConfig 的 beforeToolCall / afterToolCall / prepareNextTurn
//
// 核心认知：hook 属于 AgentLoopConfig 层，不是 tool 定义层。
//   阶段 2 的工具只管"怎么执行"——定义 schema + execute 函数，和 hook 无关。
//   阶段 4 的 hook 在 loop 侧——在工具执行前/后、turn 之间插入逻辑。
//   解耦的收益：同一个工具，不同场景用不同 hook 组合，不改工具定义。
//
// pi 的 hook 体系（四个注入点）：
//   beforeToolCall       — 执行前校验，可 block
//   afterToolCall        — 执行后覆写 result
//   shouldStopAfterTurn  — turn 结束后判断是否 graceful stop
//   prepareNextTurn      — 返回下轮的 context/model/thinking 变更
//
// TODO 清单：
//   prepareNextTurn       — 根据上下文动态调整下轮配置

import type { AgentMessage } from "./4.2-message-layer"

// ═══════════════════════════════════════════════════════════════════════════════
// Hook 签名（对标 pi types.ts AgentLoopConfig）
// ═══════════════════════════════════════════════════════════════════════════════

/** beforeToolCall：可 block 工具执行 */
export interface BeforeToolCallContext {
  toolName: string
  args: Record<string, any>
  toolCallId: string
}
export interface BeforeToolCallResult {
  block?: boolean
  reason?: string
}
export type BeforeToolCallHook = (
  ctx: BeforeToolCallContext,
) => BeforeToolCallResult | void | Promise<BeforeToolCallResult | void>

/** afterToolCall：可覆写工具执行结果 */
export interface AfterToolCallContext {
  toolName: string
  args: Record<string, any>
  toolCallId: string
  result: string
}
export interface AfterToolCallResult {
  content?: string
  isError?: boolean
  terminate?: boolean
}
export type AfterToolCallHook = (
  ctx: AfterToolCallContext,
) => AfterToolCallResult | void | Promise<AfterToolCallResult | void>

/** shouldStopAfterTurn：判断是否在当前 turn 后退出 */
export interface ShouldStopContext {
  assistantContent: string
  toolCallCount: number
  newMessageCount: number
}
export type ShouldStopHook = (
  ctx: ShouldStopContext,
) => boolean | Promise<boolean>

// ═══════════════════════════════════════════════════════════════════════════════
// TODO: prepareNextTurn — 根据上下文动态调整下轮配置
// ═══════════════════════════════════════════════════════════════════════════════
//
// 这是四个 hook 中最"主动"的一个——不只是拦截/覆写，而是返回配置变更，
// loop 在下一轮开始前应用这些变更。典型场景：
//   - 多轮未果时换模型（如 deepseek → claude）
//   - 检测到 token 快满时注入压缩提醒
//   - 根据对话阶段切换 system prompt
//
// 对标 pi：AgentLoopConfig.prepareNextTurn + AgentLoopTurnUpdate

/** prepareNextTurn 能看到的上下文 */
export interface PrepareNextTurnContext {
  /** 当前所有消息 */
  messages: AgentMessage[]
  /** 本轮的 assistant 回复内容 */
  assistantContent: string
  /** 本轮执行的工具数量 */
  toolCallCount: number
  /** 当前已累计的 turn 数（从 1 开始） */
  turnNumber: number
}

/** prepareNextTurn 返回的配置变更——所有字段可选，不返回的保持不变 */
export interface AgentLoopTurnUpdate {
  /** 替换 system prompt（在下一轮 LLM 调用时生效） */
  systemPrompt?: string
  /** 替换 model id */
  model?: string
}

export type PrepareNextTurnHook = (
  ctx: PrepareNextTurnContext,
) => AgentLoopTurnUpdate | void | Promise<AgentLoopTurnUpdate | void>

/**
 * 创建一个 prepareNextTurn hook：超过 maxTurns 轮时，注入提醒要求 LLM 尽快收尾。
 *
 * 对标 pi：AgentLoopConfig.prepareNextTurn
 */
export function createTurnLimitHook(
  maxTurns: number,
): PrepareNextTurnHook {
  // TODO:
  //   - 如果 ctx.turnNumber <= maxTurns，不干预（return 空）
  //   - 如果 ctx.turnNumber > maxTurns，return { systemPrompt: 原始 prompt + 提醒 }
  //   - 提醒追加到现有 systemPrompt 末尾，不要覆盖
  //   - 提示：ctx.messages[0] 是首条消息，可以作为 system prompt 的"原始值"来追加

  // ========== YOUR CODE HERE ==========
  return (ctx)=>{
    if(ctx.turnNumber<=maxTurns) return
    return {
      systemPrompt:ctx.messages[0].content+"提醒：达到轮次限制，尽快收尾内容"
    }
  }
  // ========== END YOUR CODE ==========
}
