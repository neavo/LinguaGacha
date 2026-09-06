import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TranslationExportProvider, useTranslationExport } from "./translation-export-context";
import type { TranslationExportFlow } from "@frontend/features/translation-export/use-translation-export-flow";

const api_fetch = vi.hoisted(() =>
  vi.fn(async () => ({ projectPath: "test.lg", warningSummary: { total_count: 0, entries: [] } })),
);
vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch }));
vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  useDesktopToast: () => ({ push_toast: vi.fn() }),
}));
vi.mock("@frontend/app/navigation/navigation-context", () => ({
  useAppNavigation: () => ({ selected_route: "agent", navigate_to_route: vi.fn() }),
}));
vi.mock("@frontend/app/session/agent/agent-session-context", () => ({
  useAgentInput: () => ({
    read_draft: () => ({ text: "", attachments: [] }),
    write_draft: vi.fn(),
  }),
}));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({ project_snapshot: { loaded: true, path: "test.lg" } }),
}));
vi.mock("@frontend/features/translation-export/translation-export-dialog", () => ({
  TranslationExportDialog: ({ state }: TranslationExportFlow) =>
    state.phase === "closed" ? null : <div role="dialog" />,
}));

/** 两个入口模拟工作台与 Agent，共享当前工程的一次导出流程。 */
function ExportEntry(): JSX.Element {
  const flow = useTranslationExport();
  return <button onClick={flow.request_export}>生成译文</button>;
}

it("多个入口共享预检和确认，页面替换保留同一导出弹窗", async () => {
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
    expect(api_fetch).toHaveBeenCalledOnce();
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
