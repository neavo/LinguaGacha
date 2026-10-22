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

const FONT_PATH = "E:/font.ttf";
const GAME_PATH = "E:/game/Game.exe";
const INSPECT = "/api/toolbox/game-font/inspect";

/** 挂载状态拥有者，通过公开返回值观察业务阶段。 */
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
          pickGameFontFilePath: vi.fn(async () => ({ canceled: false, paths: [FONT_PATH] })),
          pickGameExecutablePath: vi.fn(async () => ({ canceled: false, paths: [GAME_PATH] })),
          pickGameDirectoryPath: vi.fn(async () => ({ canceled: true, paths: [] })),
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

  it("拖入 OTF 时立即拒绝，大小写 TTF 仍进入后端内容检查", async () => {
    await act(async () => state.drop_path("font_path", "E:/font.otf"));
    expect(state.paths.font_path).toBeNull();
    expect(toast.push_error_toast).toHaveBeenCalledOnce();
    expect(api_fetch).not.toHaveBeenCalled();
    await act(async () => state.drop_path("font_path", "E:/font.TtF"));
    await act(async () => state.drop_path("game_path", GAME_PATH));
    expect(api_fetch).toHaveBeenCalledWith(INSPECT, {
      font_path: "E:/font.TtF",
      game_path: GAME_PATH,
    });
  });

  it("选择器返回不支持的扩展名后仍可重新选择", async () => {
    vi.mocked(window.desktopApp.pickGameFontFilePath).mockResolvedValueOnce({
      canceled: false,
      paths: ["E:/font.otf"],
    });
    await act(async () => state.pick_font_file());
    expect(state.input_locked).toBe(false);
    expect(state.paths.font_path).toBeNull();
    await select_both();
    expect(state.can_apply).toBe(true);
  });

  /** 字体经对话框、游戏经拖入进入同一路径入口，并完成一次检查。 */
  async function select_both(): Promise<void> {
    await act(async () => state.pick_font_file());
    await act(async () => state.drop_path("game_path", GAME_PATH));
  }

  it.each([false, true])("字体排序取消=%s，确认顺序传入修改请求", async (cancel) => {
    const game_root = "E:/game",
      orders = [{ game_root, ordered_pcks: ["patch.pck", "base.pck"] }];
    vi.mocked(api_fetch).mockResolvedValueOnce({
      godot_packs: [{ game_root, game_name: "game", external_pcks: ["base.pck", "patch.pck"] }],
    });
    await select_both();
    await act(async () => {
      void state.request_apply();
    });
    expect(state.godot_pack_order.dialog_props.games).toHaveLength(1);
    expect(state.confirm_open).toBe(false);
    await act(async () => state.godot_pack_order.finish(cancel ? null : orders));
    if (cancel) {
      expect(state.can_apply).toBe(true);
      expect(api_fetch).toHaveBeenCalledTimes(1);
    } else {
      expect(state.confirm_open).toBe(true);
      await act(async () => state.confirm_apply());
      expect(api_fetch).toHaveBeenLastCalledWith(
        "/api/toolbox/game-font/apply",
        expect.objectContaining({ godot_pack_orders: orders }),
      );
      await act(async () => state.request_apply());
      expect(state.godot_pack_order.dialog_props.games).toHaveLength(0);
      expect(state.confirm_open).toBe(true);
      await act(async () => state.confirm_apply());
      expect(api_fetch).toHaveBeenLastCalledWith(
        "/api/toolbox/game-font/apply",
        expect.objectContaining({ godot_pack_orders: [{ game_root, ordered_pcks: [] }] }),
      );
    }
  });

  it("确认期间锁定输入，取消确认后保留执行资格", async () => {
    await select_both();
    const paths = { font_path: FONT_PATH, game_path: GAME_PATH };
    await act(async () => state.request_apply());
    expect(state.confirm_open).toBe(true);
    expect(state.input_locked).toBe(true);
    await act(async () => state.drop_path("game_path", "E:/ignored"));
    await act(async () => state.clear_path("font_path"));
    expect(state.paths).toEqual(paths);
    act(() => state.close_confirm());
    expect(state.confirm_open).toBe(false);
    expect(state.input_locked).toBe(false);
    expect(state.can_apply).toBe(true);
  });

  it("更换与清除撤销旧资格，取消对话框保留当前选择", async () => {
    await select_both();
    await act(async () => state.pick_game_directory());
    expect(state.paths.game_path).toBe(GAME_PATH);
    expect(state.can_apply).toBe(true);

    const pending = Promise.withResolvers<object>();
    vi.mocked(api_fetch).mockReturnValueOnce(pending.promise);
    act(() => void state.drop_path("game_path", "E:/other"));
    expect(state.can_apply).toBe(false);
    expect(state.input_locked).toBe(true);
    await act(async () => pending.resolve({}));
    expect(api_fetch).toHaveBeenLastCalledWith(INSPECT, {
      font_path: FONT_PATH,
      game_path: "E:/other",
    });
    expect(state.can_apply).toBe(true);

    await act(async () => state.clear_path("font_path"));
    expect(state.paths.font_path).toBeNull();
    expect(state.can_apply).toBe(false);
    await act(async () => state.request_apply());
    expect(state.confirm_open).toBe(false);
  });

  it("忙碌期间拒绝重复输入", async () => {
    await act(async () => {
      void state.pick_font_file();
      void state.pick_font_file();
    });
    expect(window.desktopApp.pickGameFontFilePath).toHaveBeenCalledTimes(1);

    const pending = Promise.withResolvers<object>();
    vi.mocked(api_fetch).mockReturnValueOnce(pending.promise);
    act(() => void state.drop_path("game_path", GAME_PATH));
    await act(async () => state.drop_path("game_path", "E:/ignored"));
    await act(async () => state.clear_path("font_path"));
    await act(async () => pending.resolve({}));
    expect(api_fetch).toHaveBeenCalledTimes(1);
    expect(state.paths).toEqual({ font_path: FONT_PATH, game_path: GAME_PATH });
  });

  it("检查失败时禁止执行并通知一次，修改失败后可重试", async () => {
    vi.mocked(api_fetch).mockRejectedValueOnce(new Error("Unsupported game"));
    await select_both();
    expect(state.can_apply).toBe(false);
    expect(state.input_locked).toBe(false);
    expect(toast.push_error_toast).toHaveBeenCalledTimes(1);

    await act(async () => state.drop_path("game_path", GAME_PATH));
    vi.mocked(api_fetch).mockRejectedValueOnce(new Error("Write failed"));
    await act(async () => state.request_apply());
    await act(async () => state.confirm_apply());
    expect(toast.push_error_toast).toHaveBeenLastCalledWith(
      "game_font_page.feedback.apply_failed",
      expect.any(Error),
    );
    expect(state.can_apply).toBe(true);
  });
});
