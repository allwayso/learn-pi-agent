/**
 * 0.2 types.ts — 基本类型、interface、type、泛型
 *
 * 目标：掌握理解 pi 类型系统所需要的 TS 类型知识。
 * pi 大量使用 discriminated union、泛型接口、条件类型。
 * 运行：npx tsx learn-pi-agent/stage0-ts-basics/0.2-types.ts
 */

// ============================================================
// 0. 基本数据类型
// ============================================================

// 原始类型
const str: string = "hello";
const num: number = 42;
const flag: boolean = true;   // 使用 const 初始化时必须对变量赋值（好像是废话）
let x:number;   // 使用 let 初始化时允许仅声明不赋值，此时 x 的值为 undefined

// 数组
const names: string[] = ["Alice", "Bob"];       // 字符串数组
const scores: number[] = [95, 87, 92];            // 数字数组

// 对象字面量类型
const options: { timeout: number; shell: string } = {
  timeout: 30000,
  shell: "bash",
};

// unknown —— 不知道类型，用之前必须检查（比 any 安全得多）
let raw: unknown = "could be anything";   // let 是 ts 声明可变对象的方法
if (typeof raw === "string") {
  console.log("raw is string:", raw.toUpperCase());
}

// void —— 函数没有返回值
function log(message: string): void {
  console.log(message);
}
log(`基本类型: ${str}, ${num}, ${flag}, [${names}], [${scores}]`);

// Record<string, unknown> —— 任意 key-value 对象（pi 中 tool arguments 常用）
const params: Record<string, unknown> = {
  command: "ls -la",
  timeout: 5000,
  cwd: "/tmp",
};
console.log("Record:", params);

// ============================================================
// 1. interface —— 定义对象形状
// ============================================================

// interface 中的变量/函数都被成为 property 属性
// interface 中的函数声明方式有两种，见泛型接口 tool 函数
interface UserMessage {
  role: "user";
  content: string;
  timestamp: number;
}

const msg: UserMessage = {
  role: "user",
  content: "Hello",
  timestamp: Date.now(),
};
console.log("UserMessage:", msg);

// ============================================================
// 2. type —— 类型别名（比 interface 更灵活）
// ============================================================

type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>; // 任意 key-value 对象
};

const call: ToolCall = {
  id: "call_123",
  name: "bash",
  arguments: { command: "ls", timeout: 30 },
};
console.log("ToolCall:", call);

// ============================================================
// 3. 工厂函数 —— 省去重复的类型标注
// ============================================================

// pi 源码中大量使用工厂函数来创建特定类型的对象。
// 好处：参数按位置传（像 C++ 构造函数），返回类型自动推断，不用每次都写类型标注。

function createToolCall(
  id: string,
  name: string,
  args: Record<string, unknown>
): ToolCall {
  return { id, name, arguments: args };
}

// 工厂函数版本 —— 简洁
const call2 = createToolCall("call_456", "read", {
  path: "/tmp/file.txt",
  offset: 0,
});
console.log("Factory ToolCall:", call2);

// pi 中的类似模式（agent-harness.ts）：
// function createUserMessage(text: string): UserMessage {
//   return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
// }

// ============================================================
// 4. Discriminated Union —— pi 的 AgentEvent 核心模式
// ============================================================

// Discriminated Union 将拥有同一区分符的不同形状的 type 组合起来
// AgentEvent 的区分符为 type ，一般可辨识联合依赖单一区分符，这样收窄更自然
type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: string[] }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string }
  | { type: "tool_execution_end"; toolCallId: string; result: string };

// TypeScript 会根据 type 字段自动收窄类型
function handleEvent(event: AgentEvent): void {
  switch (event.type) {
    case "agent_start":
      console.log("Agent started");
      break;
    case "agent_end":
      // event.messages 可以安全访问（类型已收窄）
      console.log(`Agent ended with ${event.messages.length} messages`);
      break;
    case "tool_execution_start":
      console.log(`Tool ${event.toolName} (${event.toolCallId}) started`);
      break;
    case "tool_execution_end":
      console.log(`Tool ${event.toolCallId} result: ${event.result}`);
      break;
  }
}

// 这里可以先构造 AgentEvent 类型的对象传入 handleEvent 函数
// 也可以不声明类型，由 TS 自己推断

handleEvent({ type: "agent_start" });
handleEvent({ type: "agent_end", messages: ["done"] });
handleEvent({
  type: "tool_execution_start",
  toolCallId: "t1",
  toolName: "bash",
});
handleEvent({
  type: "tool_execution_end",
  toolCallId: "t1",
  result: "success",
});

// ============================================================
// 5. 泛型 —— pi 的 AgentTool<TParameters, TDetails>
// ============================================================

// 泛型函数
function first<T>(arr: T[]): T | undefined {
  return arr[0];
}

console.log("first number:", first([1, 2, 3]));
console.log("first string:", first(["a", "b", "c"]));

// 泛型接口 —— 对标 pi 的 AgentTool
interface Tool<TParams, TResult> {
  name: string;
  parameters: TParams;
  // 调用签名，interface/type 中函数的第一种声明方式
  // 也可以通过方法签名实现：execute(params: TParams): Promise<TResult>;
  execute: (params: TParams) => Promise<TResult>;   
}

// 具体化：bash 工具
interface BashParams {
  command: string;
  timeout: number;
}

interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

//  TS实例化interface不需要implements或new指令，只检查形状是否匹配
const bashTool: Tool<BashParams, BashResult> = {
  name: "bash",
  parameters: { command: "", timeout: 0 }, // 示意
  execute: async (params) => {
    // 真实实现会执行命令
    console.log(`Executing: ${params.command}`);
    return { stdout: "output", stderr: "", exitCode: 0 };
  },
};

bashTool.execute({ command: "echo hello", timeout: 5000 }).then(console.log);

// ============================================================
// 6. Extract / 工具类型（pi 中常用）
// ============================================================

// 从联合类型中提取特定成员
type ToolEvent = Extract<AgentEvent, { type: "tool_execution_start" }>;
// ToolEvent = { type: "tool_execution_start"; toolCallId: string; toolName: string }

const toolEvent: ToolEvent = {
  type: "tool_execution_start",
  toolCallId: "t2",
  toolName: "read",
};
console.log("Extracted ToolEvent:", toolEvent);

// ============================================================
// 7. 继承 —— interface extends、class extends、交叉类型 &
// ============================================================

// pi 几乎不使用继承，但了解它有助于阅读其他 TS 项目的源码

// 7.1 interface 继承 interface
interface Animal {
  name: string;
  age: number;
}

interface Dog extends Animal {
  breed: string;  // Dog 同时拥有 name、age、breed
}

const dog: Dog = { name: "Buddy", age: 3, breed: "Golden Retriever" };
console.log("Dog:", dog);

// 7.2 class 继承 class
class Vehicle {
  wheels = 0;
  move() {
    console.log(`Moving with ${this.wheels} wheels`);
  }
}

class Car extends Vehicle {
  wheels = 4;       // 重写父类属性
  brand = "Toyota"; // 新增属性
}

const car = new Car();
car.move();  // 继承自 Vehicle
console.log(`Car brand: ${car.brand}, wheels: ${car.wheels}`);

// 7.3 type 不能 extends，但可以交叉（&）
type Named = { name: string };
type Aged = { age: number };
type Person = Named & Aged;  // 交叉合并，不是继承

const person: Person = { name: "Alice", age: 25 };
console.log("Person:", person);

console.log("✅ 所有类型示例运行正常");

// 为什么 pi 不用继承？
// pi 的类型体系是组合式的：
// - AgentEvent 用联合（|）组合不同事件形状
// - AgentTool 用泛型参数化行为
// - AgentLoopConfig 用回调函数注入逻辑
// 这些都不需要继承。继承把数据和行为绑死，不利于灵活组合。

// 为什么 pi 大量用 interface 而很少用 class？
// interface 是纯类型，只在编译时存在，零运行时开销。
// pi 中 99% 的场景只需要"这个数据长什么样"——
// AgentMessage、AgentEvent、AgentTool 全部用 interface 定义。
// class 只在需要运行时方法时用（如 EventStream），整个 agent-core 里屈指可数。
// 一个简单判断：如果你不需要 new，就用 interface/type。


