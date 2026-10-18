# 原作记忆与工作文件

建立或重建 `canon`，或核对原作记忆是否仍与工程材料一致时读取本资源。分支快照的字段见 `SKILL.md`。

## 工作文件

|文件|职责|
|---|---|
|`work/roleplay/canon.json`|原作记忆 `canon`，保存可从原作重建的稳定结论|
|`work/roleplay/turns/<回合号>.json`|分支快照，每回合一份，回合号最大的快照代表当前分支|
|`work/roleplay/archive/<时间>/`|回溯、修订或重开时被替换的旧分支快照|

工作文件只通过 `scripts/state.mjs` 写入。

## `canon` 的结构

`canon` 按 `world`、`characters`、`relations`、`timeline` 和 `source_scope` 组织世界规则、人物锚点、关系基线、关键时点与调查范围。前四个分区是以实体标识为键的对象，快照通过 `canon_ref`（`<分区>/<标识>`）引用其中的实体。

```json
{
  "world": { "magic_cost": { "rule": "…", "conditions": "…", "exceptions": "…", "cost": "…", "source_ref": [] } },
  "characters": { "hero": { "names": { "zh-CN": "…" }, "presence": {}, "voice": {}, "behavior": {}, "source_ref": [] } },
  "relations": {},
  "timeline": {},
  "source_scope": { "files": ["chapter01.txt"] }
}
```

世界规则连同成立条件、例外和代价一起保存，使后续场景能够判断规则何时适用、行动需要付出什么。

稳定结论记录 `source_ref`、`time_scope`、`perspective` 和 `confidence`，说明证据位置、成立时段、事实或认知的归属、确定程度。字段内容按实际证据填写。反复公开的名称与译法随对应实体按语言保存。

`source_ref` 是证据引用数组。条目证据用 `sourceRef(item)` 生成，它记录 `item_id` 和原文摘要，译文变化不会使引用失效。页面或上传材料的证据记录 `file_path` 与页码或位置，由模型按需核对。`source_scope.files` 记录已经调查过的文件，便于发现新增材料。

实体使用重建后仍能对应同一对象的标识。别名合并需要同指证据，身份不明时分别记录。描述性称谓、职位和一次性行为只有在确实指向需要追踪的人物时才建立实体。

## 核对与重建

恢复分支或工程材料变化后，用 `checkCanon` 核对原作记忆：

```js
import { createReadStream } from 'node:fs';
const rp = await import(new URL('scripts/state.mjs', base_url).href);
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
const report = await rp.checkCanon(items());
console.log(report);
```

|返回字段|含义与处理|
|---|---|
|`stale`|原文已变化的引用及其在 `canon` 中的位置。重读对应条目，修正或删除受影响的结论|
|`missing`|条目已不存在的引用。寻找替代证据，找不到时删除该结论或标为保留未知|
|`new_files`|工程中存在、但不在 `source_scope.files` 中的文件。当前场景需要时补充调查|

更新原作基线时保留有依据的分支差异，分支差异仍记录在快照的 `presence_overrides`、`anchor_overrides` 和 `branch_facts` 中。

## 其他脚本函数

|函数|作用|
|---|---|
|`listTurns()`|返回当前分支已有快照的回合号，按升序排列|
|`loadTurn(turn)`|载入指定回合快照，不存在时返回 `null`|
|`loadCanon()`|载入 `canon`，不存在时返回 `null`|
|`saveCanon(canon)`|校验分区结构后保存 `canon`|
