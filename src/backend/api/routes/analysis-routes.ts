import type { ApiRouteContext } from "./route-types";

export function register_analysis_routes(context: ApiRouteContext): void {
  const query = context.services.workbench.query;
  const data = context.services.project.data;
  const workbench = context.services.workbench.commands;
  const reset_preview = context.services.workbench.resetPreview;

  context.postJson("/api/analysis/glossary-import/preview", (body) =>
    query.prepare_analysis_glossary_import(body),
  );
  context.postJson("/api/analysis/reset", (body) => workbench.apply_analysis_reset(body));
  context.postJson("/api/analysis/reset-preview", (body) =>
    reset_preview.preview_analysis_reset(body),
  );
  context.postJson("/api/analysis/candidates/list", () =>
    data.build_analysis_candidate_payload(context.requireLoadedProjectPath()),
  );
  context.postJson("/api/analysis/glossary/import", (body) =>
    workbench.import_analysis_glossary(body),
  );
}
