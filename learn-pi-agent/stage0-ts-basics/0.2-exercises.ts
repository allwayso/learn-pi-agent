/**
 * 0.2 练习题 —— interface、type、泛型、Discriminated Union
 *
 * 每个 TODO 都是一个练习，完成后用 npx tsx 运行验证。
 * 参考答案在本文件末尾（注释掉），先自己做再看答案。
 *
 * 运行：npx tsx learn-pi-agent/stage0-ts-basics/0.2-exercises.ts
 */

// ============================================================
// 练习 1：基本类型 + interface
// ============================================================

// TODO: 定义一个 interface ToolResult，包含以下属性：
//       - toolName: string
//       - success: boolean
//       - output: string（可选，success 为 true 时才有）
//       - error: string（可选，success 为 false 时才有）
//       - duration: number
//
// 然后创建两个合法对象：一个成功的结果，一个失败的结果

interface ToolResult{
    toolName:string;
    success:boolean;
    output?:string;
    error?:string;
    duration:number;
}

const ToolSuccess:ToolResult={
    toolName:"read",
    success:true,
    output:"read seccessful",
    duration:100,
}

const ToolFailed:ToolResult={
    toolName:"write",
    success:false,
    error:"write failed",
    duration:50,
}

console.log("Read Tool Calling:",ToolSuccess.output)
console.log("Write Tool Calling:",ToolFailed.error)

// ============================================================
// 练习 2：Discriminated Union
// ============================================================

// TODO: 用 discriminated union 定义一个 HttpResult 类型，有三种情况：
//       - loading: 请求中，没有额外字段
//       - success: 请求成功，有 data: unknown 和 statusCode: number
//       - error: 请求失败，有 message: string 和 statusCode: number
//
// 然后写一个 handleResult 函数，用 switch 收窄类型，
// 对每种情况打印不同的日志

// --- 你的代码 ---
type HttpResult = 
    | {status:"loading"}
    | {status:"success",data:unknown,statusCode:number}
    | {status:"error",message:string,statusCode:number};

function handleResult(result: HttpResult): void {
    switch(result.status){
        case "loading":
            console.log("Http loading")
            break
        case "success":
            console.log(`Success ${result.statusCode}:${JSON.stringify(result.data)}`)
            break
        case "error":
            console.log(`Failed ${result.statusCode}:${result.message}`)
    }
}

// 这里为什么success的log中要写${JSON.stringify()}来传递data参数？
// 这是因为log对于各种参数传入方法的处理方法并不相同：
// 1. (result`${data}`} 模板插值：先将对象转为string类型再传入，内部调用data.toString()函数，其内部逻辑返回 "[object"+内部类型标签+"]"
// 2. ("result",data) 逗号传参：Node.js内部用 util.inspect() 格式化每一个参数
// 3. ${JSON.stringify(data)} stringify 函数JSON化：舍弃对象的undefined属性和函数属性，序列化为严格JSON格式
// 结论：模板插值只适用于基本类型，不能传对象；逗号传参适用于调试和打日志；JSON.stringify适用于持久化存储和API传输

// 测试（取消注释验证）
handleResult({ status: "loading" });
handleResult({ status: "success", data: { name: "Alice" }, statusCode: 200 });
handleResult({ status: "error", message: "Not Found", statusCode: 404 });

// ============================================================
// 练习 3：泛型接口
// ============================================================

// TODO: 定义一个泛型接口 Cache<T>，包含：
//       - get(key: string): T | undefined
//       - set(key: string, value: T): void
//
// 然后写一个 createCache 工厂函数，
// 实现一个简单的内容缓存（内部用 Record<string, T> 存储）
// 创建两个不同类型的 cache 并测试

// --- 你的代码 ---

type MyCache<T>={
    get(key:string):T | undefined
    set(key:string,value:T):void
}

function createCache<T>():MyCache<T>{
    // 注意虽然store被声明为const变量，但是对于对象而言，TS中的const标识符只保护引用，不保护内容
    // 所以store初始长度为0，但是当调用set()函数的时候，其长度可以变长
    // 当然对于原始类型number、string和boolean类型而言，其值也不可改变
    const store: Record<string,T>={}    
    return {
        get(key){return store[key]},
        set(key,value){store[key]=value}
    }
}

const cache1=createCache<number>()
cache1.set("lsz",666)
console.log(cache1.get("lsz"))

// ============================================================
// 练习 4：Extract 工具类型
// ============================================================

// 使用上面你定义的 HttpResult 类型
// TODO: 用 Extract 提取出 success 这个分支的类型，命名为 SuccessResult
//       然后用它声明一个变量

// --- 你的代码 ---

type SuccessResult=Extract<HttpResult,{status:"success"}>

const BashSuccessResult:SuccessResult={
    data:"bash call succeeded",
    statusCode:200,
    status:"success",
}

// ============================================================
// 练习 5：综合 —— 模拟 pi 的 AgentMessage
// ============================================================

// TODO: 用 discriminated union 模仿 pi 的消息类型，定义一个 AgentMessage：
//       - user: { role: "user"; content: string; timestamp: number }
//       - assistant: { role: "assistant"; content: string; timestamp: number }
//       - toolResult: { role: "toolResult"; toolCallId: string; content: string; timestamp: number }
//       - system: { role: "system"; content: string }（没有 timestamp）
//
// 写一个函数 printMessage，根据 role 打印不同格式

// --- 你的代码 ---

type myAgentMessage=
| {role:"user",content:string,timestamp:number}
| {role: "assistant",content:string,timestamp:number}
| {role:"toolResult",toolCallId:string,content:string,timestamp:number}
| {role:"system",content:string}

function printMessage(message:myAgentMessage):void{
    switch (message.role){
        case "user":
            console.log("User: ",message.content,message.timestamp)
            break
        case "assistant":
            console.log("Assistant: ",message.content,message.timestamp)
            break
        case "system":
            console.log("System: ",message.content)
            break
        case "toolResult":
            console.log(message.toolCallId,": ",message.content,message.timestamp)
    }
}

// 测试四种消息类型
printMessage({ role: "system", content: "你是一个有用的助手" })
printMessage({ role: "user", content: "帮我查一下天气", timestamp: Date.now() })
printMessage({ role: "assistant", content: "好的，正在查询...", timestamp: Date.now() })
printMessage({ role: "toolResult", toolCallId: "call_001", content: "北京 晴 25°C", timestamp: Date.now() })


// ============================================================
// 参考答案（先自己做！）
// ============================================================

// /*
// ============================================================
// 练习 1
// ============================================================
// interface ToolResult {
//   toolName: string;
//   success: boolean;
//   output?: string;
//   error?: string;
//   duration: number;
// }
//
// const successResult: ToolResult = {
//   toolName: "bash",
//   success: true,
//   output: "hello world\n",
//   duration: 150,
// };
//
// const failResult: ToolResult = {
//   toolName: "read",
//   success: false,
//   error: "File not found",
//   duration: 23,
// };
//
// console.log("练习1 成功:", successResult);
// console.log("练习1 失败:", failResult);
//
// ============================================================
// 练习 2
// ============================================================
// type HttpResult =
//   | { status: "loading" }
//   | { status: "success"; data: unknown; statusCode: number }
//   | { status: "error"; message: string; statusCode: number };
//
// function handleResult(result: HttpResult): void {
//   switch (result.status) {
//     case "loading":
//       console.log("⏳ 请求中...");
//       break;
//     case "success":
//       console.log(`✅ [${result.statusCode}]`, result.data);
//       break;
//     case "error":
//       console.log(`❌ [${result.statusCode}]`, result.message);
//       break;
//   }
// }
//
// ============================================================
// 练习 3
// ============================================================
// interface Cache<T> {
//   get(key: string): T | undefined;
//   set(key: string, value: T): void;
// }
//
// function createCache<T>(): Cache<T> {
//   const store: Record<string, T> = {};
//   return {
//     get(key) { return store[key]; },
//     set(key, value) { store[key] = value; },
//   };
// }
//
// const numCache = createCache<number>();
// numCache.set("count", 42);
// console.log("练习3 number:", numCache.get("count"));
//
// const strCache = createCache<string>();
// strCache.set("name", "Alice");
// console.log("练习3 string:", strCache.get("name"));
//
// ============================================================
// 练习 4
// ============================================================
// type SuccessResult = Extract<HttpResult, { status: "success" }>;
// const success: SuccessResult = {
//   status: "success",
//   data: { id: 1, name: "Bob" },
//   statusCode: 200,
// };
// console.log("练习4:", success);
//
// ============================================================
// 练习 5
// ============================================================
// type AgentMessage =
//   | { role: "user"; content: string; timestamp: number }
//   | { role: "assistant"; content: string; timestamp: number }
//   | { role: "toolResult"; toolCallId: string; content: string; timestamp: number }
//   | { role: "system"; content: string };
//
// function printMessage(msg: AgentMessage): void {
//   switch (msg.role) {
//     case "user":
//       console.log(`👤 User: ${msg.content}`);
//       break;
//     case "assistant":
//       console.log(`🤖 Assistant: ${msg.content}`);
//       break;
//     case "toolResult":
//       console.log(`🔧 [${msg.toolCallId}]: ${msg.content}`);
//       break;
//     case "system":
//       console.log(`⚙️ System: ${msg.content}`);
//       break;
//   }
// }
// */

console.log("\n做完了？取消注释参考答案对比一下。");
