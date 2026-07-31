import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { register_text_context_menu } from "./text-context-menu";

const electron_mock = vi.hoisted(() => {
  const popup = vi.fn();
  const build_from_template = vi.fn(() => ({ popup }));

  return { build_from_template, popup };
});

vi.mock("electron", () => ({
  Menu: {
    buildFromTemplate: electron_mock.build_from_template,
  },
}));

/** 使用 Node 事件模型模拟 Electron webContents 的 context-menu 入口。 */
function create_target_window(): {
  target_window: Electron.BrowserWindow;
  emit_context_menu: (params: Electron.ContextMenuParams) => void;
} {
  const web_contents = new EventEmitter();
  const target_window = { webContents: web_contents } as unknown as Electron.BrowserWindow;
  register_text_context_menu(target_window);

  return {
    target_window,
    emit_context_menu: (params) => web_contents.emit("context-menu", {}, params),
  };
}

/** 构造 Chromium 上下文菜单参数，只让用例覆盖与当前规则相关的字段。 */
function create_context_menu_params(
  overrides: Partial<Omit<Electron.ContextMenuParams, "editFlags">> = {},
  edit_flags: Partial<Electron.ContextMenuParams["editFlags"]> = {},
): Electron.ContextMenuParams {
  return {
    formControlType: "none",
    isEditable: false,
    selectionText: "",
    ...overrides,
    editFlags: {
      canUndo: false,
      canRedo: false,
      canCut: false,
      canCopy: false,
      canPaste: false,
      canDelete: false,
      canSelectAll: false,
      canEditRichly: false,
      ...edit_flags,
    },
  } as Electron.ContextMenuParams;
}

type ContextMenuCase = {
  name: string;
  params: Electron.ContextMenuParams;
  template: Electron.MenuItemConstructorOptions[] | null;
};

const CONTEXT_MENU_CASES: ContextMenuCase[] = [
  {
    name: "可编辑文本沿用 Chromium 的剪切、复制和粘贴状态",
    params: create_context_menu_params(
      { isEditable: true },
      { canCut: true, canCopy: true, canPaste: false },
    ),
    template: [
      { role: "cut", enabled: true },
      { role: "copy", enabled: true },
      { role: "paste", enabled: false },
    ],
  },
  {
    name: "只读非空选区只提供复制",
    params: create_context_menu_params({ selectionText: " \n" }, { canCopy: true }),
    template: [{ role: "copy" }],
  },
  {
    name: "无选区静态文本不创建菜单",
    params: create_context_menu_params(),
    template: null,
  },
  {
    name: "不可复制选区不创建菜单",
    params: create_context_menu_params({ selectionText: "不可复制" }),
    template: null,
  },
  {
    name: "纯数字输入框始终不创建菜单",
    params: create_context_menu_params(
      { formControlType: "input-number", isEditable: true, selectionText: "123" },
      { canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
    ),
    template: null,
  },
];

describe("register_text_context_menu", () => {
  it.each(CONTEXT_MENU_CASES)("$name", ({ params, template }) => {
    const { emit_context_menu, target_window } = create_target_window();

    emit_context_menu(params);

    if (template === null) {
      expect(electron_mock.build_from_template).not.toHaveBeenCalled();
      expect(electron_mock.popup).not.toHaveBeenCalled();
      return;
    }
    expect(electron_mock.build_from_template).toHaveBeenCalledWith(template);
    expect(electron_mock.popup).toHaveBeenCalledWith({ window: target_window });
  });
});
