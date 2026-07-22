// 4.3 subscriber.ts — 事件订阅系统
// 对标 pi：agent.ts Agent 类的 subscribe + listeners 派发
//
// 和阶段 3 EventStream 的关系：
//   EventStream（3.3）是"一次运行"的事件管道——push/pull 队列，有结束条件 + 结果提取
//   Subscriber（4.3）是"长期持活"的事件监听——Agent 存活期间一直监听，和外层 UI/日志交互
//
// pi 的设计：
//   Agent 持有 `listeners: Set<fn>`，subscribe() 添加，emit 时按注册顺序 await 调用。
//   agent_end 的 listener 也是 run 的一部分——所有 listener settle 后 agent.isStreaming 才变 false。
//
// TODO 清单：
//   EventBus.subscribe         — 注册监听器，返回取消函数
//   EventBus.emit              — 按注册顺序串行 await 所有监听器
//   createEventHistory         — 用 EventBus 收集最近 N 条事件

// ═══════════════════════════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════════════════════════

/** 事件监听器：接收事件，可以返回 Promise（会被 await） */
export type EventListener<T> = (event: T) => Promise<void> | void

// ═══════════════════════════════════════════════════════════════════════════════
// EventBus — 可复用的订阅/发布基元
// ═══════════════════════════════════════════════════════════════════════════════
//
// Agent 在 4.6 中会持有 EventBus<AgentEvent> 实例，
// 目前先实现这个独立组件。

export class EventBus<T> {
  private listeners = new Set<EventListener<T>>()

  /**
   * 注册监听器，返回取消订阅函数。
   *
   * 对标 pi：agent.ts subscribe()
   */
  subscribe(listener: EventListener<T>): () => void {
    // TODO:
    //   - 把 listener 加入 Set
    //   - 返回取消函数（从 Set 中删除）

    // ========== YOUR CODE HERE ==========
    this.listeners.add(listener)
    return ()=>{this.listeners.delete(listener)}
    // ========== END YOUR CODE ==========
  }

  /**
   * 按注册顺序串行调用所有监听器。
   * 如果某个 listener 返回 Promise，会 await 它完成后再调用下一个。
   *
   * 对标 pi：agent.ts 的 listener 派发循环
   */
  async emit(event: T): Promise<void> {
    // TODO:
    //   - 遍历 this.listeners
    //   - 对每个 listener，await listener(event)
    //   - 注意：遍历过程中 listeners 可能被修改（listener 里调了 subscribe/unsubscribe）
    //     所以遍历前先复制一份快照

    // ========== YOUR CODE HERE ==========
    const snapshot=[...this.listeners]
    for(const listener of snapshot){
      await listener(event)
    }
    // ========== END YOUR CODE ==========
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TODO 3: createEventHistory — 用 EventBus 收集最近 N 条事件
// ═══════════════════════════════════════════════════════════════════════════════
//
// 实际场景：UI 组件想知道"agent 刚才做了什么"——
// 调 getHistory() 拿最后 20 个事件用于渲染状态面板。
// 不用时调 cancel() 停止收集，避免内存泄漏。

/**
 * 创建一个事件历史记录器。
 * 自动 subscribe 到 bus，保留最近 maxSize 条事件。
 * 返回 { getHistory, cancel }。
 */
export function createEventHistory<T>(
  bus: EventBus<T>,
  maxSize: number = 50,
): { getHistory: () => T[]; cancel: () => void } {
  // TODO:
  //   - 声明 history: T[] = []
  //   - 调用 bus.subscribe，在回调中将 event push 到 history
  //   - 如果 history.length > maxSize，shift 掉最旧的一条
  //   - 记录返回的 cancel 函数
  //   - return { getHistory: () => history, cancel }

  // ========== YOUR CODE HERE ==========
  const history: T[] = []
  const cancel = bus.subscribe((event) => {
    history.push(event)
    if (history.length > maxSize) history.shift()
  })
  return { getHistory: () => history, cancel }
  // ========== END YOUR CODE ==========
}
