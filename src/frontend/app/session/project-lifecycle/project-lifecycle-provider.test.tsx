import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { push_error_toast } from "@frontend/app/feedback/desktop-toast";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { usePageLeave, type BeforePageLeave } from "@frontend/app/navigation/page-leave-context";
import { PageLeaveProvider } from "@frontend/app/navigation/page-leave-provider";
import type { ProjectRenameTarget } from "@frontend/app/state/desktop-state-context";
import { create_text_resolver } from "@shared/i18n";
import type { ProjectActivity } from "@shared/runtime-activity";
import { useProjectLifecycle } from "./project-lifecycle-context";
import { ProjectLifecycleProvider } from "./project-lifecycle-provider";

const desktop = vi.hoisted(() => ({
  rename_project: vi.fn(),
  open_projects: [] as Array<{ snapshot: { projectId: string } }>,
  projects: {} as Record<string, ProjectActivity>,
}));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => desktop,
  useRuntimeSnapshot: () => ({ projects: desktop.projects }),
}));
vi.mock("@frontend/app/feedback/desktop-toast", async (load) => ({
  ...(await load<typeof import("@frontend/app/feedback/desktop-toast")>()),
  push_error_toast: vi.fn(),
}));

const t = create_text_resolver("zh-CN");

beforeEach(() => {
  desktop.rename_project.mockReset();
  desktop.open_projects = [];
  desktop.projects = {};
});

it("最近工程改名校验并提交文件名主干", async () => {
  const target = { path: "E:/最近.lg" };
  const dialog = rename_dialog(target);
  try {
    await dialog.open();
    await dialog.change_name("不/合法");
    await dialog.confirm();
    expect(desktop.rename_project).not.toHaveBeenCalled();

    await dialog.change_name(" 改名 ");
    await dialog.confirm();
    expect(desktop.rename_project).toHaveBeenCalledWith(target, "改名");
    expect(dialog.read()).toBeNull();
  } finally {
    await dialog.dispose();
  }
});

it("已打开工程只在空闲且页面保存成功时提交，确认框随打开周期失效", async () => {
  const target = { projectId: "open-project" };
  const save = vi.fn<BeforePageLeave>().mockResolvedValueOnce(false).mockResolvedValue(true);
  const dialog = rename_dialog(target, save);
  desktop.open_projects = [{ snapshot: target }];
  try {
    await dialog.open();
    await dialog.change_name("新名");
    desktop.projects = {
      [target.projectId]: { agent: true, batchTranslation: false, projectWrite: false },
    };
    await dialog.render();
    expect(dialog.confirm_button().disabled).toBe(true);

    desktop.projects = {};
    await dialog.render();
    await dialog.confirm();
    expect(save).toHaveBeenCalled();
    expect(desktop.rename_project).not.toHaveBeenCalled();

    const failure = new Error("Target is occupied");
    desktop.rename_project.mockRejectedValueOnce(failure);
    await dialog.confirm();
    expect(desktop.rename_project).toHaveBeenCalledWith(target, "新名");
    expect(push_error_toast).toHaveBeenCalledWith(t("app.feedback.rename_failed"), failure);
    expect(dialog.read()?.querySelector("input")?.value).toBe("新名");

    desktop.open_projects = []; // 状态层补读发现旧周期已结束。
    await dialog.render();
    expect(dialog.read()).toBeNull();
  } finally {
    await dialog.dispose();
  }
});

/** 用同一真实确认框验证最近工程与打开工程。 */
function rename_dialog(target: ProjectRenameTarget, save?: BeforePageLeave) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  function RenameButton() {
    const { request_rename } = useProjectLifecycle();
    const { register_before_leave } = usePageLeave();
    useEffect(() => {
      if (save && "projectId" in target)
        return register_before_leave(save, { kind: "project", projectId: target.projectId });
    }, [register_before_leave, save, target]);
    return <button onClick={() => request_rename(target, "原名.lg")}>{t("project.rename")}</button>;
  }

  const render = () =>
    act(async () =>
      root.render(
        <LocaleProvider locale="zh-CN">
          <PageLeaveProvider>
            <ProjectLifecycleProvider before_open={async () => true} show_project={() => {}}>
              <RenameButton />
            </ProjectLifecycleProvider>
          </PageLeaveProvider>
        </LocaleProvider>,
      ),
    );
  const read = () => document.querySelector('[role="dialog"]');
  const confirm_button = () =>
    [...read()!.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith(t("app.action.confirm")),
    )!;
  return {
    render,
    read,
    confirm_button,
    async open() {
      await render();
      await act(async () => host.querySelector("button")!.click());
    },
    change_name: (name: string) =>
      act(async () => {
        const input = read()!.querySelector("input")!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          name,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }),
    confirm: () => act(async () => confirm_button().click()),
    async dispose() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
