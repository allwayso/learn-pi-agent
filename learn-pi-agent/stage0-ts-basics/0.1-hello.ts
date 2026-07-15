/**
 * 0.1 hello.ts — Node.js + TypeScript 环境验证
 *
 * 目标：确认 tsx 能正常运行 TypeScript 文件。
 * 运行：npx tsx learn-pi-agent/stage0-ts-basics/0.1-hello.ts
 */

// 1. 基础类型注解
const name: string = "TypeScript";
const version: number = 5;
const isReady: boolean = true;

console.log(`Hello, ${name} ${version}! Ready: ${isReady}`);

// 2. 函数类型注解 —— 参数和返回值
function greet(person: string, age: number): string {
  return `${person} is ${age} years old`;
}

console.log(greet("Alice", 30));

// 3. 数组和对象类型
const tools: string[] = ["bash", "read", "write"];
const config: { model: string; temperature: number } = {
  model: "deepseek-chat",
  temperature: 0.7,
};

console.log(`Using model: ${config.model}, tools: ${tools.join(", ")}`);

// 4. Node.js 环境信息
console.log(`Node.js version: ${process.version}`);
console.log("✅ TypeScript + tsx 环境正常");
