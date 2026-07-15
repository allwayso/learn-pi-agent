/**
 * 0.3 async.ts — async/await、Promise、错误处理
 *
 * 目标：掌握异步编程基础。agent loop 全程异步——
 * LLM 流式调用、工具执行、事件 emit 都是 async。
 * 运行：npx tsx learn-pi-agent/stage0-ts-basics/0.3-async.ts
 */

// ============================================================
// 辅助函数放前面（定义，不调用）
// ============================================================


/*  
Promise对象：
1.泛型： 通过<T>声明类型
2.三个状态：Pending，Fulfilled,Rejected
3.构造函数：new Promise<T>()为构造函数，有三个约定——必须以一个函数(executor)作为参数、
resolve和reject只能调用一次、executor同步执行而resolve/reject可以异步调用
4.executor：即传入构造函数的函数，没有任何强制约束，但是如果不调用reject或者resolve方法，
则永远停留在pending状态，所以应该通过合适的方式调用两个方法或者抛出异常作为函数出口
5.reject和resolve：接受任何参数值
*/

function fetchUser(id: number): Promise<string> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(`User #${id}`), 1000);
  });
}

async function riskyOperation(fail: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (fail) reject(new Error("操作失败！"));
      else resolve("操作成功");
    }, 500);
  });
}

async function fetchWithTimeout(id: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("已取消")); return; }
    signal?.addEventListener("abort", () => reject(new Error("已取消")));
    const timer = setTimeout(() => resolve(`User #${id}`), 3000);
    signal?.addEventListener("abort", () => clearTimeout(timer));
  });
}

// ============================================================
// 主流程 —— 所有示例按顺序跑，输出不混乱
// ============================================================

async function main() {
  console.log("=".repeat(50));

  // ---- 1. Promise 回调方式 ----

  /*
  1. .then()函数：接受一个函数作为参数，当promise状态变为fulfilled时候回调
  2. .catch()函数：接受
  */
  console.log("\n--- 1. Promise 回调方式 ---");
  await fetchUser(1).then((user) => {
    console.log("回调方式:", user);
    return fetchUser(2);
  }).then((user2) => {
    console.log("回调嵌套:", user2);
  });

  // ---- 2. async/await ★ ----

  /* 
  await 声明：
  1. 只能在async函数中使用
  2. 阻塞所在的async函数
  3. 不阻塞线程，继续执行所在async函数后的代码
  */

  console.log("\n--- 2. async/await ---");
  console.log("开始加载用户...");
  const user1 = await fetchUser(3);
  console.log("  加载到:", user1);
  const user2 = await fetchUser(4);
  console.log("  加载到:", user2);
  console.log(`全部加载完成！结果: [${user1}, ${user2}]`);

  // ---- 3. 并行执行 ★ ----
  console.log("\n--- 3. 并行执行 (Promise.all) ---");
  console.log("并行加载用户...");
  const start = Date.now();
  const [u3, u4] = await Promise.all([fetchUser(5), fetchUser(6)]);
  console.log(`并行结果: ${u3}, ${u4}（耗时 ${Date.now() - start}ms）`);
  // 对比：上面第 2 节串行是 2000ms，这里并行是 1000ms

  // ---- 4. 错误处理 ----
  console.log("\n--- 4. 错误处理 ---");

  // 4.1 成功
  try {
    const result = await riskyOperation(false);
    console.log("✅", result);
  } catch (error) {
    console.error("❌", (error as Error).message);
  }

  // 4.2 失败
  try {
    await riskyOperation(true);
  } catch (error) {
    console.error("❌", (error as Error).message);
  }

  // 4.3 finally
  try {
    await riskyOperation(false);
  } finally {
    console.log("清理资源（finally 总会执行）");
  }

  // ★ pi 的错误哲学：LLM 错误不 throw，编码进 event stream
  // AssistantMessage { stopReason: "error", errorMessage: "..." }
  // loop 检查 stopReason 决定继续还是退出

  // ---- 5. Promise 链 vs Await 链 ----
  console.log("\n--- 5. .then() 链 vs async/await 链 ---");
  await fetchUser(7)
    .then((u) => { console.log("链式 then:", u); return fetchUser(8); })
    .then((u) => console.log("链式 then:", u))
    .catch((err) => console.error("链式 catch:", err));

  {
    const u1 = await fetchUser(9);
    console.log("async 链:", u1);
    const u2 = await fetchUser(10);
    console.log("async 链:", u2);
  }

  // ---- 6. AbortController ★ ----
  console.log("\n--- 6. AbortController ---");
  const controller = new AbortController();
  setTimeout(() => { console.log("⏹ 发送取消信号..."); controller.abort(); }, 1500);

  try {
    const user = await fetchWithTimeout(99, controller.signal);
    console.log("拿到结果:", user);
  } catch (error) {
    console.log("被取消:", (error as Error).message);
  }

  // ★ AbortSignal 在 pi 中全程传播：agent loop → LLM stream → tool execute

  console.log("\n" + "=".repeat(50));
  console.log("✅ 所有异步示例运行完成");
}

main();
