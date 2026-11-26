import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { api_fetch, DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { push_error_toast, push_toast } from "@frontend/app/feedback/desktop-toast";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { PageLeaveProvider } from "@frontend/app/navigation/page-leave-provider";
import { create_text_resolver } from "@shared/i18n";
import { useProjectLifecycle } from "./project-lifecycle-context";
import { ProjectLifecycleProvider } from "./project-lifecycle-provider";

const apply_settings_snapshot = vi.hoisted(() => vi.fn());
vi.mock("@frontend/app/desktop/desktop-api", async (load) => ({
  ...(await load<typeof import("@frontend/app/desktop/desktop-api")>()),
  api_fetch: vi.fn(),
}));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({ apply_settings_snapshot }),
  useRuntimeSnapshot: () => ({}),
}));
vi.mock("@frontend/app/feedback/desktop-toast", async (load) => ({
  ...(await load<typeof import("@frontend/app/feedback/desktop-toast")>()),
  push_error_toast: vi.fn(),
  push_toast: vi.fn(),
}));

it("工程改名验证主干，写入失败保留输入，重试成功后应用设置快照", async () => {
  const t = create_text_resolver("zh-CN");
  const path = "E:/最近.lg";
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  function RenameButton() {
    const { request_rename } = useProjectLifecycle();
    return <button onClick={() => request_rename(path, "最近.lg")}>{t("project.rename")}</button>;
  }

  try {
    const error = new DesktopApiError({ code: "project.already_exists" });
    const snapshot = { settings: { recent_projects: [{ path: "E:/改名.lg", name: "改名.lg" }] } };
    vi.mocked(api_fetch).mockRejectedValueOnce(error).mockResolvedValueOnce(snapshot);
    await act(async () => {
      root.render(
        <LocaleProvider locale="zh-CN">
          <PageLeaveProvider>
            <ProjectLifecycleProvider before_open={async () => true} show_project={() => {}}>
              <RenameButton />
            </ProjectLifecycleProvider>
          </PageLeaveProvider>
        </LocaleProvider>,
      );
    });
    await act(async () => host.querySelector("button")!.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    const input = dialog.querySelector("input")!;
    const confirm = [...dialog.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith(t("app.action.confirm")),
    )!;
    expect(input.value).toBe("最近");
    expect(dialog.textContent).toContain(".lg");
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(input);
      expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
    });

    /** 输入与确认分属两个用户事件。 */
    async function submit(name: string): Promise<void> {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          name,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => confirm.click());
    }

    await submit("不/合法");
    expect(push_toast).toHaveBeenCalledWith("warning", t("app.feedback.invalid_file_name"));
    expect(api_fetch).not.toHaveBeenCalled();
    await submit("已占用");
    expect(push_error_toast).toHaveBeenCalledWith(t("app.feedback.rename_failed"), error);
    expect(document.querySelector('[role="dialog"] input')).toHaveProperty("value", "已占用");
    await submit(" 改名 ");
    expect(api_fetch).toHaveBeenLastCalledWith("/api/session/project/rename", {
      path,
      new_name: "改名",
    });
    expect(apply_settings_snapshot).toHaveBeenCalledWith(snapshot);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
