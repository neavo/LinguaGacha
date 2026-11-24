# 旧版原生 PDF 静态迁移包恢复指南

旧版工程中的原生 PDF 资产在打开工程时会自动静态封存为 `.generic` 包，保留原始字节与历史页数据，但 `items.json` 为空。继续翻译、审校或导出前，按本指南完成重建与历史译稿回填。

## 1. 识别旧封存包与准备依赖

旧封存包在 `sources/<file_path>/` 下同时具备以下特征：

- 存在 `legacy-pdf.json`。
- `items.json` 为空数组 `[]`。
- 存在 `source.pdf`。

执行迁移前，先按主技能「环境与依赖」检查 `pdf.missingDependencies()` 并补齐缺失的 npm 依赖。

## 2. 生成正式通用包与恢复文件

为新包（`output`）和历史恢复副本（`recoveryPath`）选择**尚未存在**的新路径，调用 `pdf.migrateLegacy`：

```js
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const pdf = await import(new URL('scripts/pdf.mjs', base_url).href);

const asset = 'book.pdf.generic';
const output = 'work/migrate/book.pdf.generic';
const recoveryPath = 'work/migrate/book.legacy.json';
await mkdir(path.dirname(output), { recursive: true });

const result = await pdf.migrateLegacy({
  directory: path.join('sources', asset),
  output,
  recoveryPath,
});
console.log(result);
```

- **正常返回**：`{ output_path, pages, digest, recoveryPath, ... }`。新包已重提取各页内嵌文字（无文字或同文页自动补标识），并将旧页的 `omit`、`background` 与 `notes` 写入包内私有字段；原始 `legacy-pdf.json` 已备份至 `recoveryPath`。
- **返回 `{ unresolved }`**（脚本不会写出新包或替换资产）：保留旧资产待查，按异常类型向用户说明并核对：

|异常项|含义|
|---|---|
|`digest`|历史文档摘要缺失或与 `source.pdf` 的实际 SHA-256 不一致|
|`page_order`|历史页数与 `source.pdf` 不一致，或历史页码未从 `1` 连续递增|
|`raw_pages`|`legacy-pdf.json` 含无法解析的损坏历史页记录|
|`disposition`|存在结构非法的历史 `translation` 处置记录|

## 3. 就地替换工程资产

旧封存包的 `items.json` 为空，无需通过文件替换继承条目。按 `project-operation` 的「方式一：整包就地替换」写入 `ws.contract.changes.files.replaces.path`：

- `file_path`：原资产的 `file_path`
- `source_path`：上一步返回的 `result.output_path`
- `inheritance_mode`：`"none"`

调用 `workspace_apply` 提交并确认回执成功。替换成功后，后续脚本将读到新生成的条目快照。

## 4. 回填历史译稿与处置

在替换成功后的**新快照**中调用 `pdf.legacyItemUpdates`，将返回更新写入 `ws.contract.changes.items.updates.path` 并通过 `workspace_apply` 提交：

```js
import { writeFile } from 'node:fs/promises';
const pdf = await import(new URL('scripts/pdf.mjs', base_url).href);

const updates = await pdf.legacyItemUpdates({
  recoveryPath: 'work/migrate/book.legacy.json',
  itemsPath: ws.contract.datasets.items.path,
  filePath: 'book.pdf.generic',
});
console.log({ pending_updates: updates.length });
await writeFile(
  ws.contract.changes.items.updates.path,
  updates.map((record) => JSON.stringify(record)).join('\n') + (updates.length ? '\n' : ''),
  'utf8',
);
```

映射与保护规则：

|历史 `translation`|回填到工程条目|说明|
|---|---|---|
|`kind: "translate"`|`status: "PROCESSED"`，`dst: translation.markdown`|含跨页合并用的空译稿 `""`|
|`kind: "keep"`|`status: "EXCLUDED"`|写回时沿用原页|
|`kind: "omit"`|`status: "EXCLUDED"`|包内已设置 `omit: true`，写回时省略该页|
|`null`|不生成更新|保持 `NONE` 待处理|

- **幂等重试**：条目已具有相同处置与译稿时脚本自动跳过，允许在部分失败后安全重跑。
- **冲突保护**：若某页条目已存在不同的人工处置或非空 `dst`，脚本直接抛出冲突错误，不会静默覆盖人工修改；按报错页核对后再处理。

## 5. 写回核验与收尾

1. 按主技能「写回 PDF」运行一次 `generateFiles()` 与新包自带的 `writeback.mjs`，确认所有旧译稿语法、公式与 `pdf-image:` 嵌图引用均正常生成。
2. 重点抽查空译稿接管、保留原页、省略原页和页面背景的渲染结果，确认与旧译稿一致。
3. 在核对完提交回执与写回成果前，保留 `recoveryPath`（或旧工程副本），避免中断后丢失历史译稿依据。
4. 旧译稿已进入工程条目，页级 `notes` 已随包内 `items.json` 保留。
