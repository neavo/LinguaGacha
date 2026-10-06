import { expect, it, vi } from "vitest";
import { execute_doing_request } from "./doing";

it("校验并保存规范化阶段，`null` 清空", async () => {
  const write = vi.fn(async () => {});
  const signal = new AbortController().signal;
  await execute_doing_request({ kind: "doing", text: " 检查章节 " }, signal, write);
  expect(write).toHaveBeenLastCalledWith("检查章节");
  await execute_doing_request({ kind: "doing", text: null }, signal, write);
  expect(write).toHaveBeenLastCalledWith(null);
});

it("非法或已取消的请求不写入会话", async () => {
  const write = vi.fn(async () => {});
  const controller = new AbortController();
  for (const request of [
    { kind: "doing", text: "" },
    { kind: "doing", text: null, extra: true },
    { kind: "other", text: "检查章节" },
  ]) {
    await expect(execute_doing_request(request, controller.signal, write)).rejects.toThrow();
  }
  const reason = new Error("停止");
  controller.abort(reason);
  await expect(
    execute_doing_request({ kind: "doing", text: null }, controller.signal, write),
  ).rejects.toBe(reason);
  expect(write).not.toHaveBeenCalled();
});

it("成功回执等待写入完成，写入失败返回原调用", async () => {
  const commit = Promise.withResolvers<void>();
  let settled = false;
  const failure = new Error("提交失败");
  const pending = execute_doing_request(
    { kind: "doing", text: "检查章节" },
    new AbortController().signal,
    () => commit.promise,
  ).finally(() => {
    settled = true;
  });
  try {
    await Promise.resolve();
    expect(settled).toBe(false);
  } finally {
    commit.resolve();
    await pending;
  }
  await expect(
    execute_doing_request(
      { kind: "doing", text: "检查章节" },
      new AbortController().signal,
      async () => {
        throw failure;
      },
    ),
  ).rejects.toBe(failure);
});
