// 3.3 event-stream.ts — EventStream（有结束条件 + 结果提取的事件流）
// 对标 pi：packages/ai/src/utils/event-stream.ts
//
// 3.2 的 emit 回调是 fire-and-forget——push 出去就忘了，不管谁在听。
// EventStream 升级为有生命周期的生产者-消费者队列：
//   - 有"结束条件"：某个事件标志流结束（如 agent_end）
//   - 有"结果提取"：结束时 resolve 一个最终值（如 AgentMessage[]）
//   - async iterable：外部用 for await-of 消费事件
//
// 本质是一个内部 queue + waiting 列表的 push/pull 队列：
//   生产者 push → 入队 or 直接交给等待的消费者
//   消费者 pull → 出队 or 挂起等待
//
// TODO 清单：
//   EventStream.push              — 检测结束 → 唤醒 waiter or 入队
//   EventStream[Symbol.asyncIterator] — 消费者侧：出队 or 等待新事件

// ─── EventStream ───

// 这里的R指的是结果泛型参数，默认与事件泛型参数T同类型
export class EventStream<T, R = T> {
  /** 事件缓冲区：生产者 push 入队，消费者 pop 出队 */
  private queue: T[] = []
  /** 等待中的消费者：队列空时有 for-await 挂起，它的 resolve 函数存在这里 */
  private waiting: Array<(value: IteratorResult<T>) => void> = []
  /** 流是否已关闭 */
  private done = false
  /** 流结束时 resolve 的最终结果 */
  private resultPromise: Promise<R>
  private resolveResult!: (result: R) => void
  /** 判断事件是否标志流结束 */
  private isComplete: (event: T) => boolean
  /** 从结束事件中提取最终结果 */
  private extractResult: (event: T) => R

  constructor(
    isComplete: (event: T) => boolean,
    extractResult: (event: T) => R,
  ) {
    this.isComplete = isComplete
    this.extractResult = extractResult
    this.resultPromise = new Promise((resolve) => {
      this.resolveResult = resolve
    })
  }

  /**
   * 生产者 push 一个事件。
   *
   * 如果事件满足 isComplete → 标记 done，resolve 最终结果。
   * 如果有消费者在等 → 直接交给它。否则 → 入队。
   */
  push(event: T): void {
    // TODO:
    //   - 如果已 done，直接 return（防止 push 到已关闭的流）
    //   - 如果 isComplete(event) → 标记 done = true，resolve 最终结果
    //   - 检查 waiting 队列：有等待者则 shift 并交付
    //   - 没有等待者则 push 到 queue

    // ========== YOUR CODE HERE ==========
    if (this.done) return

    if (this.isComplete(event)) {
      this.done = true
      this.resolveResult(this.extractResult(event))
    }
    // 交付事件（isComplete 也不例外——消费者也要看到 agent_end）
    if (this.waiting.length) {
      const waiter = this.waiting.shift()!
      waiter({ value: event, done: false })
    } else {
      this.queue.push(event)
    }
    // ========== END YOUR CODE ==========
  }

  /**
   * 显式结束流（如果 isComplete 没触发的话）。
   * 通知所有等待的消费者：流结束了。
   */
  end(result?: R): void {
    this.done = true
    if (result !== undefined) {
      this.resolveResult(result)
    }
    while (this.waiting.length > 0) {
      const waiter = this.waiting.shift()!
      waiter({ value: undefined as any, done: true })
    }
  }

  /**
   * 异步迭代器。外部用 for await (const event of stream) 消费。
   *
   * 流程：
   *   队列有事件 → yield 下一个
   *   流已结束 → return
   *   队列空且未结束 → 创建 Promise 挂起，等 push 或 end 唤醒
   */
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    // TODO:
    //   - while true 循环
    //   - queue 非空：yield queue.shift()
    //   - done：return
    //   - 否则：new Promise → push 到 waiting → await → 如果 done 则 return → 否则 yield value

    // ========== YOUR CODE HERE ==========
    while (true) {
      // yield 等于 return，但是下次调用函数时从这里继续
      if (this.queue.length) { yield this.queue.shift()!; continue }
      if (this.done) return

      const result = await new Promise<IteratorResult<T>>(
        (resolve) => this.waiting.push(resolve),
      )
      if (result.done) return
      yield result.value
    }
    // ========== END YOUR CODE ==========
  }

  /** 返回 Promise，在流结束时 resolve 最终结果 */
  result(): Promise<R> {
    return this.resultPromise
  }
}
