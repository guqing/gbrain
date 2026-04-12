<div align="center">

# exo

**你的外脑。个人知识管理 CLI + MCP 服务器。**

[![npm version](https://img.shields.io/npm/v/@guqings/exo?color=blue)](https://www.npmjs.com/package/@guqings/exo)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](#许可证)
[![Bun](https://img.shields.io/badge/runtime-Bun%201.x-orange)](https://bun.sh)

[English](README.md) | [中文](README.zh.md)

</div>

---

AI 编程对话一关闭，经验就消失了。ChatGPT 聊天记录越堆越多却无处安放。笔记积累但从不提醒过期。**exo 同时解决这三个问题。**

导入 ChatGPT 导出文件、PDF、图片和 Markdown 文件。让 LLM 将原始对话和会话编译成结构化知识页面。通过混合 FTS5 + 向量检索 + LLM 查询扩展搜索一切内容。作为 MCP 服务器接入 Claude Code 或 Cursor，让 AI 工具直接读写你的大脑。

## 目录

- [安装](#安装)
- [快速上手](#快速上手)
- [命令列表](#命令列表)
- [配置](#配置)
- [页面格式](#页面格式)
- [混合检索](#混合检索)
- [AI 摄取](#ai-摄取)
- [MCP 服务器](#mcp-服务器)
- [知识质量检查](#知识质量检查)
- [开发](#开发)

---

## 安装

```bash
bun install -g @guqings/exo
```

需要 [Bun](https://bun.sh) 1.x。

---

## 快速上手

```bash
# 初始化知识库（默认：~/.exo/brain.db）
exo init

# 配置 AI 提供商（兼容 OpenAI 接口）
exo config set embed.api_key sk-...
exo config set embed.base_url https://api.openai.com/v1
exo config set compile.api_key sk-...

# 快速记录想法（无需 LLM，即时完成）
exo capture "Redis 限流：令牌桶，每用户 100 req/s"

# 或者写一个完整页面
echo '---
title: Redis 限流
type: concept
tags: [redis, 后端]
---
令牌桶方案，每用户 100 req/s。用 INCR + EXPIRE 实现滑动窗口。
' | exo put concepts/redis-rate-limiting

# 关键词搜索
exo search "redis 限流"

# 混合检索（含 AI 查询扩展，需配置 embed）
exo query "如何防止 API 滥用"

# 读取页面
exo get concepts/redis-rate-limiting

# 一键接入 Claude Code / Cursor（只需配置一次）
exo setup-mcp
```

---

## 命令列表

### 基础操作

| 命令 | 说明 |
|------|------|
| `exo init [path]` | 创建 `brain.db`（默认：`~/.exo/brain.db`） |
| `exo get <slug>` | 以 Markdown 格式读取页面 |
| `exo put <slug>` | 写入或更新页面（从 stdin 或 `--file`） |
| `exo delete <slug>` | 删除页面 |
| `exo list` | 列出页面（`--type`、`--tag`、`--limit`） |
| `exo stats` | 知识库统计（页面数量、数据库大小） |
| `exo health` | 知识库健康度指标 |
| `exo config` | 查看和修改配置 |

### 检索

| 命令 | 说明 |
|------|------|
| `exo search <query>` | FTS5 关键词搜索（`--type`、`--limit`） |
| `exo query <question>` | 混合检索：FTS5 + 向量 RRF + LLM 查询扩展 |

### AI 摄取流水线

| 命令 | 说明 |
|------|------|
| `exo capture [text]` | 即时捕获笔记到收件箱（无需 LLM，<100ms） |
| `exo inbox` | 查看待处理的收件箱队列 |
| `exo compile` | 运行 LLM 流水线：收件箱 → 结构化知识页面 |
| `exo harvest` | 从 Claude Code / Copilot / Codex 会话日志中提取知识 |
| `exo digest <file>` | 从 ChatGPT 导出 JSON 导入对话 |
| `exo import-chatgpt <dir>` | 导入完整 ChatGPT 导出目录（对话 + 图片） |

### 文件与多模态

| 命令 | 说明 |
|------|------|
| `exo attach <slug> <file>` | 附加文件到页面（PDF、图片、DOCX、音频、视频） |
| `exo detach <slug> <file>` | 从页面移除附件 |
| `exo files` | 列出知识库中的所有文件 |
| `exo describe [file-slug]` | 用 AI 提取并嵌入文件内容（图片、PDF、DOCX、音频） |

### 嵌入与同步

| 命令 | 说明 |
|------|------|
| `exo embed` | 为页面生成向量嵌入（`--all`、`--rebuild`） |
| `exo sync <dir>` | 将 Markdown 目录同步到知识库 |
| `exo import <file\|dir>` | 导入 Markdown 文件或目录 |
| `exo export` | 将页面导出为 Markdown 文件 |

### 知识图谱

| 命令 | 说明 |
|------|------|
| `exo link <from> <to>` | 在两个页面之间创建交叉引用 |
| `exo unlink <from> <to>` | 移除交叉引用 |
| `exo backlinks <slug>` | 查看指向某个 slug 的所有页面 |
| `exo tag <slug> <tag>` | 为页面添加标签 |
| `exo untag <slug> <tag>` | 移除页面标签 |
| `exo tags [slug]` | 列出所有标签，或某个页面的标签 |
| `exo graph <slug>` | 从某个节点遍历知识图谱 |
| `exo timeline <slug>` | 查看或添加页面的时间线条目 |
| `exo versions <slug>` | 管理页面版本（快照、列表、回滚） |

### 维护

| 命令 | 说明 |
|------|------|
| `exo lint` | 检查过时、孤立和低置信度的页面 |
| `exo doctor` | 对数据库和配置进行健康检查 |
| `exo check-update` | 检查 npm 是否有新版本 |

### MCP / Agent 集成

| 命令 | 说明 |
|------|------|
| `exo serve` | 启动 MCP stdio 服务器 |
| `exo setup-mcp` | 自动配置 Claude Code 和 Cursor 的 MCP |
| `exo call <tool>` | 直接从命令行调用任意 MCP 工具 |
| `exo tools-json` | 以 JSON 输出所有 MCP 工具定义 |

---

## 配置

exo 读取 `~/.exo/config.toml`。使用 `exo config` 查看配置，`exo config set <key> <value>` 修改。

```toml
[db]
path = "~/.exo/brain.db"

[embed]
base_url = "https://api.openai.com/v1"
api_key  = "sk-..."
model    = "text-embedding-3-large"

[compile]
base_url = "https://api.openai.com/v1"
api_key  = "sk-..."
model    = "gpt-4o"

[vision]
base_url = "https://api.openai.com/v1"
api_key  = "sk-..."
model    = "gpt-4o"
```

任何兼容 OpenAI 接口的服务均可使用（Vercel AI Gateway、Azure OpenAI、Ollama 等）。

### 数据库路径解析优先级

1. `--db <path>` 命令行标志（单次覆盖）
2. `EXO_DB` 环境变量
3. `~/.exo/config.toml` 中的 `db.path`
4. 默认值：`~/.exo/brain.db`

```bash
# 单次指定
exo query "限流" --db ~/work/brain.db

# 整个 shell 会话
export EXO_DB=~/work/brain.db
```

---

## 页面格式

页面使用 YAML frontmatter。`---` 分隔符（前后各有空行）将编译知识与时间线条目分开。

```markdown
---
title: Redis 限流
type: concept
confidence: 9
valid_until: 2027-01-01
tags: [redis, 后端, 限流]
sources: [https://redis.io/docs/manual/patterns/]
---

# Redis 限流

令牌桶，每用户 100 req/s。用 INCR + EXPIRE 实现滑动窗口。
Lua 脚本保证 INCR + EXPIRE 的原子性。

---

## Timeline

- **2024-03-15**：上线生产，选择令牌桶而非漏桶。
- **2024-06-01**：P99 尖刺分析后改用滑动窗口。
```

### Slug 前缀与页面类型

| 前缀 | 类型 |
|------|------|
| `concepts/` | concept（概念） |
| `learnings/` | learning（学习笔记） |
| `people/` | person（人物） |
| `projects/` | project（项目） |
| `sources/` | source（资料来源） |

### Frontmatter 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `title` | string | 页面标题（必填） |
| `type` | string | 页面类型（可从 slug 前缀推断） |
| `confidence` | 0–10 | 对该内容准确性的把握程度 |
| `valid_until` | YYYY-MM-DD | 超过此日期标记为过时 |
| `tags` | string[] | 自定义标签 |
| `sources` | string[] | URL 或参考来源 |

---

## 混合检索

`exo query` 通过倒数排名融合（RRF）综合三路信号：

1. **FTS5 关键词搜索** — 精确词匹配，通过 LIKE 回退支持中文
2. **向量检索** — 基于 `text-embedding-3-large` 的余弦相似度（需先运行 `exo embed`）
3. **LLM 查询扩展** — 搜索前将查询改写为同义词和相关词

```bash
# 完整混合检索（需要嵌入向量）
exo query "如何防止 API 滥用"

# 纯关键词搜索（无 API 调用，即时响应）
exo search "redis 限流"

# 禁用查询扩展（更快，精确匹配）
exo query "redis INCR EXPIRE" --no-expand
```

导入新内容后运行 `exo embed --all` 以保持向量检索最新。

---

## AI 摄取

### 捕获 → 编译流水线

```bash
# 1. 即时捕获（无需 LLM，进入收件箱）
exo capture "Bun 1.2 内置了原生 S3 客户端"
echo "较长的笔记内容" | exo capture --title "我的笔记"

# 2. 查看收件箱
exo inbox

# 3. 将收件箱编译为结构化知识页面（调用 LLM）
exo compile
exo compile --yes    # 跳过确认提示
```

### 从 AI 会话日志中提取知识

```bash
# 从 Claude Code 会话中提取（默认）
exo harvest

# 从所有支持的工具中提取
exo harvest --source all

# 预览而不写入
exo harvest --dry-run
```

支持的来源：Claude Code、GitHub Copilot CLI、Codex。

### 导入 ChatGPT 对话

```bash
# 从 ChatGPT 设置页面导出后导入
exo digest conversations.json

# 导入完整导出目录（对话 + 图片）
exo import-chatgpt ~/Downloads/chatgpt-export/
```

### 附加文件

```bash
# 附加图片并生成 AI 描述（调用视觉 API）
exo attach concepts/my-page screenshot.png --describe

# 附加 PDF（自动按页提取并索引文本）
exo attach concepts/my-page paper.pdf

# 附加音频并转录（调用 Whisper API）
exo attach concepts/my-page meeting.mp3 --transcribe

# 处理所有未处理的附件
exo describe --all
```

---

## MCP 服务器

exo 暴露 [Model Context Protocol](https://modelcontextprotocol.io) 服务器，让 Claude Code 和 Cursor 直接读写你的知识库。

```bash
exo setup-mcp   # 自动写入 ~/.claude/mcp.json 和 ~/.cursor/mcp.json
```

如需手动配置，编辑 `~/.claude/mcp.json`：

```json
{
  "mcpServers": {
    "exo": {
      "command": "exo",
      "args": ["serve"]
    }
  }
}
```

可用 MCP 工具：`brain_search`、`brain_query`、`brain_get`、`brain_put`、`brain_list`、`brain_link`、`brain_stats`、`brain_lint_summary`、`brain_capture`、`brain_timeline`。

---

## 知识质量检查

`exo lint` 检查三类问题：

- **过时（Stale）** — `valid_until` 已过期
- **低置信度（Low confidence）** — `confidence <= 3`
- **孤立（Orphaned）** — 没有任何入链、出链或标签

```bash
exo lint           # 查看所有问题
exo lint --json    # 机器可读的 JSON 输出
```

---

## 开发

```bash
git clone https://github.com/guqing/exo
cd exo
bun install
bun run dev                    # 从源码运行：bun src/cli.ts
bun test ./src/tests/          # 运行测试套件
bun run build                  # 编译为单一二进制文件 → bin/exo
```

---

## 许可证

MIT
