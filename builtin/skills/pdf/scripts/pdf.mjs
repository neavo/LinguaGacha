import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pack } from "@lg/generic";

const PACKAGE_SCRIPTS = ["writeback.mjs", "document.mjs", "markdown.mjs", "print.css"];
export const NPM_DEPENDENCIES = Object.freeze([
  "mupdf@1.28.6",
  "remark-rehype@11.1.2",
  "rehype-stringify@10.0.1",
  "katex@0.16.47", // 与 @streamdown/math 使用的 KaTeX 渲染器同版本。
  "entities@9.0.0",
  "unist-util-visit@5.2.0",
  "remark-github-blockquote-alert@2.1.0",
  "@streamdown/cjk@1.0.5",
  "@streamdown/math@1.0.4",
]);

/** 在工作区解析实际可用的依赖，成功解析后才加载 MuPDF。 */
export function missingDependencies() {
  return NPM_DEPENDENCIES.filter((dependency) => {
    try {
      import.meta.resolve(dependency.slice(0, dependency.lastIndexOf("@")));
      return false;
    } catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
      return true;
    }
  });
}

/** 调查原稿页序、尺寸和内嵌文字，摘要供区域引用使用。 */
export async function inspect(source) {
  const { read_pdf_document } = await import("./document.mjs");
  return read_pdf_document(await readFile(source));
}

/** 使用原稿的一基页码和旋转后坐标输出 PNG。 */
export async function renderPage(source, request) {
  const { render_pdf_page } = await import("./document.mjs");
  return render_pdf_page(await readFile(source), request);
}

/** 读取一次原稿，封包和提取共用这份字节。 */
export async function prepareAndPack(source, output) {
  const { read_pdf_document } = await import("./document.mjs");
  const bytes = await readFile(source);
  const document = read_pdf_document(bytes);
  return pack_document(bytes, document, path.basename(source), output);
}

/**
 * 普通唯一页直接保存原始提取文本；仅无内嵌文字或同文重复页补系统标识，
 * 用于区分跨页空译稿，并避免触发后端按原文去重克隆或替换继承冲突。
 */
function source_message(page, text, duplicated) {
  if (!text) return `[PAGE ${page} - NO TEXT]`;
  return duplicated ? `[PAGE ${page} - DUPLICATED PAGE]\n${text}` : text;
}

/** 只封存原稿、定位和历史处置的附注。旧译稿在替换后经条目接口回填。 */
async function pack_document(bytes, document, original_file_name, output, old_pages = []) {
  const counts = new Map();
  for (const { text } of document.pages) {
    if (text) counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  const items = document.pages.map(({ text, ...page }, index) => {
    const old = old_pages[index];
    return {
      ...page,
      message: source_message(page.page, text, (counts.get(text) ?? 0) > 1),
      omit: old?.translation?.kind === "omit",
      background: old?.translation?.background ?? null,
      notes: old?.notes ?? "",
    };
  });
  const metadata = {
    digest: document.digest,
    original_file_name,
    npm_dependencies: NPM_DEPENDENCIES,
  };
  output = path.resolve(output);
  await mkdir(path.dirname(output), { recursive: true });
  const directory = await mkdtemp(path.join(path.dirname(output), ".pdf-package-"));
  try {
    await writeFile(path.join(directory, "source.pdf"), bytes);
    await writeFile(path.join(directory, "items.json"), JSON.stringify(items));
    await writeFile(path.join(directory, "pdf.json"), JSON.stringify(metadata));
    await writeFile(
      path.join(directory, "README.md"),
      "# PDF 通用包\n\n技能：`pdf`、`generic-package`\n\n写回入口：`writeback.mjs`\n\nnpm 依赖版本见 `pdf.json`。\n",
    );
    for (const name of PACKAGE_SCRIPTS)
      await copyFile(new URL(name, import.meta.url), path.join(directory, name));
    return { ...(await pack(directory, output)), pages: items.length, digest: document.digest };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** 在替换资产前将恢复资料另存到工作目录，待替换后的条目指纹可用再回填。 */
export async function migrateLegacy({ directory, output, recoveryPath }) {
  const { read_pdf_document } = await import("./document.mjs");
  const bytes = await readFile(path.join(directory, "source.pdf"));
  const raw = await readFile(path.join(directory, "legacy-pdf.json"), "utf8");
  const legacy = JSON.parse(raw);
  if (typeof legacy?.original_file_path !== "string" || !Array.isArray(legacy?.pages))
    throw new Error("Invalid legacy PDF archive.");
  const document = read_pdf_document(bytes);
  const unresolved = [];
  if (legacy.digest !== document.digest) unresolved.push("digest");
  if (
    legacy.pages.length !== document.pages.length ||
    legacy.pages.some((page, index) => page.page !== index + 1)
  )
    unresolved.push("page_order");
  if (legacy.raw_pages?.length) unresolved.push("raw_pages");
  if (
    legacy.pages.some(
      ({ translation }) =>
        translation !== null &&
        (translation?.kind === "translate"
          ? typeof translation.markdown !== "string"
          : translation?.kind !== "keep" && translation?.kind !== "omit"),
    )
  )
    unresolved.push("disposition");
  if (unresolved.length) return { unresolved };

  await writeFile(recoveryPath, raw, { flag: "wx" });
  const packed = await pack_document(
    bytes,
    document,
    path.basename(legacy.original_file_path),
    output,
    legacy.pages,
  );
  return { ...packed, recoveryPath: path.resolve(recoveryPath) };
}

/** 快照必须来自成功替换后的工程。只回填未处理条目，并允许重试已应用的更新。 */
export async function legacyItemUpdates({ recoveryPath, itemsPath, filePath }) {
  const legacy = JSON.parse(await readFile(recoveryPath, "utf8"));
  const entries = (await readFile(itemsPath, "utf8"))
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .filter((item) => item.file_path === filePath);
  const by_row = new Map(entries.map((item) => [item.row_number, item]));
  if (!Array.isArray(legacy?.pages) || by_row.size !== legacy.pages.length)
    throw new Error("Legacy PDF and current item snapshot do not match.");
  return legacy.pages.flatMap(({ page, translation }) => {
    const item = by_row.get(page - 1);
    if (!item) throw new Error(`PDF page ${page} has no matching current item.`);
    if (translation === null) return [];
    const { item_id, fp } = item;
    const { kind } = translation;
    const update =
      kind === "translate"
        ? { item_id, fp, status: "PROCESSED", dst: translation.markdown }
        : { item_id, fp, status: "EXCLUDED" };
    if (item.status === update.status && (kind !== "translate" || item.dst === update.dst))
      return [];
    if (item.status === "PROCESSED" || item.status === "EXCLUDED" || item.dst)
      throw new Error(`PDF page ${page} already has a different disposition.`);
    return [update];
  });
}
