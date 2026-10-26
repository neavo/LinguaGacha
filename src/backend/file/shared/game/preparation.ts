import path from "node:path";
import { to_log_error, type LogError } from "../../../../shared/error";
import type { GameDirectoryChanges } from "./directory";

/** 准备与参考生成共用的局部诊断，跨 Worker 只传可序列化异常。 */
export type SourceDiagnostic = Readonly<{
  stage: "read" | "write" | "prepare" | "archive" | "directory" | "reference";
  member?: string;
  error: LogError;
}>;

/** `null` 占住失败的最终来源，收集器不能回落到旧磁盘文件。 */
export type PreparedGameFiles = Readonly<{
  files: ReadonlyMap<string, string | null>;
  excluded: readonly string[];
}>;

/** 原稿来源与正式目录计划各自表达事实。 */
export type GamePreparation = Readonly<{
  sources: PreparedGameFiles;
  changes: GameDirectoryChanges | null; // null 表示不能完整转换，可靠来源仍可归档。
  diagnostics: readonly SourceDiagnostic[];
}>;

/** Worker 回包使用可序列化异常，保留局部失败的阶段与成员。 */
export function source_diagnostic(
  stage: SourceDiagnostic["stage"],
  error: unknown,
  member?: string,
): SourceDiagnostic {
  return { stage, ...(member === undefined ? {} : { member }), error: to_log_error(error) };
}

/** 完整准备从已验证的暂存结果确定来源，后续不再依赖目录提交。 */
export function complete_game_preparation(
  staging: string,
  changes: GameDirectoryChanges,
): GamePreparation {
  return {
    sources: {
      files: new Map(changes.writes.map((name) => [name, path.join(staging, name)])),
      excluded: changes.removes ?? [],
    },
    changes,
    diagnostics: [],
  };
}
