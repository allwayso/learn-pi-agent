# 阶段 4：Agent 类 —— 状态管理 + 消息体系 + 事件 + Hook

对标 pi：`packages/agent/src/agent.ts`（575 行）+ `packages/agent/src/types.ts` AgentLoopConfig

## 承上：阶段 3 回顾

阶段 3 交出了一个完整的 agent loop **函数**：`agentLoop(prompt, ctx, config) → EventStream`。能跑，但状态散落在调用方——`systemPrompt` / `tools` / `messages` 每次 run 手动拼，运行时状态（`isStreaming` / `errorMessage` 等）封在 loop 内部不可见，abort 控制、队列管理全在外面。

阶段 4 把它封装成有生命周期的 **Agent 类**，加上消息体系、事件订阅、hook 链和生命周期管理。

## 概述

五个脚本逐层搭建，最终在 4.5 整合为完整的 `FullAgent`：

| 脚本 | 内容 | 对标 pi |
|------|------|---------|
| 4.1 agent-v1 | 状态管理：AgentState / MutableAgentState + getter/setter 拷贝保护 | `AgentState`，`MutableAgentState` |
| 4.2 message-layer | AgentMessage 体系（discriminated union）+ convertToLlm + TransformContextFn | `AgentLoopConfig.convertToLlm` |
| 4.3 subscriber | EventBus：subscribe + emit + 事件历史收集 | `agent.ts` subscribe |
| 4.4 hooks | AgentLoopConfig hook 签名 + prepareNextTurn | `AgentLoopConfig` hooks |
| 4.5 agent-full | Stage 4 原生 loop + FullAgent + prompt/abort/reset/steer/followUp | `agent-loop.ts` + `agent.ts` 全文 |

---

## 4.1 agent-v1 — 状态管理

**核心认知：把阶段 3 散落在外的状态装进 Agent 类，用 getter/setter 做拷贝保护。**

阶段 3 的 `AgentContext` 每次 run 前手动拼，运行时状态不可见，messages 直接用引用传递。4.1 的 Agent 类一次性构造、多次 run 复用同一份 messages，运行时状态暴露为只读属性。

两个 TODO：
- `createMutableAgentState`：闭包持有 tools/messages，setter 赋值时 `slice()`
- `Agent` 类：constructor 调工厂 + `get state()` 对外暴露

对标 pi：`agent.ts` 的 `createMutableAgentState()` + `AgentState` 接口。

## 4.2 message-layer — AgentMessage ≠ LLM Message

**核心认知：Agent 内部消息比 LLM 协议更丰富，convertToLlm 在调用边界做映射。**

阶段 3 的 AgentMessage 是 `role: "user" | "assistant" | ...` 字符串联合，加新类型要改 union。4.2 用 discriminated union——每种消息独立 interface，加新类型不改现有代码。

LLM 只认识 user/assistant/tool 三种角色。NotificationMessage 和 StatusMessage 在 `convertToLlm` 中被过滤。`transformContext` 是一个 hook 槽位（签名），不是具体实现——调用方自己决定做什么（裁剪、注入、什么都不做）。

两个 TODO：
- `convertToLlm`：switch type → 过滤 + 映射
- `prepareLlmMessages`：可选的 transformContext hook → convertToLlm

对标 pi：`types.ts` AgentMessage 体系 + `agent.ts` defaultConvertToLlm。

## 4.3 subscriber — 事件订阅

**核心认知：EventBus 提供 subscribe/emit 基元，Agent 靠它向外广播生命周期事件。**

和阶段 3 EventStream 的关系：EventStream 是"一次运行"的 push/pull 管道，有结束条件；EventBus 是"长期持活"的监听器集合，Agent 存活期间一直可用。pi 的 `subscribe()` 把 listener 加入 Set，emit 时按注册顺序串行 await。

关键实现细节：emit 前先把 listeners 复制成快照（`[...this.listeners]`），防止遍历过程中 listener 改 Set 导致不可预测行为。

三个 TODO：
- `subscribe`：add + 返回取消函数
- `emit`：快照 + 遍历 await
- `createEventHistory`：用 EventBus 收集最近 N 条事件

对标 pi：`agent.ts` subscribe + listeners 派发。

## 4.4 hooks — Hook 签名体系

**核心认知：hook 是 AgentLoopConfig 的扩展点，不是 tool 定义层。**

阶段 2 的工具只管"怎么执行"，hook 在 loop 侧——在工具执行前后、turn 之间插入逻辑。同一个工具，不同场景用不同 hook 组合，不改工具定义。

四个 hook 注入点：`beforeToolCall`（可 block）、`afterToolCall`（可覆写 result）、`shouldStopAfterTurn`（判断是否退出）、`prepareNextTurn`（返回下轮配置变更）。其中 `prepareNextTurn` 是唯一主动返回配置变更的 hook——pi 用它做持久化刷新（阶段 5 实现）。

一个 TODO：`createTurnLimitHook`——超过 N 轮后通过 prepareNextTurn 注入提醒。

对标 pi：`types.ts` AgentLoopConfig 的四个 hook 字段。

## 4.5 agent-full — Stage 4 原生 agent loop + FullAgent 整合

**核心认知：用 Stage 4 类型体系从零重写 agent loop，零依赖 Stage 3。**

初版 4.5 尝试把 Stage 3 的 loop 作为黑盒嵌套在 FullAgent 壳里——结果消息格式不兼容（Stage 3 用 `role`，Stage 4 用 `type`），全局 `as any` 桥接。重写版把 loop 从 Stage 3 独立出来，全程使用 4.2 的 discriminated union 消息、4.3 的 EventBus 事件、4.4 的 hook 签名。

双层 while + stopReason 六路 + 工具执行和 Stage 3 一致（脚手架）。新增的是 5 个 hook 调用点：`transformContext`（LLM 调用前）、`beforeToolCall`（可 block）、`afterToolCall`（可覆写 result）、`shouldStopAfterTurn`（判断退出）、`prepareNextTurn`（返回下轮配置）。

`LoopConfig` 预留了阶段 5/6/7 的所有 hook 槽位，全部 optional——新阶段加功能只需在 LoopConfig 加字段 + runAgentLoop 加一处调用点。

FullAgent 持有 `Agent`（状态，4.1）、双 EventBus（`subscribe` 监听生命周期，`subscribeLoop` 监听 loop 内部事件）、`LoopConfig`（hook 配置 + model/apiKey/maxTurns）。对外提供 `prompt()` / `abort()` / `reset()` / `steer()` / `followUp()`。

两个 TODO 组：
- `runAgentLoop`：5 个 hook 调用点
- `FullAgent`：prompt / abort / reset

对标 pi：`agent-loop.ts` + `agent.ts` 全文。

---

## 思考

### readonly + 结构化类型 = 一个对象，两套类型视图

阶段 4 的 `Agent` 需要对外暴露一个**完整的状态快照对象**。C++/Java 的传统做法是 private + 逐个 getter，但外部需要的是整个对象，不是零散字段。

pi 的解法：`AgentState`（对外只读）和 `MutableAgentState`（对内可写）是**同一个 JS 对象的两种类型视图**。`agent.state` 返回类型是 `AgentState`——外部只看到 `readonly` 字段；Agent 内部通过 `MutableAgentState` 操作同一块内存。零拷贝，编译期零开销。

C++/Java 做不了这个，因为它们是**名义类型**（nominal typing）——对象的类型在定义时固定，不能换"镜片"。TypeScript 是**结构化类型**（structural typing），`AgentState` 和 `MutableAgentState` 是独立定义的两个类型，只要形状兼容就能互相赋值。

`readonly` 和 `private` 一样是编译期约束、运行时消失——但编译期拦截已经足够。如果外部真要用 `as any` 绕过，那和 C++ 的 `const_cast` 一个道理——挡不住也不想挡。

`messages` 为什么用 getter/setter 而非 readonly？因为 `readonly` 只阻止替换整个数组，不阻止 `push/pop`。setter 在赋值时 `slice()` 做拷贝保护，getter 返回原引用（性能取舍，和 pi 一致）。

### `type`：类型手术刀，不是别名

`interface` 只能描述对象形状 + extends 做加法。`type` 能做 `interface` 做不了的三件事：联合类型（`A | B`）、交叉类型（`Omit + &` 做字段替换）、工具类型（`Readonly<T>`、`Partial<T>`）。

C++ 的 `typedef`/`using` 只是别名；TS `type` 操作的是类型本身。4.1 的 `MutableAgentState = Omit<AgentState, ...> & { ... }` 就是典型的类型手术——删掉原字段、焊上新签名，`interface extends` 做不了。

当前 4.1 删 6 留 1，Omit 显得杀鸡用牛刀，但 AgentState 以后加字段时 Omit 的优势就体现出来了：新字段自动穿透，不用手动同步。

### `get`/`set`：字段升级为逻辑对调用方透明

C++/Java 把 public 字段改成方法时，所有调用方都要从 `obj.x` 改成 `obj.setX()`。JS/TS 的 getter/setter 让这次升级完全透明——外部写法不变，但背后已经走了函数逻辑。

4.1 的 `AgentState` 声明 `messages: AgentMessage[]`——看起来是普通字段。外部写 `agent.state.messages = arr` 时，`MutableAgentState` 的 setter 在背后做了 `slice()` 拷贝。调用方零感知。

### Hook："Don't call us, we'll call you"

Hook 的三个要素：**时机归框架，逻辑归你，可选**。在 pi 中，`beforeToolCall`、`afterToolCall`、`shouldStopAfterTurn`、`prepareNextTurn` 全是 hook——loop 在特定节点主动调用，hook 函数由外部注入，不传就跳过。

最早来自 Emacs（1976），后被 Git（`pre-commit`）、React（`useEffect`）继承。pi 的 agent loop 本质是"我控制主循环节奏，你通过 hook 插入自定义逻辑"。

---

## 阶段 4 总结：你已经具备的能力

| 脚本 | 能力 | 对标 pi |
|------|------|---------|
| 4.1 agent-v1 | 状态封装 + getter/setter 拷贝保护 | `AgentState`，`MutableAgentState` |
| 4.2 message-layer | AgentMessage discriminated union + convertToLlm | `AgentLoopConfig.convertToLlm` |
| 4.3 subscriber | EventBus + subscribe/emit/历史收集 | `agent.ts` subscribe |
| 4.4 hooks | 四个 hook 签名 + prepareNextTurn | `AgentLoopConfig` hooks |
| 4.5 agent-full | Stage 4 原生 agent loop（双层 while + hook）+ FullAgent 整合 + CLI v2 | `agent-loop.ts` + `agent.ts` 全文 |

## 启下：阶段 5 预览

阶段 4 的 Agent 是一个"纯内存"对象。阶段 5 加上持久化层——JSONL append-only 会话存储、系统提示词分层组装、Skill 加载与注入。`prepareNextTurn` hook 在 LoopConfig 中已经预留了槽位：每轮结束时自动调用，可用于 flush JSONL、重读状态、更新 systemPrompt。
