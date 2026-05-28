import type { ApiRouteContext } from "./route-types";

export function register_proofreading_routes(context: ApiRouteContext): void {
  const query = context.services.proofreading.query;
  const proofreading = context.services.proofreading.commands;

  context.postJson("/api/project/query/proofreading", (body) => query.read(body));
  context.postJson("/api/project/proofreading/save-item", (body) => proofreading.save_item(body));
  context.postJson("/api/project/proofreading/clear-translations", (body) =>
    proofreading.clear_translations(body),
  );
  context.postJson("/api/project/proofreading/set-status", (body) =>
    proofreading.set_translation_status(body),
  );
  context.postJson("/api/project/proofreading/replace-all", (body) =>
    proofreading.replace_all(body),
  );
}
