import type {
  WorkbenchSelectorFileRecord,
  WorkbenchSelectorItemRecord,
} from "@/pages/workbench-page/types";

type BuildWorkbenchViewArgs = {
  files: Record<string, unknown>;
  items: Record<string, unknown>;
};

function isTranslatedStatus(status: string): boolean {
  return ["DONE", "PROCESSED", "PROCESSED_IN_PAST"].includes(status);
}

function normalizeWorkbenchFileRecord(value: unknown): WorkbenchSelectorFileRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return {
    rel_path: String((value as WorkbenchSelectorFileRecord).rel_path ?? ""),
    file_type: String((value as WorkbenchSelectorFileRecord).file_type ?? ""),
    sort_index: Number((value as WorkbenchSelectorFileRecord).sort_index ?? 0),
  };
}

function normalizeWorkbenchItemRecord(value: unknown): WorkbenchSelectorItemRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return {
    item_id: Number((value as WorkbenchSelectorItemRecord).item_id ?? 0),
    file_path: String((value as WorkbenchSelectorItemRecord).file_path ?? ""),
    status: String((value as WorkbenchSelectorItemRecord).status ?? ""),
  };
}

export function buildWorkbenchView(args: BuildWorkbenchViewArgs) {
  const item_values = Object.values(args.items)
    .map((item) => normalizeWorkbenchItemRecord(item))
    .filter((item): item is WorkbenchSelectorItemRecord => item !== null);
  const file_values = Object.values(args.files)
    .map((file) => normalizeWorkbenchFileRecord(file))
    .filter((file): file is WorkbenchSelectorFileRecord => file !== null)
    .sort((left_file, right_file) => {
      const sort_result = left_file.sort_index - right_file.sort_index;
      if (sort_result !== 0) {
        return sort_result;
      }

      return left_file.rel_path.localeCompare(right_file.rel_path, "zh-Hans-CN");
    });
  const entries = file_values.map((file) => {
    return {
      rel_path: file.rel_path,
      file_type: file.file_type,
      item_count: item_values.filter((item) => item.file_path === file.rel_path).length,
    };
  });

  return {
    entries,
    summary: {
      file_count: entries.length,
      total_items: item_values.length,
      translated: item_values.filter((item) => isTranslatedStatus(item.status)).length,
      translated_in_past: item_values.filter((item) => item.status === "PROCESSED_IN_PAST").length,
      error_count: item_values.filter((item) => item.status === "ERROR").length,
    },
  };
}
