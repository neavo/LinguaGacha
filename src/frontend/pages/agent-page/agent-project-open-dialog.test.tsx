import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { build_project_translation_stats } from "@shared/project-translation-stats";
import type { ProjectPreviewResponse } from "@shared/project-preview";
import { AgentProjectOpenDialog } from "./agent-project-open-dialog";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  open: vi.fn(),
  error: vi.fn(),
  loaded: false,
  busy: false,
}));
vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: mocks.api }));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({ push_error_toast: mocks.error }));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({ project_snapshot: { loaded: mocks.loaded } }),
}));
vi.mock("@frontend/app/session/project-lifecycle/project-lifecycle-context", () => ({
  useProjectLifecycle: () => ({ busy: mocks.busy, request_open: mocks.open }),
}));

it.each([false, true])("预览完成前禁止打开，失败反馈并保留取消入口：失败 %s", async (failed) => {
  const request = Promise.withResolvers<ProjectPreviewResponse>();
  mocks.api.mockReturnValue(request.promise);
  mocks.open.mockClear();
  mocks.error.mockClear();
  mocks.loaded = false;
  mocks.busy = false;
  const on_close = vi.fn();
  const root = createRoot(document.createElement("div"));
  /** 保留弹窗实例以验证工程状态变化后的确认权限。 */
  const render = () =>
    root.render(<AgentProjectOpenDialog path="E:/project.lg" on_close={on_close} />);
  /** 通过共享弹窗的动作入口操作，避免依赖布局位置。 */
  const confirm = () =>
    document.body.querySelector<HTMLButtonElement>('[data-slot="alert-dialog-primary-action"]')!;
  try {
    await act(async () => render());
    expect(confirm().disabled).toBe(true);
    const error = new Error("cannot read project");
    await act(async () => {
      if (failed) request.reject(error);
      else
        request.resolve({
          preview: {
            file_paths: ["a.txt"],
            created_at: "",
            updated_at: "",
            translation_stats: build_project_translation_stats([]),
          },
        });
    });
    expect(confirm().disabled).toBe(failed);
    if (failed) {
      await act(async () => render());
      expect(mocks.error).toHaveBeenCalledExactlyOnceWith("app.feedback.load_failed", error);
      await act(async () =>
        document.body
          .querySelector<HTMLButtonElement>('[data-slot="alert-dialog-cancel"]')!
          .click(),
      );
      expect(on_close).toHaveBeenCalledOnce();
      expect(mocks.open).not.toHaveBeenCalled();
    } else {
      mocks.loaded = true;
      await act(async () => render());
      expect(confirm().disabled).toBe(true);
      mocks.loaded = false;
      mocks.busy = true;
      await act(async () => render());
      expect(confirm().disabled).toBe(true);
      mocks.busy = false;
      await act(async () => render());
      await act(async () => confirm().click());
      expect(mocks.open).toHaveBeenCalledExactlyOnceWith("E:/project.lg");
      expect(on_close).toHaveBeenCalledOnce();
    }
  } finally {
    await act(async () => root.unmount());
  }
});
