import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { ProjectScopeContext } from "@frontend/app/navigation/project-scope-context";
import { ProjectPrefilterSettingDialog } from "./project-prefilter-setting-dialog";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
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
}));

it("按本工程占用受理保存，失败后可重试，同值直接关闭", async () => {
  const projectId = "project";
  const root = createRoot(document.createElement("div"));
  const close = vi.fn();
  const render = (runtime_locked: boolean) =>
    act(async () =>
      root.render(
        <LocaleProvider locale="zh-CN">
          <ProjectScopeContext value={{ projectId }}>
            <ProjectPrefilterSettingDialog
              field="mtool_optimizer_enable"
              enabled
              runtimeLocked={runtime_locked}
              onClose={close}
            />
          </ProjectScopeContext>
        </LocaleProvider>,
      ),
    );
  const action = (slot: "primary-action" | "secondary-action") =>
    document.querySelector<HTMLButtonElement>(`[data-slot="alert-dialog-${slot}"]`)!;

  try {
    await render(true);
    expect(action("primary-action").disabled).toBe(true);
    expect(action("secondary-action").disabled).toBe(true);

    await render(false);
    await act(async () => action("primary-action").click());
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.api).not.toHaveBeenCalled();

    mocks.api.mockRejectedValueOnce(new Error("write failed"));
    await act(async () => action("secondary-action").click());
    expect(mocks.report_error).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();

    mocks.api.mockResolvedValueOnce({ accepted: true, changes: [] });
    await act(async () => action("secondary-action").click());
    expect(mocks.api).toHaveBeenLastCalledWith("/api/project/settings/update", {
      projectId,
      mtool_optimizer_enable: false,
    });
    expect(close).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
  }
});
