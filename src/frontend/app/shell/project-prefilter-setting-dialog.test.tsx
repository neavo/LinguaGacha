import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { ProjectScopeContext } from "@frontend/app/navigation/project-scope-context";
import type { ProjectActivity } from "@shared/runtime-activity";
import { ProjectPrefilterSettingDialog } from "./project-prefilter-setting-dialog";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  projects: {} as Record<string, ProjectActivity>,
  report_error: vi.fn(),
}));

vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: mocks.api }));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_toast: vi.fn(),
  push_error_toast: mocks.report_error,
}));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({
    commit_project_write: ({ run }: { run: () => Promise<unknown> }) => run(),
  }),
  useRuntimeSnapshot: () => ({ projects: mocks.projects }),
}));

it("按本工程占用受理保存，失败后可重试，同值直接关闭", async () => {
  const projectId = "project";
  const busy = { batchTranslation: true, agent: false, projectWrite: false };
  const root = createRoot(document.createElement("div"));
  const close = vi.fn();
  const render = () =>
    act(async () =>
      root.render(
        <LocaleProvider locale="zh-CN">
          <ProjectScopeContext value={{ projectId }}>
            <ProjectPrefilterSettingDialog
              projectId={projectId}
              field="mtool_optimizer_enable"
              enabled
              onClose={close}
            />
          </ProjectScopeContext>
        </LocaleProvider>,
      ),
    );
  const action = (slot: "primary-action" | "secondary-action" | "cancel") =>
    document.querySelector<HTMLButtonElement>(`[data-slot="alert-dialog-${slot}"]`)!;

  try {
    mocks.projects = { [projectId]: busy };
    await render();
    expect(action("primary-action").disabled).toBe(true);
    expect(action("secondary-action").disabled).toBe(true);

    mocks.projects = { other: busy }; // 后台工程的占用不限制当前工程。
    await render();
    await act(async () => action("primary-action").click());
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.api).not.toHaveBeenCalled();

    mocks.api.mockRejectedValueOnce(new Error("write failed"));
    await act(async () => action("secondary-action").click());
    expect(mocks.report_error).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();

    const pending = Promise.withResolvers<{ accepted: true; changes: [] }>();
    mocks.api.mockReturnValueOnce(pending.promise);
    await act(async () => action("secondary-action").click());
    expect(action("cancel").disabled).toBe(true);
    expect(mocks.api).toHaveBeenLastCalledWith("/api/project/settings/update", {
      projectId,
      mtool_optimizer_enable: false,
    });
    await act(async () => pending.resolve({ accepted: true, changes: [] }));
    expect(close).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
  }
});
