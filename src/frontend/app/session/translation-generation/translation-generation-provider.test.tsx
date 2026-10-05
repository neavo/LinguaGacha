import { type JSX, act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TranslationGenerationProvider } from "@frontend/app/session/translation-generation/translation-generation-provider";
import { useTranslationGeneration } from "@frontend/app/session/translation-generation/translation-generation-context";
import type { TranslationGenerationFlow } from "@frontend/features/translation-generation/use-translation-generation-flow";

const api_fetch = vi.hoisted(() =>
  vi.fn(async () => ({ projectPath: "test.lg", warningSummary: { total_count: 0, entries: [] } })),
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
  useAppNavigation: () => ({ selected_route: "agent", navigate_to_agent: vi.fn() }),
}));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({ project_snapshot: { loaded: true, path: "test.lg" } }),
}));
vi.mock("@frontend/features/translation-generation/translation-generation-dialog", () => ({
  TranslationGenerationDialog: ({ state }: TranslationGenerationFlow) =>
    state.phase === "closed" ? null : <div role="dialog" />,
}));

/** 两个入口模拟工作台与 Agent，共享当前工程的一次译文生成流程。 */
function GenerationEntry(): JSX.Element {
  const flow = useTranslationGeneration();
  return <button onClick={flow.request_generation}>生成译文</button>;
}

it("多个入口共享预检和确认，页面替换保留同一译文生成弹窗", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <TranslationGenerationProvider>
          <GenerationEntry />
          <GenerationEntry />
        </TranslationGenerationProvider>,
      ),
    );
    await act(async () => {
      for (const button of container.querySelectorAll("button")) button.click();
    });
    expect(api_fetch).toHaveBeenCalledOnce();
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    await act(async () =>
      root.render(
        <TranslationGenerationProvider>
          <GenerationEntry />
        </TranslationGenerationProvider>,
      ),
    );
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    api_fetch.mockClear();
  }
});
