import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 开发与发布共用此入口，生成由 Electron 打印宿主消费的数学样式。
const root = fileURLToPath(new URL("..", import.meta.url));
const output = path.join(root, "build/resources");
const katex = path.join(root, "node_modules/katex/dist");
let css = await readFile(path.join(katex, "katex.min.css"), "utf8");
// 打印窗口只接收内嵌资源；小体量数学字体随样式发布，大字体由宿主复用 UI 文件。
for (const [declaration, file] of css.matchAll(
  /src:url\((fonts\/[^)]+\.woff2)\) format\("woff2"\)[^;}]*;?/gu,
)) {
  const bytes = await readFile(path.join(katex, file));
  css = css.replace(
    declaration,
    `src:url(data:font/woff2;base64,${bytes.toString("base64")}) format("woff2");`,
  );
}
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "pdf-print.css"), css);
