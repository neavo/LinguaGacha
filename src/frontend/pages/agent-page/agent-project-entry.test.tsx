import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { AgentProjectEntry } from "./agent-project-entry";
const mocks = vi.hoisted(() => ({
  loaded: false,
  busy: false,
  remove: vi.fn(),
  open: vi.fn(),
  create: vi.fn(),
  show_open: vi.fn(),
}));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({
    project_snapshot: { loaded: mocks.loaded },
    settings_snapshot: {
      recent_projects: Array.from({ length: 6 }, (_, i) => ({
        path: `E:/p${i}.lg`,
        name: `p${i}.lg`,
      })),
    },
  }),
}));
vi.mock("@frontend/app/session/project-lifecycle/project-lifecycle-context", () => ({
  useProjectLifecycle: () => ({
    busy: mocks.busy,
    remove_recent_project: mocks.remove,
    open_recent_project: mocks.open,
    show_create_dialog: mocks.create,
    request_open: mocks.show_open,
  }),
}));
it("工程入口连接公共流程，忙碌时禁用，工程加载后隐藏", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = () =>
    root.render(
      <LocaleProvider locale="zh-CN">
        <AgentProjectEntry attention={0} />
      </LocaleProvider>,
    );
  try {
    await act(async () => render());
    const buttons = container.querySelectorAll("button");
    expect(buttons[2]!.textContent).toBe("p0.lg");
    await act(async () => {
      buttons[0]!.click();
      buttons[1]!.click();
      buttons[2]!.click();
    });
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.show_open).toHaveBeenCalledOnce();
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith("E:/p0.lg");
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label="删除"]')!;
    await act(async () => remove.click());
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("E:/p0.lg");
    expect(mocks.open).toHaveBeenCalledOnce();
    mocks.busy = true;
    await act(async () => render());
    expect(
      Array.from(container.querySelectorAll("button")).every((button) => button.disabled),
    ).toBe(true);
    await act(async () => remove.click());
    expect(mocks.remove).toHaveBeenCalledOnce();
    mocks.loaded = true;
    await act(async () => render());
    expect(container.childElementCount).toBe(0);
  } finally {
    mocks.loaded = false;
    mocks.busy = false;
    await act(async () => root.unmount());
  }
});
