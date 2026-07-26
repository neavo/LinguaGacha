# LinguaGacha `.lg` 存储与执行契约

## 目录

- [字段能力参考](#字段能力参考)
- [能力等级](#能力等级)
- [`ambiguous` 的升级路径](#ambiguous-的升级路径)
- [数据形状](#数据形状)
- [快照和安全写入](#快照和安全写入)
- [审校计划格式](#审校计划格式)

## 字段能力参考

先运行 `inspect` 做只读浅探。参考结构不是严格版本 schema，而是以下最小语义能力：

| 表 | 参考字段 | 语义 | 用途 |
| --- | --- | --- | --- |
| `items` | `id`, `data` | 带稳定 ID 的原文 JSON | 审校必需 |
| `rules` | `id`, `type`, `data` | `type = 'glossary'` 的唯一术语规则 | 审校必需 |
| `meta` | `key`, `value` | JSON 元数据和质量规则修订号 | 自动写入必需 |

参考 `schema_version` 为 `2`。版本号缺失或不同不直接阻断；额外表、额外字段也不阻断。只有实际字段、JSON 形状和业务语义决定能力等级。`assets` 与术语审校无关，不检查、不计入快照。

## 能力等级

| 状态 | 判定 | 允许 |
| --- | --- | --- |
| `exact` | 核心读写能力成立，版本等于参考值 | `scan`、`locate`、`check`、`apply` |
| `compatible` | 核心读写能力成立，版本缺失、不同或有非核心差异 | 与 `exact` 相同 |
| `read_only` | `items` 和唯一 glossary 可读，但修订元数据不足 | `scan`、`locate`、`check`；禁止 `apply` |
| `ambiguous` | 核心表、字段或数据形状无法唯一映射 | 仅输出浅探结果 |

浅探只列出表和字段，读取最多 3 条原文样本、最多 2 条 glossary 规则，并验证相关 JSON 外形；不输出样本正文。完整 `scan` 仍会读取全部原文和术语，发现未被样本覆盖的损坏时应停止。

## `ambiguous` 的升级路径

先向用户展示 `inspect.differences`，询问是否允许继续深度只读探索。得到同意后：

1. 检查 `sqlite_master`、`PRAGMA table_info`、索引、外键、触发器和有界 JSON 样本。
2. 识别原文集合、唯一术语集合、稳定主键、修订元数据及其更新关系。
3. 输出推断映射、直接证据、仍存歧义和可用能力；不要用模糊相似度分数替代判断。
4. 映射唯一时，可用任务内的最小只读查询继续审校；不要因单个数据库变体修改本技能的通用参考。
5. 写入映射也被证明唯一且能满足下述安全写入流程时，将映射与变更清单一并交付，等待正常的明确写入批准；否则停在可复核的变更清单。

深度探索阶段始终只读。用户同意探索不等于同意写入。

## 数据形状

- `items.data`：JSON 对象。原文位于字符串字段 `src`；出处优先读取 `file_path` 和 `row_number`，旧数据回退到 `row`。
- `rules.type = 'glossary'`：必须恰好一行；`data` 是术语对象数组。
- 术语对象字段：
  - `src: string`
  - `dst: string`
  - `info: string`
  - `regex: boolean`
  - `case_sensitive: boolean`
  - `entry_id?: string`
- `meta.value`：JSON 文本。

自动写入要求 `quality_rule_revision.glossary` 恰好一行且为非负整数。以下现存修订号也必须可解析；缺失时按 `0` 参与计算：

```text
quality_rule_revision.glossary
quality_rule_revision.text_preserve
quality_rule_revision.pre_replacement
quality_rule_revision.post_replacement
```

写入 glossary 后，将 glossary 修订号设置为上述修订号最大值加一。

## 快照和安全写入

`scan` 和 `check` 使用逻辑快照：

- schema 版本参考值；
- 三个核心表实际字段定义的 SHA-256；
- glossary 修订号和全部相关修订值的 SHA-256；
- glossary 规范 JSON 的 SHA-256；
- 全部 `item_id + src` 的语料 SHA-256；
- 非 glossary 规则的 SHA-256；
- item 和 glossary 数量。

这些 HASH 用于发现数据库在检查、用户手动调整计划或写锁取得前是否变化，不用于锁死计划文件。用户可直接编辑计划；编辑后重新运行 `check` 即可。

内置 `apply` 固定执行：

1. 校验当前计划和最终术语结果。
2. 确认字段能力为 `exact` 或 `compatible`，并只读重验逻辑快照。
3. 使用 SQLite 在线备份生成一致副本并验证 `integrity_check`。
4. `BEGIN IMMEDIATE` 取得写锁。
5. 在锁内再次探测能力和快照。
6. 原位更新唯一 glossary 行，保留其 ID 和其他字段。
7. 在同一事务中更新现存 glossary 修订行。
8. 提交；失败则回滚。
9. 关闭并重开数据库，验证目标和备份完整性、最终哈希、修订号、原文语料、其他规则和非目标修订。

禁止复制可能带有未 checkpoint WAL 的主文件充当备份，也禁止手动删除 `-wal` 或 `-shm`。

## 审校计划格式

使用 UTF-8 JSON：

```json
{
  "format": "linguagacha-glossary-audit-plan/v2",
  "snapshot": {
    "schema_version": 2,
    "storage_schema_sha256": "...",
    "glossary_revision": 6,
    "quality_revisions_sha256": "...",
    "glossary_sha256": "...",
    "item_corpus_sha256": "...",
    "other_rules_sha256": "...",
    "item_count": 100,
    "glossary_count": 20
  },
  "operations": [
    {
      "op": "delete",
      "src": "骑士艾琳",
      "reason": "“骑士”仅为称谓，核心人名由艾琳覆盖",
      "evidence": [12]
    },
    {
      "op": "update",
      "src": "白の器",
      "set": {
        "dst": "白之器",
        "info": "特殊物品"
      },
      "reason": "原文各处均指同一件特殊容器",
      "evidence": [41, 93]
    },
    {
      "op": "add",
      "entry": {
        "src": "艾琳",
        "dst": "艾琳",
        "info": "女性角色",
        "regex": false,
        "case_sensitive": false
      },
      "reason": "去除修饰性称谓后的最小人物名",
      "evidence": [12]
    }
  ]
}
```

约束：

- `snapshot` 必须逐字段复制 `scan` 输出，不手写估算。
- 每个原 `src` 最多被一个操作命中；删除与修改不得重叠。
- `update.set` 只写发生变化的 `src`、`dst`、`info`、`case_sensitive`。
- 不修改既有 `entry_id`；新增条目缺少 ID 时由脚本按快照和 `src` 生成稳定 UUID。
- `reason` 必须非空。
- `evidence` 是 `item_id` 数组；脚本会确认条目存在且原文包含相关源词。
- 计划不得包含“保留”操作；未列出的条目原样保留。

所有命令向标准输出写 JSON 摘要；错误写入标准错误并返回非零状态。
