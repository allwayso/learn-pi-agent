// 3.4 agent-loop-integrated.ts — 整合 3.2 + 3.3，对齐 pi 接口
// 对标 pi：agent-loop.ts 的 agentLoop() 返回 EventStream 的对外接口
//
// 3.2 的 agentLoop 接收 emit 回调，3.3 的 EventStream 可以替代那个回调。
// 3.4 做的是把两者缝在一起——agentLoop 内部 push 到 EventStream，
// 外部用 for-await-of 消费事件 + result() 拿最终消息。
//
// pi 的 agentLoop() 返回的正是 EventStream<AgentEvent, AgentMessage[]>，
// 这里用 AgentEventStream 子类预设好 isComplete / extractResult，一行 new 即可。

import { EventStream } from "./3.3-event-stream"
import {
  agentLoop as agentLoopV2,
  type AgentEvent,
  type AgentMessage,
  type AgentContext,
  type AgentLoopConfig,
} from "./3.2-agent-loop-v1"

// ─── AgentEventStream ───

/**
 * 预设了结束条件和结果提取的 EventStream。
 * agent_end 事件标志流结束，messages 是最终结果。
 */
export class AgentEventStream extends EventStream<AgentEvent, AgentMessage[]> {
  constructor() {
    super(
      (event) => event.type === "agent_end",
      (event) => (event.type === "agent_end" ? event.messages : []),
    )
  }
}

// ─── 整合版 agentLoop ───

/**
 * 和 3.2 功能完全一致，但接口对齐 pi：
 *   - 不再接收 emit 回调，改为返回 AgentEventStream
 *   - 外部用 for await (const event of stream) 消费事件
 *   - loop 在后台运行，stream 立即返回（非阻塞）
 */
export function agentLoop(
  userPrompt: string,
  context: AgentContext,
  config: AgentLoopConfig,
): AgentEventStream {
  const stream = new AgentEventStream()

  // 在后台启动 3.2 的 loop，事件 push 到 stream
  // loop 结束时 stream.end(messages) 通知所有消费者
  agentLoopV2(userPrompt, context, config, (event) => stream.push(event))
    .then((messages) => stream.end(messages))

  return stream
}
