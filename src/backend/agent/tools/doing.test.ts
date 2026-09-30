import { describe, expect, it, vi } from "vitest";
import { execute_doing_request } from "./doing";

describe("doing 脚本请求", () => {
  it("校验并立即写入规范化阶段，null 清空", () => {
    const write = vi.fn();
    const signal = new AbortController().signal;
    execute_doing_request({ kind: "doing", text: " 检查章节 " }, signal, write);
    expect(write).toHaveBeenLastCalledWith("检查章节");
    execute_doing_request({ kind: "doing", text: null }, signal, write);
    expect(write).toHaveBeenLastCalledWith(null);
  });

  it("非法或已取消的请求不写入会话", () => {
    const write = vi.fn();
    const controller = new AbortController();
    for (const request of [
      { kind: "doing", text: "" },
      { kind: "doing", text: null, extra: true },
      { kind: "other", text: "检查章节" },
    ]) {
      expect(() => execute_doing_request(request, controller.signal, write)).toThrow();
    }
    const reason = new Error("停止");
    controller.abort(reason);
    expect(() =>
      execute_doing_request({ kind: "doing", text: null }, controller.signal, write),
    ).toThrow(reason);
    expect(write).not.toHaveBeenCalled();
  });
});
