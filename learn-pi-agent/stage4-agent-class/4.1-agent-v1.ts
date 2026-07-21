// 4.1 agent-v1.ts — 状态管理：Agent 类封装散落状态
// 对标 pi：agent.ts 的 createMutableAgentState() + AgentState 接口
//
// 阶段 3 的问题（状态散落）：
//   - AgentContext（systemPrompt / messages / tools）每次 run 前手动拼
//   - 运行时状态（isStreaming / errorMessage 等）封在 loop 函数内部，外部不可见
//   - messages 数组直接用引用传递，调用方可以意外 mutate
//   - 多轮对话记忆由调用方负责，cli.ts 甚至没做——每轮都是全新 context
//
// 4.1 的解法：
//   - Agent 类一次性构造，持有全部状态，多次 run 复用同一份 messages
//   - 运行时状态暴露为只读属性，外部随时可查
//   - tools / messages 用 getter/setter 做拷贝保护：setter 赋值时自动 slice
//
// 架构：参照 pi 的 createMutableAgentState 模式。
//   AgentState — 对外只读契约（interface）
//   MutableAgentState — 内部可变版，tools/messages 用 getter/setter 防外部 mutate
//   createMutableAgentState — 工厂函数，闭包持有内部变量 + 拷贝保护
//   Agent — 类封装，constructor 调工厂，state getter 对外暴露
//
// TODO 清单：
//   createMutableAgentState  — getter 返回引用，setter slice 拷贝保护
//   Agent 类                  — constructor + state getter

import { ToolRegistry } from "../stage2-tool-call/2.2-tool-registry"

// ═══════════════════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════════════════

/** Agent 内部消息（阶段 4 基线，4.2 扩展为完整的 AgentMessage 体系） */
export interface AgentMessage {
  role: "user" | "assistant" | "toolResult" | "steering" | "followUp"
  content: string
  toolCallId?: string
  toolCalls?: { id: string; name: string; arguments: string }[]
  timestamp: number
}

/** Agent 构造选项 */
export interface AgentOptions {
  systemPrompt?: string
  tools?: ToolRegistry
  messages?: AgentMessage[]
}

/**
 * AgentState — 对外暴露的只读状态形状。
 *
 * 字段分两类：
 *   - 持久状态：systemPrompt / tools / messages，跨 run 保持
 *   - 运行时状态：isStreaming / streamingMessage / pendingToolCalls / errorMessage，
 *     Agent 内部维护，外部只读
 *
 * 对标 pi：types.ts AgentState（322行起）
 */
export interface AgentState {
  systemPrompt: string
  tools: ToolRegistry
  messages: AgentMessage[]

  readonly isStreaming: boolean
  readonly streamingMessage?: AgentMessage
  readonly pendingToolCalls: ReadonlySet<string>
  readonly errorMessage?: string
}

/**
 * MutableAgentState — 内部可变版本。
 *
 * AgentState 是只读契约，但 Agent 内部需要修改运行时字段。
 * 同时把 tools / messages 字段改写为 getter/setter（为拷贝保护铺路）。
 *
 * 对标 pi：agent.ts MutableAgentState（~54行）
 */
export type MutableAgentState = Omit<
  AgentState,
  "tools" | "messages" | "isStreaming" | "streamingMessage" | "pendingToolCalls" | "errorMessage"
> & {
  // Omit<T,K>:构造一个属性为{T-K}的数据结构
  // &:加上新的属性，这里删去只读方签名，设为普通方法
  get tools(): ToolRegistry
  set tools(t: ToolRegistry)
  get messages(): AgentMessage[]
  set messages(m: AgentMessage[])

  isStreaming: boolean
  streamingMessage?: AgentMessage
  pendingToolCalls: Set<string>
  errorMessage?: string
}

/**
 * 创建 Agent 内部可变状态。
 *
 * 对标 pi：agent.ts createMutableAgentState（~60-95行）
 */
export function createMutableAgentState(initial?: AgentOptions): MutableAgentState {
  // TODO:
  //   - 从 initial 提取 tools / messages，兜底值：tools — new ToolRegistry()，messages — []
  //   - 两个闭包变量：let tools = ...，let messages = ...
  //   - 返回 MutableAgentState 对象：
  //     · systemPrompt 兜底 ""
  //     · tools getter → 返回闭包 tools，setter → tools = nextTools
  //     · messages getter → 返回闭包 messages，setter → messages = nextMessages.slice()
  //     · isStreaming 初始 false，streamingMessage / errorMessage 初始 undefined
  //     · pendingToolCalls 初始 new Set()

  // ========== YOUR CODE HERE ==========
  let tools = initial?.tools ?? new ToolRegistry()
  let messages = (initial?.messages ?? []).slice()
  let systemPrompt = initial?.systemPrompt ?? ""

  return {
    isStreaming:false,
    streamingMessage:undefined,
    pendingToolCalls:new Set(),
    errorMessage:undefined,

    systemPrompt:systemPrompt,
    get tools(){return tools},
    set tools(t:ToolRegistry){tools=t},
    get messages(){return messages},
    set messages(m: AgentMessage[]) {messages=m.slice()}
    
  }
  // ========== END YOUR CODE ==========
}

/**
 * 持有对话状态的 agent 实例。
 *
 * 对标 pi：agent.ts Agent 类
 */
export class Agent {
  private _state: MutableAgentState

  constructor(options: AgentOptions = {}) {
    // TODO: 调 createMutableAgentState 初始化 this._state
    
    // ========== YOUR CODE HERE ==========
    this._state=createMutableAgentState(options)
    // ========== END YOUR CODE ==========
  }

  /** 对外暴露只读状态，返回类型 AgentState 隐藏了内部 setter */
  get state(): AgentState {
    // TODO: 返回 this._state

    // ========== YOUR CODE HERE ==========
    return this._state
    // ========== END YOUR CODE ==========
  }
}
