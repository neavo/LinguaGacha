import { GAME_ENGINES } from "../../file/shared/game/engines";
import { is_game_file_type } from "../../../shared/project-source-formats";
import {
  normalize_project_asset_path,
  ProjectAssetPathIndex,
} from "../../../shared/project/project-asset-paths";
import path from "node:path";
import { GAME_FILES_MEMBER, read_game_container } from "../../file/shared/game/format";
import type { ReadableFile } from "../../file/shared/game/readable";
import { read_zip_members } from "../../file/shared/zip-members";
import type { NativeFs } from "../../../native/native-fs";

/** 按资产身份展开原稿，并生成原生游戏的可读视图。 */
export async function write_agent_workspace_sources(args: {
  nativeFs: NativeFs;
  sourceRoot: string;
  additionalFiles?: Readonly<Record<string, readonly string[]>>; // 资产路径到附加原稿的映射，附加原稿不生成可读视图。
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
    if (is_game_file_type(file.file_type)) {
      const { input, additional, game_files } = await read_game_container(
        content,
        file.file_path,
        GAME_ENGINES[file.file_type].create_adapter().has_metadata,
        args.additionalFiles?.[file.file_path],
      );
      await args.nativeFs.make_dir_async(target);
      const names = new ProjectAssetPathIndex(); // 清单、生成文件与原始成员冲突时中止，交由工作区清理整个投影。
      // input 包含格式元数据，按原字节展开，避免解析后重写改变原稿身份。
      for (const originals of [input, additional]) {
        for await (const [name, bytes] of read_member_bytes(originals)) {
          names.add(name);
          await args.nativeFs.write_file(path.join(target, name), bytes);
        }
      }
      if (game_files !== null) {
        names.add(GAME_FILES_MEMBER);
        await args.nativeFs.write_file(
          path.join(target, GAME_FILES_MEMBER),
          await game_files.async("uint8array"),
        );
      }
      for await (const [name, bytes] of GAME_ENGINES[file.file_type].workspace_projections?.(
        input,
      ) ?? []) {
        names.add(name);
        await args.nativeFs.write_file(path.join(target, name), bytes);
      }
    } else if (file.file_type === "EPUB") {
      await args.nativeFs.make_dir_async(target);
      for await (const [name, bytes] of read_member_bytes(
        await read_zip_members(content, file.file_path),
      ))
        await args.nativeFs.write_file(path.join(target, name), bytes);
    } else {
      await args.nativeFs.write_file(target, content);
    }
  }
}

/** 逐成员读取原件，避免为工作区展开额外缓存整包字节。 */
async function* read_member_bytes(
  files: ReadonlyMap<string, { async(type: "uint8array"): Promise<Uint8Array> }>,
): AsyncGenerator<ReadableFile> {
  for (const [name, member] of files) yield [name, await member.async("uint8array")];
}
