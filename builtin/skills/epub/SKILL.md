---
name: epub
description: 读取或分析 EPUB 电子书结构时使用，处理章节顺序、XHTML、目录与资源关系。用户明确要求工程外的独立 EPUB 文件时，也提供编辑与打包方法。
---

# EPUB 文件处理

工程内的翻译与审校按 `translation` 执行。本技能用于阅读结构、补充语境，以及用户明确要求的工程外独立文件。

## 阅读原稿

先读取 `sources/<file_path>/META-INF/container.xml`，从 `rootfile` 的 `full-path` 找到 OPF。下面使用示例资产 `小说/第一章.epub`，将目标替换为当前文件身份：

```js
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.join('sources', '小说/第一章.epub');
console.log(await readFile(path.join(root, 'META-INF/container.xml'), 'utf8'));
```

根据实际 `full-path` 读取 OPF，查看 `manifest` 的资源清单和 `spine` 的阅读顺序。`spine` 中的 `itemref.idref` 对应 `manifest` 中的 `item.id`，正文位置由该资源的 `href` 决定。下面假设 OPF 为 `OEBPS/content.opf`：

```js
const opfPath = 'OEBPS/content.opf';
console.log(await readFile(path.join(root, opfPath), 'utf8'));
```

按 `spine` 顺序选择需要的章节，直接读取对应 XHTML。`href` 相对 OPF 所在目录解析，图片、样式及链接则相对引用它们的文档解析。处理 URL 片段与编码时，分离片段并只解码一次，解析后的本地路径须留在当前书籍目录内。下面假设目标资源的 `href` 为 `Text/chapter01.xhtml`：

```js
const chapterPath = path.join(root, path.dirname(opfPath), 'Text/chapter01.xhtml');
console.log(await readFile(chapterPath, 'utf8'));
```

图片和其他资源同样按成员路径读取原始字节。目录可能位于导航 XHTML 或 NCX 中，与正文顺序共同确定阅读结构。结果以包内路径和章节位置定位。

## 生成独立 EPUB

仅在用户明确要求工程外的独立文件时执行，独立文件不会写入工程。修改稿写入 `work/`，修改 XHTML 时保留文档结构、注音、图片、脚注及链接关系，目录与正文顺序保持一致。使用预装 `jszip` 从展开目录创建新包。首先添加无压缩的 `mimetype`，内容严格为 `application/epub+zip`，再按原相对路径复制其他文件，并覆盖已修改的成员：

```js
import JSZip from 'jszip';
import { readdir, writeFile } from 'node:fs/promises';
const output = new JSZip();
output.file('mimetype', 'application/epub+zip', { compression: 'STORE', createFolders: false });
async function copyMembers(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    const source = path.join(directory, entry.name);
    if (entry.isDirectory()) await copyMembers(source, name + '/');
    else if (entry.isFile() && name !== 'mimetype') {
      output.file(name, await readFile(source), { createFolders: false });
    }
  }
}
await copyMembers(root);
// 将 work 中已修改的 XHTML、OPF 或目录覆盖到 output 的对应成员。
await writeFile('work/修改稿.epub', await output.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
```

写出后重新打开，核对 `mimetype`、入口、章节顺序、目标正文和资源引用，确认未修改的二进制资源保持一致。排版相关任务还需要结合实际阅读效果核验。
