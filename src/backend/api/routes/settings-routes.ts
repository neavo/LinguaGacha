import type { ApiRouteContext } from "./route-types";

export function register_settings_routes(context: ApiRouteContext): void {
  const settings = context.services.app.settings;
  context.postJson("/api/settings/app", () => settings.get_app_settings());
  context.postJson("/api/settings/update", (body) => settings.update_app_settings(body));
  context.postJson("/api/settings/recent-projects/add", (body) =>
    settings.add_recent_project(body),
  );
  context.postJson("/api/settings/recent-projects/remove", (body) =>
    settings.remove_recent_project(body),
  );
}
