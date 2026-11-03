import { expect, it } from "vitest";
import { validate_file_name } from "./file-name";

it("文件名允许 Unicode，拒绝跨目录、设备名和 Windows 非法名称", () => {
  expect(() => validate_file_name("世界设定.md")).not.toThrow();
  for (const name of ["", "CON.md", "Lpt1", "a/b", "a\\b", "a?.md", "a.", "a ", "a\0b"])
    expect(() => validate_file_name(name), name).toThrow();
});
