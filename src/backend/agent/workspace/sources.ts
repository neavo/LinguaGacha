import path from "node:path";

import type { NativeFs } from "../../../native/native-fs";

/** project_meta 中单个工程文件与 sources 投影的对应关系。 */
export type AgentWorkspaceSourceFile = {
  file_path: string; // 工程内原始文件身份
  file_type: string; // items 使用的既有格式类型
};

/** 把 .lg 中保存的源资产投影为工作区可程序化探查的原始文件树。 */
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
    await args.nativeFs.write_file(path.join(args.sourceRoot, relative_path), content);
    projected.push({ ...file, file_path: relative_path });
  }
  return projected;
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
