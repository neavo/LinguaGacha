import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build_pdf_document } from "@lg/pdf";

/** 页面快照和草稿共用逐行载荷，空行不构成更新。 */
async function read_jsonl(file) {
  return (await readFile(file, "utf8"))
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** 草稿使用与 changes 相同的逐页 JSONL，覆盖快照副本后复用正式页面组合。 */
export async function preview(file_path, updates_path) {
  const rows = (await read_jsonl(ws.contract.datasets.pdf.path)).filter(
    (row) => row.file_path === file_path,
  );
  if (!rows.length) throw new Error(`PDF document not found: ${file_path}`);
  const pages = rows.map(({ file_path: _file, fp: _fp, digest: _digest, ...page }) => page);
  if (updates_path) {
    const seen = new Set(); // 重复页不能以最后一行覆盖，否则预览与实际提交会不一致。
    for (const update of await read_jsonl(updates_path)) {
      if (update.file_path !== file_path) continue;
      const index = update.page - 1;
      if (seen.has(update.page)) throw new Error(`Duplicate PDF page: ${update.page}`);
      seen.add(update.page);
      if (!rows[index] || rows[index].fp !== update.fp)
        throw new Error(`PDF page changed or missing: ${update.page}`);
      pages[index] = {
        ...pages[index],
        translation: update.translation,
        reviewed: update.reviewed,
        notes: update.notes,
      };
    }
  }
  const document = { digest: rows[0].digest, pages };
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
