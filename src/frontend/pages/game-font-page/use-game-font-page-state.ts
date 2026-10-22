import { GAME_FONT_INPUT_EXTENSIONS } from "@shared/game-font";
import { GODOT_PACK_ORDER_REFRESH_ACTION } from "@shared/godot";
import { useGodotPackOrder } from "@frontend/features/godot-pack-order/use-godot-pack-order";
import type { GodotPackPreview, GodotPackOrder } from "@shared/godot";
import { useRef, useState } from "react";

import { api_fetch, DesktopApiError } from "@frontend/app/desktop/desktop-api";
import {
  push_error_toast,
  push_toast,
  run_modal_progress_toast,
} from "@frontend/app/feedback/desktop-toast";
import { useI18n } from "@frontend/app/locale/locale-context";

type GamePaths = Readonly<{ font_path: string | null; game_path: string | null }>; // 未选择时为 null。
type GamePathField = keyof GamePaths;

/** 只有 `ready` 表示当前路径组合检查通过，其余忙碌阶段统一锁定输入。 */
type GameFontPhase = "editing" | "picking" | "checking" | "ready" | "confirming" | "running";

/** 拥有路径、检查、确认与执行状态，游戏文件的检查与写入全部由后端完成。 */
export function useGameFontPageState() {
  const { t } = useI18n();
  const godot_pack_order = useGodotPackOrder();
  const [godot_packs, set_godot_packs] = useState<readonly GodotPackPreview[]>([]);
  const [orders, set_orders] = useState<readonly GodotPackOrder[]>([]);
  const [paths, set_paths] = useState<GamePaths>({ font_path: null, game_path: null });
  const [phase, set_phase] = useState<GameFontPhase>("editing");
  const busy_ref = useRef(false); // 阶段提交前，同一轮事件内的重复触发由同步占用拒绝。
  const input_locked = phase !== "editing" && phase !== "ready"; // 只有可编辑阶段接收新输入。

  /** 原生选择、拖入与清除串行执行，同一轮事件的重复输入直接忽略。 */
  async function run_exclusive(task: () => Promise<void>): Promise<void> {
    if (busy_ref.current || input_locked) return;
    busy_ref.current = true;
    try {
      await task();
    } finally {
      busy_ref.current = false;
    }
  }

  /** 对话框、拖入与清除的共同入口：撤销旧检查结果，两项齐全时检查当前组合。 */
  async function update_path(field: GamePathField, value: string | null): Promise<void> {
    if (
      field === "font_path" &&
      value !== null &&
      !GAME_FONT_INPUT_EXTENSIONS.includes(value.match(/\.([^.\\/]+)$/u)?.[1]?.toLowerCase() ?? "")
    ) {
      push_error_toast(
        t("game_font_page.feedback.inspect_failed"),
        new DesktopApiError({
          code: "file.parse_failed",
          message: t("game_font_page.fields.font_file.hint"),
        }),
      );
      return;
    }
    const next = { ...paths, [field]: value };
    set_paths(next);
    set_godot_packs([]);
    set_orders([]);
    if (next.font_path === null || next.game_path === null) {
      set_phase("editing");
      return;
    }
    set_phase("checking");
    try {
      const preview = await api_fetch<{ godot_packs?: readonly GodotPackPreview[] }>(
        "/api/toolbox/game-font/inspect",
        next,
      );
      set_godot_packs(preview.godot_packs ?? []);
      set_phase("ready");
    } catch (error) {
      set_phase("editing"); // 保留输入，用户可以更换或清除。
      push_error_toast(t("game_font_page.feedback.inspect_failed"), error);
    }
  }

  /** 原生选择持有输入占用，取消或失败后恢复先前阶段。 */
  function pick(
    picker: Window["desktopApp"]["pickGameFontFilePath"],
    field: GamePathField,
  ): Promise<void> {
    return run_exclusive(async () => {
      const previous_phase = phase;
      set_phase("picking");
      let selected: string | undefined;
      try {
        const result = await picker();
        selected = result.canceled ? undefined : result.paths[0];
      } catch (error) {
        push_error_toast(t("app.feedback.operation_failed"), error);
      }
      set_phase(previous_phase); // 取消、失败或扩展名被拒绝时恢复选择前的阶段。
      if (selected !== undefined) await update_path(field, selected);
    });
  }

  /** 确认框与提交请求使用同一组路径，后端会在写入占用内重新检查。 */
  async function confirm_apply(): Promise<void> {
    if (phase !== "confirming" || busy_ref.current) return;
    busy_ref.current = true;
    set_phase("running");
    let refresh_packs = false;
    try {
      await run_modal_progress_toast({
        message: t("game_font_page.feedback.applying"),
        task: () =>
          api_fetch("/api/toolbox/game-font/apply", {
            ...paths,
            ...(orders.length ? { godot_pack_orders: orders } : {}),
          }),
      });
      set_godot_packs((current) => current.map((game) => ({ ...game, external_pcks: [] })));
      set_orders([]);
      push_toast("success", t("game_font_page.feedback.apply_success"));
    } catch (error) {
      refresh_packs =
        error instanceof DesktopApiError &&
        error.details.action === GODOT_PACK_ORDER_REFRESH_ACTION;
      push_error_toast(t("game_font_page.feedback.apply_failed"), error);
    } finally {
      busy_ref.current = false;
      set_phase("ready"); // 保留选择，便于再次修改或重试。
      if (refresh_packs) await update_path("game_path", paths.game_path);
    }
  }

  /** 全部来源通过同一排序入口取得快照，取消后恢复编辑资格。 */
  async function request_apply(): Promise<void> {
    if (phase !== "ready" || busy_ref.current) return;
    busy_ref.current = true;
    set_phase("checking");
    try {
      const selected = await godot_pack_order.request_order(godot_packs);
      if (selected === null) {
        set_phase("ready");
        return;
      }
      set_orders(selected);
      set_phase("confirming");
    } finally {
      busy_ref.current = false;
    }
  }

  return {
    godot_pack_order,
    paths,
    input_locked,
    loading: phase === "checking" || phase === "running",
    can_apply: phase === "ready",
    confirm_open: phase === "confirming",
    pick_font_file: () => pick(() => window.desktopApp.pickGameFontFilePath(), "font_path"),
    pick_game_executable: () => pick(() => window.desktopApp.pickGameExecutablePath(), "game_path"),
    pick_game_directory: () => pick(() => window.desktopApp.pickGameDirectoryPath(), "game_path"),
    drop_path: (field: GamePathField, path: string) =>
      run_exclusive(() => update_path(field, path)),
    clear_path: (field: GamePathField) => run_exclusive(() => update_path(field, null)),
    request_apply,
    confirm_apply,
    close_confirm: () => set_phase((current) => (current === "confirming" ? "ready" : current)), // 取消确认保留检查结果。
  };
}
