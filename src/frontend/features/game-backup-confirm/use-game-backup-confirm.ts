import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@frontend/app/locale/locale-context";

/** 原生游戏会就地改写游戏目录，执行前提示用户完整备份。关闭页面等同取消。 */
export function useGameBackupConfirm() {
  const { t } = useI18n();
  const [open, set_open] = useState(false);
  const resolve_ref = useRef<((confirmed: boolean) => void) | null>(null); // 当前等待确认的操作。
  // 先清空 `resolve_ref`，防止同一帧的重复关闭再次完成请求。
  const finish = useCallback((confirmed: boolean) => {
    const resolve = resolve_ref.current;
    resolve_ref.current = null;
    set_open(false);
    resolve?.(confirmed);
  }, []);
  useEffect(
    () => () => {
      resolve_ref.current?.(false);
      resolve_ref.current = null;
    },
    [],
  );
  /** 新请求取消旧请求，普通文件直接通过。 */
  const request_confirm = useCallback((contains_game: boolean): Promise<boolean> => {
    resolve_ref.current?.(false);
    resolve_ref.current = null;
    set_open(contains_game);
    if (!contains_game) return Promise.resolve(true);
    return new Promise((resolve) => {
      resolve_ref.current = resolve;
    });
  }, []);
  return {
    request_confirm,
    finish,
    dialog_props: {
      open,
      description: t("app.game_backup_warning"),
      confirmDelay: true,
      onConfirm: () => finish(true),
      onClose: () => finish(false),
    },
  };
}
