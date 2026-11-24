import { expect, it } from "vitest";
import { GlobalOperationGate, ProjectOperationGate } from "./runtime-operation-gate";

it("同一工程只接受一个 Agent 租约，不同工程可并行运行", async () => {
  const first = new ProjectOperationGate();
  const second = new ProjectOperationGate();
  const agent = first.begin_runtime("agent");
  expect(() => first.begin_runtime("agent")).toThrow(
    expect.objectContaining({ code: "runtime.busy" }),
  );
  const other = second.begin_runtime("agent");
  await expect(first.run_agent_project_write(() => "applied")).resolves.toBe("applied");
  const task = first.begin_runtime("batch_translation");
  await expect(first.run_project_write(() => {})).rejects.toMatchObject({ code: "runtime.busy" });
  first.finish_runtime(task);
  first.finish_runtime(agent);
  expect(first.get_snapshot().agent).toBe(false);
  expect(second.get_snapshot().agent).toBe(true);
  second.finish_runtime(other);
});

it("对话重置期间独占工程，租约释放后允许启动翻译和写入", async () => {
  const gate = new ProjectOperationGate();
  const reset = gate.begin_runtime("agent_reset");
  expect(gate.get_snapshot().agent).toBe(true);
  expect(() => gate.begin_runtime("batch_translation")).toThrow(
    expect.objectContaining({ code: "runtime.busy" }),
  );
  await expect(gate.run_project_write(() => {})).rejects.toMatchObject({ code: "runtime.busy" });
  gate.finish_runtime(reset);
  const batch = gate.begin_runtime("batch_translation");
  expect(() => gate.begin_runtime("agent_reset")).toThrow(
    expect.objectContaining({ code: "runtime.busy" }),
  );
  gate.finish_runtime(batch);
  await expect(gate.run_project_write(() => "applied")).resolves.toBe("applied");
});

it("关闭取消在途工程写入，并等真实写入收尾", async () => {
  const gate = new ProjectOperationGate();
  const finished = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<void>();
  const write = gate.run_project_write(async (signal) => {
    signal.addEventListener("abort", () => cancelled.resolve());
    await finished.promise;
  });
  const closing = gate.stop_project_writes();
  await cancelled.promise;
  expect(gate.get_snapshot().projectWrite).toBe(true);
  finished.resolve();
  await Promise.all([write, closing]);
  expect(gate.busy).toBe(false);
  await expect(gate.run_project_write(() => {})).rejects.toMatchObject({
    code: "runtime.disposed",
  });
});

it("全局模型测试和工程运行可以同时占用各自槽位", async () => {
  const global = new GlobalOperationGate(() => !project.busy);
  const project = new ProjectOperationGate((owner) => global.check_project(owner));
  const agent = project.begin_runtime("agent");
  const test = global.begin_runtime("model_test");
  expect(global.modelTest).toBe(true);
  await expect(project.run_agent_project_write(() => "saved")).resolves.toBe("saved");
  project.finish_runtime(agent);
  global.finish_runtime(test);
});
