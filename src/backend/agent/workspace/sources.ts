import { is_rpgmaker_file_type } from "../../../shared/project-source-formats";
import {
  normalize_project_asset_path,
  ProjectAssetPathIndex,
} from "../../../shared/project/project-asset-paths";
import path from "node:path";
import { read_rpgmaker_container } from "../../file/rpgmaker-shared";
import { read_zip_members } from "../../file/zip-members";
import type { NativeFs } from "../../../native/native-fs";

/** 按资产身份写出原稿，RM 与 EPUB 在同名位置完整展开。 */
export async function write_agent_workspace_sources(args: {
  nativeFs: NativeFs;
  sourceRoot: string;
  files: ReadonlyArray<{ file_path: string; file_type: string }>;
  readAsset: (file_path: string) => Buffer | null | Promise<Buffer | null>;
}): Promise<void> {
  const paths = new ProjectAssetPathIndex();
  for (const file of args.files) paths.add(file.file_path);
  await args.nativeFs.make_dir_async(args.sourceRoot);
  for (const file of args.files) {
    const relative_path = normalize_project_asset_path(file.file_path);
    const content = await args.readAsset(file.file_path);
    if (content === null) throw new Error(`Project source asset is missing: ${file.file_path}`);
    const target = path.join(args.sourceRoot, relative_path);
    if (is_rpgmaker_file_type(file.file_type) || file.file_type === "EPUB") {
      const files = await (
        is_rpgmaker_file_type(file.file_type) ? read_rpgmaker_container : read_zip_members
      )(content, file.file_path);
      await args.nativeFs.make_dir_async(target);
      for (const [name, member] of files)
        await args.nativeFs.write_file(path.join(target, name), await member.async("uint8array"));
    } else {
      await args.nativeFs.write_file(target, content);
    }
  }
}
