/**
 * 0.4 练习题 —— fetch、流式读取、错误处理
 *
 * 参考答案在末尾（注释掉），先自己做。
 * 运行：npx tsx learn-pi-agent/stage0-ts-basics/0.4-exercises.ts
 */

// ============================================================
// 练习 1：基础 GET + 解析
// ============================================================

// TODO: 写一个 async 函数 fetchJson<T>，接收 url: string，
//       用 fetch GET 这个 url，返回解析后的 JSON（类型 T）
//       如果 response.ok 为 false，throw new Error
//       提示：response.json() 返回 Promise<any>

// --- 你的代码 ---



// 测试（取消注释）
// async function testFetchJson() {
//   const data = await fetchJson<{ url: string }>("https://httpbingo.org/get");
//   console.log("练习1 url:", data.url);
// }

// ============================================================
// 练习 2：POST 请求 + 错误体
// ============================================================

// TODO: 写一个 async 函数 createPost，接收 title: string, body: string, userId: number
//       POST 到 https://jsonplaceholder.typicode.com/posts
//       请求体是 JSON: { title, body, userId }
//       返回服务器创建的 post 对象（含 id）
//
//       如果 response.ok 为 false：尝试读取 response.text() 作为错误信息，
//       throw new Error

// --- 你的代码 ---



// 测试（取消注释）
// createPost("测试标题", "这是正文", 1).then(console.log);

// ============================================================
// 练习 3：流式计数
// ============================================================

// TODO: 写一个 async 函数 countChunks，接收 url: string
//       用流式读取 response.body（和 0.4 第 4 节一样的方式）
//       但不打印内容，只数一共有多少个 chunk
//       返回 chunk 数量

// --- 你的代码 ---



// 测试（取消注释）
// countChunks("https://httpbingo.org/stream/20").then(n => {
//   console.log(`练习3: 共 ${n} 个 chunk（期望 20）`);
// });

// ============================================================
// 练习 4：安全 fetch（封装错误处理）
// ============================================================

// TODO: 写一个 async 函数 safeFetch，行为和 fetch 完全一样
//       但额外做两件事：
//       1. 如果 response.ok 为 false，throw new Error(`HTTP ${status}: ${statusText}`)
//       2. 如果网络错误，catch 后 throw new Error(`网络错误: ${originalMessage}`)

// --- 你的代码 ---



// 测试（取消注释）
// safeFetch("https://httpbingo.org/status/404").catch(err =>
//   console.log("练习4 预期错误:", err.message)
// );
// safeFetch("https://httpbingo.org/get").then(res =>
//   console.log("练习4 成功:", res.status)
// );

// ============================================================
// 练习 5：读取 DotEnv
// ============================================================

// TODO: 用 dotenv 包加载 .env 文件，读取 DEEPSEEK_API_KEY
//       然后打印 "API Key loaded: sk-****"（只显示前 3 个字符，其余打码）
//       提示：import "dotenv/config" 自动把 .env 加载到 process.env

// --- 你的代码 ---



// ============================================================
// 按顺序运行所有练习
// ============================================================

async function main() {
  // 练习 1（待完成）
  // 练习 2（待完成）
  // 练习 3（待完成）
  // 练习 4（待完成）
  // 练习 5（待完成）

  console.log("\n💡 全部完成后取消底部参考答案对比。")
}

main()

// ============================================================
// 参考答案（先自己做！）
// ============================================================

/*
// ============================================================
// 练习 1
// ============================================================
async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

// ============================================================
// 练习 2
// ============================================================
interface Post {
  id: number;
  title: string;
  body: string;
  userId: number;
}

async function createPost(
  title: string,
  body: string,
  userId: number
): Promise<Post> {
  const response = await fetch("https://jsonplaceholder.typicode.com/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, body, userId }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`创建失败: ${errText}`);
  }

  return response.json();
}

// ============================================================
// 练习 3
// ============================================================
async function countChunks(url: string): Promise<number> {
  const response = await fetch(url);
  if (!response.body) throw new Error("No body");

  const reader = response.body.getReader();
  let count = 0;

  while (true) {
    const { done } = await reader.read();
    if (done) break;
    count++;
  }

  return count;
}

// ============================================================
// 练习 4
// ============================================================
async function safeFetch(
  url: string,
  options?: RequestInit
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error(`网络错误: ${(error as Error).message}`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response;
}

// ============================================================
// 练习 5
// ============================================================
import "dotenv/config";

const key = process.env.DEEPSEEK_API_KEY ?? "";
if (key) {
  const masked = key.slice(0, 3) + "*".repeat(Math.max(key.length - 3, 0));
  console.log(`API Key loaded: ${masked}`);
} else {
  console.log("⚠️ 未找到 DEEPSEEK_API_KEY，请检查 .env 文件");
}
*/
