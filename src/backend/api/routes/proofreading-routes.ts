import type { ApiRouteContext } from "./route-types";

export function register_proofreading_routes(context: ApiRouteContext): void {
  const query = context.services.proofreading.query;
  const proofreading = context.services.proofreading.commands;

  context.postJson("/api/proofreading/view", (body) => query.read(body));
  context.postJson("/api/proofreading/item/save", (body) => proofreading.save_item(body));
  context.postJson("/api/proofreading/translations/clear", (body) =>
    proofreading.clear_translations(body),
  );
  context.postJson("/api/proofreading/items/set-status", (body) =>
    proofreading.set_translation_status(body),
  );
  context.postJson("/api/proofreading/items/replace-all", (body) => proofreading.replace_all(body));
}
