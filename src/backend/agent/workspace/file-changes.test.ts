import { expect, it } from "vitest";
import { AppError } from "../../../shared/error";
import { create_empty_agent_workspace_intent_batch } from "../../project/agent-workspace-write";
import type { ProjectContentService } from "../../project/project-content-service";
import type { ParsedAgentWorkspaceChanges } from "./changes";
import { preview_file_changes } from "./file-changes";

it.each([
  ["mixed", ["invalid_change"]],
  ["knowledge", ["invalid_change"]],
  ["duplicate", ["merge_conflict", "merge_conflict"]],
  ["source", ["source_failed"]],
  ["orders", ["invalid_change"]],
  ["rename", ["invalid_change"]],
] as const)("文件预演拒绝 %s 并定位冲突记录", async (kind, reasons) => {
  const create = { source_path: "work/input.txt", line: 1 };
  const parsed: ParsedAgentWorkspaceChanges = {
    batch: {
      ...create_empty_agent_workspace_intent_batch(),
      knowledge: kind === "knowledge" ? [{ line: 1, fp: "test", text: "note" }] : [],
      items: kind === "mixed" ? [{ item_id: 1, fp: "test", line: 1, update: { dst: "译文" } }] : [],
    },
    files: {
      replaces: [],
      creates: kind === "duplicate" ? [create, { ...create, line: 2 }] : [create],
      updates:
        kind === "rename"
          ? [{ file_path: "script.txt", new_file_path: "../bad.txt", line: 1 }]
          : [],
      deletes: [],
    },
    rejected: [],
  };
  const inspect: ProjectContentService["inspect_sources"] = async ([source_path]) => {
    if (kind === "orders") throw new AppError("request.validation_failed");
    return [
      {
        source_path: source_path!,
        files: kind === "source" ? [] : [{ path: source_path!, kind: "file" }],
        godot_packs: [],
        failures: [],
      },
    ];
  };
  const result = await preview_file_changes({
    parsed,
    current: [{ path: "script.txt", file_type: "TXT" }],
    stale: false,
    resolve: (source) => source,
    inspect,
  });
  expect(result.rejected.map((row) => row.reason)).toEqual(reasons);
  expect(result.rejected.map((row) => row.line)).toEqual(kind === "duplicate" ? [1, 2] : [1]);
});
