import path from "node:path";
import { expect, it, vi } from "vitest";
import { create_file_generator, execute_generate_files_request } from "./generate-files";

it("宿主为每次生成选择独立的工作目录并透传生成结果", async () => {
  const root = path.resolve("workspace");
  const generate_files_to_directory = vi.fn(async (output_path: string) => ({
    accepted: true as const,
    output_path,
    pdf_files: [],
  }));
  const generate = create_file_generator(root, { generate_files_to_directory });
  const first = await generate(),
    second = await generate();
  expect(first.output_path).not.toBe(second.output_path);
  for (const result of [first, second])
    expect(path.dirname(result.output_path)).toBe(path.join(root, "work"));
  expect(first).toBe(await generate_files_to_directory.mock.results[0]!.value);
});

it("生成请求拒绝脚本指定路径，取消后不进入生成端口", async () => {
  const generate = vi.fn(async () => ({
    accepted: true as const,
    output_path: "output",
    pdf_files: [],
  }));
  const controller = new AbortController();
  await expect(
    execute_generate_files_request(
      { kind: "generate_files", output_path: "outside" },
      controller.signal,
      generate,
    ),
  ).rejects.toThrow();
  controller.abort();
  await expect(
    execute_generate_files_request({ kind: "generate_files" }, controller.signal, generate),
  ).rejects.toThrow();
  expect(generate).not.toHaveBeenCalled();
  expect(
    await execute_generate_files_request(
      { kind: "generate_files" },
      new AbortController().signal,
      generate,
    ),
  ).toMatchObject({ accepted: true });
});
