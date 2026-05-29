import type { ApiRouteContext } from "./route-types";

export function register_translation_routes(context: ApiRouteContext): void {
  context.postJson("/api/translation/files/export", () =>
    context.services.translation.files.export_files(),
  );
}
