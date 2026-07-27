import { describe, expect, it } from "vitest";
import { ProjectSessionState } from "./project-session-state";

describe("ProjectSessionState", () => {
  it("只在非空路径标记 loaded，并暴露去空白后的工程路径", async () => {
    const session_state = new ProjectSessionState();

    await session_state.mark_loaded("  E:/Project/demo.lg  ");

    expect(session_state.snapshot()).toEqual({
      loaded: true,
      projectPath: "E:/Project/demo.lg",
    });
  });

  it("空路径和 clear 会回到未加载快照且不复用旧快照对象", async () => {
    const session_state = new ProjectSessionState();
    await session_state.mark_loaded("E:/Project/demo.lg");
    const previous_snapshot = session_state.snapshot();
    previous_snapshot.loaded = false;
    previous_snapshot.projectPath = "被外部改写";

    expect(session_state.snapshot()).toEqual({
      loaded: true,
      projectPath: "E:/Project/demo.lg",
    });

    await session_state.mark_loaded("   ");

    expect(session_state.snapshot()).toEqual({
      loaded: false,
      projectPath: "",
    });

    await session_state.mark_loaded("E:/Project/demo.lg");
    await session_state.clear();

    expect(session_state.snapshot()).toEqual({
      loaded: false,
      projectPath: "",
    });
  });

  it("每次 load 和 clear 都推进会话世代并等待订阅者", async () => {
    const session_state = new ProjectSessionState();
    const changes: Array<{
      loaded: boolean;
      projectPath: string;
      sessionRevision: number;
    }> = [];
    let release_first_change: () => void = () => undefined;
    const first_change_block = new Promise<void>((resolve) => {
      release_first_change = resolve;
    });
    session_state.subscribe_change(async (change) => {
      changes.push({ ...change });
      if (change.sessionRevision === 1) {
        await first_change_block;
      }
    });
    let first_change_completed = false;
    const first_change = session_state.mark_loaded("E:/Project/a.lg").then(() => {
      first_change_completed = true;
    });

    await Promise.resolve();
    expect(first_change_completed).toBe(false);
    release_first_change();
    await first_change;
    await session_state.mark_loaded("E:/Project/b.lg");
    await session_state.clear();

    expect(changes).toEqual([
      {
        loaded: true,
        projectPath: "E:/Project/a.lg",
        sessionRevision: 1,
      },
      {
        loaded: true,
        projectPath: "E:/Project/b.lg",
        sessionRevision: 2,
      },
      {
        loaded: false,
        projectPath: "",
        sessionRevision: 3,
      },
    ]);
  });
});
