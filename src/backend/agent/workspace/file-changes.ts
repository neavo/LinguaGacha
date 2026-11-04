import type { ParsedAgentWorkspaceChanges } from "./changes";
import type { ProjectContentService } from "../../project/project-content-service";
import type { AgentWorkspaceRejectedChange } from "../../project/agent-workspace-write";
import { resolve_project_file_layout } from "../../project/project-file-layout";
import { is_app_error } from "../../../shared/error";

/** 文件批次先完整预演，任何拒绝都阻止审批与来源准备。 */
export async function preview_file_changes(args: {
  parsed: ParsedAgentWorkspaceChanges;
  current: readonly { path: string; file_type: string }[];
  stale: boolean;
  resolve: (source: string) => string;
  inspect: ProjectContentService["inspect_sources"];
}): Promise<{
  files: ParsedAgentWorkspaceChanges["files"];
  rejected: AgentWorkspaceRejectedChange[];
  created: number;
}> {
  const { parsed } = args;
  const rejected = [...parsed.rejected];
  const files = {
    ...parsed.files,
    creates: parsed.files.creates.map((entry) => ({ ...entry })),
    updates: parsed.files.updates.map((entry) => ({ ...entry })),
  };
  const other = [
    ...parsed.batch.knowledge.map((row) => ({
      scope: "knowledge" as const,
      op: row.op,
      line: row.line,
      path: row.path,
    })),
    ...(["items", "pages", "prompts"] as const).flatMap((scope) =>
      parsed.batch[scope].map((row) => ({ scope, op: "update" as const, line: row.line })),
    ),
    ...Object.values(parsed.batch.quality).flatMap((group) =>
      (
        [
          ["create", group.creates],
          ["update", group.updates],
          ["delete", group.deletes],
        ] as const
      ).flatMap(([op, rows]) =>
        rows.map((row) => ({ scope: "quality" as const, op, line: row.line, kind: row.kind })),
      ),
    ),
  ];
  rejected.push(
    ...other.map((row) => ({
      ...row,
      reason: "invalid_change" as const,
      message: "文件变更需单独提交。",
    })),
  );
  // 拒绝定位保留原始输入路径，提交参数再解析成本机路径。
  const records = [
    ...files.creates.map((row) => ({
      op: "create" as const,
      line: row.line,
      source_path: row.source_path,
    })),
    ...files.updates.map((row) => ({
      op: "update" as const,
      line: row.line,
      file_path: row.file_path,
    })),
    ...files.deletes.map((row) => ({
      op: "delete" as const,
      line: row.line,
      file_path: row.file_path,
    })),
  ];
  const sources = [
    ...files.creates.map((row) => ({ row, op: "create" as const })),
    ...files.updates
      .filter((row) => row.source_path !== undefined)
      .map((row) => ({ row, op: "update" as const })),
  ];
  for (const { row, op } of sources) {
    try {
      row.source_path = args.resolve(row.source_path!);
    } catch (error) {
      rejected.push({
        scope: "files",
        op,
        line: row.line,
        source_path: row.source_path!,
        reason: "invalid_change",
        message: String(error),
      });
    }
  }
  if (args.stale)
    rejected.push(
      ...[...records, ...parsed.rejected.filter((row) => row.scope === "files")].map((row) => ({
        ...row,
        scope: "files" as const,
        reason: "fp_mismatch" as const,
      })),
    );
  for (const row of records) {
    if ("file_path" in row && !args.current.some((file) => file.path === row.file_path))
      rejected.push({ ...row, scope: "files", reason: "target_missing" });
    const same = records.filter((other) =>
      "file_path" in row
        ? "file_path" in other && other.file_path === row.file_path
        : "source_path" in other && other.source_path === row.source_path,
    );
    if (same.length > 1) rejected.push({ ...row, scope: "files", reason: "merge_conflict" });
  }
  if (rejected.length) return { files, rejected, created: 0 };
  try {
    resolve_project_file_layout(
      args.current,
      files.deletes.map((row) => row.file_path),
      files.updates,
    );
  } catch (error) {
    const details = is_app_error(error)
      ? { ...error.diagnostic_context, ...error.public_details }
      : {};
    const target = details["file_path"] ?? details["path"];
    const matches = files.updates.filter(
      (row) => row.file_path === target || row.new_file_path === target,
    );
    rejected.push(
      ...(matches.length ? matches : files.updates).map((row) => ({
        scope: "files" as const,
        op: "update" as const,
        line: row.line,
        file_path: row.file_path,
        reason: "invalid_change" as const,
        message: String(error),
        ...(typeof details["conflict"] === "string" ? { conflict: details["conflict"] } : {}),
      })),
    );
  }
  let created = 0;
  for (const { row, op } of sources) {
    try {
      const [inspection] = await args.inspect([row.source_path!], row.godot_pack_orders);
      if (
        !inspection ||
        inspection.file_count === 0 ||
        inspection.failures.length ||
        (op === "update" && inspection.file_count !== 1)
      )
        rejected.push({
          scope: "files",
          op,
          line: row.line,
          source_path: row.source_path!,
          reason: "source_failed",
          message:
            inspection?.failures.map((failure) => failure.message).join("\n") ||
            "No supported files found.",
        });
      else if (op === "create") created += inspection.file_count;
    } catch (error) {
      rejected.push({
        scope: "files",
        op,
        line: row.line,
        source_path: row.source_path!,
        reason:
          is_app_error(error) && error.code === "request.validation_failed"
            ? "invalid_change"
            : "source_failed",
        message: String(error),
      });
    }
  }
  return { files, rejected, created };
}
