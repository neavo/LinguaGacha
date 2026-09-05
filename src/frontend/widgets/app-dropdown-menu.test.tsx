import { act, createRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuTrigger,
} from "./app-dropdown-menu";

it.each([false, true])("下拉菜单窗口失活后关闭并可重新展开，受控=%s", async (controlled) => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const actions = createRef<{ close: () => void; unmount: () => void }>();
  /** 同一关闭通知覆盖内部状态与消费方受控状态。 */
  function Menu(): JSX.Element {
    const [open, set_open] = useState(false);
    return (
      <AppDropdownMenu
        actionsRef={controlled ? actions : undefined}
        open={controlled ? open : undefined}
        onOpenChange={set_open}
      >
        <AppDropdownMenuTrigger>菜单</AppDropdownMenuTrigger>
        <AppDropdownMenuContent>选项</AppDropdownMenuContent>
      </AppDropdownMenu>
    );
  }
  try {
    await act(async () => root.render(<Menu />));
    const trigger = host.querySelector("button")!;
    await act(async () => trigger.click());
    expect(document.querySelector('[role="menu"][data-open]')).not.toBeNull();
    await act(async () => window.dispatchEvent(new Event("blur")));
    expect(document.querySelector('[role="menu"][data-open]')).toBeNull();
    expect(host.querySelector("button")).toBe(trigger);
    await act(async () => trigger.click());
    expect(document.querySelector('[role="menu"][data-open]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
