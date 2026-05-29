import type { ApiRouteContext } from "./route-types";

export function register_logs_routes(context: ApiRouteContext): void {
  context.app.get("/api/logs/stream", () => {
    return context.createLogStreamResponse();
  });
  context.postJson("/api/logs/detail", (body) => context.readLogDetail(body));
}
