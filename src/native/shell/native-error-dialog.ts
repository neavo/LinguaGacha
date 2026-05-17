import { dialog } from "electron";

/**
 * 显示 Electron main 侧原生错误提示，避免 lifecycle 和入口层直接依赖 dialog 细节。
 */
export function show_native_error_dialog(title: string, message: string): void {
  dialog.showErrorBox(title, message);
}

/**
 * fatal 退出路径使用容错提示，原生弹窗失败不能覆盖原始崩溃原因。
 */
export function try_show_native_error_dialog(title: string, message: string): void {
  try {
    show_native_error_dialog(title, message);
  } catch {
    // fatal 兜底已经处于退出路径，原生对话框失败不能覆盖原始崩溃原因。
  }
}
