import path from "node:path";

import JSZip from "jszip";

import { decode_text_content } from "../../../shared/utils/text-tool";
import type { NativeFs } from "../../../native/native-fs";

/** 当前受支持源格式中只有 EPUB 与 XLSX 需要展开容器。 */
const ARCHIVE_EXTENSIONS = new Set([".epub", ".xlsx"]);
/** 容器投影只保留可能承载正文、结构、公式或元数据的文本成员。 */
const ARCHIVE_TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".htm",
  ".js",
  ".json",
  ".ncx",
  ".opf",
  ".rels",
  ".smil",
  ".svg",
  ".txt",
  ".xhtml",
  ".xml",
]);

/** project_meta 中单个工程文件与 sources 投影的对应关系。 */
export type AgentWorkspaceSourceFile = {
  file_path: string; // 工程内原始文件身份
  file_type: string; // items 使用的既有格式类型
  source_text_path?: string; // 普通文本资产的工作区路径
  source_text_root?: string; // 容器资产的工作区文本树根
};

/** 把 .lg 中保存的源资产投影为工作区可程序化探查的纯文本树。 */
export async function write_agent_workspace_sources(args: {
  nativeFs: NativeFs;
  sourceRoot: string;
  files: ReadonlyArray<{ file_path: string; file_type: string }>;
  readAsset: (file_path: string) => Buffer | null;
}): Promise<AgentWorkspaceSourceFile[]> {
  await args.nativeFs.make_dir_async(args.sourceRoot);
  const projected: AgentWorkspaceSourceFile[] = [];
  for (const file of args.files) {
    const relative_path = normalize_source_relative_path(file.file_path);
    const content = args.readAsset(file.file_path);
    if (content === null) throw new Error(`Project source asset is missing: ${file.file_path}`);
    const extension = path.posix.extname(relative_path).toLowerCase();
    if (ARCHIVE_EXTENSIONS.has(extension)) {
      const source_text_root = `sources/${relative_path}`;
      await write_archive_text_entries(
        args.nativeFs,
        path.join(args.sourceRoot, ...relative_path.split("/")),
        content,
        extension,
      );
      projected.push({ ...file, source_text_root });
      continue;
    }
    const source_text_path = `sources/${relative_path}`;
    await args.nativeFs.write_file(
      path.join(args.sourceRoot, ...relative_path.split("/")),
      await decode_text_content(content),
    );
    projected.push({ ...file, source_text_path });
  }
  return projected;
}

/** 保留容器内部路径和标记语言，只排除图片、字体等二进制成员。 */
async function write_archive_text_entries(
  native_fs: NativeFs,
  output_root: string,
  content: Uint8Array,
  archive_extension: string,
): Promise<void> {
  await native_fs.make_dir_async(output_root);
  const archive = await JSZip.loadAsync(content);
  for (const entry of Object.values(archive.files)) {
    if (entry.dir || !is_archive_text_entry(entry.name, archive_extension)) continue;
    const relative_path = normalize_source_relative_path(entry.name);
    await native_fs.write_file(
      path.join(output_root, ...relative_path.split("/")),
      await decode_text_content(await entry.async("uint8array")),
    );
  }
}

/** EPUB 的无扩展名 mimetype 也属于文本，其余成员按扩展名收窄。 */
function is_archive_text_entry(entry_name: string, archive_extension: string): boolean {
  const normalized = entry_name.replaceAll("\\", "/");
  if (archive_extension === ".epub" && normalized === "mimetype") return true;
  return ARCHIVE_TEXT_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase());
}

/** 工程相对路径统一映射为正斜线，并拒绝逃逸 sources 根目录。 */
function normalize_source_relative_path(relative_path: string): string {
  const normalized = relative_path.replaceAll("\\", "/");
  if (
    normalized.includes("\0") ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(normalized)
  ) {
    throw new Error(`Invalid project source path: ${relative_path}`);
  }
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.includes(".") || parts.includes("..")) {
    throw new Error(`Invalid project source path: ${relative_path}`);
  }
  return parts.join("/");
}
