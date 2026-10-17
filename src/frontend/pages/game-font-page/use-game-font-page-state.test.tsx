import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { useGameFontPageState } from "@frontend/pages/game-font-page/use-game-font-page-state";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";

const toast = vi.hoisted(() => ({ push_toast: vi.fn(), push_error_toast: vi.fn() }));

vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_toast: toast.push_toast,
  push_error_toast: toast.push_error_toast,
  run_modal_progress_toast: (args: { task: () => Promise<unknown> }) => args.task(),
}));

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@frontend/app/desktop/desktop-api", async (import_original) => ({
  ...(await import_original<typeof import("@frontend/app/desktop/desktop-api")>()),
  api_fetch: vi.fn(),
}));

function Probe(props: { on_state: (state: ReturnType<typeof useGameFontPageState>) => void }) {
  const state = useGameFontPageState();
  useEffect(() => {
    props.on_state(state);
  });
  return null;
}

describe("useGameFontPageState", () => {
  let container: HTMLDivElement;
  let root: Root;
  let state: ReturnType<typeof useGameFontPageState>;

  beforeEach(async () => {
    Object.defineProperty(window, "desktopApp", {
      configurable: true,
      value: create_desktop_bridge_api_mock({
        methods: {
          pickGameFontFilePath: async () => ({ canceled: false, paths: ["E:/font.ttf"] }),
          pickGameExecutablePath: async () => ({ canceled: false, paths: ["E:/game/Game.exe"] }),
        },
      }),
    });
    vi.mocked(api_fetch).mockResolvedValue({});
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<Probe on_state={(next) => (state = next)} />);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.mocked(api_fetch).mockReset();
    toast.push_toast.mockReset();
    toast.push_error_toast.mockReset();
  });

  it("字体与启动程序齐全后检查，确认后提交同一组路径", async () => {
    await act(async () => state.pick_font_file());
    expect(api_fetch).not.toHaveBeenCalled();
    await act(async () => state.pick_game_executable());
    const paths = { font_path: "E:/font.ttf", game_path: "E:/game/Game.exe" };
    expect(api_fetch).toHaveBeenCalledWith("/api/toolbox/game-font/inspect", paths);
    expect(state.status).toBe("ready");

    act(() => state.request_apply());
    expect(state.confirm_open).toBe(true);
    await act(async () => state.confirm_apply());
    expect(state.confirm_open).toBe(false);
    expect(api_fetch).toHaveBeenCalledWith("/api/toolbox/game-font/apply", paths);
    expect(toast.push_toast).toHaveBeenCalledWith(
      "success",
      "game_font_page.feedback.apply_success",
    );
    expect(state.status).toBe("ready");
  });

  it("检查失败时禁止执行并通知一次", async () => {
    vi.mocked(api_fetch).mockRejectedValue(new Error("Unsupported game"));
    await act(async () => state.pick_font_file());
    await act(async () => state.pick_game_executable());
    expect(state.status).toBe("idle");
    expect(toast.push_error_toast).toHaveBeenCalledTimes(1);
  });
});
