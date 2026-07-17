// 1.5 retry.ts — 指数退避重试
// 目的：网络/服务端瞬时故障不直接炸，自动重试
// 对标 pi：packages/ai/src/utils/retry.ts 的 isRetryableAssistantError()
//
// pi 的 retry 作用于 AssistantMessage 层（通过 event stream 传递错误后，
// agent loop 判断是否重试）。阶段 1 先做更通用的 HTTP 层重试包装器。

import dotenv from "dotenv"
dotenv.config({ override: true })

export interface RetryOptions {
  maxRetries?: number      // 最多重试次数，默认 3
  baseDelayMs?: number     // 基础延迟（毫秒），默认 1000
  maxDelayMs?: number      // 最大延迟上限，默认 30000
  /** 自定义判断是否可重试。默认：5xx 和网络错误可重试，4xx 不可 */
  shouldRetry?: (error: Error, attempt: number) => boolean
}

/**
 * 包装一个异步函数，在失败时自动重试
 *
 * 退避策略：baseDelay * 2^attempt，上限 maxDelay，加上随机抖动
 *
 * @param fn     - 要重试的异步函数
 * @param options
 * @returns fn 的返回值
 *
 * @example
 *   const result = await withRetry(() => chatOnce(messages), { maxRetries: 3 })
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    shouldRetry,
  } = options

  let lastError: Error | undefined

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn()
    } catch (e: any) {
      lastError = e as Error

      // 检查是否应该重试
      // 默认规则：HTTP 429 或 5xx 重试，4xx（非429）不重试，网络错误重试
      const retryable = shouldRetry
        ? shouldRetry(lastError, attempt)
        : isRetryableError(lastError)

      if (!retryable || attempt > maxRetries) {
        throw lastError  // 不可重试 或 已达上限，直接抛出
      }

      // TODO: 计算延迟
      // 指数避让：如果客户端每秒重试一次，则流量永远保持高位，指数避让使得每次重试等待时间指数增长
      // 加 ±25% 随机抖动（jitter）避免大量客户端同时重试造成雪崩

      // ========== YOUR CODE HERE ==========

      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs)
      const jitterRate = 0.25
      const jitter = delay * jitterRate * (Math.random() * 2 - 1)
      const finalDelay = delay + jitter
      await sleep(finalDelay)

      // ========== END YOUR CODE ==========

    }
  }

  throw lastError!
}

/**
 * 默认的错误分类：哪些可以重试
 *
 * 可重试：HTTP 429（限流）、5xx（服务端故障）、网络错误（fetch failed 等）
 * 不可重试：401（鉴权）、403（权限）、402（付费）、insufficient_quota（额度用尽）
 */
function isRetryableError(error: Error): boolean {
  const statusMatch = error.message.match(/API 错误 \[(\d+)\]/)
  const status = statusMatch ? parseInt(statusMatch[1]) : 0

  // TODO:
  // 1. 如果有 HTTP 状态码：429 或 5xx → 可重试，其他 4xx → 不可重试
  // 2. 没有状态码（网络错误，如 fetch failed、ECONNREFUSED）→ 可重试

  // ========== YOUR CODE HERE ==========

  if (status) {
    if (status === 429 || status >= 500) return true
    else return false
  }
  else return true

  // ========== END YOUR CODE ==========

}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
