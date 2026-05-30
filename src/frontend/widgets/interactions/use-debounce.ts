import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export const INPUT_QUERY_DEBOUNCE_MS = 250; // 搜索/筛选输入统一使用的结果刷新窗口

export type DebouncedCallback<TArgs extends unknown[]> = {
  // 只保留最后一次参数，等待防抖窗口结束后执行。
  schedule: (...args: TArgs) => void;
  // 丢弃尚未发布的输入，给排序、确认、刷新等显式 action 立即接管。
  cancel: () => void;
  // 立即发布当前待处理输入，保留给需要同步收束的交互。
  flush: () => void;
  // 暴露待处理状态，避免调用方再保存第二套 timer 标记。
  has_pending: () => boolean;
};

// 返回延迟发布的值；控件继续消费原始 value，计算结果消费返回值。
export function useDebouncedValue<TValue>(
  value: TValue,
  delay_ms: number = INPUT_QUERY_DEBOUNCE_MS,
): TValue {
  const [debounced_value, set_debounced_value] = useState(value);

  useEffect(() => {
    const timer_id = window.setTimeout(() => {
      set_debounced_value(value);
    }, delay_ms);

    return () => {
      window.clearTimeout(timer_id);
    };
  }, [delay_ms, value]);

  return debounced_value;
}

// 为会触发副作用的刷新提供可取消防抖，timer 触发时始终调用最新闭包。
export function useDebouncedCallback<TArgs extends unknown[]>(
  callback: (...args: TArgs) => void,
  delay_ms: number = INPUT_QUERY_DEBOUNCE_MS,
): DebouncedCallback<TArgs> {
  const callback_ref = useRef(callback); // 避免 schedule 因 callback 变化而丢失稳定身份
  const pending_args_ref = useRef<TArgs | null>(null); // 只保存最新一次计划参数
  const timer_id_ref = useRef<number | null>(null);

  useEffect(() => {
    callback_ref.current = callback;
  }, [callback]);

  const cancel = useCallback((): void => {
    if (timer_id_ref.current !== null) {
      window.clearTimeout(timer_id_ref.current);
      timer_id_ref.current = null;
    }
    pending_args_ref.current = null;
  }, []);

  const flush = useCallback((): void => {
    const pending_args = pending_args_ref.current;
    if (pending_args === null) {
      return;
    }

    cancel();
    callback_ref.current(...pending_args);
  }, [cancel]);

  const has_pending = useCallback((): boolean => {
    return pending_args_ref.current !== null;
  }, []);

  const schedule = useCallback(
    (...args: TArgs): void => {
      if (timer_id_ref.current !== null) {
        window.clearTimeout(timer_id_ref.current);
      }

      pending_args_ref.current = args;
      timer_id_ref.current = window.setTimeout(() => {
        const pending_args = pending_args_ref.current;
        timer_id_ref.current = null;
        pending_args_ref.current = null;

        if (pending_args !== null) {
          callback_ref.current(...pending_args);
        }
      }, delay_ms);
    },
    [delay_ms],
  );

  useEffect(() => {
    return cancel;
  }, [cancel]);

  return useMemo(
    () => ({
      schedule,
      cancel,
      flush,
      has_pending,
    }),
    [cancel, flush, has_pending, schedule],
  );
}
