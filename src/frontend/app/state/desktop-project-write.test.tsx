import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  normalize_project_write_result,
  useProjectWriteCommitter,
  type ProjectWriteCommitter,
  type ProjectWriteResult,
} from "./desktop-project-write";
import { InternalInvariantError } from "@shared/error";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

type CommitterProbeProps = {
  applyProjectWriteChanges: (result: ProjectWriteResult) => Promise<void>;
  reportStateError: (error: unknown, args: unknown) => void;
  refreshProjectStateAfterError: (
    reason: string,
    triggering_event: unknown,
    recovery_context?: unknown,
  ) => Promise<void>;
  onCommitter: (committer: ProjectWriteCommitter) => void;
};

// CommitterProbe 收口测试中的共享步骤，保证断言只关注当前行为。
function CommitterProbe(props: CommitterProbeProps): JSX.Element | null {
  const committer = useProjectWriteCommitter({
    applyProjectWriteChanges: props.applyProjectWriteChanges,
    recovery: {
      report_state_error: props.reportStateError,
      refresh_project_state_after_error: props.refreshProjectStateAfterError,
    },
  });

  useEffect(() => {
    props.onCommitter(committer);
  }, [committer, props]);

  return null;
}

// capture_internal_invariant 收口测试中的共享步骤，保证断言只关注当前行为。
function capture_internal_invariant(operation: () => unknown): InternalInvariantError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(InternalInvariantError);
    return error as InternalInvariantError;
  }
  throw new Error("预期抛出 InternalInvariantError。");
}

// wait_for_expectation 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
async function wait_for_expectation(predicate: () => boolean): Promise<void> {
  // write catch 链路跨多个 Promise 边界，测试只等待公开恢复调用出现。
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error("等待 write 提交状态收敛失败。");
}

describe("useProjectWriteCommitter", () => {
  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }
    container?.remove();
    root = null;
    container = null;
  });

  it("通过显式 operation 提交 write 并返回规范化结果", async () => {
    const state: { committer: ProjectWriteCommitter | null } = { committer: null };
    const apply_project_write_changes = vi.fn(async () => undefined);
    container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <CommitterProbe
          applyProjectWriteChanges={apply_project_write_changes}
          reportStateError={vi.fn()}
          refreshProjectStateAfterError={vi.fn(async () => undefined)}
          onCommitter={(next_committer) => (state.committer = next_committer)}
        />,
      );
    });

    const committer = state.committer;
    if (committer === null) {
      throw new Error("write committer 未初始化。");
    }

    const result = await committer({
      operation: "glossary.entries_save",
      run: async () => ({
        accepted: true,
        changes: [],
      }),
    });

    expect(apply_project_write_changes).toHaveBeenCalledWith({
      accepted: true,
      changes: [],
    });
    expect(result).toEqual({
      payload: {
        accepted: true,
        changes: [],
      },
      write_result: {
        accepted: true,
        changes: [],
      },
    });
  });

  it("先执行提交前准备再回灌项目变更", async () => {
    const state: { committer: ProjectWriteCommitter | null } = { committer: null };
    const execution_order: string[] = [];
    const apply_project_write_changes = vi.fn(async () => {
      execution_order.push("apply");
    });
    container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <CommitterProbe
          applyProjectWriteChanges={apply_project_write_changes}
          reportStateError={vi.fn()}
          refreshProjectStateAfterError={vi.fn(async () => undefined)}
          onCommitter={(next_committer) => (state.committer = next_committer)}
        />,
      );
    });

    const committer = state.committer;
    if (committer === null) {
      throw new Error("write committer 未初始化。");
    }

    await committer({
      operation: "glossary.entries_save",
      run: async () => ({
        accepted: true,
        changes: [],
      }),
      prepare: () => {
        execution_order.push("prepare");
      },
    });

    expect(execution_order).toEqual(["prepare", "apply"]);
  });

  it("提交前准备失败时不回灌项目变更并进入恢复", async () => {
    const state: { committer: ProjectWriteCommitter | null } = { committer: null };
    const original_error = new Error("prepare failed");
    const apply_project_write_changes = vi.fn(async () => undefined);
    const report_state_error = vi.fn();
    const refresh_project_state_after_error = vi.fn(async () => undefined);
    container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <CommitterProbe
          applyProjectWriteChanges={apply_project_write_changes}
          reportStateError={report_state_error}
          refreshProjectStateAfterError={refresh_project_state_after_error}
          onCommitter={(next_committer) => (state.committer = next_committer)}
        />,
      );
    });

    const committer = state.committer;
    if (committer === null) {
      throw new Error("write committer 未初始化。");
    }

    await expect(
      committer({
        operation: "glossary.entries_save",
        run: async () => ({
          accepted: true,
          changes: [],
        }),
        prepare: () => {
          throw original_error;
        },
      }),
    ).rejects.toBe(original_error);

    expect(apply_project_write_changes).not.toHaveBeenCalled();
    expect(report_state_error).toHaveBeenCalledWith(
      original_error,
      expect.objectContaining({
        source: "project-write",
      }),
    );
    expect(refresh_project_state_after_error).toHaveBeenCalledWith(
      "project_write_failed",
      expect.objectContaining({
        operation: "glossary.entries_save",
      }),
      expect.objectContaining({
        phase: "prepare",
      }),
    );
  });

  it("回灌失败时等待项目恢复完成并重新抛出原始错误", async () => {
    const state: { committer: ProjectWriteCommitter | null } = { committer: null };
    const original_error = new Error("apply failed");
    let finish_recovery = (): void => {
      throw new Error("项目恢复尚未启动。");
    };
    const recovery_promise = new Promise<void>((resolve) => {
      finish_recovery = resolve;
    });
    const report_state_error = vi.fn();
    const refresh_project_state_after_error = vi.fn(() => recovery_promise);
    container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <CommitterProbe
          applyProjectWriteChanges={async () => {
            throw original_error;
          }}
          reportStateError={report_state_error}
          refreshProjectStateAfterError={refresh_project_state_after_error}
          onCommitter={(next_committer) => (state.committer = next_committer)}
        />,
      );
    });

    const committer = state.committer;
    if (committer === null) {
      throw new Error("write committer 未初始化。");
    }

    let rejected = false;
    const commit_promise = committer({
      operation: "glossary.entries_save",
      run: async () => ({
        accepted: true,
        changes: [],
      }),
    }).catch((error: unknown) => {
      rejected = true;
      return error;
    });
    await wait_for_expectation(() => refresh_project_state_after_error.mock.calls.length === 1);

    expect(report_state_error).toHaveBeenCalledWith(
      original_error,
      expect.objectContaining({
        source: "project-write",
      }),
    );
    expect(refresh_project_state_after_error).toHaveBeenCalledWith(
      "project_write_failed",
      expect.objectContaining({
        operation: "glossary.entries_save",
      }),
      expect.objectContaining({
        phase: "apply",
      }),
    );
    expect(rejected).toBe(false);

    finish_recovery();
    await expect(commit_promise).resolves.toBe(original_error);
  });
});

describe("normalize_project_write_result", () => {
  it("只接受后端 canonical changes 数组并规范化为项目状态事件", () => {
    const result = normalize_project_write_result({
      accepted: true,
      changes: [
        {
          eventId: "write-quality-1",
          source: "quality_rule_save_entries",
          projectPath: "E:/demo/demo.lg",
          projectRevision: 2,
          updatedSections: ["quality"],
          sectionRevisions: {
            quality: 2,
          },
          sections: {
            quality: {
              payloadMode: "canonical-delta",
              data: {
                glossary: {
                  entries: [],
                  enabled: true,
                  mode: "off",
                  revision: 2,
                },
              },
            },
          },
        },
      ],
    });

    expect(result).toMatchObject({
      accepted: true,
      changes: [
        {
          eventId: "write-quality-1",
          source: "quality_rule_save_entries",
          projectPath: "E:/demo/demo.lg",
          projectRevision: 2,
          updatedSections: ["quality"],
          sectionRevisions: {
            quality: 2,
          },
        },
      ],
    });
    expect(result.changes[0]?.operations[0]?.sections?.quality?.payloadMode).toBe(
      "canonical-delta",
    );
  });

  it.each([
    ["缺少 accepted=true", { changes: [] }],
    ["changes 不是数组", { accepted: true, changes: {} }],
  ] as const)("拒绝%s的 write result", (_name, payload) => {
    const error = capture_internal_invariant(() => normalize_project_write_result(payload));

    expect(error.diagnostic_context).toMatchObject({
      reason: "invalid_project_write_result_payload",
    });
  });

  it("拒绝无法规范化为项目数据变更的 change 载荷", () => {
    const error = capture_internal_invariant(() =>
      normalize_project_write_result({
        accepted: true,
        changes: [
          {
            eventId: "write-invalid-1",
            source: "invalid",
            projectPath: "E:/demo/demo.lg",
            projectRevision: 2,
            updatedSections: [],
          },
        ],
      }),
    );

    expect(error.diagnostic_context).toMatchObject({
      reason: "invalid_project_write_change_payload",
      index: 0,
    });
  });
});
