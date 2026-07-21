# 阶段 4：Agent 类 —— 状态管理 + 消息队列 + Hook

对标 pi：`packages/agent/src/agent.ts`（575 行）+ `packages/agent/src/types.ts` AgentLoopConfig

## 承上：阶段 3 回顾

阶段 3 交出了一个完整的 agent loop **函数**：`agentLoop(prompt, ctx, config) → EventStream`。能跑，但状态散落在调用方——`systemPrompt` / `tools` / `messages` 每次 run 手动拼，运行时状态（`isStreaming` / `errorMessage` 等）封在 loop 内部不可见，abort 控制、队列管理全在外面。

阶段 4 把它封装成有生命周期的 **Agent 类**，加上消息体系、hook 和事件订阅。

## 概述

六个脚本逐层搭建：状态管理 → AgentMessage 体系 → steering/followUp 队列 → hook 链 → subscriber → 完整 Agent 类。

---

## 设计笔记：readonly / getter , setter / const 

### 问题

阶段 4 的 `Agent` 类需要对外暴露一个**完整的状态快照对象**（`AgentState`），包含持久字段（`systemPrompt`、`messages`、`tools`）和运行时字段（`isStreaming`、`errorMessage` 等）。运行时字段由 Agent 内部修改，外部只能读、不能写。

C++/Java 的传统思路是：

```
方案 A：private + 逐个 getter          方案 B：const 成员
─────────────────────                 ─────────────────
class Agent {                         class Agent {
  private _isStreaming = false          const isStreaming = false
  private _errorMsg: string
                                        // 构造后永远不能改
  get isStreaming() { ... }
  get errorMsg() { ... }              }
}
```

两种方案在 TypeScript 里都**能用**，但对这个场景不合适——外部需要的不是逐个字段，而是一个整体快照对象。如果逐个 getter，外部要自己拼对象，且拼出来的快照和内部状态脱钩（拿完 `isStreaming` 后它可能已经变了）。

### pi 的解法：一个对象，两套类型视图

```ts
// 同一块内存，两种"眼镜"
interface AgentState {        // 对外：只读视⻆
  readonly isStreaming: boolean
  messages: AgentMessage[]    // 普通属性，靠 setter 保护
}

type MutableAgentState = ...  // 对内：可写视⻆
  isStreaming: boolean        // 去掉 readonly
  get messages() / set messages()  // getter/setter

class Agent {
  private _state: MutableAgentState   // 内部操作用可变视角

  get state(): AgentState {
    return this._state                // 同一个对象！零拷贝
  }
}
```

关键：**`this._state` 和 `agent.state` 是同一个 JS 对象，只是通过不同的类型镜片去看它。**

```
agent.state           → 类型 AgentState（readonly 视⻆）
agent._state          → 类型 MutableAgentState（可写视⻆）
                         ↑
                    同一个 JS 对象
```

### 为什么 C++/Java 做不了这个

C++ 和 Java 是**名义类型**（nominal typing）。一个对象是某个类的实例，类的接口在定义时固定——你不能用"另一个类型的镜片"去解释同一个对象。

TypeScript 是**结构化类型**（structural typing）。`AgentState` 和 `MutableAgentState` 是两个独立定义的类型，只要形状兼容就能互相赋值。同一个 JS 对象可以同时满足两个类型的约束，编译器只看你当前通过哪个"镜片"访问——通过 `AgentState` 镜片 → `isStreaming` 是 `readonly`，通过 `MutableAgentState` 镜片 → 可以写。

这不是简单的"防外部修改单个字段"——那用 private + getter 就够了。这里的问题是**外部要一个完整快照对象**，且希望**零拷贝、编译期零开销**。TS 的结构化类型让"同一块内存，两套视图"成为可能。

### 和 `private` 的类比

TS 的 `private` 也是编译期约束、运行时消失。`readonly` 同理——编译成 JS 后是完全普通的属性赋值。但这不代表它是"弱约束"：编译期拦截已经足够，因为你不希望外部代码在**不知情**的情况下修改状态。如果外部真的想绕过（`(agent.state as any).isStreaming = true`），那你挡不住也不想挡——和 C++ 的 `const_cast` 一个道理。

### `messages` 为什么不用 readonly 而用 getter/setter

`messages` 是数组。`readonly` 只阻止"替换整个数组"，不阻止"通过引用 push/pop"：

```ts
readonly messages: AgentMessage[]   // ❌ state.messages = [...] 报错
                                    // ✅ state.messages.push(...) 不报错
```

getter/setter 可以同时做到：getter 返回引用（性能），setter 在赋值时 `slice()` 拷贝（保护）。但 getter 返回原引用意味着 `agent.state.messages.push(...)` 仍然会修改内部——这是 pi 接受的设计取舍（和 C++ 返回 `const&` 但外部 `const_cast` 后修改类似）。

> `readonly` + 结构化类型 = 编译期零开销的类型视图切换。和 C++ `const` 的"运行时硬隔离"思路不同，TS 选择"编译期感知、运行时透明"——约束在类型系统里，不在运行时中。

---

## 设计笔记：`type` 数据类型

### `type` vs `interface` vs `class`

| | `interface` | `type` | `class` |
|---|---|---|---|
| 是什么 | 描述**对象的形状** | 给**任意类型起别名** | 创建**可 new 的对象** |
| 运行时存在？ | ❌ 编译后消失 | ❌ 编译后消失 | ✅ 编译后保留 |
| 能干什么 | 描述对象/函数结构 | 联合、交叉、映射、类型运算 | 实例化、继承、方法调用 |

`interface` 是 `type` 的子集——凡是 `interface` 能描述的，`type` 也能。但 `type` 能做 `interface` 做不了的三件事：

**1. 联合类型（Union）**
```ts
type StopReason = "stop" | "toolUse" | "maxTokens" | "error" | "aborted"
//               ↑ interface 永远写不出这个——它不是对象形状，是"几个值之一"
```

**2. 交叉类型（Intersection）——4.1 就在做这个**
```ts
// 从 AgentState 里挖掉 6 个字段，焊上新的 getter/setter 签名
type MutableAgentState = Omit<AgentState, "tools" | "messages" | "isStreaming" | ...>
  & {
      get tools(): ToolRegistry
      set tools(t: ToolRegistry)
    }
```
这是**类型层面的手术**——把一个 interface 的字段拆掉几个，再拼上新的。`interface extends` 只能做加法（加字段），做不了减法和替换。

**3. 工具类型**
```ts
type Readonly<T>  = { readonly [K in keyof T]: T[K] }  // 全变 readonly
type Partial<T>   = { [K in keyof T]?: T[K] }          // 全变可选
type Omit<T, K>   = Pick<T, Exclude<keyof T, K>>       // 挖掉几个字段
```
这些都是 `type`，操作的是**类型本身**，不是具体的值。`interface` 做不到。

### 和 C++ 的对比

C++ 有 `typedef` 和 `using`：
```cpp
using StopReason = std::variant<Stop, ToolUse, MaxTokens, Error, Aborted>;
```
但这只是**给已有类型起别名**。TS `type` 的能力远超别名——联合类型是语言内置的（C++ 需要 `std::variant` 模板），交叉类型没有 C++ 等价物（多重继承算部分重叠），`Omit` / `Pick` / `Readonly` 这些类型运算在 C++ 里需要模板元编程，动辄几十行。

一句话：C++ `using` 是便利贴，TS `type` 是手术刀。

### 4.1 为什么必须用 `type`

`MutableAgentState` 不是在 `AgentState` 上**加**字段——它要**替换** `tools`/`messages` 的签名（普通属性 → getter/setter）、**去掉** `isStreaming` 等的 `readonly`。`interface extends` 只能加不能改，只有 `type` + `Omit` + `&` 能做这种"拆墙换梁"操作。

> 题外话：当前 4.1 删 6 留 1，Omit 显得杀鸡用牛刀——手写一个新 interface 效果一样。Omit 的真正收益在 AgentState 加字段时体现：新字段自动穿透到 MutableAgentState，不用手动同步。pi 源码用 Omit 不是偷懒，是把"我是你的变体"这个设计意图编码进类型。

---

## 设计笔记：为什么 JS/TS 有单独的 `get`/`set` 签名

### 不是什么语法糖——是"字段升级为逻辑"对调用方透明

C++/Java 如果想把一个 public 字段改成需要校验的：

```cpp
// v1
class User {
public:
  std::string name;           // 直接暴露字段
};
user.name = "Bob";            // 调用方这样写

// v2 — 需要加校验，只能改成方法
class User {
  std::string _name;
public:
  const std::string& getName() const { return _name; }
  void setName(const std::string& v) { if (v.empty()) throw; _name = v; }
};
user.setName("Bob");          // ← 所有调用方必须从 obj.name 改成 obj.setName()
```

**字段升级为逻辑，破坏了所有调用方。** 这就是 C++/Java 不用 getter/setter 语法而用 `getXxx()`/`setXxx()` 约定的原因——从一开始就强迫调用方用方法，不给字段访问的"假接口"。

JS/TS 选了另一条路：

```ts
// v1
class User {
  name = "Alice"
}
user.name = "Bob"            // 直接赋值

// v2 — 需要校验，改成 getter/setter，调用方一行不用改
class User {
  private _name = "Alice"
  get name() { return this._name }
  set name(v: string) { if (!v) throw Error(); this._name = v }
}
user.name = "Bob"            // ← 还是这行！但走了 setter 的校验逻辑
```

**字段到逻辑的升级完全透明。** 代价是调用方不知道背后有函数调用（看起来像 O(1) 读内存，实际可能走了复杂计算），所以社区约定 getter 不做重操作。

### 对 4.1 的意义

外部看到的 `AgentState` 声明 `messages: AgentMessage[]`——**看起来就是个普通字段**。`agent.state.messages = arr` 这行代码，调用方以为自己只是在赋值，实际上 `MutableAgentState` 的 setter 在背后做了 `slice()` 拷贝保护。

如果用 `setMessages(arr)` / `getMessages()` 方法，调用方必须**知道**这里不能直接赋值——封装的意义被打折。getter/setter 做到了**零语法成本的防御**：外部代码不需要知道你做了什么手脚，写法和普通属性一模一样。
