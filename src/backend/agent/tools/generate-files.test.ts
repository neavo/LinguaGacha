import path from "node:path";
import { expect, it, vi } from "vitest";
import {
  create_file_generator,
  execute_generate_files_request,
  execute_get_output_paths_request,
} from "./generate-files";

it("宿主为每次生成选择独立的工作目录并透传生成结果", async () => {
  const root = path.resolve("workspace");
  const generate_staging_files = vi.fn(async (output_path: string) => ({
    accepted: true as const,
    output_path,
    bilingual_output_path: "bilingual",
    pdf_files: [],
  }));
  const generate = create_file_generator(root, { generate_staging_files });
  const first = await generate(["book.txt"]),
    second = await generate(["book.txt"]);
  expect(first.output_path).not.toBe(second.output_path);
  for (const result of [first, second])
    expect(path.dirname(result.output_path)).toBe(path.join(root, "work"));
  expect(first).toBe(await generate_staging_files.mock.results[0]!.value);
  expect(generate_staging_files).toHaveBeenCalledWith(first.output_path, ["book.txt"]);
});

it("生成请求拒绝脚本指定路径，取消后不进入生成端口", async () => {
  const generate = vi.fn(async () => ({
    accepted: true as const,
    output_path: "output",
    bilingual_output_path: "bilingual",
    pdf_files: [],
  }));
  const controller = new AbortController();
  for (const bilingual_files of [undefined, true, [1]]) {
    await expect(
      execute_generate_files_request(
        { kind: "generate_files", bilingual_files },
        controller.signal,
        generate,
      ),
    ).rejects.toThrow();
  }
  await expect(
    execute_generate_files_request(
      { kind: "generate_files", bilingual_files: [], output_path: "outside" },
      controller.signal,
      generate,
    ),
  ).rejects.toThrow();
  controller.abort();
  await expect(
    execute_generate_files_request(
      { kind: "generate_files", bilingual_files: [] },
      controller.signal,
      generate,
    ),
  ).rejects.toThrow();
  expect(generate).not.toHaveBeenCalled();
  expect(
    await execute_generate_files_request(
      { kind: "generate_files", bilingual_files: ["book.txt"] },
      new AbortController().signal,
      generate,
    ),
  ).toMatchObject({ accepted: true });
  expect(generate).toHaveBeenCalledExactlyOnceWith(["book.txt"]);
});

it("交付目录请求校验绝对路径、拒绝多余字段，并转发手动选择", async () => {
  const directory = path.resolve("output");
  const result = { manual: false, translated_path: directory, bilingual_path: directory };
  const read_paths = vi.fn(() => result);
  const signal = new AbortController().signal;
  for (const request of [
    { kind: "get_output_paths", directory: "relative" },
    { kind: "get_output_paths", directory: 1 },
    { kind: "get_output_paths", extra: true },
  ])
    await expect(execute_get_output_paths_request(request, signal, read_paths)).rejects.toThrow();
  expect(read_paths).not.toHaveBeenCalled();
  expect(
    await execute_get_output_paths_request({ kind: "get_output_paths" }, signal, read_paths),
  ).toBe(result);
  expect(read_paths).toHaveBeenLastCalledWith(undefined);
  expect(
    await execute_get_output_paths_request(
      { kind: "get_output_paths", directory },
      signal,
      read_paths,
    ),
  ).toBe(result);
  expect(read_paths).toHaveBeenLastCalledWith(directory);
  const controller = new AbortController();
  controller.abort();
  read_paths.mockClear();
  await expect(
    execute_get_output_paths_request({ kind: "get_output_paths" }, controller.signal, read_paths),
  ).rejects.toThrow();
  expect(read_paths).not.toHaveBeenCalled();
});
