import { type JSX, act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TranslationExportProvider } from "@frontend/app/session/translation-export/translation-export-provider";
import { useTranslationExport } from "@frontend/app/session/translation-export/translation-export-context";
import type { TranslationExportFlow } from "@frontend/features/translation-export/use-translation-export-flow";

const api_fetch = vi.hoisted(() =>
  vi.fn(async () => ({
    projectPath: "test.lg",
    snapshot: { entries: [{ file_type: "TXT" }] },
    sectionRevisions: { files: 0 },
    warningCount: 0,
  })),
);
vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch }));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_error_toast: vi.fn(),
  push_toast: vi.fn(),
}));
vi.mock("@frontend/app/navigation/navigation-context", () => ({
  useAppNavigation: () => ({ navigate_to_agent: vi.fn() }),
}));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({
    project_snapshot: { loaded: true, file_count: 1, path: "test.lg" },
    settings_snapshot: { translation_save_mode: "PROJECT", translation_fixed_path: "" },
  }),
}));
vi.mock("@frontend/features/translation-export/translation-export-dialog", () => ({
  TranslationExportDialog: ({ state }: TranslationExportFlow) =>
    state.phase === "closed" ? null : <div role="dialog" />,
}));

/** 两个入口模拟工作台与任务完成通知，共享当前工程的一次翻译成果导出流程。 */
function ExportEntry(): JSX.Element {
  const flow = useTranslationExport();
  return <button onClick={flow.request_export}>导出翻译成果</button>;
}

it("多个入口共享预检和确认，页面替换保留同一翻译成果导出弹窗", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <TranslationExportProvider>
          <ExportEntry />
          <ExportEntry />
        </TranslationExportProvider>,
      ),
    );
    await act(async () => {
      for (const button of container.querySelectorAll("button")) button.click();
    });
    expect(api_fetch).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    await act(async () =>
      root.render(
        <TranslationExportProvider>
          <ExportEntry />
        </TranslationExportProvider>,
      ),
    );
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    api_fetch.mockClear();
  }
});
