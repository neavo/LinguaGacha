import { create_text_resolver } from "@shared/i18n";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { AppTableDragIndicator } from "./app-table-drag-indicator";

let container: HTMLDivElement;
let root: Root | undefined;
const handle_ref = createRef<HTMLButtonElement>();

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
  root = undefined;
  vi.useRealTimers();
});

/** 在同一组件身份下更新能力与拖动状态。 */
async function render(disabled: boolean, dragging = false, show_tooltip = true): Promise<void> {
  await act(async () =>
    root?.render(
      <LocaleProvider locale="zh-CN">
        <TooltipProvider delay={0}>
          <AppTableDragIndicator
            row_number={3}
            disabled={disabled}
            dragging={dragging}
            handle_ref={handle_ref}
            show_tooltip={show_tooltip}
          />
        </TooltipProvider>
      </LocaleProvider>,
    ),
  );
}

/** 悬停外层触发器，覆盖原生禁用按钮的事件边界。 */
async function hover(): Promise<void> {
  const trigger = container.querySelector<HTMLElement>('[data-slot="tooltip-trigger"]')!;
  await act(async () => {
    trigger.dispatchEvent(
      new MouseEvent("mouseenter", { bubbles: true, clientX: 10, clientY: 10 }),
    );
    trigger.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 10, clientY: 10 }));
    vi.runAllTimers();
  });
}

it.each([false, true])("表格把手禁用=%s 时仍能悬停查看对应应用提示", async (disabled) => {
  await render(disabled);
  const button = container.querySelector("button")!;
  const label = create_text_resolver("zh-CN")(disabled ? "app.drag.disabled" : "app.drag.enabled");
  expect(button.disabled).toBe(disabled);
  expect(button.getAttribute("aria-label")).toBe(label);
  expect(handle_ref.current).toBe(button);
  await hover();
  expect(document.querySelector('[role="tooltip"][data-open]')?.textContent).toBe(label);
});

it("拖动开始时关闭已打开的提示，拖动期间保持关闭", async () => {
  await render(false);
  await hover();
  expect(document.querySelector('[role="tooltip"][data-open]')).not.toBeNull();
  await render(false, true);
  await hover();
  expect(document.querySelector('[role="tooltip"][data-open]')).toBeNull();
});

it("拖动浮层只显示序号和图标，不注册提示入口", async () => {
  await render(false, true, false);
  expect(container.querySelector('[data-slot="tooltip-trigger"]')).toBeNull();
});
