import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProofreadingFilePicker } from "./proofreading-file-picker";
import type { ProofreadingFileSelection } from "@shared/proofreading/proofreading-types";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

// happy-dom 不执行布局，提供滚动视口尺寸以运行真实虚拟列表。
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(320);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(440);
});
afterEach(() => vi.restoreAllMocks());

it("全选覆盖整个工程并跟随新增文件，空选择与装饰条随实际选择更新", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let selected: ProofreadingFileSelection = { mode: "default" };
  let files = [
    { file_path: "chapter.txt", internal_file_path: null, kind: "item" as const, count: 3 },
    { file_path: "appendix.pdf", internal_file_path: null, kind: "page" as const, count: 2 },
  ];
  /** 受控选择随用户勾选更新，模拟页面拥有文件范围。 */
  function Probe() {
    const [choice, set_choice] = useState<ProofreadingFileSelection>(selected);
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
    files = [...files, { file_path: "new.txt", internal_file_path: null, kind: "item", count: 1 }];
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
    expect(selected).toEqual({
      mode: "selected",
      values: [
        { file_path: "chapter.txt", internal_file_path: null },
        { file_path: "new.txt", internal_file_path: null },
      ],
    });
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
    { file_path: "game/intro.rpy", internal_file_path: null, kind: "item" as const, count: 3 },
    {
      file_path: "game/tl/zh/options.rpy",
      internal_file_path: null,
      kind: "item" as const,
      count: 0,
    },
    {
      file_path: "game/tl/zh/manual.pdf",
      internal_file_path: null,
      kind: "page" as const,
      count: 2,
    },
    { file_path: "outside.txt", internal_file_path: null, kind: "item" as const, count: 1 },
  ];
  const changed = vi.fn();
  let selected: ProofreadingFileSelection = {
    mode: "selected",
    values: [{ file_path: files[1]!.file_path, internal_file_path: null }],
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
      values: [
        { file_path: "game/tl/zh/options.rpy", internal_file_path: null },
        { file_path: "game/intro.rpy", internal_file_path: null },
        { file_path: "game/tl/zh/manual.pdf", internal_file_path: null },
      ],
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

it("容器默认折叠，子文件独立选择产生半选，同名内部目录独立展开", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const files = [
    {
      file_path: "a.trans",
      internal_file_path: "data/Actors.json",
      kind: "item" as const,
      count: 2,
    },
    { file_path: "a.trans", internal_file_path: "data/Map.json", kind: "item" as const, count: 3 },
    {
      file_path: "b.trans",
      internal_file_path: "data/Actors.json",
      kind: "item" as const,
      count: 1,
    },
  ];
  let selected: ProofreadingFileSelection = { mode: "selected", values: [] };
  function Probe() {
    const [selection, set_selection] = useState<ProofreadingFileSelection>(selected);
    selected = selection;
    return (
      <TooltipProvider>
        <ProofreadingFilePicker
          files={files}
          selection={selection}
          disabled={false}
          on_change={set_selection}
        />
      </TooltipProvider>
    );
  }
  const toggle = (scope: ParentNode, name: string) =>
    scope.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
  try {
    await act(async () => root.render(<Probe />));
    await act(async () => container.querySelector("button")!.click());
    const first = toggle(document, "a.trans");
    const second = toggle(document, "b.trans");
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector('input[aria-label="Actors.json"]')).toBeNull();
    await act(async () => first.click());
    await act(async () => toggle(document, "data").click());
    await act(async () =>
      document.querySelector<HTMLInputElement>('input[aria-label="Actors.json"]')!.click(),
    );
    expect(selected).toEqual({
      mode: "selected",
      values: [{ file_path: "a.trans", internal_file_path: "data/Actors.json" }],
    });
    expect(
      document.querySelector<HTMLInputElement>('input[aria-label="a.trans"]')!.indeterminate,
    ).toBe(true);
    expect(first.querySelector('[data-slot="badge"]')?.textContent).toBe("1/2");
    await act(async () => second.click());
    expect(
      document
        .querySelectorAll<HTMLButtonElement>('button[aria-label="data"]')[1]!
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(toggle(document, "data").getAttribute("aria-expanded")).toBe("true");
    await act(async () => first.click());
    await act(async () =>
      document.querySelector<HTMLInputElement>('input[aria-label="a.trans"]')!.click(),
    );
    expect(selected).toEqual({
      mode: "selected",
      values: [
        { file_path: "a.trans", internal_file_path: "data/Actors.json" },
        { file_path: "a.trans", internal_file_path: "data/Map.json" },
      ],
    });
    expect(first.getAttribute("aria-expanded")).toBe("false");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("大目录只挂载视口附近行，滚动后选择仍覆盖未挂载的叶子", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const files = Array.from({ length: 200 }, (_, index) => ({
    file_path: "game.trans",
    internal_file_path: `Map${index}.json`,
    kind: "item" as const,
    count: 1,
  }));
  const selected: { value: ProofreadingFileSelection } = { value: { mode: "default" } };
  function Probe() {
    const [selection, set_selection] = useState<ProofreadingFileSelection>(selected.value);
    selected.value = selection;
    return (
      <TooltipProvider>
        <ProofreadingFilePicker
          files={files}
          selection={selection}
          disabled={false}
          on_change={set_selection}
        />
      </TooltipProvider>
    );
  }
  try {
    await act(async () => root.render(<Probe />));
    await act(async () => container.querySelector("button")!.click());
    await act(async () =>
      document.querySelector<HTMLButtonElement>('button[aria-label="game.trans"]')!.click(),
    );
    expect(document.querySelectorAll(".proofreading-page__file-row").length).toBeLessThan(
      files.length,
    );
    expect(document.querySelector('input[aria-label="Map199.json"]')).toBeNull();
    const viewport = document.querySelector<HTMLDivElement>(".proofreading-page__file-options")!;
    await act(async () => {
      const content = viewport.querySelector<HTMLUListElement>("ul")!;
      viewport.scrollTop = Number.parseFloat(content.style.height) - viewport.offsetHeight;
      viewport.dispatchEvent(new Event("scroll"));
    });
    const last = document.querySelector<HTMLInputElement>('input[aria-label="Map199.json"]')!;
    expect(last).not.toBeNull();
    await act(async () => last.click());
    if (selected.value.mode !== "selected") throw new Error("未形成显式选择");
    expect(selected.value.values).toHaveLength(files.length - 1);
    expect(selected.value.values).toContainEqual({
      file_path: "game.trans",
      internal_file_path: "Map0.json",
    });
    expect(selected.value.values).not.toContainEqual({
      file_path: "game.trans",
      internal_file_path: "Map199.json",
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
