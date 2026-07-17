// 2.2 tool-registry.ts — 工具注册表 + 切换到 openai SDK
// 对标 pi：packages/agent/src/types.ts 的 AgentTool 接口
//
// 从这一步开始，不再用裸 fetch，改用 openai SDK（baseURL 指向 DeepSeek）。
// 核心变化：工具不再散落在外，而是注册到 ToolRegistry 统一管理。

import dotenv from "dotenv"
dotenv.config({ override: true })
import OpenAI from "openai"

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY!

const client = new OpenAI({
  apiKey: DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
})

// export：类似cpp/java中的public，将class/interface暴露给其他文件
export interface RegisteredTool {
  name: string
  description: string
  parameters: Record<string, any>        // JSON Schema
  execute: (args: Record<string, any>) => Promise<string> | string
}

// ─── OpenAI 工具定义 ───

/** getDefinitions() 的返回值类型：OpenAI 线格式 */
export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

// ─── 工具注册表 ───

// private：仅在编译期进行检查，运行时中并不会拦截对私有属性的访问
export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map()

  /** 注册一个工具 */
  register(tool: RegisteredTool): void {
    // TODO: 存入 this.tools，key 为 tool.name

    this.tools.set(tool.name,tool)
  }

  /** 将内部的 RegisteredTool 映射为 OpenAI 线格式 */
  getDefinitions(): OpenAITool[] {

    // ========== YOUR CODE HERE ==========
    const OpenAITools:OpenAITool[]=[]

    for(const tool of this.tools.values()){
      
      const tool_openai:OpenAITool={
        type:"function",
        function:{
          name:tool.name,
          description:tool.description,
          parameters:tool.parameters,
        }
      }
      OpenAITools.push(tool_openai)
    }

    return OpenAITools
    // ========== END YOUR CODE ==========
  }

  /** 执行指定工具，返回结果字符串 */
  execute(name: string, args: Record<string, any>): Promise<string> | string {
    // TODO: 查找工具，调用 tool.execute(args)
    const tool=this.tools.get(name)
    if (!tool) {
     throw new Error(`工具 "${name}" 未注册`)
    }
    return tool!.execute(args)
  }

  get size(): number {
    return this.tools.size
  }
}

// ─── 预置工具 ───

/** 创建预置工具的注册表（天气 + 计算器） */
export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry()

  // ========== YOUR CODE HERE (注册工具) ==========
  // 注册 getWeather 和 calculator 两个工具
  //
  // getWeather: 获取城市天气（复用 2.1 的逻辑）
  // calculator: 执行数学表达式，参数 { expression: string }，内部用 eval 计算

  const getWeather:RegisteredTool={
    name: "getWeather" as const,
    description: "获取指定城市的天气信息",
    parameters: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "城市名称，如 北京、上海、东京",
        },
      },
      required: ["city"],
    },
    execute: (args) => {
       const weathers: Record<string, string> = {
         "北京": "晴，25°C",
         "上海": "小雨，22°C",
       }
       return weathers[args.city] ?? `未找到 ${args.city} 的天气数据`
     },
  }

  const calculator: RegisteredTool = {
    name: "calculator",
    description: "执行数学表达式，支持加减乘除和括号",
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "数学表达式，如 1+2*3、(1+2)*3",
        },
      },
      required: ["expression"],
    },
    execute: (args) => {
      const expr = args.expression as string
      try {
        const result = eval(expr)
        return `计算结果: ${expr} = ${result}`
      } catch (e) {
        return `表达式 "${expr}" 计算失败: ${(e as Error).message}`
      }
    },   
  }

  registry.register(getWeather)
  registry.register(calculator)

  // ========== END YOUR CODE ==========

  return registry
}

// ─── 对话流程 ───

export interface ToolCallStep {
  id: string
  name: string
  arguments: Record<string, any>
  result: string
}

export interface ChatResult {
  content: string
  steps: ToolCallStep[]
}

/**
 * 使用 ToolRegistry 进行工具调用对话
 *
 * 和 2.1 相同流程，但用 openai SDK + ToolRegistry 替代裸 fetch + 散落函数
 */
export async function chatWithTools(
  userMessage: string,
  registry: ToolRegistry,
): Promise<ChatResult> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "user", content: userMessage },
  ]

  const steps: ToolCallStep[] = []

  // 第 1 次调用：带 tools，让 LLM 决定是否调用

  // ========== YOUR CODE HERE (SDK create with tools) ==========
  const response1 = await client.chat.completions.create({
    model: "deepseek-v4-pro",
    messages,
    tools: registry.getDefinitions(),
  })
  // ========== END YOUR CODE ==========

  const choice1 = response1.choices[0]

  // 不需要工具，直接返回文本
  if (choice1.finish_reason === "stop") {
    return { content: choice1.message.content ?? "", steps: [] }
  }

  // 需要工具：逐一执行（和 2.1 流程一样，只是用 registry.execute 替代硬编码分发）
  const toolCalls = choice1.message.tool_calls ?? []
  for (const tc of toolCalls) {
    const args = typeof tc.function.arguments === "string"
      ? JSON.parse(tc.function.arguments)
      : tc.function.arguments
    const result = await registry.execute(tc.function.name, args)
    steps.push({ id: tc.id, name: tc.function.name, arguments: args, result })
  }

  // 注入 assistant 消息（含 tool_calls）和 tool 结果（和 2.1 完全一样）
  messages.push(choice1.message)
  for (const step of steps) {
    messages.push({ role: "tool", tool_call_id: step.id, content: step.result })
  }

  // 第 2 次调用：LLM 根据工具结果生成最终回复

  // ========== YOUR CODE HERE (SDK create without tools) ==========
  const response2 = await client.chat.completions.create({
    model: "deepseek-v4-pro",
    messages,
  })
  // ========== END YOUR CODE ==========

  return { content: response2.choices[0].message.content ?? "", steps }
}
