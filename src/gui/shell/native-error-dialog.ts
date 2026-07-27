import { dialog } from "electron";

/**
 * 显示 Electron 主进程原生错误提示，避免 GUI 入口层直接依赖 dialog 细节。
 */
export function show_native_error_dialog(title: string, message: string): void {
  dialog.showErrorBox(title, message);
}

/**
 * 退出路径使用容错提示，原生弹窗失败不能覆盖原始错误或阻断资源关闭。
 */
export function try_show_native_error_dialog(title: string, message: string): void {
  try {
    show_native_error_dialog(title, message);
  } catch {
    // 调用方已经处于退出路径，原生对话框失败不能覆盖原始错误或阻断资源关闭。
  }
}
