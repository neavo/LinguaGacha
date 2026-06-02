import type { ApiRouteContext } from "./route-types";

export function register_toolbox_routes(context: ApiRouteContext): void {
  context.postJson("/api/toolbox/ts-conversion/files/export", (body) =>
    context.services.toolbox.tsConversion.export_files(body),
  );
}
