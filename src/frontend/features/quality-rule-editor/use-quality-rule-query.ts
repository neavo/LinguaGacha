import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useProjectChangeSignal } from "@frontend/app/state/use-desktop-state";
import { useProjectChangeSeqForSections } from "@frontend/app/state/project-change-signal";
import {
  read_quality_rule_snapshot,
  type QualityRuleQuerySlice,
  type QualityRuleType,
} from "@frontend/features/quality-rule-editor/quality-rule-api-client";

export type QualityRuleQueryStatus = "idle" | "loading" | "ready" | "error";
type QueryState<TSlice> =
  | { status: "ready"; slice: TSlice }
  | { status: "idle" | "loading" | "error" };
type UseQualityRuleQueryArgs<TType extends QualityRuleType, TSlice> = {
  rule_type: TType;
  project_path: string;
  session_ready: boolean;
  default_slice: TSlice;
  normalize_slice: (
    slice: QualityRuleQuerySlice<TType> | undefined,
    section_revision: number,
  ) => TSlice;
  on_load_error: (error: unknown) => void;
};
const QUALITY_RULE_REFRESH_SECTIONS = ["quality"] as const;

/** 规则查询统一拥有首次加载、已有快照刷新、重试与项目身份隔离。 */
export function useQualityRuleQuery<TType extends QualityRuleType, TSlice>(
  args: UseQualityRuleQueryArgs<TType, TSlice>,
): {
  quality_slice: TSlice;
  quality_status: QualityRuleQueryStatus;
  reload_quality_rule_snapshot: () => void;
  refresh_quality_rule_snapshot: () => Promise<TSlice>;
} {
  const { rule_type, project_path, session_ready, default_slice, normalize_slice, on_load_error } =
    args;
  const project_change_signal = useProjectChangeSignal();
  const change_seq = useProjectChangeSeqForSections(
    project_change_signal,
    QUALITY_RULE_REFRESH_SECTIONS,
  );
  const [state, set_state] = useState<QueryState<TSlice>>({ status: "idle" });
  const state_ref = useRef(state); // 异步重试读取当前成功快照，保持刷新入口稳定。
  const request_token_ref = useRef(0); // 请求、项目切换与卸载共用失效世代。
  const query_enabled = project_path !== "" && session_ready;
  /** 同步 React 展示与异步入口读取的当前状态。 */
  const apply_state = useCallback((next: QueryState<TSlice>): void => {
    state_ref.current = next;
    set_state(next);
  }, []);

  useLayoutEffect(() => {
    request_token_ref.current += 1;
    apply_state({ status: "idle" });
  }, [apply_state, project_path, rule_type, session_ready, default_slice]);

  /** 显式刷新向调用方返回快照或当前请求的错误。 */
  const refresh_quality_rule_snapshot = useCallback(async (): Promise<TSlice> => {
    const token = ++request_token_ref.current;
    const previous = state_ref.current;
    if (!query_enabled) {
      apply_state({ status: "idle" });
      return default_slice;
    }
    if (previous.status !== "ready") apply_state({ status: "loading" });
    try {
      const response = await read_quality_rule_snapshot(rule_type);
      if (token === request_token_ref.current && response.projectPath === project_path) {
        const slice = normalize_slice(
          response.qualityRule,
          response.sectionRevisions?.quality ?? 0,
        );
        apply_state({ status: "ready", slice });
        return slice;
      }
    } catch (error) {
      if (token === request_token_ref.current) {
        if (previous.status !== "ready") apply_state({ status: "error" });
        throw error;
      }
      // 已失效请求的失败随其项目或查询世代一起结束。
    }
    return state_ref.current.status === "ready" ? state_ref.current.slice : default_slice;
  }, [apply_state, default_slice, normalize_slice, project_path, query_enabled, rule_type]);

  /** 页面重试和事件重查共用通知策略。 */
  const reload_quality_rule_snapshot = useCallback((): void => {
    const had_snapshot = state_ref.current.status === "ready";
    const request = refresh_quality_rule_snapshot();
    const token = request_token_ref.current;
    void request.catch((error: unknown) => {
      // 首次失败由内容区提供恢复入口；已有内容的刷新失败由页面通知。
      if (had_snapshot && token === request_token_ref.current) on_load_error(error);
    });
  }, [on_load_error, refresh_quality_rule_snapshot]);

  useEffect(() => {
    if (query_enabled) reload_quality_rule_snapshot();
    return () => {
      request_token_ref.current += 1;
    };
  }, [query_enabled, reload_quality_rule_snapshot, change_seq]);

  return {
    quality_slice: state.status === "ready" ? state.slice : default_slice,
    quality_status: state.status,
    reload_quality_rule_snapshot,
    refresh_quality_rule_snapshot,
  };
}
