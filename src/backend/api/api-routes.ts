import type { Hono } from "hono";

import type { JsonRecord, JsonValue } from "../../domain/json";
import type { BackendServices } from "../bootstrap/backend-services";
import type { ApiPostJsonRoute } from "./api-json";
import { ok } from "./api-types";

/**
 * 公开路由只消费组合根和 Gateway 提供的传输适配器，不自行创建领域依赖。
 */
export interface ApiRouteContext {
  app: Hono;
  services: BackendServices;
  postJson: ApiPostJsonRoute;
  createLogStreamResponse: () => Response;
  readLogDetail: (body: JsonRecord) => JsonValue;
  recordRendererError: (body: JsonRecord) => JsonValue;
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
  const file_preview = services.files.preview;
  context.postJson("/api/session/project/manifest", () => services.project.readManifest());
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

  context.app.get("/api/events/stream", () => services.create_event_stream_response());
  context.app.get("/api/agent/snapshot", (hono_context) =>
    hono_context.json(ok(services.agent.get_snapshot())),
  );
  context.postJson("/api/agent/message", (body) => services.agent.send_message(body));
  context.postJson("/api/agent/stop", () => services.agent.stop());
  context.postJson("/api/agent/reset", () => services.agent.reset());

  const project_content = services.project.content;
  const reset_preview = services.project.resetPreview;
  context.postJson("/api/workbench/snapshot", () => services.project.summary.read());
  context.postJson("/api/workbench/files/import", (body) => project_content.import_files(body));
  context.postJson("/api/workbench/file/reset", (body) => project_content.reset_files(body));
  context.postJson("/api/workbench/file/delete", (body) => project_content.delete_files(body));
  context.postJson("/api/workbench/files/reorder", (body) => project_content.reorder_files(body));
  context.postJson("/api/workbench/file/parse", (body) => file_preview.parse_project_file(body));
  context.postJson("/api/workbench/settings-alignment/apply", (body) =>
    project_content.align_settings(body),
  );
  context.postJson("/api/workbench/translation/reset", (body) =>
    project_content.reset_translation(body),
  );
  context.postJson("/api/workbench/translation/reset-preview", (body) =>
    reset_preview.preview_translation_reset(body),
  );

  const proofreading_query = services.proofreading.query;
  const proofreading = services.proofreading.commands;
  context.postJson("/api/proofreading/query", (body) => proofreading_query.query(body));
  context.postJson("/api/proofreading/items/update", (body) => proofreading.update_items(body));
  context.postJson("/api/proofreading/translations/clear", (body) =>
    proofreading.clear_translations(body),
  );
  context.postJson("/api/proofreading/items/set-status", (body) =>
    proofreading.set_translation_status(body),
  );
  context.postJson("/api/proofreading/items/replace-all", (body) => proofreading.replace_all(body));

  const quality_statistics = services.quality.statistics;
  const quality_rules = services.quality.rules;
  const prompts = services.quality.prompts;
  context.postJson("/api/quality/statistics/view", (body) => quality_statistics.read(body));
  context.postJson("/api/quality/rules/query", (body) => quality_rules.query(body));
  context.postJson("/api/quality/prompts/view", (body) => prompts.read(body));
  context.postJson("/api/quality/rules/update", (body) => quality_rules.update(body));
  context.postJson("/api/quality/rules/import", (body) => quality_rules.import_rules(body));
  context.postJson("/api/quality/rules/export", (body) => quality_rules.export_rules(body));
  context.postJson("/api/quality/rules/presets", (body) => quality_rules.list_rule_presets(body));
  context.postJson("/api/quality/rules/presets/read", (body) =>
    quality_rules.read_rule_preset(body),
  );
  context.postJson("/api/quality/rules/presets/save", (body) =>
    quality_rules.save_rule_preset(body),
  );
  context.postJson("/api/quality/rules/presets/rename", (body) =>
    quality_rules.rename_rule_preset(body),
  );
  context.postJson("/api/quality/rules/presets/delete", (body) =>
    quality_rules.delete_rule_preset(body),
  );
  context.postJson("/api/quality/prompts/template", (body) => prompts.get_template(body));
  context.postJson("/api/quality/prompts/save", (body) => prompts.save(body));
  context.postJson("/api/quality/prompts/import", (body) => prompts.read_import_text(body));
  context.postJson("/api/quality/prompts/export", (body) => prompts.export(body));
  context.postJson("/api/quality/prompts/presets", (body) => prompts.list_presets(body));
  context.postJson("/api/quality/prompts/presets/read", (body) => prompts.read_preset(body));
  context.postJson("/api/quality/prompts/presets/save", (body) => prompts.save_preset(body));
  context.postJson("/api/quality/prompts/presets/rename", (body) => prompts.rename_preset(body));
  context.postJson("/api/quality/prompts/presets/delete", (body) => prompts.delete_preset(body));

  context.postJson("/api/analysis/glossary-import/preview", (body) =>
    quality_rules.prepare_analysis_glossary_import(body),
  );
  context.postJson("/api/analysis/reset", (body) => project_content.reset_analysis(body));
  context.postJson("/api/analysis/reset-preview", (body) =>
    reset_preview.preview_analysis_reset(body),
  );
  context.postJson("/api/analysis/candidates/list", () =>
    services.project.readAnalysisCandidates(),
  );
  context.postJson("/api/analysis/glossary/import", (body) =>
    quality_rules.import_analysis_glossary(body),
  );

  context.postJson("/api/translation/files/export", () =>
    services.files.translationExport.export_files(),
  );
  context.postJson("/api/toolbox/ts-conversion/files/export", (body) =>
    services.files.tsConversionExport.export_files(body),
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

  const models = services.model;
  context.app.get("/api/models/selection", (hono_context) =>
    hono_context.json(ok(models.get_selection_snapshot())),
  );
  context.postJson("/api/models/snapshot", () => models.get_snapshot());
  context.postJson("/api/models/update", (body) => models.update_model(body));
  context.postJson("/api/models/select", (body) => models.select_model(body));
  context.postJson("/api/models/add", (body) => models.add_model(body));
  context.postJson("/api/models/delete", (body) => models.delete_model(body));
  context.postJson("/api/models/reset-preset", (body) => models.reset_preset_model(body));
  context.postJson("/api/models/reorder", (body) => models.reorder_model(body));
  context.postJson("/api/models/list-available", (body) => models.list_available_models(body));
  context.postJson("/api/models/test", (body) => models.test_model(body));

  const tasks = services.tasks;
  context.postJson("/api/tasks/start", (body) => tasks.start_task(body));
  context.postJson("/api/tasks/stop", (body) => tasks.stop_task(body));
  context.postJson("/api/tasks/snapshot", (body) => tasks.get_task_snapshot(body));
}
