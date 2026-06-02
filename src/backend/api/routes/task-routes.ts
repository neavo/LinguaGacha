import type { ApiRouteContext } from "./route-types";

export function register_task_routes(context: ApiRouteContext): void {
  const tasks = context.services.engine.tasks;
  context.postJson("/api/tasks/start", (body) => tasks.start_task(body));
  context.postJson("/api/tasks/stop", (body) => tasks.stop_task(body));
  context.postJson("/api/tasks/snapshot", (body) => tasks.get_task_snapshot(body));
}
