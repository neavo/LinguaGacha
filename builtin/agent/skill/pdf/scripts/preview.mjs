import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build_pdf_document } from "@lg/pdf";
import {
  parse_page_update,
  resolve_agent_workspace_page_updates,
} from "@lg/workspace/page-updates";

/** JSONL 按 LF 分行并保留物理行号，快照与草稿共用读取方式。 */
async function read_rows(file_path) {
  return (await readFile(file_path, "utf8")).split("\n").flatMap((text, index) => {
    if (!text.trim()) return [];
    try {
      return [{ line: index + 1, value: JSON.parse(text) }];
    } catch (cause) {
      throw new Error(`Invalid JSON at ${file_path}:${index + 1}`, { cause });
    }
  });
}

/** 草稿使用与 changes 相同的逐页 JSONL，覆盖快照副本后复用正式页面组合。 */
export async function preview(file_path, updates_path) {
  const rows = (await read_rows(ws.contract.datasets.pages.path))
    .map((row) => row.value)
    .filter((row) => row.file_path === file_path);
  if (!rows.length) throw new Error(`PDF document not found: ${file_path}`);
  const pages = rows.map(({ file_path: _file, fp: _fp, digest: _digest, ...page }) => page);
  const document = { digest: rows[0].digest, pages };
  if (updates_path) {
    const intents = [];
    for (const row of await read_rows(updates_path)) {
      const parsed = parse_page_update(row);
      if ("rejection" in parsed) throw new Error(JSON.stringify(parsed.rejection));
      if (parsed.intent.file_path === file_path) intents.push(parsed.intent);
    }
    const result = resolve_agent_workspace_page_updates(intents, [{ file_path, document }]);
    // 预览展示完整方案。拒绝任何目标更新时先修复草稿，避免把部分方案当作完整预览。
    if (result.rejected.length) throw new Error(JSON.stringify(result.rejected));
    for (const { page } of result.changes) pages[page.page - 1] = page;
  }
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
