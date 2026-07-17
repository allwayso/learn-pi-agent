// 1.4 json-mode.test.ts — 测试 JSON 模式
// 运行：npx tsx learn-pi-agent/stage1-llm-basics/1.4-json-mode.test.ts

import { jsonChat } from "./1.4-json-mode"

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log(`  ✅ ${name}`); passed++ }
  else           { console.log(`  ❌ ${name}` + (detail ? ` — ${detail}` : "")); failed++ }
}

async function main() {
  // ─── 测试 1：基本结构 ───
  console.log("=== 1. 基本 JSON 输出 ===")
  const r1 = await jsonChat(
    "用 JSON 描述：张三，25 岁，程序员",
    "{ name: string, age: number, job: string }",
  )
  check("返回对象非空", r1 !== null && typeof r1 === "object")
  check("包含 name", typeof r1.name === "string" && r1.name.length > 0, JSON.stringify(r1))
  check("包含 age",  typeof r1.age  === "number", JSON.stringify(r1))
  check("包含 job",  typeof r1.job  === "string", JSON.stringify(r1))

  // ─── 测试 2：嵌套结构 ───
  console.log("\n=== 2. 嵌套对象 ===")
  const r2 = await jsonChat(
    "描述一本你最喜欢的书，包含标题、作者和出版年份",
    "{ title: string, author: string, year: number }",
  )
  check("title 非空",  typeof r2.title  === "string" && r2.title.length > 0)
  check("author 非空", typeof r2.author === "string" && r2.author.length > 0)
  check("year 是数字", typeof r2.year   === "number")

  // ─── 测试 3：数组输出 ───
  console.log("\n=== 3. 数组 ===")
  const r3 = await jsonChat(
    "列出三个水果名",
    "string[]",
  )
  check("是数组",    Array.isArray(r3),  `类型: ${typeof r3}`)
  check("长度 >= 3", Array.isArray(r3) && r3.length >= 3, `实际: ${Array.isArray(r3) ? r3.length : 'N/A'}`)

  // ─── 测试 4：markdown 代码块清洗 ───
  console.log("\n=== 4. markdown 清洗 ===")
  // 这个测试依赖模型自发返回 markdown，不能保证每次都触发。
  // 但清洗逻辑应该对正常 JSON 也无害（幂等）。
  const r4 = await jsonChat(
    "用 JSON 返回：1+1=2",
    "{ result: number }",
  )
  check("正常解析", typeof r4 === "object" && r4 !== null)

  // ─── 测试 5：无效 JSON 容错 ───
  // LLM 可能在 JSON 后追加文字，清洗逻辑应该截取到最后一个 }
  console.log("\n=== 5. JSON 后多余文字容错 ===")
  try {
    const r5 = await jsonChat(
      "返回 JSON 只包含键 msg 值为 ok",
      "{ msg: string }",
    )
    check("解析成功", r5.msg === "ok", JSON.stringify(r5))
  } catch (e: any) {
    check("解析成功", false, e.message)
  }

  // ─── 结果 ───
  const total = passed + failed
  console.log(`\n${"=".repeat(30)}`)
  console.log(`通过 ${passed}/${total}` + (failed > 0 ? `  ❌ ${failed} 个失败` : "  ✅ 全部通过"))
}

main()
