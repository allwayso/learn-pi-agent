// 5.1 session-store.ts — JSONL 追加式会话存储
// 对标 pi：harness/session/jsonl-storage.ts + session/session.ts
//
// 核心概念：Entry 树 + parentId 链。
//   会话不是一个消息数组，而是一棵 Entry 树。每个 Entry 有 parentId 指向前一个 Entry，
//   形成从 root 到 leaf 的链。leaf Entry 标记"当前对话走到了哪个位置"。
//   分支支持：用户回到某个点重新提问 → 产生新链，旧链数据保留。
//
// 存储格式：JSONL（每行一个 JSON 对象）。
//   第一行是 SessionHeader，后面每行是一个 SessionTreeEntry。
//   追加一行只需 appendFile，永远不需要重写整个文件。
//
// 简化：pi 有 11 种 Entry 类型，我们只用 2 种核心类型（message + leaf），
//   足够演示完整的"存储 → 追加 → 回溯"闭环。
//
// 引入的新模式：
//   - SessionError：存储层专用错误，带 code（便于上层按错误类型决策）
//   - Minimal FS 接口：不依赖 Node.js 特定 API，便于测试 mock
//
// TODO 清单：
//   parseHeaderLine       — 解析首行 JSON → SessionHeader，校验必需字段
//   parseEntryLine        — 解析一行 JSON → SessionTreeEntry，根据 type 字段区分
//   getPathToRoot         — 沿 parentId 链从 leaf 回溯到 root
//   appendEntry           — 追加一行 JSON + 更新 byId / entries / currentLeafId

import * as fs from "fs/promises";
import type { AgentMessage } from "../stage4-agent-class/4.2-message-layer.js";

// ═══════════════════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════════════════

/** JSONL 文件第一行——session 元信息。对标 pi：SessionHeader。 */
export interface SessionHeader {
  type: "session";
  /* Session 格式的版本 */
  version: 3;
  id: string;
  timestamp: string;
  /**
   * current working directory——创建 session 时 agent 的工作目录（绝对路径）。
   * agent 执行命令、读写文件都依赖它，恢复 session 时需要还原这个上下文。
   */
  cwd: string;
  /** 如果这个 session 是从另一个 session fork 出来的，记录来源文件路径 */
  parentSession?: string;
  /** 应用层挂任意数据的口袋字段（存放可拓展消息而不必修改SessionHeader字段） */
  metadata?: Record<string, unknown>;
}

/** 一条 AgentMessage 的持久化包装。对标 pi：MessageEntry。 */
export interface MessageEntry {
  type: "message";
  id: string;
  /** 指向前一条 Entry 的 id。null 表示这是 session 的第一条消息。 */
  parentId: string | null;
  timestamp: string;
  message: AgentMessage;
}

/** 标记会话当前的"读取位置",指向当前最新位置。对标 pi：LeafEntry。 */
export interface LeafEntry {
  type: "leaf";
  id: string;
  parentId: string | null;
  timestamp: string;
  /** 指向目标 Entry 的 id。null 表示回到 session 开头（第一条消息之前）。 */
  targetId: string | null;
}

/** 本课用的 Entry 类型联合。后续阶段扩张。 */
export type SessionTreeEntry = MessageEntry | LeafEntry;

/** 会话元信息的只读视图 */
export interface SessionMetadata {
  id: string;
  createdAt: string;
  cwd: string;
  /** JSONL 文件的绝对路径 */
  filePath: string;
  parentSessionPath?: string;
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SessionError — 存储层专用错误
// ═══════════════════════════════════════════════════════════════════════════════

/** 错误码枚举。上层可根据 code 决定处理方式，比 instanceof 更稳定。 */
export type SessionErrorCode =
  | "not_found"
  | "invalid_session"
  | "invalid_entry"
  | "storage"
  | "unknown";

/** 存储层专用错误，带稳定 code。对标 pi：harness/types.ts SessionError */
export class SessionError extends Error {
  /** 稳定错误码，不可变 */
  public code: SessionErrorCode;

  constructor(code: SessionErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SessionError";
    this.code = code;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 最小文件系统接口
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * JsonlSessionStorage 需要的文件系统操作，可 mock、可替换后端。
 */
export interface SessionFS {
  readTextFile(path: string): Promise<string>;
  readTextLines(path: string, options?: { maxLines?: number }): Promise<string[]>;
  writeFile(path: string, content: string): Promise<void>;
  appendFile(path: string, content: string): Promise<void>;
}

/** Node.js fs/promises 适配器 */
export const nodeSessionFS: SessionFS = {
  async readTextFile(path: string) {
    return fs.readFile(path, "utf-8");
  },
  async readTextLines(path: string, options?: { maxLines?: number }) {
    const content = await fs.readFile(path, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    if (options?.maxLines !== undefined) {
      return lines.slice(0, options.maxLines);
    }
    return lines;
  },
  async writeFile(path: string, content: string) {
    await fs.writeFile(path, content, "utf-8");
  },
  async appendFile(path: string, content: string) {
    await fs.appendFile(path, content, "utf-8");
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 判断一条 Entry 追加后 leaf 应指向哪里。
 * - 非 leaf：自动推进到该 Entry 的 id
 * - leaf：按 targetId 跳转
 */
function leafIdAfterEntry(entry: SessionTreeEntry): string | null {
  if (entry.type === "leaf") return entry.targetId;
  return entry.id;
}

/** 生成短 ID（8 位 hex） */
function generateEntryId(): string {
  return crypto.randomUUID().slice(-8);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TODO 1: parseHeaderLine — 解析首行 JSON 为 SessionHeader
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 解析 JSONL 首行，校验并返回 SessionHeader。
 * 必需字段：type="session"、version=3、id、timestamp、cwd。
 */
function parseHeaderLine(line: string, filePath: string): SessionHeader {
  // TODO:
  //   - JSON.parse → 失败抛 invalid_session
  //   - 校验 type/version/id/timestamp/cwd
  //   - 校验 parentSession（如有）是 string，metadata（如有）是 object
  //   - 返回 SessionHeader

  // ========== YOUR CODE HERE ==========
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new SessionError(
      "invalid_session",
      `Invalid JSON in session header ${filePath}`,
      error instanceof Error ? error : undefined,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new SessionError("invalid_session", `Session header is not an object in ${filePath}`);
  }
  const h = parsed as Record<string, unknown>;
  if (h.type !== "session") {
    throw new SessionError("invalid_session", `Missing or invalid session type in ${filePath}`);
  }
  if (h.version !== 3) {
    throw new SessionError("invalid_session", `Unsupported session version in ${filePath}`);
  }
  if (typeof h.id !== "string" || !h.id) {
    throw new SessionError("invalid_session", `Session header missing id in ${filePath}`);
  }
  if (typeof h.timestamp !== "string" || !h.timestamp) {
    throw new SessionError("invalid_session", `Session header missing timestamp in ${filePath}`);
  }
  if (typeof h.cwd !== "string" || !h.cwd) {
    throw new SessionError("invalid_session", `Session header missing cwd in ${filePath}`);
  }
  // parentSession 可选，但如果存在必须是 string
  if (h.parentSession !== undefined && typeof h.parentSession !== "string") {
    throw new SessionError("invalid_session", `Session header parentSession must be a string in ${filePath}`);
  }
  // metadata 可选，但如果存在必须是 object（非 null、非数组）
  if (h.metadata !== undefined && (typeof h.metadata !== "object" || h.metadata === null || Array.isArray(h.metadata))) {
    throw new SessionError("invalid_session", `Session header metadata must be an object in ${filePath}`);
  }
  return {
    type: "session",
    version: 3,
    id: h.id as string,
    timestamp: h.timestamp as string,
    cwd: h.cwd as string,
    parentSession: h.parentSession as string | undefined,
    metadata: h.metadata as Record<string, unknown> | undefined,
  };
  // ========== END YOUR CODE ==========
}

// ═══════════════════════════════════════════════════════════════════════════════
// TODO 2: parseEntryLine — 解析一行 JSON 为 SessionTreeEntry
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 解析 JSONL 中的一行 Entry，根据 type 字段区分种类。
 */
function parseEntryLine(
  line: string,
  filePath: string,
  lineNumber: number,
): SessionTreeEntry {
  // TODO:
  //   - JSON.parse → 失败抛 invalid_entry
  //   - 校验 type/id/timestamp 存在且类型正确
  //   - parentId 允许 null 或 string
  //   - leaf 类型额外校验 targetId
  //   - 返回 parsed as SessionTreeEntry

  // ========== YOUR CODE HERE ==========
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new SessionError(
      "invalid_entry",
      `Invalid JSON at line ${lineNumber} in ${filePath}`,
      error instanceof Error ? error : undefined,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new SessionError("invalid_entry", `Entry at line ${lineNumber} is not an object in ${filePath}`);
  }
  const e = parsed as Record<string, unknown>;
  if (typeof e.type !== "string") {
    throw new SessionError("invalid_entry", `Entry at line ${lineNumber} missing type in ${filePath}`);
  }
  if (typeof e.id !== "string" || !e.id) {
    throw new SessionError("invalid_entry", `Entry at line ${lineNumber} missing id in ${filePath}`);
  }
  if (e.parentId !== null && typeof e.parentId !== "string") {
    throw new SessionError("invalid_entry", `Entry at line ${lineNumber} invalid parentId in ${filePath}`);
  }
  if (typeof e.timestamp !== "string" || !e.timestamp) {
    throw new SessionError("invalid_entry", `Entry at line ${lineNumber} missing timestamp in ${filePath}`);
  }
  // leaf 类型额外校验
  if (e.type === "leaf" && e.targetId !== null && typeof e.targetId !== "string") {
    throw new SessionError("invalid_entry", `Leaf entry at line ${lineNumber} invalid targetId in ${filePath}`);
  }
  return parsed as SessionTreeEntry;
  // ========== END YOUR CODE ==========
}

// ═══════════════════════════════════════════════════════════════════════════════
// JsonlSessionStorage 类
// ═══════════════════════════════════════════════════════════════════════════════

/** JSONL 文件会话存储。对标 pi：harness/session/jsonl-storage.ts */
export class JsonlSessionStorage {
  /** 文件系统后端，可 mock */
  private fs: SessionFS;
  /** JSONL 文件的绝对路径 */
  private filePath: string;
  private metadata: SessionMetadata;
  /** 内存中的 Entry 列表，按追加顺序，与文件 1:1 对应 */
  private entries: SessionTreeEntry[];
  /** id → Entry 哈希表，O(1) 查找 */
  private byId: Map<string, SessionTreeEntry>;
  /** 当前 leaf 指向的目标 id。null = 无活跃消息。 */
  private currentLeafId: string | null;

  private constructor(
    fs: SessionFS,
    filePath: string,
    header: SessionHeader,
    entries: SessionTreeEntry[],
    leafId: string | null,
  ) {
    this.fs = fs;
    this.filePath = filePath;
    this.metadata = {
      id: header.id,
      createdAt: header.timestamp,
      cwd: header.cwd,
      filePath,
      parentSessionPath: header.parentSession,
      metadata: header.metadata,
    };
    this.entries = entries;
    this.byId = new Map(entries.map((e) => [e.id, e]));
    this.currentLeafId = leafId;
  }

  // ── 工厂方法 ──

  /** 打开已有 JSONL 文件，全量解析后返回实例 */
  static async open(fs: SessionFS, filePath: string): Promise<JsonlSessionStorage> {
    const content = await fs.readTextFile(filePath);
    const lines = content.split("\n").filter((l) => l.trim());
    if (lines.length === 0) {
      throw new SessionError("invalid_session", `Missing session header in ${filePath}`);
    }

    const header = parseHeaderLine(lines[0]!, filePath);
    const entries: SessionTreeEntry[] = [];
    let leafId: string | null = null;

    for (let i = 1; i < lines.length; i++) {
      const entry = parseEntryLine(lines[i]!, filePath, i + 1);
      entries.push(entry);
      leafId = leafIdAfterEntry(entry);
    }

    return new JsonlSessionStorage(fs, filePath, header, entries, leafId);
  }

  /**
   * 创建新 JSONL 文件，写入 header 行后返回实例。
   *
   * header 行 = 一行 JSON，包含 type/version/id/timestamp/cwd。
   * 后续所有 Entry 追加在这行后面。
   */
  static async create(
    fs: SessionFS,
    filePath: string,
    options: { cwd: string; sessionId: string; parentSessionPath?: string; metadata?: Record<string, unknown> },
  ): Promise<JsonlSessionStorage> {
    const header: SessionHeader = {
      type: "session",
      version: 3,
      id: options.sessionId,
      timestamp: new Date().toISOString(),
      cwd: options.cwd,
      parentSession: options.parentSessionPath,
      metadata: options.metadata,
    };
    await fs.writeFile(filePath, JSON.stringify(header) + "\n");
    return new JsonlSessionStorage(fs, filePath, header, [], null);
  }

  // ── 实例方法 ──

  /** 返回 session 元信息的只读视图（浅拷贝） */
  getMetadata(): SessionMetadata {
    return { ...this.metadata };
  }

  /** 返回当前 leaf 指向的 Entry id */
  async getLeafId(): Promise<string | null> {
    if (this.currentLeafId !== null && !this.byId.has(this.currentLeafId)) {
      throw new SessionError("invalid_session", `Leaf target ${this.currentLeafId} not found`);
    }
    return this.currentLeafId;
  }

  /** 修改当前 leaf 位置 */
  async setLeafId(leafId: string | null): Promise<void> {
    if (leafId !== null && !this.byId.has(leafId)) {
      throw new SessionError("not_found", `Entry ${leafId} not found`);
    }
    const entry: LeafEntry = {
      type: "leaf",
      id: generateEntryId(),
      parentId: this.currentLeafId,
      timestamp: new Date().toISOString(),
      targetId: leafId,
    };
    await this.fs.appendFile(this.filePath, JSON.stringify(entry) + "\n");
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    this.currentLeafId = leafId;
  }

  /** 生成一个不重复的 Entry id */
  async createEntryId(): Promise<string> {
    return generateEntryId();
  }

  /** 按 id 查找 Entry */
  async getEntry(id: string): Promise<SessionTreeEntry | undefined> {
    return this.byId.get(id);
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // TODO 3: getPathToRoot — 沿 parentId 链从 leaf 回溯到 root
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * 从指定 leafId 沿 parentId 链回溯到 root，返回 [根, ..., 叶]。
   * leafId 为 null 返回 []。
   */
  async getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]> {
    // TODO:
    //   - leafId 为 null → 返回 []
    //   - while 循环：unshift → parentId 为 null 时停止
    //   - 链上任一 id 找不到 → 抛 SessionError

    // ========== YOUR CODE HERE ==========
    if (leafId === null) return [];

    const path: SessionTreeEntry[] = [];
    let current = this.byId.get(leafId);
    if (!current) {
      throw new SessionError("not_found", `Entry ${leafId} not found`);
    }

    while (current) {
      path.unshift(current);
      if (current.parentId === null) break;
      const parent = this.byId.get(current.parentId);
      if (!parent) {
        throw new SessionError("invalid_session", `Parent entry ${current.parentId} not found`);
      }
      current = parent;
    }
    return path;
    // ========== END YOUR CODE ==========
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // TODO 4: appendEntry — 追加一行 JSON + 更新内存索引
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * 追加一条 Entry：先写文件（失败则内存不变），再更新 entries / byId / currentLeafId。
   */
  async appendEntry(entry: SessionTreeEntry): Promise<void> {
    // TODO:
    //   - 先写文件（await fs.appendFile）→ 失败则 throw，内存不变
    //   - 文件写入成功后更新内存：
    //     - entries.push(entry)
    //     - byId.set(entry.id, entry)
    //     - currentLeafId = leafIdAfterEntry(entry)

    // ========== YOUR CODE HERE ==========
    // 先写文件，失败则 throw，内存状态保持不变
    await this.fs.appendFile(this.filePath, JSON.stringify(entry) + "\n");

    // 文件写入成功后更新内存
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    this.currentLeafId = leafIdAfterEntry(entry);
    // ========== END YOUR CODE ==========
  }

  /** 返回所有 Entry 的浅拷贝 */
  async getEntries(): Promise<SessionTreeEntry[]> {
    return [...this.entries];
  }
}
