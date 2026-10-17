import { read_wolf_sources } from "../../file/wolfrpg/readable";
import { is_game_file_type } from "../../../shared/project-source-formats";
import {
  normalize_project_asset_path,
  ProjectAssetPathIndex,
} from "../../../shared/project/project-asset-paths";
import path from "node:path";
import { read_game_container } from "../../file/shared/game/format";
import { read_rgss_sources } from "../../file/rpgmaker-rgss/readable";
import { read_zip_members } from "../../file/shared/zip-members";
import type { NativeFs } from "../../../native/native-fs";

/** 按资产身份展开原稿，并生成原生游戏的只读视图。 */
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
    if (is_game_file_type(file.file_type) || file.file_type === "EPUB") {
      const files = await (
        is_game_file_type(file.file_type) ? read_game_container : read_zip_members
      )(content, file.file_path);
      await args.nativeFs.make_dir_async(target);
      if (file.file_type === "RPGMAKER_RGSS" || file.file_type === "WOLFRPG") {
        const members = new ProjectAssetPathIndex();
        for await (const [name, content] of file.file_type === "WOLFRPG"
          ? read_wolf_sources(files)
          : read_rgss_sources(files)) {
          members.add(name); // 生成文件与原始成员冲突时中止，交由工作区清理整个投影。
          await args.nativeFs.write_file(path.join(target, name), content);
        }
      } else {
        for (const [name, member] of files)
          await args.nativeFs.write_file(path.join(target, name), await member.async("uint8array"));
      }
    } else {
      await args.nativeFs.write_file(target, content);
    }
  }
}
