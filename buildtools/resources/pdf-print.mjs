import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** 打印窗口只接收内嵌资源，数学字体随样式发布，正文大字体由宿主复用。 */
export async function build_pdf_print_resources(root, output) {
  const katex = path.join(root, "node_modules/katex/dist");
  let css = await readFile(path.join(katex, "katex.min.css"), "utf8");
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
}
