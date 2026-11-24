import { expect, it } from "vitest";
import { GlobalOperationGate, ProjectOperationGate } from "./runtime-operation-gate";

it("同时保留两条 Agent 执行与另一工程的任务，只互斥同工程的写入和翻译", async () => {
  const first = new ProjectOperationGate();
  const second = new ProjectOperationGate();
  const a = first.begin_runtime("agent");
  const b = first.begin_runtime("agent");
  expect(first.get_snapshot().activeChatCount).toBe(2);
  await expect(first.run_agent_project_write(() => "applied")).resolves.toBe("applied");
  const task = first.begin_runtime("batch_translation");
  const other = second.begin_runtime("batch_translation");
  await expect(first.run_project_write(() => {})).rejects.toMatchObject({ code: "runtime.busy" });
  expect(second.get_snapshot().batchTranslation).toBe(true);
  first.finish_runtime(task);
  first.finish_runtime(a);
  expect(first.get_snapshot().activeChatCount).toBe(1);
  first.finish_runtime(b);
  second.finish_runtime(other);
  expect(first.busy || second.busy).toBe(false);
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

it("全局模型测试不占用工程，实验室同步要求所有工程空闲", async () => {
  const global = new GlobalOperationGate(() => !project.busy);
  const project = new ProjectOperationGate((owner) => global.check_project(owner));
  const agent = project.begin_runtime("agent");
  const test = global.begin_runtime("model_test");
  expect(global.modelTest).toBe(true);
  await expect(global.run_laboratory(async () => {})).rejects.toMatchObject({
    code: "runtime.busy",
  });
  project.finish_runtime(agent);
  await expect(global.run_laboratory(async () => "saved")).resolves.toBe("saved");
  global.finish_runtime(test);
});
