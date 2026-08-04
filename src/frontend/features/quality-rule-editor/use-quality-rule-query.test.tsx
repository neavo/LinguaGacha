import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { query_quality_rules_mock } = vi.hoisted(() => ({
  query_quality_rules_mock: vi.fn(),
}));

vi.mock("@frontend/features/quality-rule-editor/quality-rule-api-client", async (import_actual) => {
  const actual =
    await import_actual<
      typeof import("@frontend/features/quality-rule-editor/quality-rule-api-client")
    >();
  return {
    ...actual,
    query_quality_rules: query_quality_rules_mock,
  };
});

let project_change_signal = {
  seq: 0,
  reason: "test",
  updated_sections: [] as Array<"items" | "quality">,
  results: [],
};

vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useProjectChangeSignal: () => project_change_signal,
}));

import { useQualityRuleQuery } from "./use-quality-rule-query";

const DEFAULT_SLICE = { enabled: true, section_revision: 0 };
const on_load_error = vi.fn();
const normalize_slice = (slice: { enabled?: unknown } | undefined, section_revision: number) => ({
  enabled: slice?.enabled === undefined ? true : Boolean(slice.enabled),
  section_revision,
});

let current_state: ReturnType<typeof useQualityRuleQuery<"glossary", typeof DEFAULT_SLICE>> | null =
  null;

function QueryProbe(props: { project_path: string; session_ready?: boolean }) {
  current_state = useQualityRuleQuery({
    rule_type: "glossary",
    project_path: props.project_path,
    session_ready: props.session_ready ?? true,
    default_slice: DEFAULT_SLICE,
    normalize_slice,
    on_load_error,
  });
  return null;
}

describe("quality rule query lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    query_quality_rules_mock.mockReset();
    on_load_error.mockReset();
    current_state = null;
    project_change_signal = {
      seq: 0,
      reason: "test",
      updated_sections: [],
      results: [],
    };
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  it("只在会话可读且 quality 事实变化时刷新规则切片", async () => {
    query_quality_rules_mock.mockResolvedValue({
      projectPath: "E:/demo/demo.lg",
      sectionRevisions: { quality: 3 },
      qualityRule: { enabled: false },
    });

    await act(async () => root.render(<QueryProbe project_path="" />));
    expect(query_quality_rules_mock).not.toHaveBeenCalled();
    expect(current_state).toMatchObject({
      quality_slice: DEFAULT_SLICE,
      quality_loaded: false,
    });

    await act(async () => root.render(<QueryProbe project_path="E:/demo/demo.lg" />));
    expect(query_quality_rules_mock).toHaveBeenCalledTimes(1);
    expect(current_state).toMatchObject({
      quality_slice: { enabled: false, section_revision: 3 },
      quality_loaded: true,
    });

    project_change_signal = {
      ...project_change_signal,
      seq: 1,
      updated_sections: ["items"],
    };
    await act(async () => root.render(<QueryProbe project_path="E:/demo/demo.lg" />));
    expect(query_quality_rules_mock).toHaveBeenCalledTimes(1);

    project_change_signal = {
      ...project_change_signal,
      seq: 2,
      updated_sections: ["quality"],
    };
    await act(async () => root.render(<QueryProbe project_path="E:/demo/demo.lg" />));
    expect(query_quality_rules_mock).toHaveBeenCalledTimes(2);
  });

  it("初次查询失败时只交给页面错误出口", async () => {
    const error = new Error("load failed");
    query_quality_rules_mock.mockRejectedValue(error);

    await act(async () => root.render(<QueryProbe project_path="E:/demo/demo.lg" />));

    expect(on_load_error).toHaveBeenCalledWith(error);
    expect(current_state?.quality_loaded).toBe(false);
  });
});
