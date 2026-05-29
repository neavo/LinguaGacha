import type { ApiRouteContext } from "./route-types";

export function register_diagnostics_routes(context: ApiRouteContext): void {
  context.postJson("/api/diagnostics/renderer-error", (body) => context.recordRendererError(body));
}
