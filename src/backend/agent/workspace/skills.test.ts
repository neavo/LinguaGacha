import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { default_native_fs } from "../../../native/native-fs";
import { project_workspace_skill } from "./skills";

it("投影整个模块包，重读刷新资源并清除已删除模块", () => {
  using directory = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-skill-projection-"));
  const source = path.join(directory.path, "source");
  const workspace = path.join(directory.path, "workspace");
  fs.mkdirSync(path.join(source, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(source, "SKILL.md"), "技能正文");
  fs.writeFileSync(path.join(source, "scripts/entry.mjs"), "export const value = 1;");
  const project = () => project_workspace_skill(default_native_fs, workspace, "fixture", source);
  expect(project()).toBe("skills/fixture");
  const projected = path.join(workspace, "skills/fixture");
  expect(fs.readFileSync(path.join(projected, "scripts/entry.mjs"), "utf8")).toBe(
    "export const value = 1;",
  );
  fs.unlinkSync(path.join(source, "scripts/entry.mjs"));
  fs.writeFileSync(path.join(source, "SKILL.md"), "更新正文");
  project();
  expect(fs.existsSync(path.join(projected, "scripts/entry.mjs"))).toBe(false);
  expect(fs.readFileSync(path.join(projected, "SKILL.md"), "utf8")).toBe("更新正文");
});
