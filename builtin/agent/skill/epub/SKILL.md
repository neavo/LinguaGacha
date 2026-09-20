---
name: epub
description: 读取、分析、编辑或生成 EPUB 电子书时使用，处理章节顺序、XHTML、目录、资源关系与打包。
---

# EPUB 文件处理

使用预装 `jszip` 读取 EPUB 容器，先查看成员目录，再读取需要的文本和资源。

```js
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
const book = await JSZip.loadAsync(await readFile('sources/小说/第一章.epub'));
console.log(Object.values(book.files).filter(entry => !entry.dir).map(entry => entry.name));
const container = book.file('META-INF/container.xml');
if (!container) throw new Error('EPUB 缺少容器入口');
console.log(await container.async('string'));
```

从 `META-INF/container.xml` 找到 OPF。读取 OPF 的 `manifest` 和 `spine`，按 `spine` 的顺序选择正文。资源引用相对所属文档解析，处理 URL 编码时避免重复解码。

修改 XHTML 时保留文档结构、注音、图片、脚注及链接关系。目录可能位于导航 XHTML 或 NCX 中，应与修改后的章节保持一致。仅改目标成员，图片、字体等二进制资源保留原字节。结果以包内路径和章节位置定位。

写出时创建新容器，首先添加无压缩的 `mimetype`，内容严格为 `application/epub+zip`。随后按原路径复制成员，并覆盖已修改的内容：

```js
import { writeFile } from 'node:fs/promises';
const output = new JSZip();
output.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
for (const entry of Object.values(book.files)) {
  if (entry.dir || entry.name === 'mimetype') continue;
  output.file(entry.name, await entry.async('uint8array'));
}
// 在这里将已修改的 XHTML、OPF 或目录写入 output 的对应成员。
await writeFile('work/修改稿.epub', await output.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
```

JSZip 支持逐成员读取，按需要控制解压量。需要展开到磁盘时，包内路径必须保持在目标 `work/` 目录内。加密或分卷容器读取失败时说明实际限制。

写出后重新打开，核对入口、章节顺序、目标正文和资源引用，确认未修改的二进制资源保持一致。排版相关任务还需要结合实际阅读效果核验。项目内翻译与审校继续使用对应工程流程。
