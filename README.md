# learn-pi-agent

> 逐层拆解 [pi agent](https://github.com/earendil-works/pi-mono)，用 Python 手写一个完整的 agent 运行时。

## 这是什么

一个 **Agent 学习仓库**——通过阅读 pi agent（极简但完整的现代 TypeScript agent 运行时）的源码，逐层用 Python 复刻其核心架构。终极目标：能手写出 pi agent 的主干代码，并理解每一个架构决策的"为什么"。

## pi agent 是什么

[pi agent](https://github.com/earendil-works/pi-mono) 是一个 MIT 协议的开源 agent 运行时，claude.ai/code 背后的核心范式之一。架构分 4 层：

| 层 | 职责 |
|----|------|
| `pi-ai` | 统一 30+ LLM 厂商 API |
| `pi-agent-core` | Agent loop + Agent 类 + Harness |
| `pi-coding-agent` | 交互式 CLI 编程 agent |
| `pi-tui` / `pi-orchestrator` | 终端 UI / 多 agent 编排 |

本仓库聚焦于 `pi-agent-core` 的学习和 Python 复刻。

## 学习路线

8 个阶段，逐层递进：

```
阶段 1：LLM 调用基础        → requests → streaming → retry
阶段 2：Tool Call           → 让 LLM 调用函数，并行/串行执行
阶段 3：Agent Loop ★        → 手写 pi 的核心循环（双层 while + 事件系统）
阶段 4：Agent 类            → 状态管理 + 消息队列 + Hook + abort
阶段 5：Harness 层          → 会话持久化 + 系统提示词 + Skills
阶段 6：上下文工程          → 窗口管理 + 压缩 + 分支摘要
阶段 7：扩展话题            → 子 Agent + MCP + Orchestrator
阶段 8：综合复刻 ★          → ~500 行完整 pi 主干
```

详见 [CLAUDE.md](CLAUDE.md) 中的完整路线。

## 目录

```
agent/
├── learn-pi-agent/      # ★ 所有阶段代码（Python）
│   ├── notes/           # 跨阶段架构笔记
│   ├── stage1-llm-basics/
│   ├── stage2-tool-call/
│   ├── ...
│   └── stage8-pi-core/
├── ReAct/               # ReAct 论文学习笔记
├── pi/                  # pi agent 源码（只读参照）
├── CLAUDE.md            # 详细学习计划
└── README.md
```

## 环境

- Python 3.9+
- DeepSeek API（OpenAI 兼容）
- 阶段 1 用 `requests`，阶段 2.2 起用 `openai` SDK

```bash
# 安装依赖
pip install requests openai python-dotenv tiktoken

# 配置 API Key
echo "DEEPSEEK_API_KEY=你的key" > .env
```

## 进度

- [x] ReAct 论文精读
- [x] pi agent 源码结构理解
- [ ] 阶段 1：LLM 调用基础
- [ ] 阶段 2：Tool Call
- [ ] 阶段 3：Agent Loop
- [ ] 阶段 4：Agent 类
- [ ] 阶段 5：Harness 层
- [ ] 阶段 6：上下文工程
- [ ] 阶段 7：扩展话题
- [ ] 阶段 8：综合复刻

## 参考

- [pi agent](https://github.com/earendil-works/pi-mono) — 主要参照
- [hello-agents](https://github.com/datawhalechina/hello-agents) — 教程组织方式
- [ai-agents-from-scratch](https://github.com/pguso/ai-agents-from-scratch) — 渐进粒度
- [minimal-agent](https://github.com/Antropath/minimal-agent) — ~100 行极简 agent loop
