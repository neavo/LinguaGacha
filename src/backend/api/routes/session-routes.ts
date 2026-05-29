import type { ApiRouteContext } from "./route-types";

export function register_session_routes(context: ApiRouteContext): void {
  const lifecycle = context.services.project.lifecycle;
  const data = context.services.project.data;
  const preview = context.services.workbench.filePreview;

  context.postJson("/api/session/project/manifest", () =>
    data.build_manifest(context.services.project.sessionState.snapshot()),
  );
  context.postJson("/api/session/project/snapshot", () => lifecycle.get_project_snapshot());
  context.postJson("/api/session/project/close", () => lifecycle.unload_project());
  context.postJson("/api/session/project/preview", (body) => lifecycle.get_project_preview(body));
  context.postJson("/api/session/source-files/collect", (body) =>
    lifecycle.collect_source_files(body),
  );
  context.postJson("/api/session/project/create-preview", (body) =>
    preview.build_create_preview(body),
  );
  context.postJson("/api/session/project/open", (body) => lifecycle.load_project(body));
  context.postJson("/api/session/project/create", (body) => lifecycle.create_project_commit(body));
  context.postJson("/api/session/project/open-preview", (body) =>
    lifecycle.get_open_alignment_preview(body),
  );
}
