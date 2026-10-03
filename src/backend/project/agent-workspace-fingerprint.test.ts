import { expect, it } from "vitest";
import { agent_workspace_fingerprint } from "./agent-workspace-fingerprint";

it.each([
  ["", "kd3p"],
  ["搭档🙂", "6qtm"],
  ["12", "0jyw"],
])("内容 %s 生成固定的 4 位 Base36 指纹", (content, expected) => {
  expect(agent_workspace_fingerprint(content)).toBe(expected);
});
