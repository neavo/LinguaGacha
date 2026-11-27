import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { AppPathService } from "../app/app-path-service";
import { default_native_fs } from "../../native/native-fs";
import { ProjectDefaultPresetReader } from "./project-default-preset-reader";

it("跳过缺失的预设，继续读取规则和含 Unicode 文件名的提示词", () => {
  using directory = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "default-preset-"));
  const builtin_root = path.join(directory.path, "builtin");
  const prompt_name = "Português.txt";
  const missing = "builtin:missing.json";
  default_native_fs.write_file_sync(
    path.join(builtin_root, "glossary", "preset", "base.json"),
    JSON.stringify([{ src: "勇者", dst: "Hero" }]),
  );
  default_native_fs.write_file_sync(
    path.join(builtin_root, "translation_prompt", "preset", prompt_name.normalize("NFD")),
    "\uFEFF翻译提示词\n",
  );
  const reader = new ProjectDefaultPresetReader(
    {
      read_setting: () => ({
        glossary_default_preset: "builtin:base.json",
        pre_translation_replacement_default_preset: missing,
        translation_custom_prompt_default_preset: `builtin:${prompt_name}`,
      }),
    },
    new AppPathService({ appRoot: directory.path, builtinRoot: builtin_root }),
    default_native_fs,
  );
  const warning = vi.fn();
  expect(reader.read({ warning })).toMatchObject({
    quality_rules: [{ kind: "glossary", entries: [{ src: "勇者", dst: "Hero" }] }],
    translation_prompt: { text: "翻译提示词", enabled: true },
  });
  expect(warning).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ context: expect.objectContaining({ virtual_id: missing }) }),
  );
});
