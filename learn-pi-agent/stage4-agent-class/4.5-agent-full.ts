// 4.5 agent-full.ts — 整合：Stage 4 原生 agent loop + FullAgent
// 对标 pi：agent-loop.ts（790行）+ agent.ts（575行）
//
// ★ 重写动机：Stage 4 的壳和 Stage 3 的引擎消息格式不一致。
//   本文件用 Stage 4 类型体系从零写 agent loop，零依赖 Stage 3。
//
// TODO 清单：
//   runAgentLoop hook 调用点（5 处）
//   FullAgent.prompt / abort / reset

import dotenv from "dotenv"
dotenv.config({ override: true })
import OpenAI from "openai"

import { Agent, type AgentOptions } from "./4.1-agent-v1"
import {
  convertToLlm,
  type AgentMessage,
  type LlmMessage,
  type TransformContextFn,
} from "./4.2-message-layer"
import { EventBus } from "./4.3-subscriber"
import type {
  BeforeToolCallHook,
  AfterToolCallHook,
  ShouldStopHook,
  PrepareNextTurnHook,
  BeforeToolCallContext,
  AfterToolCallContext,
  BeforeToolCallResult,
  AfterToolCallResult,
  ShouldStopContext,
  PrepareNextTurnContext,
} from "./4.4-hooks"
import { ToolRegistry } from "../stage2-tool-call/2.2-tool-registry"

// ═══════════════════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════════════════

type StopReason = "stop" | "endTurn" | "toolUse" | "maxTokens" | "error" | "aborted"

interface PendingToolCall {
  id: string
  name: string
  arguments: string
}

interface LoopConfig {
  model: string
  apiKey: string
  baseUrl?: string

  // 消息层 hook（阶段 6 上下文压缩用）
  transformContext?: TransformContextFn

  // 工具 hook（4.4）
  beforeToolCall?: BeforeToolCallHook
  afterToolCall?: AfterToolCallHook

  // turn 间 hook（4.4）
  shouldStopAfterTurn?: ShouldStopHook
  prepareNextTurn?: PrepareNextTurnHook

  // 队列
  getSteeringMessages?: () => Promise<AgentMessage[]>
  getFollowUpMessages?: () => Promise<AgentMessage[]>

  // 限制
  maxTurns?: number

  // 取消
  signal?: AbortSignal
}

type LoopEvent =
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: AgentMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_start"; toolCallId: string; toolName: string }
  | { type: "tool_end"; toolCallId: string; toolName: string; result: string }

interface StreamResult {
  content: string
  toolCalls: PendingToolCall[]
  stopReason: StopReason
  usage?: { input: number; output: number }
}

export type AgentEvent =
  | { type: "agent_start"; prompt: string }
  | { type: "agent_end" }
  | { type: "error"; message: string }

// ═══════════════════════════════════════════════════════════════════════════════
// 辅助函数（脚手架，和 Stage 3 一致）
// ═══════════════════════════════════════════════════════════════════════════════

function mapStopReason(raw: string | null): StopReason {
  if (!raw) return "stop"
  switch (raw) {
    case "stop": case "end": return "stop"
    case "tool_calls": case "function_call": return "toolUse"
    case "length": return "maxTokens"
    default: return "stop"
  }
}

function ensureToolCall(
  pending: Map<number, PendingToolCall>,
  tc: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall,
): void {
  const idx = tc.index
  if (!pending.has(idx)) pending.set(idx, { id: "", name: "", arguments: "" })
  const existing = pending.get(idx)!
  if (tc.id) existing.id = tc.id
  if (tc.function?.name) existing.name = tc.function.name
  if (tc.function?.arguments) existing.arguments += tc.function.arguments
}

// ═══════════════════════════════════════════════════════════════════════════════
// streamAssistantResponse（脚手架，和 Stage 3 一致，model/apiKey/baseUrl 参数化）
// ═══════════════════════════════════════════════════════════════════════════════

async function streamAssistantResponse(
  model: string,
  apiKey: string,
  baseUrl: string,
  llmMessages: LlmMessage[],
  tools: ToolRegistry,
  signal?: AbortSignal,
  onToken?: (partialContent: string) => void,
): Promise<StreamResult> {
  const client = new OpenAI({ apiKey, baseURL: baseUrl })

  let content = ""
  let usage: { input: number; output: number } | undefined
  const pendingToolCalls = new Map<number, PendingToolCall>()
  let finishReason: string | null = null

  try {
    if (signal?.aborted) {
      return { content, toolCalls: [], stopReason: "aborted" }
    }

    const stream = await client.chat.completions.create({
      model,
      messages: llmMessages as any,
      tools: tools.getDefinitions(),
      stream: true,
    }, { signal })

    for await (const chunk of stream) {
      if (signal?.aborted) {
        return { content, toolCalls: Array.from(pendingToolCalls.values()), stopReason: "aborted" }
      }
      const delta = chunk.choices[0]?.delta
      if (delta?.content) {
        content += delta.content
        onToken?.(content)
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          ensureToolCall(pendingToolCalls, tc)
        }
      }
      if (chunk.choices[0]?.finish_reason) {
        finishReason = chunk.choices[0].finish_reason
      }
      if (chunk.usage) {
        usage = {
          input: chunk.usage.prompt_tokens ?? 0,
          output: chunk.usage.completion_tokens ?? 0,
        }
      }
    }

    return {
      content,
      toolCalls: Array.from(pendingToolCalls.values()),
      stopReason: mapStopReason(finishReason),
      usage,
    }
  } catch (e: any) {
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

// ═══════════════════════════════════════════════════════════════════════════════
// TODO 1: runAgentLoop — 5 个 hook 调用点
// ═══════════════════════════════════════════════════════════════════════════════
//
// 双层 while + stopReason 六路 + 工具执行 = 和 Stage 3 一致（已写好）。
// 你只需要在标记 ★ 的位置填入 5 个 hook 调用。

async function runAgentLoop(
  userPrompt: string,
  context: { systemPrompt: string; messages: AgentMessage[]; tools: ToolRegistry },
  config: LoopConfig,
  bus: EventBus<LoopEvent>,
): Promise<AgentMessage[]> {
  const signal = config.signal

  // 推送用户消息
  const userMsg: AgentMessage = {
    type: "user", content: userPrompt, timestamp: Date.now(),
  }
  context.messages.push(userMsg)
  await bus.emit({ type: "message_start", message: userMsg })
  await bus.emit({ type: "message_end", message: userMsg })

  // ── 外层 while（followUp 队列）──
  while (true) {
    let hasToolCalls = true
    let pendingMessages = (await config.getSteeringMessages?.()) ?? []
    let turnNumber = 0

    // ── 内层 while（tool + steering）──
    while (hasToolCalls || pendingMessages.length > 0) {
      if (signal?.aborted) return context.messages

      turnNumber++

      // ★ turn 数限制
      if (config.maxTurns && turnNumber > config.maxTurns) {
        const msg: AgentMessage = {
          type: "assistant",
          content: `已达到最大轮数限制 (${config.maxTurns})，对话终止。`,
          timestamp: Date.now(),
        }
        context.messages.push(msg)
        await bus.emit({ type: "message_start", message: msg })
        await bus.emit({ type: "message_end", message: msg })
        return context.messages
      }

      await bus.emit({ type: "turn_start" })

      // steering 消息注入
      for (const msg of pendingMessages) {
        context.messages.push(msg)
        await bus.emit({ type: "message_start", message: msg })
        await bus.emit({ type: "message_end", message: msg })
      }
      pendingMessages = []

      // ★ TODO 1a: transformContext — LLM 调用前操作上下文
      //
      // 对标 pi：agent-loop.ts transformContext 调用
      //
      //   - 如果 config.transformContext 存在，调它并用返回值替换 msgsForLlm
      //   - 不存在则 msgsForLlm = context.messages（默认行为）

      let msgsForLlm = context.messages

      // ========== YOUR CODE HERE ==========

      if (config.transformContext){
        msgsForLlm=await config.transformContext(msgsForLlm,signal)
      }

      // ========== END YOUR CODE ==========

      // LLM 调用
      const llmMessages = convertToLlm(msgsForLlm)
      const systemMsg = { role: "system", content: context.systemPrompt } as any
      const { content, toolCalls, stopReason } = await streamAssistantResponse(
        config.model,
        config.apiKey,
        config.baseUrl ?? "https://api.deepseek.com",
        [systemMsg, ...llmMessages],
        context.tools,
        signal,
        (partial) => {
          bus.emit({
            type: "message_update",
            message: { type: "assistant", content: partial, timestamp: Date.now() },
          })
        },
      )

      // ── stopReason 六路分支（脚手架，和 Stage 3 一致）──
      let shouldExecuteTools = true

      switch (stopReason) {
        case "stop":
        case "endTurn": {
          shouldExecuteTools = false
          const msg: AgentMessage = {
            type: "assistant", content, timestamp: Date.now(),
          }
          context.messages.push(msg)
          await bus.emit({ type: "message_start", message: msg })
          await bus.emit({ type: "message_end", message: msg })
          break
        }

        case "toolUse": {
          break
        }

        case "maxTokens": {
          shouldExecuteTools = false
          const msg: AgentMessage = {
            type: "assistant", content, timestamp: Date.now(),
          }
          context.messages.push(msg)
          await bus.emit({ type: "message_start", message: msg })
          await bus.emit({ type: "message_end", message: msg })

          for (const tc of toolCalls) {
            const errMsg: AgentMessage = {
              type: "toolResult",
              toolCallId: tc.id,
              toolName: tc.name,
              content: `[错误] 工具 "${tc.name}" 未执行：token 限制截断`,
              timestamp: Date.now(),
            }
            context.messages.push(errMsg)
            await bus.emit({ type: "message_start", message: errMsg })
            await bus.emit({ type: "message_end", message: errMsg })
          }
          break
        }

        case "error":
        case "aborted": {
          const msg: AgentMessage = {
            type: "assistant", content, timestamp: Date.now(),
          }
          context.messages.push(msg)
          await bus.emit({ type: "message_start", message: msg })
          await bus.emit({ type: "message_end", message: msg })
          return context.messages
        }
      }

      // ── 工具执行（脚手架，和 Stage 3 一致）──
      const toolResults: AgentMessage[] = []

      if (shouldExecuteTools && toolCalls.length > 0) {
        // push assistant 消息（含 toolCalls）
        const assistantMsg: AgentMessage = {
          type: "assistant",
          content,
          toolCalls: toolCalls.map(tc => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          })),
          timestamp: Date.now(),
        }
        context.messages.push(assistantMsg)
        await bus.emit({ type: "message_start", message: assistantMsg })
        await bus.emit({ type: "message_end", message: assistantMsg })

        for (const tc of toolCalls) {
          if (signal?.aborted) return context.messages

          // ★ TODO 1b: beforeToolCall — 可 block 工具执行
          //
          // 对标 pi：AgentLoopConfig.beforeToolCall
          //
          //   - 如果 config.beforeToolCall 存在：
          //     构造 BeforeToolCallContext { toolName, args, toolCallId }
          //     调 hook，await 结果
          //   - 如果返回 { block: true }：
          //     设置 blocked = true，blockReason = result.reason
          //     （上层脚手架已写好 block 处理——注入 error result + continue）

          let blocked = false
          let blockReason = ""

          // ========== YOUR CODE HERE ==========
          if (config.beforeToolCall){
            const BeforeContext:BeforeToolCallContext={
              toolName:tc.name,
              args:JSON.parse(tc.arguments),
              toolCallId:tc.id
            }
            const hookResult=await config.beforeToolCall(BeforeContext)
            if(hookResult && hookResult.block==true){
              blocked=true
              blockReason=hookResult.reason ?? ""
            }
          }
          // ========== END YOUR CODE ==========

          if (blocked) {
            const em: AgentMessage = {
              type: "toolResult",
              toolCallId: tc.id,
              toolName: tc.name,
              content: `[错误] 工具 "${tc.name}" 被阻止: ${blockReason}`,
              timestamp: Date.now(),
            }
            toolResults.push(em)
            context.messages.push(em)
            await bus.emit({ type: "message_start", message: em })
            await bus.emit({ type: "message_end", message: em })
            continue
          }

          await bus.emit({
            type: "tool_start",
            toolCallId: tc.id,
            toolName: tc.name,
          })

          let result: string
          let isError = false
          try {
            result = await context.tools.execute(tc.name, JSON.parse(tc.arguments))
          } catch (e: any) {
            result = `[错误] ${e?.message || String(e)}`
            isError = true
          }

          // ★ TODO 1c: afterToolCall — 可覆写执行结果
          //
          // 对标 pi：AgentLoopConfig.afterToolCall
          //
          //   - 如果 config.afterToolCall 存在：
          //     构造 AfterToolCallContext { toolName, args, toolCallId, result }
          //     调 hook，await 结果
          //   - 如果返回 { content } → result = r.content
          //   - 如果返回 { isError } → isError = r.isError

          // ========== YOUR CODE HERE ==========
          if(config.afterToolCall){
            const AfterContext:AfterToolCallContext={
              toolName:tc.name,
              args:JSON.parse(tc.arguments),
              toolCallId:tc.id,
              result:result
            }
            const hookResult=await config.afterToolCall(AfterContext)
            if(hookResult){
              result=hookResult.content ?? result
              isError=hookResult.isError ?? isError
            }
          }
          // ========== END YOUR CODE ==========

          await bus.emit({
            type: "tool_end",
            toolCallId: tc.id,
            toolName: tc.name,
            result,
          })

          const toolMsg: AgentMessage = {
            type: "toolResult",
            toolCallId: tc.id,
            toolName: tc.name,
            content: result,
            timestamp: Date.now(),
          }
          toolResults.push(toolMsg)
          context.messages.push(toolMsg)
          await bus.emit({ type: "message_start", message: toolMsg })
          await bus.emit({ type: "message_end", message: toolMsg })
        }
      }

      hasToolCalls = shouldExecuteTools && toolCalls.length > 0
      const lastMsg = context.messages[context.messages.length - 1]
      await bus.emit({ type: "turn_end", message: lastMsg, toolResults })

      // ★ TODO 1d: shouldStopAfterTurn — turn 结束后判断是否退出
      //
      // 对标 pi：AgentLoopConfig.shouldStopAfterTurn
      //
      //   - 如果 config.shouldStopAfterTurn 存在：
      //     调 hook，传入 { assistantContent, toolCallCount, newMessageCount }
      //   - 如果返回 true → return context.messages（agent 优雅退出）

      // ========== YOUR CODE HERE ==========

      if(config.shouldStopAfterTurn){
        const shouldStopContext:ShouldStopContext={
          assistantContent:content,
          toolCallCount:toolResults.length,
          newMessageCount:context.messages.length,
        }
        if(await config.shouldStopAfterTurn(shouldStopContext)) return context.messages
      }
      // ========== END YOUR CODE ==========

      // ★ TODO 1e: prepareNextTurn — 返回下轮配置变更
      //
      // 对标 pi：AgentLoopConfig.prepareNextTurn
      //
      //   - 如果 config.prepareNextTurn 存在：
      //     调 hook，传入 { messages, assistantContent, toolCallCount, turnNumber }
      //   - 如果返回 { systemPrompt } → 更新 context.systemPrompt

      // ========== YOUR CODE HERE ==========
      if(config.prepareNextTurn){
        const prepareContext:PrepareNextTurnContext={
          messages:context.messages,
          assistantContent:content,
          toolCallCount:toolResults.length,
          turnNumber:turnNumber,
        }
      }
      // ========== END YOUR CODE ==========

      // 拉取新一轮 steering
      pendingMessages = (await config.getSteeringMessages?.()) ?? []
    }

    // ── followUp 检查（脚手架，和 Stage 3 一致）──
    const followUp = await config.getFollowUpMessages?.()
    if (followUp?.length) {
      for (const msg of followUp) {
        context.messages.push(msg)
        await bus.emit({ type: "message_start", message: msg })
        await bus.emit({ type: "message_end", message: msg })
      }
      continue
    }
    break
  }

  return context.messages
}

// ═══════════════════════════════════════════════════════════════════════════════
// FullAgent（复用 4.1 Agent + 4.3 EventBus）
// ═══════════════════════════════════════════════════════════════════════════════

export class FullAgent {
  private agent: Agent
  private bus = new EventBus<AgentEvent>()
  private loopBus = new EventBus<LoopEvent>()
  private currentController: AbortController | null = null
  private _isRunning = false
  private config: LoopConfig

  // ★ steering + followUp 队列
  private steeringMessages: AgentMessage[] = []
  private followUpMessages: AgentMessage[] = []

  constructor(
    stateInit: AgentOptions = {},
    loopConfig: Partial<LoopConfig> = {},
  ) {
    this.agent = new Agent(stateInit)
    this.config = {
      model: loopConfig.model ?? "deepseek-v4-pro",
      apiKey: loopConfig.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "",
      baseUrl: loopConfig.baseUrl ?? "https://api.deepseek.com",
      transformContext: loopConfig.transformContext,
      beforeToolCall: loopConfig.beforeToolCall,
      afterToolCall: loopConfig.afterToolCall,
      shouldStopAfterTurn: loopConfig.shouldStopAfterTurn,
      prepareNextTurn: loopConfig.prepareNextTurn,
      maxTurns: loopConfig.maxTurns ?? 3,
    }
  }

  // ── 公开状态 ──

  get state() { return this.agent.state }
  get isRunning() { return this._isRunning }

  subscribe(fn: (event: AgentEvent) => void): () => void {
    return this.bus.subscribe(fn)
  }

  /** ★ 订阅 loop 内部事件（turn_start / tool_start / message_update 等） */
  subscribeLoop(fn: (event: LoopEvent) => void): () => void {
    return this.loopBus.subscribe(fn)
  }

  /** ★ 在 agent 运行中注入干预消息 */
  steer(message: string): void {
    this.steeringMessages.push({
      type: "user", content: message, timestamp: Date.now(),
    })
  }

  /** ★ agent 停下后追加后续任务 */
  followUp(message: string): void {
    this.followUpMessages.push({
      type: "user", content: message, timestamp: Date.now(),
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TODO 2: prompt / abort / reset
  // ═══════════════════════════════════════════════════════════════════════════

  async prompt(userMessage: string): Promise<void> {
    // TODO: 生命周期管理
    // ========== YOUR CODE HERE ==========
    if (this._isRunning) this.abort()
    this.currentController = new AbortController()
    this._isRunning = true
    await this.bus.emit({ type: "agent_start", prompt: userMessage })
    const context = {
      systemPrompt: this.agent.state.systemPrompt,
      messages: this.agent.state.messages as any as AgentMessage[],
      tools: this.agent.state.tools,
    }
    const fullConfig: LoopConfig = {
      ...this.config,
      signal: this.currentController.signal,
      getSteeringMessages: async () => {
        const d = this.steeringMessages.slice()
        this.steeringMessages = []
        return d
      },
      getFollowUpMessages: async () => {
        const d = this.followUpMessages.slice()
        this.followUpMessages = []
        return d
      },
    }
    try {
      await runAgentLoop(userMessage, context, fullConfig, this.loopBus)
      this.agent.state.messages = context.messages as any
    } finally {
      this.currentController = null
      this._isRunning = false
      await this.bus.emit({ type: "agent_end" })
    }
    // ========== END YOUR CODE ==========
  }

  abort(): void {
    // TODO: 中断当前 run
    // ========== YOUR CODE HERE ==========
    if (this.currentController && !this.currentController.signal.aborted) {
      this.currentController.abort()
    }
    // ========== END YOUR CODE ==========
  }

  reset(): void {
    // TODO: 重置对话
    // ========== YOUR CODE HERE ==========
    this.abort()
    this.agent.state.messages = []
    this._isRunning = false
    // ========== END YOUR CODE ==========
  }
}
