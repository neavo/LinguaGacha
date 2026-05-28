import type { ApiRouteContext } from "./route-types";

export function register_export_routes(context: ApiRouteContext): void {
  context.postJson("/api/project/export-converted-translation", (body) =>
    context.services.export.tsConversion.export_converted_translation(body),
  );
  context.postJson("/api/tasks/generate-translation", () =>
    context.services.export.files.generate_translation(),
  );
}
