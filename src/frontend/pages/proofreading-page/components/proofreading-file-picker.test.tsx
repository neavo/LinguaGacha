import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProofreadingFilePicker } from "./proofreading-file-picker";
import type { ProofreadingFilterChoice } from "../proofreading-filter-state";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

it("全选覆盖整个工程并跟随新增文件，空选择与装饰条随实际选择更新", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let selected: ProofreadingFilterChoice<string> = { mode: "default" };
  let files = [
    { file_path: "chapter.txt", kind: "item" as const, count: 3 },
    { file_path: "appendix.pdf", kind: "page" as const, count: 2 },
  ];
  /** 受控选择随用户勾选更新，模拟页面拥有文件范围。 */
  function Probe() {
    const [choice, set_choice] = useState<ProofreadingFilterChoice<string>>(selected);
    selected = choice;
    return (
      <TooltipProvider>
        <ProofreadingFilePicker
          files={files}
          selection={choice}
          disabled={false}
          on_change={set_choice}
        />
      </TooltipProvider>
    );
  }
  try {
    await act(async () => root.render(<Probe />));
    const trigger = container.querySelector("button")!;
    expect(trigger.getAttribute("data-active")).toBe("true");
    await act(async () => trigger.click());
    const all = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => all.click());
    expect(selected).toEqual({ mode: "selected", values: [] });
    expect(trigger.hasAttribute("data-active")).toBe(false);
    await act(async () => all.click());
    expect(selected).toEqual({ mode: "default" });
    files = [...files, { file_path: "new.txt", kind: "item", count: 1 }];
    await act(async () => root.render(<Probe />));
    expect(all.checked).toBe(true);
    const pdf = document.querySelector<HTMLInputElement>('input[aria-label="appendix.pdf"]')!;
    vi.useFakeTimers();
    await act(async () => {
      pdf.focus();
      vi.runAllTimers();
    });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("appendix.pdf");
    vi.useRealTimers();

    await act(async () => pdf.click());
    expect(all.indeterminate).toBe(true);
    expect(trigger.getAttribute("data-active")).toBe("true");
    expect(selected).toEqual({ mode: "selected", values: ["chapter.txt", "new.txt"] });
    await act(async () => pdf.click());
    expect(selected.mode).toBe("selected");
    expect(trigger.getAttribute("data-active")).toBe("true");
    files = [];
    await act(async () => root.render(<Probe />));
    expect(trigger.hasAttribute("data-active")).toBe(false);
    expect(all.disabled).toBe(true);
    expect(document.querySelector('[role="status"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  }
});

it("目录折叠仍可勾选全部后代，重开浮层保留展开状态，行点击与勾选独立", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const files = [
    { file_path: "game/intro.rpy", kind: "item" as const, count: 3 },
    { file_path: "game/tl/zh/options.rpy", kind: "item" as const, count: 0 },
    { file_path: "game/tl/zh/manual.pdf", kind: "page" as const, count: 2 },
    { file_path: "outside.txt", kind: "item" as const, count: 1 },
  ];
  const changed = vi.fn();
  let selected: ProofreadingFilterChoice<string> = {
    mode: "selected",
    values: [files[1]!.file_path],
  };
  /** 用页面持有的选择集合验证目录操作，回调次数用于检查一次点击只更新一次。 */
  function Probe() {
    const [choice, set_choice] = useState(selected);
    selected = choice;
    return (
      <TooltipProvider>
        <ProofreadingFilePicker
          files={files}
          selection={choice}
          disabled={false}
          on_change={(next) => {
            changed(next);
            set_choice(next);
          }}
        />
      </TooltipProvider>
    );
  }
  // 按可见名称定位操作，保持断言聚焦展开与选择行为。
  const toggle = (name: string) =>
    document.querySelector<HTMLButtonElement>('button[aria-label="' + name + '"]')!;
  const checkbox = (name: string) =>
    [...document.querySelectorAll(".proofreading-page__file-row")]
      .find((row) => row.querySelector(".proofreading-page__file-name")?.textContent === name)!
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  try {
    await act(async () => root.render(<Probe />));
    const open = async () => {
      await act(async () => container.querySelector("button")!.click());
    };
    await open();
    expect(toggle("game").getAttribute("aria-expanded")).toBe("true");
    expect(toggle("game").querySelector('[data-slot="badge"]')?.textContent).toBe("1/3");
    expect(toggle("tl").getAttribute("aria-expanded")).toBe("false");
    expect(checkbox("game").indeterminate).toBe(true);
    await act(async () =>
      (toggle("game").querySelector('[data-slot="badge"]') as HTMLElement).click(),
    );
    expect(changed).not.toHaveBeenCalled();
    expect(toggle("tl")).toBeNull();

    expect(document.body.textContent).not.toContain("manual.pdf");
    expect(checkbox("game").indeterminate).toBe(true);
    await act(async () => checkbox("game").click());
    expect(changed).toHaveBeenCalledTimes(1);
    expect(selected).toEqual({
      mode: "selected",
      values: ["game/tl/zh/options.rpy", "game/intro.rpy", "game/tl/zh/manual.pdf"],
    });
    expect(checkbox("game").indeterminate).toBe(false);
    expect(checkbox("game").checked).toBe(true);
    expect(toggle("game").querySelector('[data-slot="badge"]')?.textContent).toBe("3/3");
    expect(toggle("game").getAttribute("aria-expanded")).toBe("false");
    expect(toggle("tl")).toBeNull();

    await act(async () => {
      document
        .querySelector("input")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector(".proofreading-page__file-picker")).toBeNull();
    await open();
    expect(toggle("game").getAttribute("aria-expanded")).toBe("false");

    await act(async () => toggle("game").click());
    await act(async () => toggle("tl").click());
    await act(async () => toggle("zh").click());
    const file_row = (name: string) => checkbox(name).closest(".proofreading-page__file-row")!;
    const calls_before = changed.mock.calls.length;
    await act(async () =>
      (file_row("manual.pdf").querySelector('[data-slot="badge"]') as HTMLElement).click(),
    );
    expect(changed).toHaveBeenCalledTimes(calls_before);
    const game_row = file_row("game") as HTMLElement;
    // 名称、空白和胶囊共用目录展开入口，勾选只由独立复选框负责。
    for (const target of [
      game_row.querySelector<HTMLElement>(".proofreading-page__file-name")!,
      game_row,
    ]) {
      await act(async () => target.click());
      expect(toggle("game").getAttribute("aria-expanded")).toBe("false");
      expect(changed).toHaveBeenCalledTimes(calls_before);
      await act(async () => toggle("game").click());
    }
    await act(async () => checkbox("game").click());
    expect(toggle("game").getAttribute("aria-expanded")).toBe("true");
    expect(toggle("game").querySelector('[data-slot="badge"]')?.textContent).toBe("0/3");
    expect(changed).toHaveBeenCalledTimes(calls_before + 1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
