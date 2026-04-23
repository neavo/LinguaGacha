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
  const item_count_by_file_path = new Map<string, number>();
  let translated = 0;
  let translated_in_past = 0;
  let error_count = 0;

  for (const item of item_values) {
    item_count_by_file_path.set(
      item.file_path,
      (item_count_by_file_path.get(item.file_path) ?? 0) + 1,
    );

    if (isTranslatedStatus(item.status)) {
      translated += 1;
    }
    if (item.status === "PROCESSED_IN_PAST") {
      translated_in_past += 1;
    }
    if (item.status === "ERROR") {
      error_count += 1;
    }
  }

  const entries = file_values.map((file) => {
    return {
      rel_path: file.rel_path,
      file_type: file.file_type,
      item_count: item_count_by_file_path.get(file.rel_path) ?? 0,
    };
  });

  return {
    entries,
    summary: {
      file_count: entries.length,
      total_items: item_values.length,
      translated,
      translated_in_past,
      error_count,
    },
  };
}
