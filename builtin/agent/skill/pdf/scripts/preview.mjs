import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build_pdf_document } from "@lg/pdf";

/** 读取本次快照或 work 里的草稿，复用正式页面组合生成可视检查材料。 */
export async function preview(file_path, translation_path) {
  const rows = (await readFile(ws.contract.datasets.pdf.path, "utf8"))
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const document = rows.find((row) => row.file_path === file_path);
  if (!document) throw new Error(`PDF document not found: ${file_path}`);
  if (translation_path) document.translation = JSON.parse(await readFile(translation_path, "utf8"));
  const meta = JSON.parse(await readFile(ws.contract.datasets.project_meta.path, "utf8"));
  const source = meta.files.find((file) => file.file_path === file_path);
  if (!source?.source_binary_path) throw new Error(`PDF source not found: ${file_path}`);
  const output = await build_pdf_document({
    title: path.basename(file_path),
    document,
    source_bytes: new Uint8Array(await readFile(source.source_binary_path)),
    print: async (html) => {
      const printed = await ws.host({ kind: "print_pdf", html });
      return new Uint8Array(await readFile(printed.path));
    },
  });
  const output_path = `work/${randomUUID()}.pdf`;
  await writeFile(output_path, output);
  return { path: output_path };
}
