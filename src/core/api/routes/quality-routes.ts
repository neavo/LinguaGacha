import type { ApiRouteContext } from "./route-types";

export function register_quality_routes(context: ApiRouteContext): void {
  const query = context.services.workbench.query;
  const statistics = context.services.quality.statistics;
  const quality = context.services.quality.service;

  context.postJson("/api/project/query/quality-statistics", (body) => statistics.read(body));
  context.postJson("/api/project/query/quality-rule", (body) => query.read_quality_rule_view(body));
  context.postJson("/api/project/query/prompt", (body) => query.read_prompt_view(body));
  context.postJson("/api/quality/rules/save-entries", (body) => quality.save_rule_entries(body));
  context.postJson("/api/quality/rules/update-meta", (body) => quality.update_rule_meta(body));
  context.postJson("/api/quality/rules/import", (body) => quality.import_rules(body));
  context.postJson("/api/quality/rules/export", (body) => quality.export_rules(body));
  context.postJson("/api/quality/rules/presets", (body) => quality.list_rule_presets(body));
  context.postJson("/api/quality/rules/presets/read", (body) => quality.read_rule_preset(body));
  context.postJson("/api/quality/rules/presets/save", (body) => quality.save_rule_preset(body));
  context.postJson("/api/quality/rules/presets/rename", (body) => quality.rename_rule_preset(body));
  context.postJson("/api/quality/rules/presets/delete", (body) => quality.delete_rule_preset(body));
  context.postJson("/api/quality/prompts/template", (body) => quality.get_prompt_template(body));
  context.postJson("/api/quality/prompts/save", (body) => quality.save_prompt(body));
  context.postJson("/api/quality/prompts/import", (body) => quality.read_prompt_import_text(body));
  context.postJson("/api/quality/prompts/export", (body) => quality.export_prompt(body));
  context.postJson("/api/quality/prompts/presets", (body) => quality.list_prompt_presets(body));
  context.postJson("/api/quality/prompts/presets/read", (body) => quality.read_prompt_preset(body));
  context.postJson("/api/quality/prompts/presets/save", (body) => quality.save_prompt_preset(body));
  context.postJson("/api/quality/prompts/presets/rename", (body) =>
    quality.rename_prompt_preset(body),
  );
  context.postJson("/api/quality/prompts/presets/delete", (body) =>
    quality.delete_prompt_preset(body),
  );
}
