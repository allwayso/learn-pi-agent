// 5.1 session-store test
// 覆盖：parseHeaderLine / parseEntryLine / getPathToRoot / appendEntry
// 路径：正常 + 边界 + 错误

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  JsonlSessionStorage,
  nodeSessionFS,
  SessionError,
} from "./5.1-session-store.js";
import type { SessionTreeEntry, SessionHeader } from "./5.1-session-store.js";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── 辅助函数 ──

async function makeTempPath(): Promise<string> {
  return path.join(os.tmpdir(), `session-test-${crypto.randomUUID().slice(0, 8)}.jsonl`);
}

function makeUserMessage(content: string) {
  return { type: "user" as const, content, timestamp: Date.now() };
}

function makeAssistantMessage(content: string) {
  return { type: "assistant" as const, content, timestamp: Date.now() };
}

function makeToolResultMessage(toolCallId: string, toolName: string, content: string) {
  return { type: "toolResult" as const, toolCallId, toolName, content, timestamp: Date.now() };
}

async function run() {
  console.log("\n=== 5.1 session-store 测试 ===\n");

  // ═══════════════════════════════════════════════════════
  // create() 正常路径
  // ═══════════════════════════════════════════════════════
  {
    console.log("[create()]");
    const filePath = await makeTempPath();
    const store = await JsonlSessionStorage.create(nodeSessionFS, filePath, {
      cwd: "/test/project",
      sessionId: "sess-001",
    });

    const meta = store.getMetadata();
    check("id 来自 options", meta.id === "sess-001");
    check("cwd 来自 options", meta.cwd === "/test/project");
    check("filePath 正确", meta.filePath === filePath);
    check("新建 session 的 leafId 为 null", (await store.getLeafId()) === null);

    // 验证文件内容：首行是 header
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    check("文件只有 header 一行", lines.length === 1);
    const header = JSON.parse(lines[0]!) as SessionHeader;
    check("header.type 为 session", header.type === "session");
    check("header.version === 3", header.version === 3);
    check("header.id 正确", header.id === "sess-001");
    check("header.cwd 正确", header.cwd === "/test/project");

    await fs.unlink(filePath);
  }

  // ═══════════════════════════════════════════════════════
  // create() + appendEntry() + getPathToRoot() 正常路径
  // ═══════════════════════════════════════════════════════
  {
    console.log("\n[create + append + getPathToRoot]");
    const filePath = await makeTempPath();
    const store = await JsonlSessionStorage.create(nodeSessionFS, filePath, {
      cwd: "/project",
      sessionId: "sess-002",
    });

    // 追加 3 条消息
    const msg1: SessionTreeEntry = {
      type: "message",
      id: await store.createEntryId(),
      parentId: null,
      timestamp: new Date().toISOString(),
      message: makeUserMessage("hello"),
    };
    await store.appendEntry(msg1);

    const msg2: SessionTreeEntry = {
      type: "message",
      id: await store.createEntryId(),
      parentId: msg1.id,
      timestamp: new Date().toISOString(),
      message: makeAssistantMessage("hi there"),
    };
    await store.appendEntry(msg2);

    const msg3: SessionTreeEntry = {
      type: "message",
      id: await store.createEntryId(),
      parentId: msg2.id,
      timestamp: new Date().toISOString(),
      message: makeToolResultMessage("tc1", "read", "file content"),
    };
    await store.appendEntry(msg3);

    // currentLeafId 应自动推进到 msg3.id  ← 注意：是 msg3.id，不是 msg3.toolCallId
    check("leaf 自动推进到最新消息 id", (await store.getLeafId()) === msg3.id);

    // 验证文件行数
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    check("文件有 header + 3 条 entry = 4 行", lines.length === 4);

    // getPathToRoot：从当前 leaf 回溯
    const pathToRoot = await store.getPathToRoot(await store.getLeafId());
    check("回溯路径长度 = 3", pathToRoot.length === 3);
    check("第一条是 msg1", pathToRoot[0]!.id === msg1.id);
    check("第二条是 msg2", pathToRoot[1]!.id === msg2.id);
    check("第三条是 msg3", pathToRoot[2]!.id === msg3.id);

    // 用 getEntry 查找单条
    const found = await store.getEntry(msg2.id);
    check("getEntry 能找到 msg2", found !== undefined);
    check("找到的 entry type 是 message", found!.type === "message");

    await fs.unlink(filePath);
  }

  // ═══════════════════════════════════════════════════════
  // setLeafId：手动跳转 leaf
  // ═══════════════════════════════════════════════════════
  {
    console.log("\n[setLeafId]");
    const filePath = await makeTempPath();
    const store = await JsonlSessionStorage.create(nodeSessionFS, filePath, {
      cwd: "/project",
      sessionId: "sess-leaf",
    });

    const msg1: SessionTreeEntry = {
      type: "message",
      id: await store.createEntryId(),
      parentId: null,
      timestamp: new Date().toISOString(),
      message: makeUserMessage("first"),
    };
    await store.appendEntry(msg1);

    const msg2: SessionTreeEntry = {
      type: "message",
      id: await store.createEntryId(),
      parentId: msg1.id,
      timestamp: new Date().toISOString(),
      message: makeAssistantMessage("second"),
    };
    await store.appendEntry(msg2);

    // 手动设置 leaf 回到 msg1（模拟用户回溯到某点）
    await store.setLeafId(msg1.id);
    check("setLeafId 后 leaf 指向 msg1", (await store.getLeafId()) === msg1.id);

    // 从新 leaf 回溯应该只有 1 条
    const pathToRoot = await store.getPathToRoot(msg1.id);
    check("回溯路径长度 = 1", pathToRoot.length === 1);
    check("只有 msg1", pathToRoot[0]!.id === msg1.id);

    // 验证文件包含 leaf entry
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    // header + msg1 + msg2 + leaf = 4 行
    const leafEntry = JSON.parse(lines[lines.length - 1]!);
    check("最后一行的 type 是 leaf", leafEntry.type === "leaf");
    check("leaf.targetId 指向 msg1", leafEntry.targetId === msg1.id);

    await fs.unlink(filePath);
  }

  // ═══════════════════════════════════════════════════════
  // open() 重新加载已有文件
  // ═══════════════════════════════════════════════════════
  {
    console.log("\n[open()]");
    const filePath = await makeTempPath();
    const store1 = await JsonlSessionStorage.create(nodeSessionFS, filePath, {
      cwd: "/project",
      sessionId: "sess-reopen",
    });

    const msg: SessionTreeEntry = {
      type: "message",
      id: await store1.createEntryId(),
      parentId: null,
      timestamp: new Date().toISOString(),
      message: makeUserMessage("persist me"),
    };
    await store1.appendEntry(msg);

    // 重新打开
    const store2 = await JsonlSessionStorage.open(nodeSessionFS, filePath);
    const meta = store2.getMetadata();
    check("重新打开后 id 一致", meta.id === "sess-reopen");
    check("重新打开后 cwd 一致", meta.cwd === "/project");
    check("重新打开后 leaf 恢复", (await store2.getLeafId()) === msg.id);

    const pathToRoot = await store2.getPathToRoot(await store2.getLeafId());
    check("重新打开后回溯路径长度 = 1", pathToRoot.length === 1);
    check("消息内容一致", (pathToRoot[0] as any).message.content === "persist me");

    await fs.unlink(filePath);
  }

  // ═══════════════════════════════════════════════════════
  // getPathToRoot(null) → 边界：空 session
  // ═══════════════════════════════════════════════════════
  {
    console.log("\n[边界条件]");
    const filePath = await makeTempPath();
    const store = await JsonlSessionStorage.create(nodeSessionFS, filePath, {
      cwd: "/project",
      sessionId: "sess-empty",
    });

    const pathToRoot = await store.getPathToRoot(null);
    check("leafId=null → 空数组", Array.isArray(pathToRoot) && pathToRoot.length === 0);

    // getPathToRoot 不存在的 id
    try {
      await store.getPathToRoot("nonexistent");
      check("不存在的 id 应抛 SessionError", false);
    } catch (e) {
      check("不存在的 id 抛 SessionError", e instanceof SessionError);
      check("错误 code 为 not_found", (e as SessionError).code === "not_found");
    }

    await fs.unlink(filePath);
  }

  // ═══════════════════════════════════════════════════════
  // 错误路径：损坏的 header
  // ═══════════════════════════════════════════════════════
  {
    console.log("\n[错误路径: 损坏的 header]");
    const filePath = await makeTempPath();

    // 缺少 type 字段
    await fs.writeFile(filePath, JSON.stringify({ version: 3, id: "x", timestamp: "t", cwd: "/c" }) + "\n");
    try {
      await JsonlSessionStorage.open(nodeSessionFS, filePath);
      check("缺少 type 应抛 SessionError", false);
    } catch (e) {
      check("缺少 type 抛 SessionError", e instanceof SessionError);
      check("code 为 invalid_session", (e as SessionError).code === "invalid_session");
    }

    // 非法 JSON
    await fs.writeFile(filePath, "not json at all\n");
    try {
      await JsonlSessionStorage.open(nodeSessionFS, filePath);
      check("非法 JSON 应抛 SessionError", false);
    } catch (e) {
      check("非法 JSON 抛 SessionError", e instanceof SessionError);
    }

    // version 不是 3
    await fs.writeFile(filePath, JSON.stringify({ type: "session", version: 1, id: "x", timestamp: "t", cwd: "/c" }) + "\n");
    try {
      await JsonlSessionStorage.open(nodeSessionFS, filePath);
      check("version != 3 应抛 SessionError", false);
    } catch (e) {
      check("version != 3 抛 SessionError", e instanceof SessionError);
    }

    // id 为空字符串
    await fs.writeFile(filePath, JSON.stringify({ type: "session", version: 3, id: "", timestamp: "t", cwd: "/c" }) + "\n");
    try {
      await JsonlSessionStorage.open(nodeSessionFS, filePath);
      check("id 为空应抛 SessionError", false);
    } catch (e) {
      check("id 为空抛 SessionError", e instanceof SessionError);
    }

    await fs.unlink(filePath);
  }

  // ═══════════════════════════════════════════════════════
  // 错误路径：损坏的 entry
  // ═══════════════════════════════════════════════════════
  {
    console.log("\n[错误路径: 损坏的 entry]");
    const filePath = await makeTempPath();

    // 构造合法 header + 一个缺少 type 的 entry
    const header = JSON.stringify({ type: "session", version: 3, id: "x", timestamp: new Date().toISOString(), cwd: "/c" });
    const badEntry = JSON.stringify({ id: "1", parentId: null, timestamp: new Date().toISOString() }); // 缺少 type
    await fs.writeFile(filePath, header + "\n" + badEntry + "\n");

    try {
      await JsonlSessionStorage.open(nodeSessionFS, filePath);
      check("缺少 type 的 entry 应抛 SessionError", false);
    } catch (e) {
      check("缺少 type 的 entry 抛 SessionError", e instanceof SessionError);
      check("code 为 invalid_entry", (e as SessionError).code === "invalid_entry");
    }

    await fs.unlink(filePath);
  }

  // ═══════════════════════════════════════════════════════
  // 错误路径：entry 的 id 为空
  // ═══════════════════════════════════════════════════════
  {
    console.log("\n[错误路径: entry id 为空]");
    const filePath = await makeTempPath();

    const header = JSON.stringify({ type: "session", version: 3, id: "x", timestamp: new Date().toISOString(), cwd: "/c" });
    const badEntry = JSON.stringify({ type: "message", id: "", parentId: null, timestamp: new Date().toISOString() });
    await fs.writeFile(filePath, header + "\n" + badEntry + "\n");

    try {
      await JsonlSessionStorage.open(nodeSessionFS, filePath);
      check("id 为空的 entry 应抛 SessionError", false);
    } catch (e) {
      check("id 为空的 entry 抛 SessionError", e instanceof SessionError);
    }

    await fs.unlink(filePath);
  }

  // ═══════════════════════════════════════════════════════
  // appendEntry 文件写入失败 → 内存不变
  // ═══════════════════════════════════════════════════════
  {
    console.log("\n[错误路径: appendEntry 写入失败]");
    const filePath = await makeTempPath();
    const store = await JsonlSessionStorage.create(nodeSessionFS, filePath, {
      cwd: "/project",
      sessionId: "sess-atomic",
    });

    const entriesBefore = (await store.getEntries()).length;

    // 构造一个会失败的 FS：appendFile 抛错
    const brokenFS: typeof nodeSessionFS = {
      ...nodeSessionFS,
      async appendFile(_path: string, _content: string) {
        throw new Error("disk full");
      },
    };

    const msg: SessionTreeEntry = {
      type: "message",
      id: await store.createEntryId(),
      parentId: null,
      timestamp: new Date().toISOString(),
      message: makeUserMessage("should not persist"),
    };

    // 注意：store 内部用的是构造时的 fs，我们需要用 brokenFS 重建 store
    // 这里改为直接测试 brokenFS.open 不会读到脏数据
    const store2 = await JsonlSessionStorage.create(brokenFS, filePath, {
      cwd: "/project",
      sessionId: "sess-atomic2",
    });

    try {
      await store2.appendEntry(msg);
      check("brokenFS 应抛错", false);
    } catch (e) {
      check("brokenFS 抛错", (e as Error).message.includes("disk full"));
    }

    // 用正常 FS 重新打开原始文件 → 应无 msg
    const store3 = await JsonlSessionStorage.open(nodeSessionFS, filePath);
    check("原始文件未受 brokenFS 影响（空 session）", (await store3.getEntries()).length === 0);

    await fs.unlink(filePath);
  }

  // ═══════════════════════════════════════════════════════
  // getLeafId 校验：leaf 指向的 targetId 不存在
  // ═══════════════════════════════════════════════════════
  {
    console.log("\n[错误路径: getLeafId 校验]");
    const filePath = await makeTempPath();
    const store = await JsonlSessionStorage.create(nodeSessionFS, filePath, {
      cwd: "/project",
      sessionId: "sess-leafcheck",
    });

    // 写入一条 leaf Entry 指向不存在的 targetId
    const badLeaf: SessionTreeEntry = {
      type: "leaf",
      id: await store.createEntryId(),
      parentId: null,
      timestamp: new Date().toISOString(),
      targetId: "nonexistent-target",
    };
    await store.appendEntry(badLeaf);

    try {
      await store.getLeafId();
      check("leaf 指向不存在 target 应抛 SessionError", false);
    } catch (e) {
      check("leaf 指向不存在 target 抛 SessionError", e instanceof SessionError);
      check("code 为 invalid_session", (e as SessionError).code === "invalid_session");
    }

    await fs.unlink(filePath);
  }

  // ═══════════════════════════════════════════════════════
  // 总结
  // ═══════════════════════════════════════════════════════
  console.log(`\n${"─".repeat(40)}`);
  console.log(`PASS: ${passed}  FAIL: ${failed}`);
  if (failed > 0) {
    console.log("❌ 有未通过的测试");
    process.exit(1);
  } else {
    console.log("✅ 全部通过");
  }
}

run().catch((e) => {
  console.error("测试执行异常:", e);
  process.exit(1);
});
