import { describe, expect, it } from "vitest";

import { ProjectSessionState } from "./project-session-state";

describe("ProjectSessionState", () => {
  it("只在非空路径标记 loaded，并暴露去空白后的工程路径", () => {
    const session_state = new ProjectSessionState();

    session_state.mark_loaded("  E:/Project/demo.lg  ");

    expect(session_state.snapshot()).toEqual({
      loaded: true,
      projectPath: "E:/Project/demo.lg",
    });
  });

  it("空路径和 clear 会回到未加载快照且不复用旧快照对象", () => {
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    const previous_snapshot = session_state.snapshot();
    previous_snapshot.loaded = false;
    previous_snapshot.projectPath = "被外部改写";

    expect(session_state.snapshot()).toEqual({
      loaded: true,
      projectPath: "E:/Project/demo.lg",
    });

    session_state.mark_loaded("   ");

    expect(session_state.snapshot()).toEqual({
      loaded: false,
      projectPath: "",
    });

    session_state.mark_loaded("E:/Project/demo.lg");
    session_state.clear();

    expect(session_state.snapshot()).toEqual({
      loaded: false,
      projectPath: "",
    });
  });
});
