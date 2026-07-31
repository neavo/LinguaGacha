import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";

/** 为应用窗口注册由 Chromium 编辑语义驱动的原生文本上下文菜单。 */
export function register_text_context_menu(target_window: BrowserWindow): void {
  target_window.webContents.on("context-menu", (_event, params) => {
    const template = resolve_text_context_menu_template(params);
    if (template.length === 0) {
      return;
    }

    Menu.buildFromTemplate(template).popup({ window: target_window });
  });
}

/** 只给可编辑文本或可复制选区构造菜单；数字框保留原生步进交互。 */
function resolve_text_context_menu_template(
  params: Electron.ContextMenuParams,
): MenuItemConstructorOptions[] {
  if (params.formControlType === "input-number") {
    return [];
  }

  if (params.isEditable) {
    return [
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
    ];
  }

  if (params.selectionText.length > 0 && params.editFlags.canCopy) {
    return [{ role: "copy" }];
  }

  return [];
}
