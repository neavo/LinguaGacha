import type { ApiRouteContext } from "./route-types";

export function register_workbench_routes(context: ApiRouteContext): void {
  const query = context.services.workbench.query;
  const workbench = context.services.workbench.commands;
  const preview = context.services.workbench.filePreview;
  const reset_preview = context.services.workbench.resetPreview;

  context.postJson("/api/workbench/snapshot", () => query.read_workbench_snapshot());
  context.postJson("/api/workbench/files/import", (body) => workbench.import_workbench_files(body));
  context.postJson("/api/workbench/file/reset", (body) => workbench.reset_workbench_file(body));
  context.postJson("/api/workbench/file/delete", (body) => workbench.delete_workbench_file(body));
  context.postJson("/api/workbench/files/reorder", (body) =>
    workbench.reorder_workbench_files(body),
  );
  context.postJson("/api/workbench/file/parse", (body) => preview.parse_workbench_file(body));
  context.postJson("/api/workbench/settings-alignment/apply", (body) =>
    workbench.apply_settings_alignment(body),
  );
  context.postJson("/api/workbench/translation/reset", (body) =>
    workbench.apply_translation_reset(body),
  );
  context.postJson("/api/workbench/translation/reset-preview", (body) =>
    reset_preview.preview_translation_reset(body),
  );
}
