import type { Hono } from "hono";

import type { BackendServices } from "../bootstrap/backend-services";
import type { ApiPostJsonRoute } from "./api-json";
import { ok, type ApiJsonValue } from "./api-types";

/**
 * 公开路由只消费组合根和 Gateway 提供的传输适配器，不自行创建领域依赖。
 */
export interface ApiRouteContext {
  app: Hono;
  services: BackendServices;
  postJson: ApiPostJsonRoute;
  requireLoadedProjectPath: () => string;
  createLogStreamResponse: () => Response;
  readLogDetail: (body: Record<string, ApiJsonValue>) => ApiJsonValue;
  recordRendererError: (body: Record<string, ApiJsonValue>) => ApiJsonValue;
}

/**
 * 在唯一 API 注册文件集中绑定路径；这里只做协议分发，业务语义留在领域服务。
 */
export function register_api_routes(context: ApiRouteContext): void {
  const services = context.services;

  context.app.get("/api/health", (hono_context) =>
    hono_context.json(
      ok({
        status: "ok",
        service: "linguagacha-backend",
        version: services.app.metadata.read_version(),
      }),
    ),
  );
  context.app.get("/api/logs/stream", () => context.createLogStreamResponse());
  context.postJson("/api/logs/detail", (body) => context.readLogDetail(body));
  context.postJson("/api/diagnostics/renderer-error", (body) => context.recordRendererError(body));

  const lifecycle = services.project.lifecycle;
  const project_data = services.project.data;
  const file_preview = services.workbench.filePreview;
  context.postJson("/api/session/project/manifest", () =>
    project_data.build_manifest(services.project.sessionState.snapshot()),
  );
  context.postJson("/api/session/project/snapshot", () => lifecycle.get_project_snapshot());
  context.postJson("/api/session/project/close", () => lifecycle.unload_project());
  context.postJson("/api/session/project/preview", (body) => lifecycle.get_project_preview(body));
  context.postJson("/api/session/source-files/collect", (body) =>
    lifecycle.collect_source_files(body),
  );
  context.postJson("/api/session/project/create-preview", (body) =>
    file_preview.build_create_preview(body),
  );
  context.postJson("/api/session/project/open", (body) => lifecycle.load_project(body));
  context.postJson("/api/session/project/create", (body) => lifecycle.create_project_commit(body));
  context.postJson("/api/session/project/open-preview", (body) =>
    lifecycle.get_open_alignment_preview(body),
  );

  context.app.get("/api/events/stream", () => services.streams.api.create_stream_response());

  const workbench_query = services.workbench.query;
  const workbench = services.workbench.commands;
  const reset_preview = services.workbench.resetPreview;
  context.postJson("/api/workbench/snapshot", () => workbench_query.read_workbench_snapshot());
  context.postJson("/api/workbench/files/import", (body) => workbench.import_workbench_files(body));
  context.postJson("/api/workbench/file/reset", (body) => workbench.reset_workbench_file(body));
  context.postJson("/api/workbench/file/delete", (body) => workbench.delete_workbench_file(body));
  context.postJson("/api/workbench/files/reorder", (body) =>
    workbench.reorder_workbench_files(body),
  );
  context.postJson("/api/workbench/file/parse", (body) => file_preview.parse_workbench_file(body));
  context.postJson("/api/workbench/settings-alignment/apply", (body) =>
    workbench.apply_settings_alignment(body),
  );
  context.postJson("/api/workbench/translation/reset", (body) =>
    workbench.apply_translation_reset(body),
  );
  context.postJson("/api/workbench/translation/reset-preview", (body) =>
    reset_preview.preview_translation_reset(body),
  );

  const proofreading_query = services.proofreading.query;
  const proofreading = services.proofreading.commands;
  context.postJson("/api/proofreading/view", (body) => proofreading_query.read(body));
  context.postJson("/api/proofreading/item/save", (body) => proofreading.save_item(body));
  context.postJson("/api/proofreading/translations/clear", (body) =>
    proofreading.clear_translations(body),
  );
  context.postJson("/api/proofreading/items/set-status", (body) =>
    proofreading.set_translation_status(body),
  );
  context.postJson("/api/proofreading/items/replace-all", (body) => proofreading.replace_all(body));

  const quality_statistics = services.quality.statistics;
  const quality = services.quality.service;
  context.postJson("/api/quality/statistics/view", (body) => quality_statistics.read(body));
  context.postJson("/api/quality/rules/view", (body) =>
    workbench_query.read_quality_rule_view(body),
  );
  context.postJson("/api/quality/prompts/view", (body) => workbench_query.read_prompt_view(body));
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

  context.postJson("/api/analysis/glossary-import/preview", (body) =>
    workbench_query.prepare_analysis_glossary_import(body),
  );
  context.postJson("/api/analysis/reset", (body) => workbench.apply_analysis_reset(body));
  context.postJson("/api/analysis/reset-preview", (body) =>
    reset_preview.preview_analysis_reset(body),
  );
  context.postJson("/api/analysis/candidates/list", () =>
    project_data.build_analysis_candidate_payload(context.requireLoadedProjectPath()),
  );
  context.postJson("/api/analysis/glossary/import", (body) =>
    workbench.import_analysis_glossary(body),
  );

  context.postJson("/api/translation/files/export", () =>
    services.translation.files.export_files(),
  );
  context.postJson("/api/toolbox/ts-conversion/files/export", (body) =>
    services.toolbox.tsConversion.export_files(body),
  );

  const settings = services.app.settings;
  context.postJson("/api/settings/app", () => settings.get_app_settings());
  context.postJson("/api/settings/update", (body) => settings.update_app_settings(body));
  context.postJson("/api/settings/recent-projects/add", (body) =>
    settings.add_recent_project(body),
  );
  context.postJson("/api/settings/recent-projects/remove", (body) =>
    settings.remove_recent_project(body),
  );

  const models = services.models.service;
  context.postJson("/api/models/snapshot", () => models.get_snapshot());
  context.postJson("/api/models/update", (body) => models.update_model(body));
  context.postJson("/api/models/activate", (body) => models.activate_model(body));
  context.postJson("/api/models/add", (body) => models.add_model(body));
  context.postJson("/api/models/delete", (body) => models.delete_model(body));
  context.postJson("/api/models/reset-preset", (body) => models.reset_preset_model(body));
  context.postJson("/api/models/reorder", (body) => models.reorder_model(body));
  context.postJson("/api/models/list-available", (body) => models.list_available_models(body));
  context.postJson("/api/models/test", (body) => models.test_model(body));

  const tasks = services.engine.tasks;
  context.postJson("/api/tasks/start", (body) => tasks.start_task(body));
  context.postJson("/api/tasks/stop", (body) => tasks.stop_task(body));
  context.postJson("/api/tasks/snapshot", (body) => tasks.get_task_snapshot(body));
}
