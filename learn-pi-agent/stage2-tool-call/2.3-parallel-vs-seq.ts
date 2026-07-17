// 2.3 parallel-vs-seq.ts — 并行 vs 串行工具执行
// 对标 pi：agent-loop.ts 的 executeToolCalls / executeToolCallsParallel / executeToolCallsSequential
//
// LLM 一次可以返回多个 tool_call。这些 tool_call 怎么执行？
//   - 并行：多个 tool 互不依赖，可以同时跑 → Promise.all
//   - 串行：tool 标记了 executionMode="sequential" → for 循环逐个跑
//
// pi 的策略：默认并行。如果任一 tool 标记 executionMode="sequential"，整批降级为串行。
//
// TODO 清单：
//   shouldRunSequential — Array.some 检查 executionMode
//   executeParallel      — Promise.all 并发执行
//   executeSequential    — for + await 串行执行
//   executeToolCalls     — 分发：判模式 → 选路径

import { ToolRegistry } from "./2.2-tool-registry"
import { ToolCall, ToolResult } from "../shared/types"


/**
 * 判断整批 tool call 应该用哪种模式执行
 *
 * 规则（同 pi）：如果任何一个 tool 标记了 sequential，整批降级为串行。
 * 原因：标记 sequential 的 tool 可能有副作用，和其他 tool 交错执行不安全。
 */
export function shouldRunSequential(toolCalls: ToolCall[], registry: ToolRegistry): boolean {

  // ========== YOUR CODE HERE ==========
  // 如果 toolCalls 中有任意一个 tool 的 executionMode === "sequential"，返回 true
  return toolCalls.some((tc) => registry.get(tc.name)?.executionMode === "sequential")
  // ========== END YOUR CODE ==========
}

// ─── 并行执行 ───

/** 并行执行：所有 tool 同时跑，Promise.all 收集结果 */
export async function executeParallel(
  toolCalls: ToolCall[],
  registry: ToolRegistry,
): Promise<ToolResult[]> {

  // ========== YOUR CODE HERE ==========
  // toolCalls.map → 每个 tc 调 registry.execute(tc.name, tc.arguments)
  // 然后用 Promise.all 收集所有结果
  const promises = toolCalls.map(async (tc) => {
    const result = await registry.execute(tc.name, tc.arguments)
    return { toolCallId: tc.id, name: tc.name, result }
  })
  return Promise.all(promises)
  // ========== END YOUR CODE ==========
}

// ─── 串行执行 ───

/** 串行执行：一个接一个跑，前一个的结果可以影响后一个 */
export async function executeSequential(
  toolCalls: ToolCall[],
  registry: ToolRegistry,
): Promise<ToolResult[]> {

  // ========== YOUR CODE HERE ==========
  // for 循环遍历 toolCalls，逐个 await registry.execute(tc.name, tc.arguments)
  // 每次 push { toolCallId, name, result } 到 results 数组
  const results: ToolResult[] = []
  for (const tc of toolCalls) {
    const result = await registry.execute(tc.name, tc.arguments)
    results.push({ toolCallId: tc.id, name: tc.name, result })
  }
  return results
  // ========== END YOUR CODE ==========
}

// ─── 分发器 ───

/** 分发器：根据 shouldRunSequential 自动选择并行或串行 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  registry: ToolRegistry,
): Promise<ToolResult[]> {

  // ========== YOUR CODE HERE ==========
  // if (shouldRunSequential(...)) → executeSequential
  // else → executeParallel
  if (shouldRunSequential(toolCalls, registry)) {
    return executeSequential(toolCalls, registry)
  }
  return executeParallel(toolCalls, registry)
  // ========== END YOUR CODE ==========
}
