import { ok } from "../api-types";
import type { ApiRouteContext } from "./route-types";

export function register_health_routes(context: ApiRouteContext): void {
  context.app.get("/api/health", (hono_context) => {
    return hono_context.json(
      ok({
        status: "ok",
        service: "linguagacha-core",
        version: context.services.app.metadata.read_version(),
      }),
    );
  });
}
