---
name: translation-plan
description: 当需要重新分析当前工程中尚未翻译的条目，并生成完整的翻译、跳过与译文复用计划时使用；只输出计划，不修改工程或启动翻译任务。
---

# 翻译计划

从当前工程事实独立生成一次完整翻译计划。最终只写 `task/translation-plan.json`，不得调用 `workspace_apply`、准备工程 change、修改工程条目或启动翻译任务。

## 必读规则

开始前必须调用 `read_skill` 读取当前获胜 skill 包内的 `references/rules.md`，完整遵守其中的规则、优先级和默认决定。读取失败时停止，不得使用规则库未声明的判断继续生成计划。

## 范围

- 用户限定的文件、item 或其它范围优先；没有限定时处理当前工程全部 item。
- `PROCESSED` 与 `ERROR` 不进入候选；其余状态在候选视图中统一投影为 `NONE`。
- 只处理解析器已经生成且具有稳定正整数 `item_id` 的条目，不从 sources 创建新 item。
- 无法证明应跳过时选择翻译；无法证明可以复用时选择独立翻译。
- 每个候选最终必须且只能归入 `translate`、`reuse` 或 `skipped` 之一。

## 工作资产

同一次 `workspace_load` 内只维护：

```text
scratch/translation-plan-baseline.jsonl
scratch/translation-plan-candidates.jsonl
scratch/translation-plan-decisions.jsonl
scratch/translation-plan-comparison.json
task/translation-plan.json
```

- baseline 只保存 `item_id` 与原始 `status`；正式计划冻结前不得读取。
- candidates 保存新判断需要的源事实，把 `status` 固定写为 `NONE`，不保存 `dst`、`name_dst` 或 `retry_count`。
- decisions 每个候选一行，保存最终 action、命中的 `rule_ids`、简短依据和可选 reuse source；它不是项目事实。
- comparison 只在正式计划已经写入并通过自检后生成，不得反馈修改同一次计划。
- 再次执行本技能时覆盖上述资产，并从当前工作区重新生成全部判断。

候选至少保留：

```json
{
  "item_id": 1,
  "src": "原文",
  "name_src": "姓名",
  "file_path": "game.trans",
  "file_type": "TRANS",
  "text_type": "WOLF",
  "row_number": 10,
  "tag": "内部文件键",
  "extra_field": {},
  "status": "NONE"
}
```

decision 使用以下形状：

```json
{
  "item_id": 1,
  "action": "translate",
  "rule_ids": ["DEFAULT-TRANSLATE"],
  "reason": "无法证明无需翻译"
}
```

`action: "reuse"` 时额外保存正整数 `source_item_id`。

## 工作流

### 1. 固定候选全集

调用一次 `workspace_load`，再用一次 `workspace_script` 完整遍历用户范围：

1. 把每个 item 的原始状态写入 baseline。
2. 排除 `PROCESSED` 与 `ERROR`。
3. 从其余 item 构造 candidates，并把投影状态写为 `NONE`。
4. 返回范围内总 item、两类排除数和候选数。

后续范围只以 candidates 为准，items 中的 status 不再参与判断。

### 2. 执行 item 本地规则

一次程序化遍历同时检查 `src`、`name_src`、内容形态、语言、引用、`file_type`、`text_type`、`tag` 与 `extra_field`：

- 对规则库允许直接裁决的条目写入 decisions。
- 对需要项目语境的条目按规则条件形成互斥分组，只返回数量、代表样本和边界样本。
- 不把通用规则和格式规则拆成互相遮蔽的多条筛选流水线。

### 3. 收敛项目歧义

按 `references/rules.md` 读取每个歧义组的必要邻近上下文或定点 source 证据。形成项目级判断时必须写明作用范围、精确条件、决定、代表样本和边界反例；判断只写入本次 decisions，不持久化为全局规则。

### 4. 处理关系

基础 translate / skip 决定完成后，程序化处理完全重复与 KVJSON 多行包含关系。reuse source 必须属于本次 `translate`；无法证明语境一致时保持独立翻译。

### 5. 残差收敛

对仍未决定的区域执行一次独立残差调查。新稳定模式最多触发一次完整覆盖；之后仍不确定的候选统一写入 `DEFAULT-TRANSLATE`，不递归发现规则。

### 6. 生成并自检计划

最终脚本从 decisions 生成 `task/translation-plan.json`：

```json
{
  "languages": { "source": "JA", "target": "ZH" },
  "scope": {
    "total_items": 6,
    "processed_omitted": 1,
    "error_omitted": 1,
    "candidate_items": 4
  },
  "translate": [1],
  "reuse": [
    {
      "source_item_id": 1,
      "target_item_ids": [2],
      "reason": "原文、姓名、格式用途与邻近语境一致"
    }
  ],
  "skipped": [
    {
      "reason": "无正文内容",
      "item_ids": [3, 4]
    }
  ],
  "summary": { "translate": 1, "reuse": 1, "skipped": 2 }
}
```

覆盖正式计划前必须程序化验证：

- 候选 ID 全部存在且恰好出现一次。
- translate、全部 reuse 目标和全部 skipped item 互斥。
- reuse source 属于 translate，与目标 `src` 完全相同，且不形成链或环。
- summary 等于真实数组计数。
- `candidate_items = translate + reuse + skipped`。
- languages 与当前 project_meta 一致。

验证失败时不得覆盖已有计划，只返回缺口计数和少量代表 ID。

### 7. 冻结后对照

正式计划通过自检后，才读取 baseline 并生成 comparison。统计 baseline status 与 plan decision 的一致和分歧，按 status 与文件给出必要分布，但绝对不得据此回改同一次计划。

## 完成

只有候选全集完整扫描、每个候选已有互斥决定、关系与残差检查完成、正式计划自检通过且 comparison 已生成时完成。对外只报告范围、三类数量、主要项目规则、代表性分歧和计划路径；明确说明没有修改工程，也没有启动翻译任务。不要展示 scratch 文件、原始脚本或完整 ID 清单。
