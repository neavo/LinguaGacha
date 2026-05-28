import type { ApiRouteContext } from "./route-types";

export function register_project_routes(context: ApiRouteContext): void {
  const lifecycle = context.services.project.lifecycle;
  const data = context.services.project.data;
  const preview = context.services.workbench.filePreview;

  context.app.get("/api/events/stream", () => {
    return context.services.streams.api.create_stream_response();
  });
  context.postJson("/api/project/manifest", () =>
    data.build_manifest(context.services.project.sessionState.snapshot()),
  );
  context.postJson("/api/project/snapshot", () => lifecycle.get_project_snapshot());
  context.postJson("/api/project/unload", () => lifecycle.unload_project());
  context.postJson("/api/project/preview", (body) => lifecycle.get_project_preview(body));
  context.postJson("/api/project/source-files", (body) => lifecycle.collect_source_files(body));
  context.postJson("/api/project/create-preview", (body) => preview.build_create_preview(body));
  context.postJson("/api/project/load", (body) => lifecycle.load_project(body));
  context.postJson("/api/project/create-commit", (body) => lifecycle.create_project_commit(body));
  context.postJson("/api/project/open-preview", (body) =>
    lifecycle.get_open_alignment_preview(body),
  );
}
