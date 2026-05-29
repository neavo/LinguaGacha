import type { ApiRouteContext } from "./route-types";

export function register_model_routes(context: ApiRouteContext): void {
  const models = context.services.models.service;
  context.postJson("/api/models/snapshot", () => models.get_snapshot());
  context.postJson("/api/models/update", (body) => models.update_model(body));
  context.postJson("/api/models/activate", (body) => models.activate_model(body));
  context.postJson("/api/models/add", (body) => models.add_model(body));
  context.postJson("/api/models/delete", (body) => models.delete_model(body));
  context.postJson("/api/models/reset-preset", (body) => models.reset_preset_model(body));
  context.postJson("/api/models/reorder", (body) => models.reorder_model(body));
  context.postJson("/api/models/list-available", (body) => models.list_available_models(body));
  context.postJson("/api/models/test", (body) => models.test_model(body));
}
