import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import type { BrowserWindow } from "electron";
import { pick_save_path } from "./path-dialog";

const show_save_dialog = vi.hoisted(() => vi.fn());
vi.mock("electron", () => ({ dialog: { showSaveDialog: show_save_dialog } }));

// 原生对话框由系统隔离，测试直接观察路径组合和单路径结果。
describe("保存路径对话框", () => {
  beforeEach(() => show_save_dialog.mockReset());

  it("默认目录和文件名按调用输入组合，选定路径原样返回", async () => {
    const window = {} as BrowserWindow;
    const filters = [{ name: "Text", extensions: ["txt"] }];
    for (const [directory, name, expected] of [
      ["D:/recent", "report.txt", path.join("D:/recent", "report.txt")],
      [null, "report.txt", "report.txt"],
      ["D:/recent", "", "D:/recent"],
    ] as const) {
      show_save_dialog.mockResolvedValueOnce({ canceled: false, filePath: "E:/saved.txt" });
      await expect(pick_save_path(window, directory, name, filters)).resolves.toEqual({
        canceled: false,
        paths: ["E:/saved.txt"],
      });
      expect(show_save_dialog).toHaveBeenLastCalledWith(window, { defaultPath: expected, filters });
    }
  });

  it("无主窗口和默认位置时使用系统默认，取消返回空路径", async () => {
    show_save_dialog.mockResolvedValueOnce({ canceled: true });
    await expect(pick_save_path(null, null, "", [])).resolves.toEqual({
      canceled: true,
      paths: [],
    });
    expect(show_save_dialog).toHaveBeenCalledWith({ filters: [] });
  });
});
