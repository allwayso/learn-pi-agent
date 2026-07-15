/**
 * 0.3 练习题 —— async/await、Promise、错误处理
 *
 * 每个 TODO 都是一个练习。建议逐个完成、逐个运行验证。
 * 参考答案在本文件末尾（注释掉），先自己做再看答案。
 *
 * 运行：npx tsx learn-pi-agent/stage0-ts-basics/0.3-exercises.ts
 */

// ============================================================
// 辅助函数（和 0.3-async.ts 里一样的 fetchUser）
// ============================================================

function fetchUser(id: number): Promise<string> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(`User #${id}`), 500);
  });
}

function fetchUserMayFail(id: number): Promise<string> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (id < 0) reject(new Error(`Invalid id: ${id}`));
      else resolve(`User #${id}`);
    }, 300);
  });
}

// ============================================================
// 练习 1：基础 async/await
// ============================================================

// TODO: 写一个 async 函数 loadThreeUsers，
//       依次 await fetchUser(1)、fetchUser(2)、fetchUser(3)
//       返回三人的数组，打印"加载了 N 个用户"

// --- 你的代码 ---

async function loadThreeUsers():Promise<string[]>{
  const user1=await fetchUser(1)
  const user2=await fetchUser(2)
  const user3=await fetchUser(3)
  console.log("加载了3个用户",user1,user2,user3)
  return [user1,user2,user3]
}

// ============================================================
// 按顺序运行所有练习
// ============================================================

async function main() {
  // 练习 1
  console.log("\n--- 练习 1：基础 async/await ---")
  await loadThreeUsers()

  // 练习 2
  console.log("\n--- 练习 2：try/catch ---")
  console.log(await safeFetch(-1))
  console.log(await safeFetch(1))

  // 练习 3
  console.log("\n--- 练习 3：串行 vs 并行 ---")
  await fetchSequential()
  await fetchParallel()

  // 练习 4
  console.log("\n--- 练习 4：超时取消 ---")
  console.log("Promise.race 版（100ms 超时）:", await fetchWithTimeoutRace(1, 100))
  console.log("Promise.race 版（1000ms 超时）:", await fetchWithTimeoutRace(1, 1000))
  console.log("AbortController 版（1000ms 超时）:", await fetchWithTimeoutSignal(1, 1000))
  console.log("AbortController 版（100ms 超时）:", await fetchWithTimeoutSignal(1, 100))

  // 练习 5
  console.log("\n--- 练习 5：循环重试 ---")
  console.log(await fetchWithRetry(1, 2))          // 成功：一次过
  try {
    await fetchWithRetry(-1, 2)                     // 失败：3 次全 fail，throw
  } catch (error) {
    console.log("全部重试失败:", (error as Error).message)
  }
  console.log("\n💡 全部完成后取消底部参考答案对比。")
}

main()

// ============================================================
// 练习 2：try/catch
// ============================================================

async function safeFetch(id:number):Promise<string>{
  try{
    const user1=await fetchUserMayFail(id)
    return `OK:${user1}`
  }catch(error){
    return `Fail:${(error as Error).message}`
  }
}

// ============================================================
// 练习 3：并行 vs 串行
// ============================================================

async function fetchSequential(){
  console.log("串行加载用户")
  const start=Date.now()
  for (let i = 1; i <= 5; i++) {
     const user = await fetchUser(i)
     console.log(user)
   }
  console.log(`串行耗时 ${Date.now() - start}ms`)
}

async function fetchParallel(){
  console.log("并行加载用户")
  const start=Date.now()
  const results = await Promise.all([1, 2, 3, 4, 5].map(fetchUser))
  console.log(`并行耗时 ${Date.now() - start}ms`)
}

// ============================================================
// 练习 4：超时取消
// ============================================================

// TODO: 写一个 async 函数 fetchWithTimeout，
//       接收 id 和 timeoutMs，调用 fetchUser(id)
//       如果在 timeoutMs 毫秒内完成，返回结果
//       如果超时，返回 "TIMEOUT"
//       提示：用 Promise.race 或 AbortController

// --- 你的代码 ---

// Promise.race:接受任意多个promise对象，返回与第一个结束的promise相同结果的promise
// 即如果第一个完成的promise结果为settle，那么返回的promise也是settle，但是这个promise与数组中任意一个都不一样
// 一般的使用方式为：让计时器和被监测对象赛跑，计时器在一定时间后reject，如果计时器跑赢则结果为reject，否则为resolve
async function fetchWithTimeoutRace(id:number,timeoutMs:number){
  // 注意promise构造函数默认第一个为resolve，第二个为reject，如果不用_占位，则虽然写了reject，实际内部为resolve
  const timer=new Promise<string>((_,reject)=>
  setTimeout(()=>reject(new Error("TIMEOUT")),timeoutMs)
  )

  try{
    // 计时器和对象赛跑
    return await Promise.race([fetchUser(id),timer])
  }catch{
    return "TIMEOUT"
  }
}

// AbortController 超时控制：
// 1.创建一个AbortController对象controller
// 2.设置一个timer，到达设定时间后执行controller.abort
// 3.将controller的signal传入目标函数
// 4.若abort信号在传入时已经aborted，目标函数即刻reject
// 5.若进入时abort尚未取消，则设置一个监听器addEventListener监听signal，当abort操作触发，目标函数即刻reject
function fetchUserAbortable(id:number,signal:AbortSignal):Promise<string>{
  return new Promise((resolve,reject)=>{
    if(signal.aborted) {reject(new Error("TIMEOUT"))}
    signal.addEventListener("abort",()=>reject(new Error("TIMEOUT")))
    const timer=setTimeout(()=>resolve(`User #${id}`),500)
    signal.addEventListener("abort",()=>clearTimeout(timer))
  })
}

async function fetchWithTimeoutSignal(id: number, timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const user = await fetchUserAbortable(id, controller.signal)
    clearTimeout(timer)  // 成功了，清理定时器
    return user
  } catch {
    return "TIMEOUT"
  }
}

// ============================================================
// 练习 5：重试机制
// ============================================================

// TODO: 写一个 async 函数 fetchWithRetry，
//       接收 id 和 maxRetries
//       调用 fetchUserMayFail(id)，失败时重试，最多重试 maxRetries 次
//       全部失败后返回最后一次的错误信息
//       提示：for 循环 + try/catch，失败继续循环，成功立即返回

// --- 你的代码 ---


async function fetchWithRetry(id:number,maxRetries:number):Promise<string>{
  // 这里为什么从0开始：最大重试次数+1=实际尝试次数，初始调用不计入重试次数
  for(let i=0;i<=maxRetries;i++){
    try{
      return await fetchUserMayFail(id)
    }catch(error){
      if(i==maxRetries) throw error
    }
  }
  // 实际上永远不会执行这个语句，但是ts不够智能：
  // 当声明返回类型为Promise类型时，编辑器并不能确定for循环一定会return或throw，所以需要一个for外的throw兜底
  throw new Error("不可达")
}

// ============================================================
// 参考答案（先自己做！）
// ============================================================

/*
// ============================================================
// 练习 1
// ============================================================
async function loadThreeUsers(): Promise<string[]> {
  const u1 = await fetchUser(1);
  const u2 = await fetchUser(2);
  const u3 = await fetchUser(3);
  const users = [u1, u2, u3];
  console.log(`加载了 ${users.length} 个用户:`, users);
  return users;
}
loadThreeUsers();

// ============================================================
// 练习 2
// ============================================================
async function safeFetch(id: number): Promise<string> {
  try {
    const user = await fetchUserMayFail(id);
    return `OK: ${user}`;
  } catch (error) {
    return `FAIL: ${(error as Error).message}`;
  }
}
safeFetch(1).then(console.log);   // OK: User #1
safeFetch(-1).then(console.log);  // FAIL: Invalid id: -1

// ============================================================
// 练习 3
// ============================================================
async function fetchSequential(): Promise<string[]> {
  const start = Date.now();
  const results: string[] = [];
  for (const id of [1, 2, 3, 4, 5]) {
    results.push(await fetchUser(id));
  }
  console.log(`串行耗时: ${Date.now() - start}ms`);
  return results;
}

async function fetchParallel(): Promise<string[]> {
  const start = Date.now();
  const results = await Promise.all([1, 2, 3, 4, 5].map(fetchUser));
  console.log(`并行耗时: ${Date.now() - start}ms`);
  return results;
}

fetchSequential();  // ~2500ms
fetchParallel();    // ~500ms

// ============================================================
// 练习 4
// ============================================================
async function fetchWithTimeout(id: number, timeoutMs: number): Promise<string> {
  const timer = new Promise<string>((_, reject) =>
    setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs)
  );
  try {
    return await Promise.race([fetchUser(id), timer]);
  } catch {
    return "TIMEOUT";
  }
}
fetchWithTimeout(1, 100).then(console.log);  // TIMEOUT (fetchUser 要 500ms)
fetchWithTimeout(1, 1000).then(console.log); // User #1

// ============================================================
// 练习 5
// ============================================================
async function fetchWithRetry(id: number, maxRetries: number): Promise<string> {
  let lastError: Error | undefined;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fetchUser(id);
    } catch (error) {
      lastError = error as Error;
      console.log(`第 ${i + 1} 次失败: ${lastError.message}`);
    }
  }
  throw lastError ?? new Error("Unknown error");
}

fetchWithRetry(1, 2).then(console.log);   // 一次就成功
fetchWithRetry(-1, 2).catch(console.error); // 全部失败
*/
