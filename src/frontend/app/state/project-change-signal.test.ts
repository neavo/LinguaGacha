import { describe, expect, it } from "vitest";

import type { ProjectChangeSignal } from "@frontend/app/state/desktop-state-context";
import {
  hasProjectChangeSections,
  resolveProjectChangeSeqForSections,
} from "@frontend/app/state/project-change-signal";

/**
 * 默认信号模拟 items 变更，用例只覆盖 section 和 seq 的组合差异。
 */
function create_signal(overrides: Partial<ProjectChangeSignal> = {}): ProjectChangeSignal {
  return {
    seq: 1,
    reason: "test",
    updated_sections: ["items"],
    results: [],
    ...overrides,
  };
}

describe("project change signal section helpers", () => {
  it("seq 为 0 时不产出项目变更序号", () => {
    expect(resolveProjectChangeSeqForSections(create_signal({ seq: 0 }), ["items"])).toBeNull();
  });

  it("包含目标 section 时返回当前 seq", () => {
    expect(resolveProjectChangeSeqForSections(create_signal({ seq: 7 }), ["items"])).toBe(7);
  });

  it("不包含目标 section 时返回 null", () => {
    expect(
      resolveProjectChangeSeqForSections(
        create_signal({
          updated_sections: ["analysis"],
        }),
        ["quality"],
      ),
    ).toBeNull();
  });

  it("多个 section 任一命中即可判断为相关变更", () => {
    expect(
      hasProjectChangeSections(
        create_signal({
          updated_sections: ["analysis", "quality"],
        }),
        ["items", "quality"],
      ),
    ).toBe(true);
  });
});
