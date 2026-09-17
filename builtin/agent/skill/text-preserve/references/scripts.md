# 文本保护扫描

需要核验表达式或查找相同正则表达式时读取本参考。`base_url` 使用本技能的 `read_skill` 返回值或显式注入值。

```js
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
const { scanPatterns } = await import(new URL('scripts/scan-patterns.mjs', base_url).href);
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
const evidence = await scanPatterns(items(), {
  patterns: [{ key: 'player', source: String.raw`\{player_name\}` }],
});
await writeFile('work/preserve-evidence.json', JSON.stringify(evidence));
console.log(evidence.patterns.map(({ key, error, match_count, zero_length_match_count }) => ({
  key, error, match_count, zero_length_match_count,
})));
```

将示例表达式替换为当前方案。标准文件流按 LF 分行，保留字段内的 Unicode 分隔符，提前退出时也释放流。需要限制调查范围时，向脚本传入按任务范围筛选的条目流，并保存实际扫描范围。数据记录和工程修改协议以对应 `reference` 为准。

- `patterns` 为 `{ key, source }` 数组，`key` 唯一，`source` 是 JavaScript 正则表达式源码。每条表达式独立以 `giu` 编译，扫描范围为原始 `item.src` 按 `\n` 拆出的各行。
- `max_matches_per_pattern` 省略时保存全部命中证据，`0` 只统计，正整数限制每条表达式保存的命中数。计数和分布始终覆盖完整输入。
- 返回 `scanned_item_count` 和按输入顺序排列的 `patterns`。每个结果包含 `key`、`source`、`error`、`match_count`、`matched_item_count`、`zero_length_match_count`、`matches_complete`、`matches`、`file_counts` 和 `text_type_counts`。
- `error` 为编译错误文字或 `null`。非法表达式的 `matches_complete` 为 `false`。合法表达式仅在所有命中均已收集时为 `true`。
- 每条证据包含 `item_id`、`file_path`、`text_type`、从 1 开始的 `line`、行内 UTF-16 半开范围 `start/end` 和 `text`。文件与文本类型分布统计命中次数，`matched_item_count` 按条目计数。零长度命中同时纳入命中总数与零长度计数。

扫描会独立核验每条规则，保留重叠与零长度命中的证据。实际保护执行会处理重叠并忽略空片段，因此调查单条表达式时应使用独立扫描结果。

取得位置和计数后，还需判断保护资格、自然语言反例和边界安全。安全结论只覆盖已检查的材料。遇到执行超时，按已保存材料缩小问题范围并修正表达式。

## 查找相同表达式

按当前规则的 `src` 分组，成员沿用对象 ID。相同源码说明表达式写法重复，具体行为关系需根据扫描结果判断。

```js
const entries = (await readFile(ws.contract.datasets.text_preserve.path, 'utf8'))
  .split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
const duplicates = [...Map.groupBy(entries, entry => entry.src)]
  .filter(([, members]) => members.length > 1)
  .map(([source, members]) => ({ source, entry_ids: members.map(entry => entry.id) }));
```
