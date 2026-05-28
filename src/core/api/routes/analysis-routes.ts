import type { ApiRouteContext } from "./route-types";

export function register_analysis_routes(context: ApiRouteContext): void {
  const query = context.services.workbench.query;
  const name_fields = context.services.analysis.nameFields;
  const data = context.services.project.data;
  const workbench = context.services.workbench.commands;
  const reset_preview = context.services.workbench.resetPreview;

  context.postJson("/api/project/query/name-field-extraction", (body) => name_fields.read(body));
  context.postJson("/api/project/query/analysis-glossary-import", (body) =>
    query.prepare_analysis_glossary_import(body),
  );
  context.postJson("/api/project/analysis/reset", (body) => workbench.apply_analysis_reset(body));
  context.postJson("/api/project/analysis/reset-preview", (body) =>
    reset_preview.preview_analysis_reset(body),
  );
  context.postJson("/api/project/analysis/candidates", () =>
    data.build_analysis_candidate_payload(context.requireLoadedProjectPath()),
  );
  context.postJson("/api/project/analysis/import-glossary", (body) =>
    workbench.import_analysis_glossary(body),
  );
}
