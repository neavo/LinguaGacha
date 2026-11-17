import path from "node:path";
import { expect, it, vi } from "vitest";
import { create_image_qa_generator, execute_generate_image_qa_request } from "./generate-image-qa";

it("图片 QA 使用独立工作目录并拒绝通用生成参数", async () => {
  const root = path.resolve("workspace");
  const generate_image_qa = vi.fn(async (output_path: string) => ({
    output_path,
    report: {
      path: path.join(output_path, ".lg-export-report.json"),
      summary: {
        success: 1,
        failures: 0,
        originals: 0,
        translated: 1,
      },
    },
  }));
  const generate = create_image_qa_generator(root, { generate_image_qa });
  const first = await generate();
  const second = await generate();
  expect(first.output_path).not.toBe(second.output_path);
  expect(path.dirname(first.output_path)).toBe(path.join(root, "work"));

  const signal = new AbortController().signal;
  await expect(
    execute_generate_image_qa_request(
      { kind: "generate_image_qa", image_qa: true },
      signal,
      generate,
    ),
  ).rejects.toThrow("Invalid generate_image_qa request");
  const result = await execute_generate_image_qa_request(
    { kind: "generate_image_qa" },
    signal,
    generate,
  );
  expect(result).toBe(await generate_image_qa.mock.results[2]!.value);
});
