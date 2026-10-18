import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { File } from "lucide-react";
import { expect, it, vi } from "vitest";

import { PathSelectionCard } from "./path-selection-card";

it("引用指向选择按钮，清除独立触发，禁用后两个动作均不可用", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const ref = createRef<HTMLButtonElement>();
  const on_select = vi.fn();
  const on_clear = vi.fn();
  const props = {
    ref,
    icon: File,
    title: "选择文件",
    summary: { name: "source.txt" },
    clear_label: "清除",
    onClick: on_select,
    on_clear,
    on_path_drop: vi.fn(),
  };
  try {
    await act(async () => root.render(<PathSelectionCard {...props} />));
    const clear = container.querySelector<HTMLButtonElement>('button[aria-label="清除"]')!;
    await act(async () => ref.current!.click());
    await act(async () => clear.click());
    expect(on_select).toHaveBeenCalledTimes(1);
    expect(on_clear).toHaveBeenCalledTimes(1);

    await act(async () => root.render(<PathSelectionCard {...props} disabled />));
    await act(async () => ref.current!.click());
    await act(async () => clear.click());
    expect(on_select).toHaveBeenCalledTimes(1);
    expect(on_clear).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
