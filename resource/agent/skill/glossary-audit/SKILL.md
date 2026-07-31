---
name: glossary-audit
description: 用于审查、整理、修正、去重、优化或维护当前工程术语表；基于完整术语表与全量原文语境给出可核验方案，并仅在用户明确批准后原子写入。不用于一般翻译问答。
---

# 术语表审校

以数据库事实和原文语境为唯一依据完成「发现—审校—确认—写入—复核」闭环。优先得到全局一致、低冗余的术语体系，不为旧条目保留无依据的兼容层。

## 工作流

### 1. 阅读审校标准

首次执行本技能时，根据当前 `SKILL.md` 的绝对路径，用 `read_skill` 读取同目录下 `references/audit-standard.md` 的绝对路径和完整正文。它是所有保留 / 修改 / 删除 / 新增判断的唯一语义标准；其中的 `info` 分类只约束本技能创建或修改的条目，不声明数据库存储硬约束。

### 2. 建立只读事实快照

调用 `query_quality_rules` 并指定 `rule_type: glossary`，读取完整术语表、每条的 `exact_occurrences` 与 `fact_violations`、`structure` 的 `duplicate_src_groups` / `containment_candidates` / `root_candidates` 三组，以及 `sectionRevisions`。

据此识别候选问题：零出现词、空译文、正则条目、重复源词、包含关系和共享词根。这些是事实信号，不替代语义判断。

### 3. 逐条基于语境审校

按每条术语的 `case_sensitive` 分组，分别用 `query_project_items` 的 `search` 模式、`scope: src` 和同组 `case_sensitive` 批量查询，逐页使用 `cursor` 直到 `complete=true`；重复的完全相同行可合并，但不得跳过不同语境。

按 `audit-standard.md` 的七步审查顺序逐项决定保留、修改或删除；跨条目按同根词 5 优先级全局重组整张词表，先定全局结构再定单项结果。任何无法由出处证明的判断列为未决，不擅自写入。

### 4. 生成变更方案

逐项列出每个 create / update / delete，必须包含：

- 目标 `entry_id`（create 除外）；
- 新增或修改后的完整条目（`src` / `dst` / `info` / `case_sensitive`）；
- 每项支撑判断的 `item_id` 证据（零出现条目可用空证据，理由须明确写为未出现或被有效同根条目取代）；
- 非空语义理由与同根处理说明。

方案只表达与原快照的差异，不重写未变条目，不夹带格式整理。

### 5. 先交付变更清单并等待明确批准

向用户交付：新增 / 修改 / 删除清单、每项的出处与语义理由、同根处理、保留项中的重要歧义、变更前后数量，并明确声明尚未写入。

到此停止，等待用户对当前方案的明确批准。不得把「继续」「看起来可以」等模糊表达解释为授权。若用户修改方案，重新展示完整变更清单并再次等待明确批准。

### 6. 批准后原子写入并复核

获得明确批准后调用一次 `update_quality_rules`，指定 `rule_type: glossary`，提交完整 changes 和 `expected_section_revisions: { quality: sectionRevisions.quality }`。

- 出现 `RevisionConflictError` 时不得覆盖或强写：重新 `query_quality_rules`，基于新快照生成新方案，回到第 5 步再次等待批准。
- 写入成功后复读返回结果，向用户报告新 revision、变更及最终数量、以及未执行或未决项；只报告已确认事实。
