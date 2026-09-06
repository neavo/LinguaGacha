import { describe, expect, it } from "vitest";

import {
  hasProjectChangeSections,
  resolveProjectChangeSeqForSections,
  type ProjectChangeSignal,
} from "@frontend/app/state/project-change-signal";

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
  it.each([
    [create_signal({ seq: 0 }), ["items"] as const, null],
    [create_signal({ seq: 7 }), ["items"] as const, 7],
    [create_signal({ updated_sections: ["prompts"] }), ["quality"] as const, null],
  ])("只返回非零且命中目标 section 的变更序号", (signal, sections, expected) => {
    expect(resolveProjectChangeSeqForSections(signal, sections)).toBe(expected);
  });

  it("多个 section 任一命中即可判断为相关变更", () => {
    expect(
      hasProjectChangeSections(
        create_signal({
          updated_sections: ["prompts", "quality"],
        }),
        ["items", "quality"],
      ),
    ).toBe(true);
  });
});
