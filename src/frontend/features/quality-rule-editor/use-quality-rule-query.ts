import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useProjectChangeSignal } from "@frontend/app/state/use-desktop-state";
import { useProjectChangeSeqForSections } from "@frontend/app/state/project-change-signal";
import {
  query_quality_rules,
  type QualityRuleQuerySlice,
  type QualityRuleType,
} from "@frontend/features/quality-rule-editor/quality-rule-api-client";

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

type QualityRuleQueryState<TSlice> = {
  quality_slice: TSlice;
  quality_loaded: boolean;
  refresh_quality_rule_snapshot: () => Promise<TSlice>;
};

const QUALITY_RULE_REFRESH_SECTIONS = ["quality"] as const;

/**
 * 质量规则切片消费方共用一次查询、相关项目事件重读和迟到响应隔离。
 */
export function useQualityRuleQuery<TType extends QualityRuleType, TSlice>(
  args: UseQualityRuleQueryArgs<TType, TSlice>,
): QualityRuleQueryState<TSlice> {
  const { rule_type, project_path, session_ready, default_slice, normalize_slice, on_load_error } =
    args;
  const project_change_signal = useProjectChangeSignal();
  const quality_rule_change_seq = useProjectChangeSeqForSections(
    project_change_signal,
    QUALITY_RULE_REFRESH_SECTIONS,
  );
  const [quality_slice, set_quality_slice] = useState(default_slice);
  const [quality_loaded, set_quality_loaded] = useState(false);
  const request_token_ref = useRef(0);
  const query_enabled = project_path !== "" && session_ready;

  // 工程、规则或会话身份变化时先失效旧请求并清空旧切片，禁止跨身份闪现旧事实。
  useLayoutEffect(() => {
    request_token_ref.current += 1;
    set_quality_slice(default_slice);
    set_quality_loaded(false);
  }, [default_slice, project_path, rule_type, session_ready]);

  const read_quality_rule_snapshot = useCallback(async (): Promise<TSlice | null> => {
    const response = await query_quality_rules(rule_type);
    if (response.projectPath !== project_path) {
      return null;
    }

    return normalize_slice(response.qualityRule, response.sectionRevisions?.quality ?? 0);
  }, [normalize_slice, project_path, rule_type]);

  const refresh_quality_rule_snapshot = useCallback(async (): Promise<TSlice> => {
    const request_token = request_token_ref.current + 1;
    request_token_ref.current = request_token;
    if (!query_enabled) {
      set_quality_slice(default_slice);
      set_quality_loaded(false);
      return default_slice;
    }

    const next_slice = await read_quality_rule_snapshot();
    if (request_token_ref.current !== request_token || next_slice === null) {
      return quality_slice;
    }
    set_quality_slice(next_slice);
    set_quality_loaded(true);
    return next_slice;
  }, [default_slice, quality_slice, query_enabled, read_quality_rule_snapshot]);

  useEffect(() => {
    if (!query_enabled) {
      return;
    }

    let cancelled = false;
    const request_token = request_token_ref.current + 1;
    request_token_ref.current = request_token;
    void read_quality_rule_snapshot()
      .then((next_slice) => {
        if (cancelled || request_token_ref.current !== request_token || next_slice === null) {
          return;
        }
        set_quality_slice(next_slice);
        set_quality_loaded(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          on_load_error(error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    default_slice,
    on_load_error,
    quality_rule_change_seq,
    query_enabled,
    read_quality_rule_snapshot,
  ]);

  return {
    quality_slice,
    quality_loaded,
    refresh_quality_rule_snapshot,
  };
}
