import { dialog, type BrowserWindow } from "electron";
import path from "node:path";

import type { DesktopPathPickResult } from "../bridge/bridge-types";

/**
 * 打开保存路径选择框；空 default_name 表示只使用系统默认目录
 */
export async function pick_save_path(
  main_window: BrowserWindow | null,
  default_directory: string | null,
  default_name: string,
  filters: Electron.FileFilter[],
): Promise<DesktopPathPickResult> {
  const dialog_options: Electron.SaveDialogOptions = {
    filters,
  };
  if (default_directory !== null && default_directory !== "") {
    dialog_options.defaultPath =
      default_name === "" ? default_directory : path.join(default_directory, default_name);
  } else if (default_name !== "") {
    dialog_options.defaultPath = default_name;
  }
  const result =
    main_window === null
      ? await dialog.showSaveDialog(dialog_options)
      : await dialog.showSaveDialog(main_window, dialog_options);

  return {
    canceled: result.canceled || result.filePath === undefined,
    paths: result.filePath === undefined ? [] : [result.filePath],
  };
}
