import type { Hono } from "hono";

import type { BackendServices } from "../../bootstrap/backend-services";
import type { ApiPostJsonRoute } from "../api-json";
import type { ApiJsonValue } from "../api-types";

export interface ApiRouteContext {
  app: Hono;
  services: BackendServices;
  postJson: ApiPostJsonRoute;
  requireLoadedProjectPath: () => string;
  createLogStreamResponse: () => Response;
  readLogDetail: (body: Record<string, ApiJsonValue>) => ApiJsonValue;
  recordRendererError: (body: Record<string, ApiJsonValue>) => ApiJsonValue;
}
