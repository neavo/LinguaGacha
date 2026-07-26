---
name: lg-glossary-audit
description: 禁止自动触发
---

# LinguaGacha 术语表审校

以数据库事实和原文语境为唯一依据完成“发现—审校—确认—写入—复核”闭环。优先得到全局一致、低冗余的术语体系，不为旧条目保留无依据的兼容层。

## 开始前

1. 完整阅读 [references/audit-standard.md](references/audit-standard.md)。
2. 操作 `.lg` 时完整阅读 [references/storage-contract.md](references/storage-contract.md)。
3. 将本技能目录记为 `SKILL_DIR`，正常路径复用 `scripts/glossary_audit.py`；只有获准处理 `ambiguous` 时才使用任务内的最小只读查询，不因单个变体改写通用脚本。
4. 先按字段和数据形状浅探数据库；`schema_version` 只作参考，不作为单独的放行或拒绝依据。

脚本仅依赖 Python 3 标准库。以下命令优先使用 `uv run --no-project python`；没有 `uv` 时，将该前缀替换为可用的 `python3` 或 `python`。

## 工作流

### 1. 浅探存储能力

先运行：

```shell
uv run --no-project python "$SKILL_DIR/scripts/glossary_audit.py" inspect PROJECT.lg
```

按结果继续：

| `status` | 行动 |
| --- | --- |
| `exact` | 参考版本、核心字段和数据形状匹配；继续。 |
| `compatible` | 核心读写能力匹配，仅版本或非核心结构不同；继续，不索取源码或额外确认。 |
| `read_only` | 原文和术语可读，但修订写入契约不足；继续审校和生成计划，明确禁止 `apply`。 |
| `ambiguous` | 核心表、字段或数据形状无法唯一判断；展示差异，先询问用户是否允许深度只读探索。 |

只有 `ambiguous` 需要在继续探索前确认。用户同意后，按 `storage-contract.md` 的升级路径自行检查结构和有界样本；仍不能证明唯一语义映射时列为阻塞，不猜测。

### 2. 建立只读事实快照

运行：

```shell
uv run --no-project python "$SKILL_DIR/scripts/glossary_audit.py" scan PROJECT.lg --output audit-report.json
```

检查报告中的：

- 存储能力等级、术语修订号、术语与原文语料哈希；
- 空词、空译文、非法分类、正则、重复源词、重复 ID；
- 零出现词、出现次数、代表性出处；
- 包含关系和共享前缀候选组。

完整扫描发现浅探样本未覆盖的数据错误时，回到存储能力判断；不要降级为凭字面猜测。

### 3. 逐条基于语境审校

对每个现有条目执行 `locate`，查看所有不同原文行；不要只看扫描样例：

```shell
uv run --no-project python "$SKILL_DIR/scripts/glossary_audit.py" locate PROJECT.lg --src "术语" --limit 0
```

按审校标准逐项决定保留、修改或删除。随后跨条目处理同根、包含、别名、错拼和译法一致性，先重组整体词表，再确定单项结果。任何无法由出处证明的判断列为未决。

### 4. 生成机器可执行计划

按 `storage-contract.md` 的计划格式创建 JSON。每项操作必须包含：

- 精确目标；
- 非空理由；
- 支撑判断的 `item_id` 证据；
- 新增或修改后的完整必要字段。

计划只表达与原快照的差异，不重写未变条目，不夹带格式整理。

### 5. 校验并先交付变更清单

运行：

```shell
uv run --no-project python "$SKILL_DIR/scripts/glossary_audit.py" check PROJECT.lg PLAN.json
```

脚本必须确认快照未变化、操作无冲突、最终源词和 ID 唯一、分类合法、非正则、译文非空，且所有最终源词实际出现在原文中。

向用户交付：

- 新增、修改、删除清单；
- 每项的出处、语义理由和同根处理；
- 保留项中的重要歧义；
- 校验输出的前后数量、修订号和预期结果；
- 当前是否具备自动写入能力；
- 明确说明尚未写入。

到此停止，等待用户明确批准。不得把“继续”“看起来可以”等模糊表达解释为授权。

### 6. 执行当前已确认计划

允许用户在执行前直接修改计划。每次修改后重新运行 `check` 并展示最终差异；用户明确批准当前版本后运行：

```shell
uv run --no-project python "$SKILL_DIR/scripts/glossary_audit.py" apply PROJECT.lg PLAN.json
```

仅 `exact` 或 `compatible` 可使用内置 `apply`。用户确认后若计划又发生实质变化，重新 `check`、展示变化并再次确认。不要要求用户管理 HASH；`apply` 会自行在线备份、取得写锁、重验数据库快照、原子更新术语与修订号，并独立重开数据库复核。

### 7. 交付结果

只报告已确认事实：

- 备份与目标绝对路径；
- 新增、修改、删除及最终数量；
- 修订号变化；
- 数据库完整性、原文语料和其他规则是否未变；
- 未执行或未解决的事项。

## 完成条件

按用户请求的阶段判定完成：

- **审校或变更清单阶段**：范围内每个术语都经过实际出处审查；每个同根候选组都作出全局决定；计划通过 `check`；已交付证据化清单、未决项和当前写入能力。此阶段不要求写入。
- **写入阶段**：用户明确批准当前计划；备份、事务和写后完整性检查通过；原文条目、其他规则和非目标数据未变化。
- **受限阶段**：`read_only` 或用户不批准 `ambiguous` 深度探索时，交付已确认事实和精确阻塞即可完成当前只读阶段；不得宣称写入完成。
