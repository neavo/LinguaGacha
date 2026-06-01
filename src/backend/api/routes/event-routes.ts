import type { ApiRouteContext } from "./route-types";

export function register_event_routes(context: ApiRouteContext): void {
  context.app.get("/api/events/stream", () => {
    return context.services.streams.api.create_stream_response();
  });
}
