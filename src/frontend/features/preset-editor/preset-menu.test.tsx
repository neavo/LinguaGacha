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
  AppDropdownMenuTrigger: (props: { children: ReactNode }) => <>{props.children}</>,
  AppDropdownMenuContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AppDropdownMenuGroup: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AppDropdownMenuSeparator: () => <hr />,
  AppDropdownMenuSub: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AppDropdownMenuSubTrigger: (props: { children: ReactNode }) => <span>{props.children}</span>,
  AppDropdownMenuSubContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AppDropdownMenuItem: (props: {
    children: ReactNode;
    disabled?: boolean;
    onSelect?: () => void;
  }) => (
    <button type="button" disabled={props.disabled} onClick={props.onSelect}>
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

  it("菜单动作携带对应预设标识", async () => {
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
          readonly={false}
          trigger_label="预设"
          {...callbacks}
        />,
      );
    });

    await act(async () => {
      find_button("打开").click();
      find_button("app.action.reset").click();
      find_button("quality_editor.preset.save").click();
      for (const apply_button of [
        ...(container?.querySelectorAll<HTMLButtonElement>("button") ?? []),
      ].filter((button) => button.textContent?.includes("quality_editor.preset.apply"))) {
        apply_button.click();
      }
      find_button("quality_editor.preset.set_default").click();
      find_button("quality_editor.preset.rename").click();
      find_button("quality_editor.preset.delete").click();
      find_button("quality_editor.preset.cancel_default").click();
    });

    expect(callbacks.on_open_change).toHaveBeenCalledWith(true);
    expect(callbacks.on_open).toHaveBeenCalledOnce();
    expect(callbacks.on_request_reset).toHaveBeenCalledOnce();
    expect(callbacks.on_request_save).toHaveBeenCalledOnce();
    expect(callbacks.on_apply).toHaveBeenNthCalledWith(1, "builtin:default");
    expect(callbacks.on_apply).toHaveBeenNthCalledWith(2, "user:demo.json");
    expect(callbacks.on_set_default).toHaveBeenCalledWith("builtin:default");
    expect(callbacks.on_request_rename).toHaveBeenCalledWith(
      expect.objectContaining({ virtual_id: "user:demo.json" }),
    );
    expect(callbacks.on_request_delete).toHaveBeenCalledWith(
      expect.objectContaining({ virtual_id: "user:demo.json" }),
    );
    expect(callbacks.on_cancel_default).toHaveBeenCalledOnce();
  });
});
