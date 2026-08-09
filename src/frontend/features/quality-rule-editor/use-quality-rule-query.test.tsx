import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { read_quality_rule_snapshot_mock } = vi.hoisted(() => ({
  read_quality_rule_snapshot_mock: vi.fn(),
}));

vi.mock("@frontend/features/quality-rule-editor/quality-rule-api-client", async (import_actual) => {
  const actual =
    await import_actual<
      typeof import("@frontend/features/quality-rule-editor/quality-rule-api-client")
    >();
  return {
    ...actual,
    read_quality_rule_snapshot: read_quality_rule_snapshot_mock,
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
    read_quality_rule_snapshot_mock.mockReset();
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
    read_quality_rule_snapshot_mock.mockResolvedValue({
      projectPath: "E:/demo/demo.lg",
      sectionRevisions: { quality: 3 },
      qualityRule: { enabled: false },
    });

    await act(async () => root.render(<QueryProbe project_path="" />));
    expect(read_quality_rule_snapshot_mock).not.toHaveBeenCalled();
    expect(current_state).toMatchObject({
      quality_slice: DEFAULT_SLICE,
      quality_loaded: false,
    });

    await act(async () => root.render(<QueryProbe project_path="E:/demo/demo.lg" />));
    expect(read_quality_rule_snapshot_mock).toHaveBeenCalledTimes(1);
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
    expect(read_quality_rule_snapshot_mock).toHaveBeenCalledTimes(1);

    project_change_signal = {
      ...project_change_signal,
      seq: 2,
      updated_sections: ["quality"],
    };
    await act(async () => root.render(<QueryProbe project_path="E:/demo/demo.lg" />));
    expect(read_quality_rule_snapshot_mock).toHaveBeenCalledTimes(2);
  });

  it("初次查询失败时只交给页面错误出口", async () => {
    const error = new Error("load failed");
    read_quality_rule_snapshot_mock.mockRejectedValue(error);

    await act(async () => root.render(<QueryProbe project_path="E:/demo/demo.lg" />));

    expect(on_load_error).toHaveBeenCalledWith(error);
    expect(current_state?.quality_loaded).toBe(false);
  });

  it("项目切换后不接纳旧项目的迟到响应", async () => {
    let resolve_old!: (value: unknown) => void;
    let resolve_new!: (value: unknown) => void;
    read_quality_rule_snapshot_mock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolve_old = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolve_new = resolve;
          }),
      );

    await act(async () => root.render(<QueryProbe project_path="E:/old/old.lg" />));
    await vi.waitFor(() => expect(read_quality_rule_snapshot_mock).toHaveBeenCalledTimes(1));
    await act(async () => root.render(<QueryProbe project_path="E:/new/new.lg" />));
    expect(current_state).toMatchObject({ quality_slice: DEFAULT_SLICE, quality_loaded: false });

    await act(async () =>
      resolve_old({
        projectPath: "E:/old/old.lg",
        sectionRevisions: { quality: 1 },
        qualityRule: { enabled: true },
      }),
    );
    expect(current_state).toMatchObject({ quality_slice: DEFAULT_SLICE, quality_loaded: false });

    await act(async () =>
      resolve_new({
        projectPath: "E:/new/new.lg",
        sectionRevisions: { quality: 4 },
        qualityRule: { enabled: false },
      }),
    );
    expect(current_state).toMatchObject({
      quality_slice: { enabled: false, section_revision: 4 },
      quality_loaded: true,
    });
  });

  it("显式刷新迟到时不覆盖新工程切片", async () => {
    read_quality_rule_snapshot_mock.mockResolvedValueOnce({
      projectPath: "E:/old/old.lg",
      sectionRevisions: { quality: 1 },
      qualityRule: { enabled: true },
    });
    await act(async () => root.render(<QueryProbe project_path="E:/old/old.lg" />));
    await vi.waitFor(() => expect(current_state?.quality_loaded).toBe(true));

    let resolve_refresh!: (value: unknown) => void;
    read_quality_rule_snapshot_mock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolve_refresh = resolve;
        }),
    );
    let refresh!: Promise<unknown>;
    await act(async () => {
      refresh = current_state!.refresh_quality_rule_snapshot();
      await Promise.resolve();
    });

    read_quality_rule_snapshot_mock.mockResolvedValueOnce({
      projectPath: "E:/new/new.lg",
      sectionRevisions: { quality: 4 },
      qualityRule: { enabled: false },
    });
    await act(async () => root.render(<QueryProbe project_path="E:/new/new.lg" />));
    await vi.waitFor(() => expect(current_state?.quality_slice.section_revision).toBe(4));

    await act(async () => {
      resolve_refresh({
        projectPath: "E:/old/old.lg",
        sectionRevisions: { quality: 2 },
        qualityRule: { enabled: true },
      });
      await refresh;
    });
    expect(current_state).toMatchObject({
      quality_slice: { enabled: false, section_revision: 4 },
      quality_loaded: true,
    });
  });
});
