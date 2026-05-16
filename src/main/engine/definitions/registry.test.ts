import { describe, expect, it } from "vitest";

import type { StartTaskCommand } from "../protocol/task-command";
import type { TaskDefinition } from "./task-definition";
import { TaskDefinitionRegistry } from "./registry";

describe("TaskDefinitionRegistry", () => {
  it("按 task_type 返回最新注册的 definition", () => {
    const registry = new TaskDefinitionRegistry();
    const first = create_definition("translation", "first");
    const second = create_definition("translation", "second");

    registry.register(first);
    registry.register(second);

    expect(
      registry.get({
        task_type: "translation",
        mode: "new",
        scope: { kind: "all" },
        expected_section_revisions: {},
      }),
    ).toBe(second);
  });

  it("未知任务类型不会回退到其它 definition", () => {
    const registry = new TaskDefinitionRegistry();
    registry.register(create_definition("translation", "translation"));

    expect(() =>
      registry.get({
        task_type: "analysis",
        mode: "new",
        expected_section_revisions: {},
      }),
    ).toThrow("runtime.internal_invariant");
  });
});

function create_definition(
  task_type: "translation",
  label: string,
): TaskDefinition<Extract<StartTaskCommand, { task_type: "translation" }>> & { label: string } {
  return {
    label,
    task_type,
    normalize_command: (command) => command,
    revision_dependencies: () => [],
    prepare_plan: () => ({ task_type, progress: {}, units: [] }),
    build_units: (plan) => plan.units,
    interpret_worker_result: () => ({
      retry_units: [],
      artifacts: [],
      progress_delta: {},
      terminal_error: null,
    }),
  };
}
