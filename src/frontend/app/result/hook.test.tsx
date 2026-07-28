import { act, useCallback, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { useResultSnapshotState } from "@frontend/app/result/hook";
import {
  REBUILD_RESULT_REFRESH,
  create_result_snapshot,
  type ResultSnapshot,
} from "@frontend/app/result/snapshot";

type Query = { keyword: string };
type HookState = ReturnType<typeof useResultSnapshotState<Query, string>>;

function ResultProbe(props: {
  revision: number;
  snapshot: ResultSnapshot<Query, string>;
  valid_ids: readonly string[];
  on_state: (state: HookState) => void;
}): null {
  const build_snapshot = useCallback(() => props.snapshot, [props.snapshot]);
  const state = useResultSnapshotState({
    project_path: "E:/demo/sample.lg",
    section: "quality",
    section_revision: props.revision,
    has_active_query: true,
    valid_ids: props.valid_ids,
    build_snapshot,
  });

  useEffect(() => {
    props.on_state(state);
  }, [props, state]);
  return null;
}

describe("useResultSnapshotState", () => {
  it("只在当前事实源到达目标 revision 后重建结果成员", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    let latest_state: HookState | null = null;
    const read_state = (): HookState => {
      if (latest_state === null) {
        throw new Error("结果状态尚未初始化");
      }
      return latest_state;
    };
    const initial_snapshot = create_result_snapshot({
      applied_query: { keyword: "角色" },
      ordered_ids: ["a"],
    });
    const rebuilt_snapshot = create_result_snapshot({
      applied_query: { keyword: "角色" },
      ordered_ids: ["a", "b"],
    });

    await act(async () => {
      root.render(
        <ResultProbe
          revision={1}
          snapshot={initial_snapshot}
          valid_ids={["a", "b"]}
          on_state={(state) => {
            latest_state = state;
          }}
        />,
      );
    });
    await act(async () => {
      read_state().set_pending_result_refresh({
        policy: REBUILD_RESULT_REFRESH,
        source: {
          projectPath: "E:/demo/sample.lg",
          section: "quality",
          revision: 2,
        },
      });
      root.render(
        <ResultProbe
          revision={1}
          snapshot={rebuilt_snapshot}
          valid_ids={["a", "b"]}
          on_state={(state) => {
            latest_state = state;
          }}
        />,
      );
    });
    expect(read_state().result_snapshot?.ordered_ids).toEqual(["a"]);

    await act(async () => {
      root.render(
        <ResultProbe
          revision={2}
          snapshot={rebuilt_snapshot}
          valid_ids={["a", "b"]}
          on_state={(state) => {
            latest_state = state;
          }}
        />,
      );
    });
    expect(read_state().result_snapshot?.ordered_ids).toEqual(["a", "b"]);
    await act(async () => root.unmount());
  });
});
