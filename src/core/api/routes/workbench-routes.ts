import type { ApiRouteContext } from "./route-types";

export function register_workbench_routes(context: ApiRouteContext): void {
  const query = context.services.workbench.query;
  const workbench = context.services.workbench.commands;
  const preview = context.services.workbench.filePreview;
  const reset_preview = context.services.workbench.resetPreview;

  context.postJson("/api/project/query/workbench", () => query.read_workbench_view());
  context.postJson("/api/project/workbench/import-files", (body) =>
    workbench.import_workbench_files(body),
  );
  context.postJson("/api/project/workbench/reset-file", (body) =>
    workbench.reset_workbench_file(body),
  );
  context.postJson("/api/project/workbench/delete-file", (body) =>
    workbench.delete_workbench_file(body),
  );
  context.postJson("/api/project/workbench/reorder-files", (body) =>
    workbench.reorder_workbench_files(body),
  );
  context.postJson("/api/project/workbench/parse-file", (body) =>
    preview.parse_workbench_file(body),
  );
  context.postJson("/api/project/settings-alignment/apply", (body) =>
    workbench.apply_settings_alignment(body),
  );
  context.postJson("/api/project/translation/reset", (body) =>
    workbench.apply_translation_reset(body),
  );
  context.postJson("/api/project/translation/reset-preview", (body) =>
    reset_preview.preview_translation_reset(body),
  );
}
