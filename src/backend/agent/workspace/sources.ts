import {
  assert_project_asset_paths,
  normalize_project_asset_path,
} from "../../../shared/project/project-asset-paths";
import path from "node:path";

import type { NativeFs } from "../../../native/native-fs";

/** `project_meta` 中单个工作区文件与 `sources` 投影的对应关系。 */
export type AgentWorkspaceSourceFile = {
  file_path: string; // 工程内原始文件身份
  file_type: string; // items 使用的既有格式类型
};

/** 把 .lg 中保存的源资产投影为工作区可程序化探查的原始文件树。 */
export async function write_agent_workspace_sources(args: {
  nativeFs: NativeFs;
  sourceRoot: string;
  files: ReadonlyArray<{ file_path: string; file_type: string }>;
  readAsset: (file_path: string) => Buffer | null | Promise<Buffer | null>;
}): Promise<AgentWorkspaceSourceFile[]> {
  assert_project_asset_paths(args.files.map((file) => file.file_path));
  await args.nativeFs.make_dir_async(args.sourceRoot);
  const projected: AgentWorkspaceSourceFile[] = [];
  for (const file of args.files) {
    const relative_path = normalize_project_asset_path(file.file_path);
    const content = args.readAsset(file.file_path);
    if (content === null) throw new Error(`Project source asset is missing: ${file.file_path}`);
    await args.nativeFs.write_file(path.join(args.sourceRoot, relative_path), content);
    projected.push({ ...file, file_path: relative_path });
  }
  return projected;
}
