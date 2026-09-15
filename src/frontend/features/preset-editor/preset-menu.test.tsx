import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PresetMenu } from "./preset-menu";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@frontend/widgets/app-dropdown-menu", () => ({
  AppDropdownMenu: (props: { children: ReactNode; onOpenChange: (open: boolean) => void }) => (
    <div>
      <button type="button" data-testid="open-menu" onClick={() => props.onOpenChange(true)}>
        打开
      </button>
      {props.children}
    </div>
  ),
  AppDropdownMenuTrigger: (props: { children?: ReactNode; render?: ReactNode }) => (
    <>{props.render ?? props.children}</>
  ),
  AppDropdownMenuContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AppDropdownMenuGroup: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AppDropdownMenuSeparator: () => <hr />,
  AppDropdownMenuSub: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AppDropdownMenuSubTrigger: (props: { children: ReactNode }) => <span>{props.children}</span>,
  AppDropdownMenuSubContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AppDropdownMenuItem: (props: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));

describe("PresetMenu", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }
    container?.remove();
    container = null;
    root = null;
  });

  function find_button(label: string): HTMLButtonElement {
    const button = [...(container?.querySelectorAll("button") ?? [])].find((candidate) =>
      candidate.textContent?.includes(label),
    );
    if (button === undefined) {
      throw new Error(`找不到按钮：${label}`);
    }
    return button;
  }

  it.each([false, true])(
    "工程写锁 %s 时仍可管理预设，仅应用和重置受限",
    async (project_write_disabled) => {
      const callbacks = {
        on_open: vi.fn(async () => {}),
        on_open_change: vi.fn(),
        on_apply: vi.fn(async () => {}),
        on_request_reset: vi.fn(),
        on_request_save: vi.fn(),
        on_request_rename: vi.fn(),
        on_request_delete: vi.fn(),
        on_set_default: vi.fn(async () => {}),
        on_cancel_default: vi.fn(async () => {}),
      };
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);

      await act(async () => {
        root?.render(
          <PresetMenu
            items={[
              { name: "内置", virtual_id: "builtin:default", type: "builtin" },
              { name: "用户", virtual_id: "user:demo.json", type: "user", is_default: true },
            ]}
            open
            project_write_disabled={project_write_disabled}
            trigger_label="预设"
            {...callbacks}
          />,
        );
      });

      await act(async () => {
        find_button("打开").click();
        find_button("app.action.reset").click();
        find_button("preset_editor.action.save").click();
        for (const apply_button of [
          ...(container?.querySelectorAll<HTMLButtonElement>("button") ?? []),
        ].filter((button) => button.textContent?.includes("preset_editor.action.apply"))) {
          apply_button.click();
        }
        find_button("preset_editor.action.set_default").click();
        find_button("preset_editor.action.rename").click();
        find_button("preset_editor.action.delete").click();
        find_button("preset_editor.action.cancel_default").click();
      });

      expect(callbacks.on_open_change).toHaveBeenCalledWith(true);
      expect(callbacks.on_open).toHaveBeenCalledOnce();
      expect(callbacks.on_request_reset).toHaveBeenCalledTimes(project_write_disabled ? 0 : 1);
      expect(callbacks.on_request_save).toHaveBeenCalledOnce();
      expect(callbacks.on_apply.mock.calls).toEqual(
        project_write_disabled ? [] : [["builtin:default"], ["user:demo.json"]],
      );
      expect(callbacks.on_set_default).toHaveBeenCalledWith("builtin:default");
      expect(callbacks.on_request_rename).toHaveBeenCalledWith(
        expect.objectContaining({ virtual_id: "user:demo.json" }),
      );
      expect(callbacks.on_request_delete).toHaveBeenCalledWith(
        expect.objectContaining({ virtual_id: "user:demo.json" }),
      );
      expect(callbacks.on_cancel_default).toHaveBeenCalledOnce();
    },
  );
});
