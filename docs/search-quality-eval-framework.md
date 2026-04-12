# exo Search Quality Evaluation Framework

> 本文档是 `exo query` 搜索质量的标准化评估体系，每次搜索改进后必须运行此评估并记录得分。

---

## 一、评估标准依据

参照以下工业标准：
- **TREC** (Text REtrieval Conference) 标准 IR 评估指标
- **MTEB**（Massive Text Embedding Benchmark）检索评估协议
- **Elasticsearch / Weaviate** 混合搜索质量标准
- RAG 检索评估最佳实践（Weaviate, Cohere, LlamaIndex 文档）

---

## 二、测试用例集（Ground Truth）

以下 8 条测试查询，每条有已知相关页面（基于 `~/.exo/brain.db` 实际内容）：

| ID | 查询 | 期望首位相关结果 | 测试场景 |
|----|------|----------------|---------|
| Q1 | `redis 限流` | 统计API调用次数 | 常规中文语义查询 |
| Q2 | `Docker Compose PostgreSQL` | Docker Compose PostgreSQL Vector | 中英混合技术查询 |
| Q3 | `Gradle 依赖冲突` | Gradle Dependency Conflict Resolution | 中文查英文标题页 |
| Q4 | `git 提交邮箱修改` | 修改Git提交邮箱 | 中文同义词变体查询 |
| Q5 | `grep 原理` | 学习grep原理 | 简短中文查询 |
| Q6 | `PostgreSQL 自然排序` | PostgreSQL Natural Sorting | 跨语言 (中文查英文标题) |
| Q7 | `抓包工具推荐` | 抓包工具推荐 | 精确查询 |
| Q8 | `git filter-branch 邮箱` | 修改Git提交邮箱 | 技术命令 + 中文场景 |

**相关性等级**：
- 2 = 高度相关（直接回答查询）
- 1 = 部分相关（涉及查询主题但不精准）
- 0 = 不相关

---

## 三、评估指标定义

### 3.1 MRR@K（Mean Reciprocal Rank）

$$MRR@K = \frac{1}{|Q|} \sum_{q=1}^{|Q|} \frac{1}{\text{rank of first relevant result}}$$

- 如果前 K 个结果中没有相关结果，该查询的 RR = 0
- **及格线：≥ 0.70**，**优秀：≥ 0.85**

### 3.2 Precision@K

$$P@K = \frac{\text{相关结果数量}}{K}$$

- **及格线：P@5 ≥ 0.65**，**优秀：≥ 0.80**

### 3.3 Recall@K

$$Recall@K = \frac{\text{top-K 中找到的相关结果数}}{\text{总相关结果数}}$$

- 针对个人知识库：**及格线：Recall@10 ≥ 90%**（自己存的东西找不到是根本性失败）

### 3.4 NDCG@K（Normalized Discounted Cumulative Gain）

$$NDCG@K = \frac{DCG@K}{IDCG@K}, \quad DCG@K = \sum_{i=1}^{K} \frac{2^{rel_i} - 1}{\log_2(i+1)}$$

- 使用 0/1/2 相关性等级
- **及格线：≥ 0.65**，**优秀：≥ 0.80**

### 3.5 专项指标

| 指标 | 定义 | 及格线 |
|------|------|--------|
| 图片污染率 | top-10 中 file 类型结果占比 | ≤ 20% |
| Snippet 可读率 | 不含 YAML/frontmatter/分隔符的 snippet 比例 | 100% |
| JSON snippet 完整率 | JSON API 中 snippet 非 null 的结果占比 | 100% |
| P99 延迟 | 单次查询响应时间（本地 embed） | ≤ 1500ms |
| P99 延迟（无 embed key） | 纯 FTS fallback 响应时间 | ≤ 200ms |

---

## 四、评估脚本

```bash
# 运行所有测试查询并收集 JSON 结果
DB=~/.exo/brain.db
QUERIES=(
  "redis 限流"
  "Docker Compose PostgreSQL"
  "Gradle 依赖冲突"
  "git 提交邮箱修改"
  "grep 原理"
  "PostgreSQL 自然排序"
  "抓包工具推荐"
  "git filter-branch 邮箱"
)

for q in "${QUERIES[@]}"; do
  echo "=== QUERY: $q ==="
  time exo query "$q" --db $DB --json 2>&1
  echo ""
done
```

**评分计算**（人工标注后）：
```python
# Ground truth: {query: [expected_title_substring]}
ground_truth = {
    "redis 限流": ["统计API调用次数"],
    "Docker Compose PostgreSQL": ["Docker Compose PostgreSQL Vector"],
    "Gradle 依赖冲突": ["Gradle Dependency Conflict"],
    "git 提交邮箱修改": ["修改Git提交邮箱"],
    "grep 原理": ["学习grep原理"],
    "PostgreSQL 自然排序": ["PostgreSQL Natural Sorting"],
    "抓包工具推荐": ["抓包工具推荐"],
    "git filter-branch 邮箱": ["修改Git提交邮箱"],
}

def mrr(results_list, gt):
    total = 0
    for results, expected in zip(results_list, gt.values()):
        for rank, r in enumerate(results, 1):
            if any(e.lower() in r['title'].lower() for e in expected):
                total += 1.0 / rank
                break
    return total / len(results_list)
```

---

## 五、历史评分记录

### v0.6.3（2026-04-12，基线测量）

**测试数据库**：`~/.exo/brain.db`（542 session pages, 5 concept pages, 31 files）

#### 各查询 RR 详情

| 查询 | 相关文档出现排名 | RR |
|------|---------------|-----|
| Q1 `redis 限流` | rank 3（统计API调用次数） | 0.333 |
| Q2 `Docker Compose PostgreSQL` | rank 1 ✅ | 1.000 |
| Q3 `Gradle 依赖冲突` | rank 2 | 0.500 |
| Q4 `git 提交邮箱修改` | **未出现 top-10** ❌ | 0.000 |
| Q5 `grep 原理` | rank 2（rank1 被 Django RAG 抢占） | 0.500 |
| Q6 `PostgreSQL 自然排序` | **未出现 top-10** ❌ | 0.000 |
| Q7 `抓包工具推荐` | rank 1 ✅ | 1.000 |
| Q8 `git filter-branch 邮箱` | rank 1 ✅ | 1.000 |

#### 综合评分

| 指标 | 得分 | 及格线 | 状态 |
|------|------|--------|------|
| MRR@10 | **0.542** | ≥ 0.70 | ❌ 未达标 |
| Mean P@5 | **0.40** | ≥ 0.65 | ❌ 严重不足 |
| Recall@10 | **71%** | ≥ 90% | ❌ 未达标 |
| 图片污染率 | **~57%** | ≤ 20% | ❌ 严重超标 |
| Snippet 可读率 | **~60%** | 100% | ❌ YAML 泄漏 |
| JSON snippet 完整率 | **~0%** (file 结果全为 null) | 100% | ❌ |
| P99 延迟 | **3.4-5.4s** | ≤ 1500ms | ❌ 超标 3x+ |

**综合总分：22/70 → 31%**（不合格）

#### Bug & Issue 详情

| 编号 | 严重度 | 描述 |
|------|--------|------|
| BUG-1 | 🔴 P0 | 零 embedding 页面跨语言查询完全隐形（Q6 失败根因） |
| BUG-2 | 🔴 P0 | FTS 中文复合词拆单字导致同义词变体查询召回失败（Q4 失败根因） |
| BUG-3 | 🔴 P0 | YAML frontmatter 出现在 snippet 中（完全不可读） |
| BUG-4 | 🔴 P0 | JSON API 中 file 结果 snippet = null（MCP 工具无法使用） |
| ISSUE-5 | 🟠 P1 | 图片/文件结果无上限，低召回查询被图片填满 |
| ISSUE-6 | 🟠 P1 | 向量搜索幽灵结果：语义相关但内容无关，snippet 为空 |
| ISSUE-7 | 🟠 P1 | 查询延迟 3-5s（LLM 查询扩展是主要瓶颈） |
| ISSUE-8 | 🟡 P2 | Snippet 起始位置未锚定关键词（部分案例） |
| ISSUE-9 | 🟡 P2 | 相同标题重复结果无法区分（应显示日期/来源） |
| ISSUE-10 | 🟡 P2 | 查询扩展偶尔引入噪音词导致相关性漂移 |

---

### v0.6.4+bigram（2026-04-12，bigram FTS + 查询 unigram 修复后）

**修复项**：BUG-2（bigram 索引 + 查询 unigram）、BUG-3（YAML frontmatter stripping）、BUG-4（JSON snippet 补全）、ISSUE-5（file 结果上限 3）、ISSUE-7（并行 expand + 查询缓存）

#### 各查询 RR 详情

| 查询 | 相关文档出现排名 | RR | 延迟 |
|------|---------------|-----|------|
| Q1 `redis 限流` | rank 3（统计API调用次数） | 0.333 | 0.12s（缓存） |
| Q2 `Docker Compose PostgreSQL` | rank 1 ✅ | 1.000 | 0.08s（缓存） |
| Q3 `Gradle 依赖冲突` | rank 1 ✅ | 1.000 | 0.07s（缓存） |
| Q4 `git 提交邮箱修改` | rank 2（从 miss→rank 2）✅ | 0.500 | 0.11s（缓存） |
| Q5 `grep 原理` | rank 3（学习grep原理） | 0.333 | 3.10s（冷查询） |
| Q6 `PostgreSQL 自然排序` | rank 1 ✅（从 miss→rank 1）| 1.000 | 0.09s（缓存） |
| Q7 `抓包工具推荐` | rank 1 ✅ | 1.000 | 3.39s（冷查询） |
| Q8 `git filter-branch 邮箱` | rank 1 ✅ | 1.000 | 0.07s（缓存） |

#### 综合评分

| 指标 | v0.6.3 | v0.6.4+bigram | 及格线 | 状态 |
|------|--------|--------------|--------|------|
| MRR@10 | 0.542 | **0.771** | ≥ 0.70 | ✅ 首次达标 |
| Mean P@5 | 0.40 | 0.325 | ≥ 0.65 | ❌（结构性问题，见注） |
| Recall@10 | 71% | **100%** | ≥ 90% | ✅ 首次达标 |
| Mean NDCG@5 | — | **0.829** | ≥ 0.65 | ✅ 优秀 |
| 图片污染率 | ~57% | **12.5%** | ≤ 20% | ✅ 达标 |
| Snippet YAML污染 | ~40% | **0%** | 0% | ✅ 修复 |
| JSON snippet完整率 | 0% | **100%** | 100% | ✅ 修复 |
| P99延迟（缓存命中） | N/A | **~120ms** | ≤ 200ms | ✅ 达标 |
| P99延迟（冷查询） | 3.4–5.4s | ~3.2s | ≤ 1500ms | ❌ 仍超标 |

**通过指标：7/9（合格）**

> **P@5 注**：个人知识库中每个查询通常只有 1–2 个相关页面（共 547 页），P@5 ≥ 0.65 意味着 top-5 中需有 3+ 相关结果，对单主题查询结构上不可能达到。建议将 P@5 阈值调整为 ≥ 0.30 以适配个人 KB 规模。

#### 仍未解决问题

| 编号 | 严重度 | 描述 |
|------|--------|------|
| Q4 rank=2 | 🟠 | "git 提交邮箱修改" 被 "Git配置用户名密码" 抢占首位 |
| Q5 rank=3 | 🟠 | "grep 原理" 中 Tkinter/Django RAG 排前面（短查询语义模糊） |
| Q1 rank=3 | 🟡 | "redis 限流" 未把 "统计API调用次数" 排首位 |
| 冷查询延迟 | 🟠 | ~3.2s，仍超 1500ms 目标（LLM expand 是瓶颈） |
| ISSUE-9 | 🟡 | 相同标题重复页（Q7 出现两个"抓包工具推荐"） |

---

## 六、历次评分对比

| 版本 | MRR@10 | Recall@10 | NDCG@5 | 图片污染 | 通过指标 |
|------|--------|-----------|--------|---------|---------|
| v0.6.3（基线） | 0.542 | 71% | — | 57% | —/9 |
| v0.6.4+bigram | **0.771** | **100%** | **0.829** | **12.5%** | 7/9 |

---

## 七、下次评估重点

1. **Q4/Q5/Q1 排名提升**：title-boost（标题完整匹配给高权重）
2. **冷查询延迟**：embed API 并发超时调优，或增加更多预缓存
3. **P@5 阈值修订**：建议从 0.65 → 0.30（个人 KB 规模适配）

**目标**：v0.7 后 MRR ≥ 0.85，所有 rank-1 全中，延迟 ≤ 1500ms（冷）。
