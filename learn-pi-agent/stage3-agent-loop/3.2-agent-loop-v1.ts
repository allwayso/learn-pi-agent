// 3.2 agent-loop-v1.ts — 完整 agent loop（双层 while + stop_reason + 事件）
// 对标 pi：agent-loop.ts 全文（runLoop + streamAssistantResponse + executeToolCalls）
//
// 3.1 → 3.2 的升级：
//   1. 双层 while — 外层控制 follow-up 队列，内层处理 tool + steering 循环
//   2. stop_reason 多分支 — stop / toolUse / maxTokens / error / aborted，各有处理逻辑
//   3. 错误不 throw — LLM 失败编码成 stopReason="error"，loop 优雅退出不崩溃
//   4. AbortSignal 全程传播 — streaming / tool execute / steering 三处检查
//   5. 最小事件系统 — emit(event) 回调，让外部感知 loop 每一步
//
// TODO 清单：
//   agentLoop steering 注入   — 内层 while 顶部，注入 pending 消息并 emit 事件
//   agentLoop stop_reason 分支 — shouldExecuteTools 标志 + switch 6 路分流
//   agentLoop follow-up 检查   — 外层 while 底部，拉取 follow-up 队列并决定是否继续

import dotenv from "dotenv"
dotenv.config({ override: true })
import OpenAI from "openai"

import { ToolResult } from "../shared/types"
import { ToolRegistry } from "../stage2-tool-call/2.2-tool-registry"

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY!

const client = new OpenAI({
  apiKey: DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
})

// ─── 类型定义 ───

/** LLM 调用可能结束的原因 */
type StopReason = "stop" | "endTurn" | "toolUse" | "maxTokens" | "error" | "aborted"

/** Agent 内部消息（比 LLM 协议更丰富，这是阶段 4 的前奏） */
interface AgentMessage {
  role: "user" | "assistant" | "toolResult" | "steering" | "followUp"
  content: string
  stopReason?: StopReason
  toolCallId?: string
  toolCalls?: PendingToolCall[]
  timestamp: number
}

/** 流式累积中的 tool call 条目（同 3.1） */
interface PendingToolCall {
  id: string
  name: string
  arguments: string
}

/** Agent 运行上下文 */
interface AgentContext {
  systemPrompt: string
  messages: AgentMessage[]
  tools: ToolRegistry
}

/** Loop 配置：钩子 + 队列 + signal */
interface AgentLoopConfig {
  /** AgentMessage → LLM 线格式的转换函数（阶段 4 深入） */
  convertToLlm: (msgs: AgentMessage[]) => OpenAI.Chat.ChatCompletionMessageParam[]
  /** 内层循环每次迭代前拉取的 steering 消息队列 */
  getSteeringMessages?: () => Promise<AgentMessage[]>
  /** 外层循环每轮结束后拉取的 follow-up 消息队列 */
  getFollowUpMessages?: () => Promise<AgentMessage[]>
  /** 取消信号 */
  signal?: AbortSignal
}

/** Loop 事件（最小版，3.3 升级为 EventStream） */
type AgentEvent =
  | { type: "turn_start" }
  | { type: "turn_end" }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_start"; toolCallId: string; toolName: string }
  | { type: "tool_end"; toolCallId: string; toolName: string; result: string }
  | { type: "agent_end"; messages: AgentMessage[] }

type AgentEventSink = (event: AgentEvent) => Promise<void> | void

/** finish_reason → StopReason 映射 */
function mapStopReason(raw: string | null): StopReason {
  if (!raw) return "stop"
  switch (raw) {
    case "stop": case "end": return "stop"
    case "tool_calls": case "function_call": return "toolUse"
    case "length": return "maxTokens"
    default: return "stop"
  }
}

// ─── ensureToolCall（同 3.1）───

function ensureToolCall(
  pendingToolCalls: Map<number, PendingToolCall>,
  tc: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall,
): void {
  const idx = tc.index
  if (!pendingToolCalls.has(idx)) {
    pendingToolCalls.set(idx, { id: "", name: "", arguments: "" })
  }
  const existing = pendingToolCalls.get(idx)!
  if (tc.id) existing.id = tc.id
  if (tc.function?.name) existing.name = tc.function.name
  if (tc.function?.arguments) existing.arguments += tc.function.arguments
}

// ─── 流式 LLM 调用 + 错误编码 ───

/**
 * 流式调用 LLM，累积 content + tool_calls，返回统一结果。
 *
 * 错误不 throw——编码进返回值的 stopReason，由上层 loop 决定如何处理。
 * 参照 pi：openai-completions.ts 的 catch 分支把 error 编码进 AssistantMessage。
 */
async function streamAssistantResponse(
  llmMessages: OpenAI.Chat.ChatCompletionMessageParam[],
  tools: ToolRegistry,
  signal?: AbortSignal,
): Promise<{ content: string; toolCalls: PendingToolCall[]; stopReason: StopReason }> {

  // 变量提到 try 外面，catch 里才能拿到 partial content
  let content = ""
  const pendingToolCalls = new Map<number, PendingToolCall>()
  let finishReason: string | null = null

  try {
    if (signal?.aborted) {
      return { content, toolCalls: [], stopReason: "aborted" }
    }

    // 以下部分同3.1，流式处理请求
    const stream = await client.chat.completions.create({
      model: "deepseek-v4-pro",
      messages: llmMessages,
      tools: tools.getDefinitions(),
      stream: true,
    }, { signal })

    for await (const chunk of stream) {
      if (signal?.aborted) {
        return { content, toolCalls: Array.from(pendingToolCalls.values()), stopReason: "aborted" }
      }
      const delta = chunk.choices[0]?.delta
      if (delta?.content) content += delta.content
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          ensureToolCall(pendingToolCalls, tc)
        }
      }
      if (chunk.choices[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason
    }

    const stopReason = mapStopReason(finishReason)
    return { content, toolCalls: Array.from(pendingToolCalls.values()), stopReason }
  } catch (e: any) {
    // 错误不 throw —— 编码进 stopReason，partial content 不丢失
    const toolCalls = Array.from(pendingToolCalls.values())
    if (signal?.aborted || e?.name === "AbortError") {
      return { content, toolCalls, stopReason: "aborted" }
    }
    const errorMsg = e?.message || String(e)
    return {
      content: content ? content + "\n[错误] " + errorMsg : errorMsg,
      toolCalls,
      stopReason: "error",
    }
  }
}

// ─── 默认 convertToLlm（最简映射）───

function defaultConvertToLlm(msgs: AgentMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.ChatCompletionMessageParam[] = []
  for (const m of msgs) {
    switch (m.role) {
      case "user":
        result.push({ role: "user", content: m.content })
        break
      case "assistant":
        result.push({ role: "assistant", content: m.content, tool_calls: m.toolCalls?.map(tc => ({
          id: tc.id, type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })) })
        break
      case "toolResult":
        result.push({ role: "tool", tool_call_id: m.toolCallId!, content: m.content })
        break
      // steering / followUp 在默认映射中转为 user 消息
      case "steering":
      case "followUp":
        result.push({ role: "user", content: m.content })
        break
    }
  }
  return result
}

// ─── Agent Loop ★ ───

/**
 * 完整 agent loop：双层 while + stop_reason 多分支 + 事件 + AbortSignal。
 *
 * 对标 pi agent-loop.ts 的 runLoop：
 *   外层 while = follow-up 队列（agent 停止后检查是否还有后续任务）
 *   内层 while = tool + steering（LLM 调用 → 工具执行 → 人机中途干预）
 */
export async function agentLoop(
  userPrompt: string,
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink = () => {},
): Promise<AgentMessage[]> {
  const signal = config.signal
  const convertToLlm = config.convertToLlm || defaultConvertToLlm

  // 初始化：push 用户消息
  const userMsg: AgentMessage = {
    role: "user", content: userPrompt, timestamp: Date.now(),
  }
  context.messages.push(userMsg)
  await emit({ type: "message_start", message: userMsg })
  await emit({ type: "message_end", message: userMsg })

  // ─── 外层 while：follow-up 队列 ───
  while (true) {
    let hasToolCalls = true
    let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || []

    // ─── 内层 while：tool + steering ───
    while (hasToolCalls || pendingMessages.length > 0) {
      if (signal?.aborted) {
        await emit({ type: "agent_end", messages: context.messages })
        return context.messages
      }

      await emit({ type: "turn_start" })

      // TODO:
      //   - 如果 pendingMessages 非空：逐条 push 到 context.messages，并 emit message_start / message_end
      //   - 执行后清空 pendingMessages

      // ========== YOUR CODE HERE (steering 注入) ==========

      while(pendingMessages.length){
         const message=pendingMessages.shift()!
         context.messages.push(message)
         await emit({type:"message_start",message})
         await emit({type:"message_end",message})
       }

      // ========== END YOUR CODE ==========

      // 调用 LLM
      const llmMessages = convertToLlm(context.messages)
      const llmSystemPrompt: OpenAI.Chat.ChatCompletionMessageParam =
        { role: "system", content: context.systemPrompt }
      const fullLlmMessages = [llmSystemPrompt, ...llmMessages]

      const { content, toolCalls, stopReason } = await streamAssistantResponse(
        fullLlmMessages, context.tools, signal,
      )

      // TODO:
      //   - 用 shouldExecuteTools 标志控制 switch 后的脚手架是否执行
      //   - stop / endTurn：push assistant（含 LLM 回复文本），shouldExecuteTools = false
      //   - toolUse：不做操作，shouldExecuteTools 保持 true，自然落入脚手架执行工具
      //   - maxTokens：push assistant + 每个 call 配一条 error tool result，
      //     shouldExecuteTools = false
      //   - error / aborted：push error assistant → emit agent_end → return

      // ========== YOUR CODE HERE (stop_reason 分支) ==========
      
      let shouldExecuteTools = true

      switch (stopReason) {
        case "stop":
        case "endTurn": {
          shouldExecuteTools = false
          // stop/endTurn 也有文本内容，需要 push assistant 消息
          const assistantMsg: AgentMessage = {
            role: "assistant", content, timestamp: Date.now(),
          }
          context.messages.push(assistantMsg)
          await emit({ type: "message_start", message: assistantMsg })
          await emit({ type: "message_end", message: assistantMsg })
          break
        }

        case "toolUse":
          break

        case "maxTokens": {
          shouldExecuteTools = false

          const assistantMsg: AgentMessage = {
            role: "assistant", content, toolCalls, timestamp: Date.now(),
          }
          context.messages.push(assistantMsg)
          await emit({ type: "message_start", message: assistantMsg })
          await emit({ type: "message_end", message: assistantMsg })

          for (const tc of toolCalls) {
            const toolMsg: AgentMessage = {
              role: "toolResult",
              content: `[错误] 工具 "${tc.name}" 未执行：响应被 token 限制截断，参数可能不完整，请重试`,
              toolCallId: tc.id,
              timestamp: Date.now(),
            }
            context.messages.push(toolMsg)
            await emit({ type: "message_start", message: toolMsg })
            await emit({ type: "message_end", message: toolMsg })
          }
          break
        }

        case "error":
        case "aborted": {
          const errorMsg: AgentMessage = {
            role: "assistant", content, stopReason, timestamp: Date.now(),
          }
          context.messages.push(errorMsg)
          await emit({ type: "message_start", message: errorMsg })
          await emit({ type: "message_end", message: errorMsg })
          await emit({ type: "agent_end", messages: context.messages })
          return context.messages
        }
      }
      // ========== END YOUR CODE ==========

      // 只有 toolUse 会走到这里
      if (shouldExecuteTools && toolCalls.length > 0) {
        const assistantMsg: AgentMessage = {
          role: "assistant", content, toolCalls, timestamp: Date.now(),
        }
        context.messages.push(assistantMsg)
        await emit({ type: "message_start", message: assistantMsg })
        await emit({ type: "message_end", message: assistantMsg })

        for (const tc of toolCalls) {
          if (signal?.aborted) {
            await emit({ type: "agent_end", messages: context.messages })
            return context.messages
          }

          await emit({ type: "tool_start", toolCallId: tc.id, toolName: tc.name })
          const result = await context.tools.execute(tc.name, JSON.parse(tc.arguments))
          await emit({ type: "tool_end", toolCallId: tc.id, toolName: tc.name, result })

          const toolMsg: AgentMessage = {
            role: "toolResult", content: result, toolCallId: tc.id, timestamp: Date.now(),
          }
          context.messages.push(toolMsg)
          await emit({ type: "message_start", message: toolMsg })
          await emit({ type: "message_end", message: toolMsg })
        }
      }

      hasToolCalls = shouldExecuteTools && toolCalls.length > 0
      await emit({ type: "turn_end" })

      // 拉取新一轮 steering 消息
      pendingMessages = (await config.getSteeringMessages?.()) || []
    }

    // TODO:
    //   - 拉取 follow-up 队列
    //   - 非空则赋值给 pendingMessages 并 continue 外层 while
    //   - 为空则 break，loop 结束

    // ========== YOUR CODE HERE (follow-up 检查) ==========

    // 注意 FollowUp 消息与 Steering 消息不同，前者指 agent 未完成时收到的用户信息，后者指 agent 完成后收到的用户信息
    const FollowUp=await config.getFollowUpMessages?.()
    if(FollowUp?.length){
      pendingMessages=FollowUp
      continue
    }
    else break
    // ========== END YOUR CODE ==========
  }

  await emit({ type: "agent_end", messages: context.messages })
  return context.messages
}
