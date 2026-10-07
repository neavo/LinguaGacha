import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { QualityRuleCommandBar } from "./quality-rule-command-bar";
import { TooltipProvider } from "@frontend/shadcn/tooltip";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
});

it("未就绪时禁止按钮与快捷键，工程占用期间仍允许导出与预设管理", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const create = vi.fn();
  const remove = vi.fn(async () => {});
  const export_entries = vi.fn(async () => {});
  const callbacks = {
    on_import: vi.fn(async () => {}),
    on_export: export_entries,
    on_open_preset_menu: vi.fn(async () => {}),
    on_apply_preset: vi.fn(async () => {}),
    on_request_reset: vi.fn(),
    on_request_save_preset: vi.fn(),
    on_request_rename_preset: vi.fn(),
    on_request_delete_preset: vi.fn(),
    on_set_default_preset: vi.fn(async () => {}),
    on_cancel_default_preset: vi.fn(async () => {}),
    on_preset_menu_open_change: vi.fn(),
  };
  /** 使用真实按钮与快捷键验证内容就绪和工程占用两个边界。 */
  async function render(ready: boolean, readonly = false) {
    await act(async () =>
      root!.render(
        <TooltipProvider>
          <QualityRuleCommandBar
            ready={ready}
            readonly={readonly}
            hint={<span>actual mode</span>}
            entry_actions={{
              create_label: "app.action.create",
              selected_entry_count: 1,
              on_create: create,
              on_delete_selected: remove,
            }}
            preset_items={[]}
            preset_menu_open={false}
            {...callbacks}
          />
        </TooltipProvider>,
      ),
    );
  }
  /** 按动作文案查找控件，避免依赖操作栏的排列顺序。 */
  const button = (label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
      item.textContent?.includes(label),
    )!;
  await render(false);
  expect(container.querySelector(".command-bar")).not.toBeNull();
  expect(container.textContent).not.toContain("app.action.loading");
  expect(container.textContent).not.toContain("actual mode");
  for (const label of [
    "app.action.create",
    "app.action.delete",
    "app.action.import",
    "app.action.export",
    "app.action.preset",
  ])
    expect(button(label).disabled).toBe(true);
  await act(async () => {
    button("app.action.export").click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }));
  });
  expect(create).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(export_entries).not.toHaveBeenCalled();
  await render(true);
  expect(container.textContent).toContain("actual mode");
  await act(async () =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", ctrlKey: true })),
  );
  expect(create).toHaveBeenCalledOnce();
  await render(true, true);
  expect(button("app.action.create").disabled).toBe(true);
  expect(button("app.action.export").disabled).toBe(false);
  expect(button("app.action.preset").disabled).toBe(false);
  await act(async () => button("app.action.export").click());
  expect(export_entries).toHaveBeenCalledOnce();
});
