/**
 * 0.4 fetch.ts — Node.js 内置 fetch API
 *
 * 目标：掌握 HTTP 请求，为阶段 1 的 LLM 调用做准备。
 * Node.js 18+ 内置了 fetch，零依赖。
 * 运行：npx tsx learn-pi-agent/stage0-ts-basics/0.4-fetch.ts
 */

// ============================================================
// 1. GET 请求 —— 最基础的发请求拿数据
// ============================================================

/*
response数据类型的属性：
response.status         // number —— HTTP 状态码（200, 404...）
response.ok             // boolean —— 状态码是否在 200-299
response.statusText     // string —— "OK", "Not Found"...
response.headers        // Headers 对象 —— 响应头
response.body           // ReadableStream | null —— 响应体（流式）
response.json()         // → Promise<any> —— 解析为 JSON
response.text()         // → Promise<string> —— 解析为纯文本
response.blob()         // → Promise<Blob> —— 解析为二进制
*/


// fetch(url) 返回 Promise<Response>
// https://httpbingo.org/ 是一个回显服务器，即该服务器将发送请求原封不动的回传
async function demoGet() {
  
  const response = await fetch("https://httpbingo.org/get?name=Alice");

  console.log("状态码:", response.status);        // 200
  console.log("是否成功:", response.ok);           // true（status 在 200-299）
  console.log("Content-Type:", response.headers.get("content-type"));

  // response.json() —— 把响应体解析为 JSON 对象，返回 Promise
  const data = await response.json();
  console.log("响应数据:", data);
}


// ============================================================
// 2. POST 请求 —— 带请求体 + 自定义 headers
// ============================================================

async function demoPost() {
  const response = await fetch("https://httpbingo.org/post", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer sk-test-token",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: "Hello" }],
    }),
  })
  const data = await response.json()
  console.log("POST 回显:", data.json)
}

// ============================================================
// 3. 错误处理 —— status 不是 200 时不会自动抛异常
// ============================================================

async function demoErrors() {
  // fetch 只在网络层面抛异常（断网、DNS 失败）
  // HTTP 层面的错误（404、500）不抛异常，需要自己检查 response.ok
  const bad = await fetch("https://httpbingo.org/status/404")
  console.log("404 的 ok:", bad.ok)

  const response = await fetch("https://httpbingo.org/status/404")
  if (!response.ok) {
    console.log(`请求失败: ${response.status} ${response.statusText}`)
  }

  try {
    await fetch("https://this-domain-does-not-exist-12345.com")
  } catch (error) {
    console.log("网络错误:", (error as Error).message)
  }
}

// ============================================================
// 4. 流式读取 —— LLM streaming 的底层原理
// ============================================================

async function demoStreaming() {
  const response = await fetch("https://httpbingo.org/stream/5")
  if (!response.body) {
    console.log("响应没有 body")
    return
  }

  /*
  Reader:数据结构为异步队列，读取端若无数据则返回一个等待数据的promise，收到数据时唤醒
  需要注意的是流结束和数据队列为空并不是一个概念，只有当服务器发送流结束信号时，read()返回done=true,否则持续等待
  */
  const reader = response.body.getReader()
  // decoder将二进制数据转化为字符串
  const decoder = new TextDecoder()
  // chunk是数据的基本单位，其大小由网络层和服务器决定
  let chunks = 0

  // 每次read()会从数据队列中出队一个chunk，本示例中每读到一个chunk就解码并渲染
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks++
    const text = decoder.decode(value, { stream: true })
    console.log(`[chunk ${chunks}]:`, text.slice(0, 100))
  }

  console.log(`共收到 ${chunks} 个数据块`)
}

// ============================================================
// 5. 组装起来：模拟一次 LLM API 调用
// ============================================================

type DeepSeekMessage = { role: "user" | "assistant" | "system"; content: string };

async function callDeepSeek(apiKey: string, messages: DeepSeekMessage[]) {
  console.log("\n--- 模拟 LLM 调用 ---");

  try {
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages,
        stream: false,  // 非流式，一次返回
      }),
    });

    if (!response.ok) {
      // 尝试读取错误详情
      const errBody = await response.text();
      console.log(`API 错误 [${response.status}]:`, errBody.slice(0, 200));
      return;
    }

    const data = await response.json();
    // 实际结构：data.choices[0].message.content
    console.log("回复:", data.choices?.[0]?.message?.content ?? "（无内容）");
  } catch (error) {
    console.log("请求失败（网络错误）:", (error as Error).message);
  }
}

// 如果你有 API Key，取消下面的注释试试
// callDeepSeek(process.env.DEEPSEEK_API_KEY!, [{ role: "user", content: "说一句你好" }])

import dotenv from "dotenv"
dotenv.config({ override: true })  // 强制覆盖系统环境变量中的旧 Key

// ============================================================
// 按顺序运行所有示例
// ============================================================

async function main() {
  console.log("--- 1. GET 请求 ---")
  await demoGet()

  console.log("\n--- 2. POST 请求 ---")
  await demoPost()

  console.log("\n--- 3. 错误处理 ---")
  await demoErrors()

  console.log("\n--- 4. 流式读取 ---")
  await demoStreaming()

  // 5. 真正的 LLM 调用
  console.log("\n--- 5. DeepSeek LLM 调用 ---")
  await callDeepSeek(process.env.DEEPSEEK_API_KEY!, [{ role: "user", content: "说一句你好" }])

  console.log("\n✅ 所有 fetch 示例运行完成")
}

main()