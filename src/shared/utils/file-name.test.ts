import { expect, it } from "vitest";
import { is_portable_relative_path, validate_file_name } from "./file-name";

it("文件名允许 Unicode，拒绝跨目录、设备名和 Windows 非法名称", () => {
  expect(() => validate_file_name("世界设定.md")).not.toThrow();
  for (const name of ["", "CON.md", "Lpt1", "a/b", "a\\b", "a?.md", "a.", "a ", "a\0b"])
    expect(() => validate_file_name(name), name).toThrow();
});

it("相对路径的每一段都必须是可移植名称", () => {
  expect(is_portable_relative_path("资料/chapter/note.txt")).toBe(true);
  for (const path of ["", "/a", "a/", "a\\b", "a//b", "a/../b", "a/CON.txt"])
    expect(is_portable_relative_path(path), path).toBe(false);
});
