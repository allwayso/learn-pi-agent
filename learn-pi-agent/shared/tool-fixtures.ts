// shared/tool-fixtures.ts — stage2 共用工具夹具
// 2.2 / 2.3 复用

import { RegisteredTool } from "../stage2-tool-call/2.2-tool-registry"

/** 天气查询工具 */
export const getWeatherTool: RegisteredTool = {
  name: "getWeather",
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
  execute: async (args) => {
    // 模拟网络延迟（2.3 并行演示需要）
    await new Promise((r) => setTimeout(r, 500 + Math.random() * 300))
    const weathers: Record<string, string> = {
      "北京": "晴，25°C",
      "上海": "小雨，22°C",
      "东京": "阴，18°C",
    }
    return weathers[args.city] ?? `未找到 ${args.city} 的天气数据`
  },
}

/** 计算器工具 */
export const calculatorTool: RegisteredTool = {
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

/** 写文件工具（有副作用 → executionMode: "sequential"） */
export const writeFileTool: RegisteredTool = {
  name: "writeFile",
  description: "写入文件",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "文件路径" },
      content: { type: "string", description: "内容" },
    },
    required: ["path", "content"],
  },
  executionMode: "sequential",
  execute: (args) => {
    return `已写入 ${args.path}（${(args.content as string).length} 字节）`
  },
}
