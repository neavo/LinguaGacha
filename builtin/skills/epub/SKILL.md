---
name: epub
description: 读取、分析或翻译 EPUB 文件时使用。用户要求生成或编辑工程外的独立 EPUB 文件时也使用。
---

# EPUB 文件处理

工程内的翻译与审校按 `translation` 执行。本技能用于阅读结构、补充语境，以及用户明确要求的工程外独立文件。

## 阅读原稿

EPUB 在 `sources/<file_path>/` 展开为包内目录，例如 `sources/小说/第一章.epub/`。按标准结构读取：`META-INF/container.xml` 指向 OPF，`spine` 给出阅读顺序，导航 XHTML 或 NCX 给出目录。解析后的本地路径须留在当前书籍目录内，结果以包内路径和章节位置定位。

## 生成独立 EPUB

仅在用户明确要求工程外的独立文件时执行，独立文件不会写入工程。修改稿写入 `work/`，修改 XHTML 时保留文档结构、注音、图片、脚注及链接关系，目录与正文顺序保持一致。使用 `jszip` 从展开目录创建新包。首先添加无压缩的 `mimetype`，内容严格为 `application/epub+zip`，再按原相对路径复制其他文件，并覆盖已修改的成员：

```js
import JSZip from 'jszip';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.join('sources', '小说/第一章.epub');
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
