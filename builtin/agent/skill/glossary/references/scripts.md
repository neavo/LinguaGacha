# 术语取证脚本

需要字面扫描、词根枚举或字符关系线索时读取本参考。`base_url` 使用本技能的 `read_skill` 返回值或显式注入值，指向技能原包根目录。

数据路径取自 `ws.contract`，记录结构和修改协议读取对应 `reference`。脚本返回普通对象，完整结果按需要保存到 `work/`，当前输出只选择待判断的证据。快照或模式变化后重新取得受影响结果。

## 字面命中与邻近语境

```js
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { queryItemContexts } from '@lg/workspace/item-contexts';
const { matchLiterals } = await import(new URL('scripts/match-literals.mjs', base_url).href);
async function* items() {
  const input = createReadStream(ws.contract.datasets.items.path, { encoding: 'utf8' });
  let pending = '';
  try {
    for await (const chunk of input) {
      const lines = (pending + chunk).split('\n');
      pending = lines.pop();
      for (const line of lines) if (line.trim()) yield JSON.parse(line);
    }
    if (pending.trim()) yield JSON.parse(pending);
  } finally { input.destroy(); }
}
const evidence = await matchLiterals(items(), {
  patterns: [{ key: 'candidate', text: 'セラ', case_sensitive: false }],
});
await writeFile('work/literal-evidence.json', JSON.stringify(evidence));
const ids = [...new Set(evidence.patterns.flatMap(pattern => pattern.matches.map(match => match.item_id)))];
const contexts = await queryItemContexts(items(), ids);
await writeFile('work/literal-contexts.json', JSON.stringify(contexts));
console.log({ scanned: evidence.scanned_item_count, matched: evidence.matched_item_count });
```

将示例模式替换为当前已确定的候选，并为待判断条目查询必要语境。标准文件流按 LF 分行，保留字段内的 Unicode 分隔符，提前退出时也释放流。`patterns` 中的 `key` 唯一，`text` 是保留原始空白的非空连续字面量，`case_sensitive` 必填。

`matchLiterals` 单次完整扫描 `src` 和 `name_src`，始终返回完整计数。用 `max_matches_per_pattern` 控制保存的证据量：

|取值|保存的证据|
|---|---|
|省略|全部字段证据|
|`0`|只统计数量|
|正整数|每个模式最多保存指定条数字段证据|

返回结果：

- 结果包含 `scanned_item_count`、去重的 `matched_item_count` 和按输入模式顺序排列的 `patterns`。每个模式包含 `key`、`matched_item_count`、`field_item_counts`、`matches_complete` 和 `matches`。
- 每条字段证据为 `{ item_id, field, ranges: [{ start, end }] }`，按条目、正文、姓名排列。范围是原字段的 UTF-16 半开区间，用原字段的 `slice(start, end)` 取回原文。完整覆盖比较须确认各模式的 `matches_complete`。

## 公共词根

```js
const { deriveCommonLiteralRoots } = await import(new URL('scripts/literal-roots.mjs', base_url).href);
const { candidates } = deriveCommonLiteralRoots(['ドトール家', 'ドトール領']);
```

输入已确认语义相关的短词形。按应用的 Unicode 规则规范化后，至少应有两种不同写法。返回 `candidates: [{ root, grapheme_length }]`，保留首个词形的原始写法，按可见字符长度升序、等长时按发现顺序排列。用字符重合寻找候选，再核验身份、译法及全部命中的安全性。

## 字符关系

```js
const { analyzeRelations } = await import(new URL('scripts/relations.mjs', base_url).href);
const entries = (await readFile(ws.contract.datasets.glossary.path, 'utf8'))
  .split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
const relations = analyzeRelations(entries);
await writeFile('work/glossary-relations.json', JSON.stringify(relations));
```

输入为完整分析集合，每项至少包含唯一 `id`、非空 `src` 和 `case_sensitive`，可以使用现有规则或工作材料中的候选。先分析完整相关集合，再按目标 ID 选择证据。

返回 `entry_ids` 和 `relations`，孤立对象仍保留在 `entry_ids`。关系包括：

|`reason`|字段与含义|
|---|---|
|`equivalent`|`entry_ids` 为两个存在规范化相等写法的对象，大小写按规则策略比较|
|`contains`|`entry_ids` 为 `[包含者, 被包含者]`，按被包含者的大小写策略判断|
|`shared_root`|`root` 为规范化公共片段，`entry_ids` 为成员集合。片段至少包含两个字素，且覆盖每个成员词形的至少一半。相同成员集合保留最长片段|

公共片段关系不传递，所有字符关系均需语义确认。结果直接引用对象 ID，按当前问题安排阅读范围并保存进度。核验字符关系后，将已确认的实体和语义关系加入关系图。
