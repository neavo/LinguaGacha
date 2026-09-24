import { describe, expect, it } from "vitest";
import { normalize_agent_skill_settings } from "./agent-skill-settings";

describe("技能偏好", () => {
  it("清理手动配置中的非法名称与重复项，并保留各来源和排序", () => {
    expect(
      normalize_agent_skill_settings({
        disabled: { builtin: ["shared", "shared", null], user: "shared" },
        user_order: ["second", false, "first", "second", "../outside"],
      }),
    ).toEqual({
      disabled: { builtin: ["shared"], user: [] },
      user_order: ["second", "first"],
    });
    expect(normalize_agent_skill_settings(null)).toEqual({
      disabled: { builtin: [], user: [] },
      user_order: [],
    });
  });
});
