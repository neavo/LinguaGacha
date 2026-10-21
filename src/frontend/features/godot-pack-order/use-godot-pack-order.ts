import { useCallback, useEffect, useRef, useState } from "react";
import type { GodotPackOrder, GodotPackPreview } from "@shared/godot";

/** 页面的排序草稿与等待中的动作共用生命周期，关闭页面等同取消。 */
export function useGodotPackOrder() {
  const [games, set_games] = useState<readonly GodotPackPreview[]>([]);
  const resolve_ref = useRef<((orders: readonly GodotPackOrder[] | null) => void) | null>(null);
  // 先清空 `resolve_ref`，防止同一帧的重复关闭再次完成请求。
  const finish = useCallback((orders: readonly GodotPackOrder[] | null) => {
    const resolve = resolve_ref.current;
    resolve_ref.current = null;
    set_games([]);
    resolve?.(orders);
  }, []);
  useEffect(
    () => () => {
      resolve_ref.current?.(null);
      resolve_ref.current = null;
    },
    [],
  );
  /** 每次请求重新生成草稿，零包和单包也保留预览时的集合快照。 */
  const request_order = useCallback(
    (previews: readonly GodotPackPreview[] = []): Promise<readonly GodotPackOrder[] | null> => {
      resolve_ref.current?.(null);
      resolve_ref.current = null;
      const sortable = previews.filter((game) => game.external_pcks.length >= 2);
      const defaults = previews.map((game) => ({
        game_root: game.game_root,
        ordered_pcks: [...game.external_pcks],
      }));
      if (!sortable.length) {
        set_games([]);
        return Promise.resolve(defaults);
      }
      set_games(sortable.map((game) => ({ ...game, external_pcks: [...game.external_pcks] })));
      return new Promise((resolve) => {
        resolve_ref.current = (selected) =>
          resolve(
            selected === null
              ? null
              : defaults.map(
                  (order) => selected.find((entry) => entry.game_root === order.game_root) ?? order,
                ),
          );
      });
    },
    [],
  );
  return {
    request_order,
    finish,
    dialog_props: {
      games,
      on_reorder: (game_root: string, names: string[]) =>
        set_games((current) =>
          current.map((game) =>
            game.game_root === game_root ? { ...game, external_pcks: names } : game,
          ),
        ),
      on_confirm: () =>
        finish(
          games.map((game) => ({ game_root: game.game_root, ordered_pcks: game.external_pcks })),
        ),
      on_close: () => finish(null),
    },
  };
}
