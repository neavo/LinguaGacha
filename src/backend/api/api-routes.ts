import type { AgentService } from "../agent/agent-service";
import type { AgentPersonalityService } from "../agent/agent-personality-service";
import type { AgentSkillsApi } from "../agent/agent-skills-service";
import type { Hono } from "hono";
import { Readable } from "node:stream";
import { AppError } from "../../shared/error";

import type { JsonRecord, JsonValue } from "../../domain/json";
import type { BackendServices } from "../bootstrap/backend-services";
import type { SettingsUpdateResponse } from "../../shared/settings";
import type { ApiPostJsonRoute, ApiRequestRoute } from "./api-request";
import { ok } from "./api-types";

/**
 * 公开路由只消费组合根和 Gateway 提供的传输适配器，不自行创建领域依赖。
 */
export interface ApiRouteContext {
  app: Hono;
  services: BackendServices<AgentService>;
  skills: AgentSkillsApi;
  personality: Pick<AgentPersonalityService, "read" | "save">;
  postJson: ApiPostJsonRoute;
  request: ApiRequestRoute;
  createEventStreamResponse: () => Response;
  readLogFiles: () => JsonValue;
  readLogPage: (body: JsonRecord) => Promise<JsonValue>;
  readLogDetail: (body: JsonRecord) => Promise<JsonValue>;
  recordRendererError: (body: JsonRecord) => JsonValue;
}

/**
 * 在唯一 API 注册文件集中绑定路径；这里只做协议分发，业务语义留在领域服务。
 */
export function register_api_routes(context: ApiRouteContext): void {
  const services = context.services;
  const request_data = ({ projectId: _projectId, ...data }: JsonRecord): JsonRecord => data;
  const scope = (id: unknown) => services.projects.require(id);
  const project = (body: JsonRecord) => scope(body.projectId);
  const require_agent = (projectId: unknown) => {
    const agent = scope(projectId).agent;
    if (agent === undefined) throw new AppError("runtime.disposed");
    return agent;
  };
  const chat = (body: JsonRecord) => require_agent(body.projectId);
  const query_chat = (params: URLSearchParams) => require_agent(params.get("projectId"));
  // 工程内相同的预览路径在重置后可以指向其他文件。
  const preview_agent = (projectId: unknown, chatId: unknown) => {
    const agent = require_agent(projectId);
    agent.assert_chat_identity(chatId);
    return agent;
  };

  context.postJson("/api/agent/personality/read", () => context.personality.read());
  context.postJson("/api/agent/personality/save", (body) => context.personality.save(body));
  context.postJson("/api/skills/delete", (body) => context.skills.delete(body));
  context.postJson("/api/skills/snapshot", () => context.skills.snapshot());
  context.postJson("/api/skills/enabled", (body) => context.skills.set_enabled(body));
  context.postJson("/api/skills/reorder", (body) => context.skills.reorder(body));
  context.postJson("/api/skills/tree", (body) => context.skills.tree(body));
  context.postJson("/api/skills/file/read", (body) => context.skills.read_file(body));
  context.postJson("/api/skills/file/save", (body) => context.skills.save_file(body));
  context.postJson("/api/skills/file/change", (body) => context.skills.change_file(body));

  context.app.get("/api/health", (hono_context) =>
    hono_context.json(
      ok({
        status: "ok",
        service: "linguagacha-backend",
        version: services.app.metadata.read_version(),
      }),
    ),
  );
  context.postJson("/api/logs/files", () => context.readLogFiles());
  context.postJson("/api/logs/page", (body) => context.readLogPage(body));
  context.postJson("/api/logs/detail", (body) => context.readLogDetail(body));
  context.postJson("/api/diagnostics/renderer-error", (body) => context.recordRendererError(body));

  context.postJson("/api/project/knowledge/read", (body) => project(body).knowledge.read());
  context.postJson("/api/project/knowledge/save", (body) =>
    project(body).knowledge.save(request_data(body)),
  );
  const lifecycle = services.lifecycle;
  context.postJson("/api/session/project/manifest", (body) =>
    services.read_manifest(project(body)),
  );
  context.postJson("/api/session/project/snapshot", (body) =>
    services.project_snapshot(project(body)),
  );
  context.postJson("/api/session/project/close", (body) => services.close_project(body.projectId));
  context.postJson("/api/session/project/preview", (body) => lifecycle.get_project_preview(body));
  context.postJson("/api/session/project/default-name", (body) =>
    lifecycle.get_default_project_name(body),
  );
  context.postJson("/api/session/project/open", (body) => services.open_project(body));
  context.postJson("/api/session/project/create", (body) => services.create_project(body));

  context.app.get("/api/session/projects", (request) => request.json(ok(services.list_projects())));
  context.postJson("/api/agent/reset", (body) => chat(body).reset());
  context.app.get("/api/events/stream", () => context.createEventStreamResponse());
  context.postJson("/api/runtime/snapshot", () => services.runtime.getSnapshot());
  context.app.get("/api/models/catalog/snapshot", (hono_context) =>
    hono_context.json(ok(services.modelCatalog.get_snapshot())),
  );
  context.request("GET", "/api/agent/files", async (request) =>
    Response.json(ok(await query_chat(new URL(request.url).searchParams).list_files())),
  );
  context.request("GET", "/api/agent/snapshot", async (request) =>
    Response.json(ok(await query_chat(new URL(request.url).searchParams).read_snapshot())),
  );
  context.postJson("/api/agent/message", (body) =>
    chat(body).input_command("send", request_data(body)),
  );
  context.postJson("/api/agent/input-status", (body) =>
    chat(body).input_command_status(request_data(body)),
  );
  context.request("POST", "/api/agent/uploads", async (request) => {
    const query = new URL(request.url).searchParams;
    const name = query.get("name");
    if (name === null || name === "") throw new AppError("request.validation_failed");
    return Response.json(
      ok(
        await query_chat(query).upload_file(
          name,
          request.body ??
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.close();
              },
            }),
          request.signal,
        ),
      ),
    );
  });
  context.request("GET", "/api/agent/uploads/:id", (request) => {
    const id = new URL(request.url).pathname.split("/").at(-1)!;
    const { file, stream } = query_chat(new URL(request.url).searchParams).read_upload(id);
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": file.imageMimeType ?? "application/octet-stream",
        "Content-Length": String(file.size),
        "Content-Disposition": `${file.imageMimeType === null ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  });
  context.postJson("/api/agent/workspace/file", (body) =>
    preview_agent(body.projectId, body.chatId).describe_workspace_file(body.path),
  );
  context.postJson("/api/agent/workspace/document", (body) =>
    preview_agent(body.projectId, body.chatId).read_workspace_document(body.path),
  );
  context.request("GET", "/api/agent/workspace/image", async (request) => {
    const query = new URL(request.url).searchParams;
    const agent = preview_agent(query.get("projectId"), query.get("chatId"));
    return create_image_response(await agent.read_workspace_image(query.get("path")));
  });
  context.request("GET", "/api/agent/tool-image", (request) => {
    const query = new URL(request.url).searchParams;
    const agent = preview_agent(query.get("projectId"), query.get("chatId"));
    return create_image_response(agent.read_tool_image(query.get("entryId"), query.get("index")));
  });
  context.postJson("/api/agent/workspace/activate-path", (body) =>
    preview_agent(body.projectId, body.chatId).activate_workspace_path(request_data(body)),
  );
  context.postJson("/api/agent/question/resolve", (body) =>
    chat(body).resolve_question(request_data(body)),
  );
  context.postJson("/api/agent/write-approval/resolve", (body) =>
    chat(body).resolve_write_approval(request_data(body)),
  );
  context.postJson("/api/agent/queue/update", (body) =>
    chat(body).update_queued_message(request_data(body)),
  );
  context.postJson("/api/agent/queue/delete", (body) =>
    chat(body).delete_queued_message(request_data(body)),
  );
  context.postJson("/api/agent/queue/reorder", (body) =>
    chat(body).reorder_queued_messages(request_data(body)),
  );
  context.postJson("/api/agent/queue/send", (body) =>
    chat(body).input_command("queue_send", request_data(body)),
  );
  context.postJson("/api/agent/round/fork", (body) =>
    chat(body).input_command("fork", request_data(body)),
  );
  context.postJson("/api/agent/round/revise", (body) =>
    chat(body).input_command("revise", request_data(body)),
  );
  context.postJson("/api/agent/continue", (body) =>
    chat(body).input_command("continue", request_data(body)),
  );
  context.postJson("/api/agent/context/compact", (body) => chat(body).compact_context());
  context.postJson("/api/agent/stop", (body) => chat(body).stop());

  context.postJson("/api/workbench/snapshot", (body) => project(body).summary.read());
  context.postJson("/api/project/translation-stats", (body) =>
    project(body).summary.read_translation_stats(),
  );
  context.postJson("/api/workbench/files/import", (body) =>
    project(body).content.import_files(request_data(body)),
  );
  context.postJson("/api/workbench/file/reset", (body) =>
    project(body).content.reset_files(request_data(body)),
  );
  context.postJson("/api/workbench/file/delete", (body) =>
    project(body).content.delete_files(request_data(body)),
  );
  context.postJson("/api/workbench/file/rename", (body) =>
    project(body).content.rename_file(request_data(body)),
  );
  context.postJson("/api/workbench/files/reorder", (body) =>
    project(body).content.reorder_files(request_data(body)),
  );
  context.postJson("/api/workbench/files/preview", (body) =>
    project(body).content.preview_import_files(request_data(body)),
  );
  context.postJson("/api/project/settings/update", (body) =>
    project(body).content.update_project_settings(request_data(body)),
  );
  context.postJson("/api/workbench/translation/reset", (body) =>
    project(body).content.reset_translation(request_data(body)),
  );

  context.postJson("/api/proofreading/query", (body) =>
    project(body).proofreading.query.query(request_data(body)),
  );
  context.postJson("/api/proofreading/items/update", (body) =>
    project(body).proofreading.commands.apply_item_changes(request_data(body)),
  );
  context.postJson("/api/proofreading/translations/clear", (body) =>
    project(body).proofreading.commands.clear_translations(request_data(body)),
  );
  context.postJson("/api/proofreading/items/replace-all", (body) =>
    project(body).proofreading.commands.replace_all(request_data(body)),
  );

  context.postJson("/api/quality/statistics/view", (body) =>
    project(body).quality.statistics.read(request_data(body)),
  );
  context.postJson("/api/quality/rules/query", (body) =>
    project(body).quality.rules.query(request_data(body)),
  );
  context.postJson("/api/quality/prompts/view", (body) =>
    project(body).quality.prompts.read(request_data(body)),
  );
  context.postJson("/api/quality/rules/update", (body) =>
    project(body).quality.rules.update(request_data(body)),
  );
  context.postJson("/api/quality/rules/import", (body) =>
    project(body).quality.rules.import_rules(request_data(body)),
  );
  context.postJson("/api/quality/rules/export", (body) =>
    project(body).quality.rules.export_rules(request_data(body)),
  );
  context.postJson("/api/quality/rules/presets", (body) =>
    project(body).quality.rules.list_rule_presets(request_data(body)),
  );
  context.postJson("/api/quality/rules/presets/read", (body) =>
    project(body).quality.rules.read_rule_preset(request_data(body)),
  );
  context.postJson("/api/quality/rules/presets/save", (body) =>
    project(body).quality.rules.save_rule_preset(request_data(body)),
  );
  context.postJson("/api/quality/rules/presets/rename", (body) =>
    project(body).quality.rules.rename_rule_preset(request_data(body)),
  );
  context.postJson("/api/quality/rules/presets/delete", (body) =>
    project(body).quality.rules.delete_rule_preset(request_data(body)),
  );
  context.postJson("/api/quality/prompts/template", (body) =>
    project(body).quality.prompts.get_template(request_data(body)),
  );
  context.postJson("/api/quality/prompts/save", (body) =>
    project(body).quality.prompts.save(request_data(body)),
  );
  context.postJson("/api/quality/prompts/import", (body) =>
    project(body).quality.prompts.read_import_text(request_data(body)),
  );
  context.postJson("/api/quality/prompts/export", (body) =>
    project(body).quality.prompts.export(request_data(body)),
  );
  context.postJson("/api/quality/prompts/presets", (body) =>
    project(body).quality.prompts.list_presets(request_data(body)),
  );
  context.postJson("/api/quality/prompts/presets/read", (body) =>
    project(body).quality.prompts.read_preset(request_data(body)),
  );
  context.postJson("/api/quality/prompts/presets/save", (body) =>
    project(body).quality.prompts.save_preset(request_data(body)),
  );
  context.postJson("/api/quality/prompts/presets/rename", (body) =>
    project(body).quality.prompts.rename_preset(request_data(body)),
  );
  context.postJson("/api/quality/prompts/presets/delete", (body) =>
    project(body).quality.prompts.delete_preset(request_data(body)),
  );

  context.postJson("/api/translation/files/generate", (body) =>
    project(body).generation.generate_files(request_data(body)),
  );

  context.postJson("/api/toolbox/game-font/inspect", (body) => services.gameFont.inspect(body));
  context.postJson("/api/toolbox/game-font/apply", (body) => services.gameFont.apply(body));
  context.postJson("/api/toolbox/translation-transfer/apply", (body) =>
    services.translationTransfer.apply(body),
  );

  const settings = services.app.settings;
  context.postJson("/api/settings/app", () => settings.get_app_settings());
  context.postJson("/api/settings/update", (body): SettingsUpdateResponse => ({
    ...services.app.settings.update_app_settings(body),
    accepted: true,
    changes: [],
  }));
  context.postJson("/api/settings/recent-projects/add", (body) =>
    settings.add_recent_project(body),
  );
  context.postJson("/api/settings/recent-projects/remove", (body) =>
    settings.remove_recent_project(body),
  );

  const models = services.model;
  context.postJson("/api/models/auth/snapshot", () => ({
    snapshot: services.modelAuth.snapshot(),
  }));
  context.postJson("/api/models/auth/login", () => services.modelAuth.login());
  context.postJson("/api/models/auth/cancel", (body) =>
    services.modelAuth.cancel_login(body["id"]),
  );
  context.postJson("/api/models/auth/logout", () => services.modelAuth.logout());
  context.app.get("/api/models/selection", (hono_context) =>
    hono_context.json(ok(models.get_selection_snapshot())),
  );
  context.postJson("/api/models/snapshot", () => models.get_snapshot());
  context.postJson("/api/models/update", (body) => models.update_model(body));
  context.postJson("/api/models/select", (body) => models.select_model(body));
  context.postJson("/api/models/add", (body) => models.add_model(body));
  context.postJson("/api/models/copy", (body) => models.copy_model(body));
  context.postJson("/api/models/delete", (body) => models.delete_model(body));
  context.postJson("/api/models/reset-preset", (body) => models.reset_preset_model(body));
  context.postJson("/api/models/reorder", (body) => models.reorder_model(body));
  context.postJson("/api/models/list-available", (body) => models.list_available_models(body));
  context.postJson("/api/models/test", (body) => models.test_model(body));

  context.postJson("/api/batch-translation/start", (body) =>
    project(body).batchTranslation.start(request_data(body)),
  );
  context.postJson("/api/batch-task/stop", async (body) => {
    const ids = body["run_ids"];
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      !ids.every((id): id is string => typeof id === "string" && id !== "")
    )
      throw new AppError("request.validation_failed");
    const tasks = project(body).batchTasks;
    const accepted = await tasks.request_stop(ids);
    return { accepted, batch_tasks: tasks.build_snapshot() };
  });
  context.postJson("/api/batch-task/snapshot", (body) => ({
    batch_tasks: project(body).batchTasks.build_snapshot(),
  }));
}

/** 图片响应禁止嗅探和缓存。直接打开 SVG 时隔离活动内容。 */
function create_image_response(image: { bytes: Uint8Array; mime: string }): Response {
  return new Response(new Uint8Array(image.bytes), {
    headers: {
      "Content-Type": image.mime,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      ...(image.mime === "image/svg+xml" && {
        "Content-Security-Policy": "default-src 'none'; sandbox",
      }),
    },
  });
}
