import { expect, it, vi } from "vitest";
import { execute_and_refresh_skills } from "./workspace-execution";

it.each(["success", "failure"])("执行 %s 后刷新技能并保留原结果", async (mode) => {
  const value = { result: "saved" };
  const failure = new Error("execution stopped");
  const refresh = vi.fn(async () => {});
  const result = execute_and_refresh_skills(async () => {
    if (mode === "failure") throw failure;
    return value;
  }, refresh);
  if (mode === "success") await expect(result).resolves.toBe(value);
  else await expect(result).rejects.toBe(failure);
  expect(refresh).toHaveBeenCalledOnce();
});

it("刷新失败保留执行主因和两次失败", async () => {
  const execution = new Error("execution failed");
  const refresh = new Error("refresh failed");
  await expect(
    execute_and_refresh_skills(
      async () => {
        throw execution;
      },
      async () => {
        throw refresh;
      },
    ),
  ).rejects.toMatchObject({ cause: execution, errors: [execution, refresh] });
});
