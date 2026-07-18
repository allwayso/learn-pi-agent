// 2.2 tool-registry.ts — 工具注册表 + 切换到 openai SDK
// 对标 pi：packages/agent/src/types.ts 的 AgentTool 接口
//
// 从这一步开始，不再用裸 fetch，改用 openai SDK（baseURL 指向 DeepSeek）。
// 核心变化：工具不再散落在外，而是注册到 ToolRegistry 统一管理。
//
// TODO 清单：
//   ToolRegistry.register    — Map.set 存入工具
//   ToolRegistry.getDefinitions — 遍历 → 包成 OpenAITool 线格式
//   ToolRegistry.execute     — Map.get 查找 → 调 tool.execute
//   createDefaultRegistry    — register 两个共享工具
//   chatWithTools 第 1 次    — SDK create（带 tools）
//   chatWithTools 第 2 次    — SDK create（不带 tools）

import dotenv from "dotenv"
dotenv.config({ override: true })
import OpenAI from "openai"

import { ToolResult, ChatResult } from "../shared/types"
import { getWeatherTool, calculatorTool } from "../shared/tool-fixtures"

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
  /** 执行模式：默认 "parallel"，标记 "sequential" 时可强制串行 */
  executionMode?: "parallel" | "sequential"
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

    // ========== YOUR CODE HERE ==========

    this.tools.set(tool.name,tool)
    // ========== END YOUR CODE ==========
  }

  /** 将内部的 RegisteredTool 映射为 OpenAI 线格式 */
  getDefinitions(): OpenAITool[] {
    // TODO: 遍历 this.tools.values()，每个 tool 包成 { type: "function", function: {...} }

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

  /** 按名称查找工具，未注册返回 undefined */
  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name)
  }

  /** 执行指定工具，返回结果字符串 */
  execute(name: string, args: Record<string, any>): Promise<string> | string {
    // TODO: 查找工具 → 未找到抛 Error → 调用 tool.execute(args)

    // ========== YOUR CODE HERE ==========
    const tool=this.tools.get(name)
    if (!tool) {
     throw new Error(`工具 "${name}" 未注册`)
    }
    return tool!.execute(args)
    // ========== END YOUR CODE ==========
  }

  get size(): number {
    return this.tools.size
  }
}

// ─── 预置工具 ───

/** 创建预置工具的注册表（天气 + 计算器） */
export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry()

  // TODO: 注册 getWeatherTool 和 calculatorTool（从 shared/tool-fixtures 导入）

  // ========== YOUR CODE HERE (注册工具) ==========

  registry.register(getWeatherTool)
  registry.register(calculatorTool)

  // ========== END YOUR CODE ==========

  return registry
}

// ─── 对话流程 ───

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

  const steps: ToolResult[] = []

  // TODO: client.chat.completions.create（带 tools）

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
    steps.push({ toolCallId: tc.id, name: tc.function.name, result })
  }

  // 注入 assistant 消息（含 tool_calls）和 tool 结果（和 2.1 完全一样）
  messages.push(choice1.message)
  for (const step of steps) {
    messages.push({ role: "tool", tool_call_id: step.toolCallId, content: step.result })
  }

  // TODO: client.chat.completions.create（不带 tools，让 LLM 基于结果回复）

  // ========== YOUR CODE HERE (SDK create without tools) ==========
  const response2 = await client.chat.completions.create({
    model: "deepseek-v4-pro",
    messages,
  })
  // ========== END YOUR CODE ==========

  return { content: response2.choices[0].message.content ?? "", steps }
}
