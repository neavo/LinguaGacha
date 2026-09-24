import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  change_skill_file,
  read_skill_file,
  read_skill_tree,
  skill_existing_path,
  write_skill_file,
} from "./agent-skill-files";

const skill = { source: "user" as const, name: "sample" };

/** 每个场景独占真实目录，结束时由资源作用域清理。 */
function fixture() {
  const temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-skill-files-"));
  const root = fs.realpathSync(temporary.path);
  fs.writeFileSync(
    path.join(root, "SKILL.md"),
    "---\nname: sample\ndescription: example\n---\n\nBody",
  );
  return { root, [Symbol.dispose]: () => temporary[Symbol.dispose]() };
}

describe("技能文件", () => {
  it("每级目录优先，主文件参与普通文件排序", () => {
    using f = fixture();
    fs.mkdirSync(path.join(f.root, "z-folder/nested"), { recursive: true });
    fs.mkdirSync(path.join(f.root, "a-folder"));
    fs.writeFileSync(path.join(f.root, "a.md"), "");
    fs.writeFileSync(path.join(f.root, "z-folder/a.md"), "");
    expect(read_skill_tree(f.root).map((entry) => entry.path)).toEqual([
      "a-folder",
      "z-folder",
      "z-folder/nested",
      "z-folder/a.md",
      "a.md",
      "SKILL.md",
    ]);
  });
  it("文件读写、移动和删除保留正文，入口及内部文件受保护", async () => {
    using f = fixture();
    fs.writeFileSync(path.join(f.root, "ui.json"), "{}");
    expect(read_skill_tree(f.root)).toEqual([{ path: "SKILL.md", kind: "file" }]);
    await change_skill_file(f.root, { operation: "create_directory", path: "references" });
    await change_skill_file(f.root, { operation: "create_file", path: "references/note.md" });
    write_skill_file(skill_existing_path(f.root, "references/note.md"), "  text\n\n");
    await change_skill_file(f.root, {
      operation: "move",
      path: "references/note.md",
      destination: "note.md",
    });
    expect(read_skill_file(f.root, skill, "note.md").text).toBe("  text\n\n");
    for (const relative of ["ui.json", "UI.JSON", "../outside.md", "skill.md"]) {
      expect(() => read_skill_file(f.root, skill, relative)).toThrow();
    }
    for (const operation of ["create_file", "delete", "move"] as const) {
      for (const relative of ["SKILL.md", "ui.json"]) {
        await expect(
          change_skill_file(f.root, { operation, path: relative, destination: "other.md" }),
        ).rejects.toThrow();
      }
    }
    await change_skill_file(f.root, { operation: "delete", path: "references" });
    expect(fs.existsSync(path.join(f.root, "references"))).toBe(false);
  });

  it("包内链接不参与读取或创建，父目录操作保护隐藏后代", async () => {
    using f = fixture();
    using outside = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-skill-outside-"));
    fs.writeFileSync(path.join(outside.path, "secret.md"), "private");
    fs.symlinkSync(outside.path, path.join(f.root, "linked"), "junction");
    expect(read_skill_tree(f.root).some((entry) => entry.path === "linked")).toBe(false);
    expect(() => read_skill_file(f.root, skill, "linked/secret.md")).toThrow();
    await expect(
      change_skill_file(f.root, { operation: "create_file", path: "linked/new.md" }),
    ).rejects.toThrow();
    fs.mkdirSync(path.join(f.root, "nested"));
    fs.writeFileSync(path.join(f.root, "nested/ui.json"), "{}");
    await expect(
      change_skill_file(f.root, { operation: "delete", path: "nested" }),
    ).rejects.toThrow();
    expect(fs.readFileSync(path.join(outside.path, "secret.md"), "utf8")).toBe("private");
  });

  it("二进制文件只返回信息", () => {
    using f = fixture();
    const binary = path.join(f.root, "asset.bin");
    fs.writeFileSync(binary, Buffer.from([0, 255, 1]));
    expect(read_skill_file(f.root, skill, "asset.bin").text).toBeNull();
  });
});
