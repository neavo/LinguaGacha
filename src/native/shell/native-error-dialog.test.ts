import { describe, expect, it, vi } from "vitest";

const show_error_box = vi.hoisted(() => vi.fn());

vi.mock("electron", () => {
  return {
    dialog: {
      showErrorBox: show_error_box,
    },
  };
});

describe("原生错误弹窗", () => {
  it("显示原生错误提示", async () => {
    const { show_native_error_dialog } = await import("./native-error-dialog");

    show_native_error_dialog("启动失败", "端口不可用");

    expect(show_error_box).toHaveBeenCalledWith("启动失败", "端口不可用");
  });

  it("致命错误容错提示不会抛出原生弹窗异常", async () => {
    const { try_show_native_error_dialog } = await import("./native-error-dialog");
    show_error_box.mockImplementationOnce(() => {
      throw new Error("dialog failed");
    });

    expect(() => {
      try_show_native_error_dialog("致命错误", "已写入诊断日志");
    }).not.toThrow();
  });
});
