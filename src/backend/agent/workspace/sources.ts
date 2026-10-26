import { GAME_ENGINES } from "../../file/shared/game/engines";
import { is_game_file_type } from "../../../shared/project-source-formats";
import {
  normalize_project_asset_path,
  ProjectAssetPathIndex,
} from "../../../shared/project/project-asset-paths";
import path from "node:path";
import { GAME_FILES_MEMBER, read_game_container } from "../../file/shared/game/format";
import { read_zip_members } from "../../file/shared/zip-members";
import type { NativeFs } from "../../../native/native-fs";
import { source_diagnostic, type SourceDiagnostic } from "../../file/shared/game/preparation";

/** 当前原稿的准备问题，供 Agent 判断材料范围。完整异常链只进入应用日志。 */
export type WorkspaceSourceIssue = Readonly<{
  asset_path: string;
  member_path?: string;
  stage: "read" | "archive" | "write" | "reference";
  message: string;
}>;

/** 资产读取或文件写入失败时 `retry` 让下次准备只重试该资产。 */
export type WorkspaceSourceResult = Readonly<{
  file_path: string;
  retry: boolean;
  issues: readonly WorkspaceSourceIssue[];
}>;

/** 每个资产独立发布可靠原稿和参考，日志与问题记录来自同一诊断。 */
export async function write_agent_workspace_sources(args: {
  nativeFs: NativeFs;
  signal?: AbortSignal;
  sourceRoot: string;
  additionalFiles?: Readonly<Record<string, readonly string[]>>; // 资产路径到附加原稿的映射，附加原稿不生成参考。
  files: ReadonlyArray<{ file_path: string; file_type: string }>;
  readAsset: (file_path: string) => Buffer | null | Promise<Buffer | null>;
  report?: (asset: string, diagnostic: SourceDiagnostic) => void;
}): Promise<WorkspaceSourceResult[]> {
  const { signal } = args;
  signal?.throwIfAborted();
  const paths = new ProjectAssetPathIndex();
  for (const file of args.files) paths.add(file.file_path); // 资产路径冲突时拒绝展开。
  await args.nativeFs.make_dir_async(args.sourceRoot);
  const results: WorkspaceSourceResult[] = [];
  for (const file of args.files) {
    signal?.throwIfAborted();
    const target = path.join(args.sourceRoot, normalize_project_asset_path(file.file_path));
    // 重试先撤掉该资产旧成果。清理失败直接终止，不能将旧修订交给脚本。
    await args.nativeFs.remove_async(target, { recursive: true, force: true });
    let retry = false;
    const issues: WorkspaceSourceIssue[] = [];
    const report = (stage: WorkspaceSourceIssue["stage"], error: unknown, member?: string) => {
      const diagnostic = source_diagnostic(stage, error, member);
      args.report?.(file.file_path, diagnostic);
      issues.push({
        asset_path: file.file_path,
        ...(member === undefined ? {} : { member_path: member.split(path.sep).join("/") }),
        stage,
        message: diagnostic.error.message,
      });
    };
    /** 写入失败须隔离半成品，后续脚本只能读取完整文件。 */
    const write = async (name: string, bytes: Uint8Array) => {
      signal?.throwIfAborted();
      try {
        await args.nativeFs.write_file(name, bytes);
      } catch (error) {
        retry = true;
        report("write", error, path.relative(target, name) || undefined); // 普通资产本身没有成员路径。
        try {
          await args.nativeFs.remove_async(name, { force: true });
        } catch (cleanup) {
          throw new WorkspaceSourceCleanupError("Cannot isolate incomplete source file", {
            cause: new AggregateError([error, cleanup]),
          });
        }
      }
    };
    let content: Buffer | null;
    try {
      content = await args.readAsset(file.file_path);
      if (content === null) throw new Error("Project source asset is missing: " + file.file_path);
    } catch (error) {
      signal?.throwIfAborted();
      report("read", error);
      results.push({ file_path: file.file_path, retry: true, issues });
      continue;
    }
    signal?.throwIfAborted();
    try {
      if (is_game_file_type(file.file_type) || file.file_type === "EPUB") {
        const engine = is_game_file_type(file.file_type) ? GAME_ENGINES[file.file_type] : null;
        const container = engine
          ? await read_game_container(
              content,
              file.file_path,
              engine.create_adapter().has_metadata,
              args.additionalFiles?.[file.file_path],
            )
          : null;
        const originals = container
          ? new Map([...container.input, ...container.additional])
          : await read_zip_members(content, file.file_path);
        const names = new ProjectAssetPathIndex();
        for (const name of originals.keys()) names.add(name); // 失败成员仍占据原稿路径。
        for (const [name, member] of originals) {
          signal?.throwIfAborted();
          let bytes: Uint8Array;
          try {
            bytes = await member.async("uint8array");
          } catch (error) {
            signal?.throwIfAborted();
            report("archive", error, name);
            continue;
          }
          await write(path.join(target, name), bytes);
        }
        if (container?.game_files) {
          if (names.find_conflict(GAME_FILES_MEMBER) !== null)
            report("reference", new Error("File list conflicts with original"), GAME_FILES_MEMBER);
          else {
            names.add(GAME_FILES_MEMBER);
            await write(
              path.join(target, GAME_FILES_MEMBER),
              await container.game_files.async("uint8array"),
            );
          }
        }
        for await (const [name, bytes] of engine?.workspace_projections?.(
          container!.input,
          (member, error) => report("reference", error, member),
          signal,
        ) ?? []) {
          if (names.find_conflict(name) !== null) {
            report("reference", new Error("Reference path conflicts with original"), name);
            continue;
          }
          names.add(name);
          await write(path.join(target, name), bytes);
        }
      } else await write(target, content);
    } catch (error) {
      if (error instanceof WorkspaceSourceCleanupError) throw error;
      signal?.throwIfAborted();
      report("archive", error);
    }
    signal?.throwIfAborted();
    results.push({ file_path: file.file_path, retry, issues });
  }
  return results;
}

/** 无法隔离半成品时，服务必须阻止脚本执行。 */
class WorkspaceSourceCleanupError extends Error {}
