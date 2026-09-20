import { expect, it, vi } from "vitest";
import { uploaded_file } from "../../test/agent-upload-fixture";
import { prepare_agent_message } from "./agent-message-input";
import { AGENT_MESSAGE_IMAGE_LIMIT } from "../../shared/agent";

it("普通文件按路径交给模型，混排图片的编号与视觉输入一致", async () => {
  const files = [
    uploaded_file("sheet", null),
    uploaded_file("first"),
    uploaded_file("archive", null),
    uploaded_file("second"),
  ];
  const read = vi.fn((id: string) => Buffer.from(id));
  const prepare = vi.fn(async (bytes: Uint8Array) => ({
    data: Buffer.from(bytes).toString(),
    mimeType: "image/webp" as const,
    width: 1,
    height: 1,
    originalWidth: 1,
    originalHeight: 1,
  }));
  const result = await prepare_agent_message(
    { text: "比较附件", attachments: files },

    {
      get: (id) => files.find((file) => file.uploadId === id)!,
      read_image: read,
    },
    { prepare },
  );
  expect(result.images.map((image) => image.data)).toEqual(["first", "second"]);
  expect(read.mock.calls.map(([id]) => id)).toEqual(["first", "second"]);
  const manifest = JSON.parse(result.text.match(/\[[\s\S]*\]/u)![0]);
  expect(manifest).toMatchObject([
    { path: "uploads/sheet.png" },
    { path: "uploads/first.png", image: 1 },
    { path: "uploads/archive.png" },
    { path: "uploads/second.png", image: 2 },
  ]);
});

it("视觉图片超限显式拒绝，不静默丢弃附件", async () => {
  const file = uploaded_file("image");
  const prepare = vi.fn();
  await expect(
    prepare_agent_message(
      { text: "", attachments: Array.from({ length: AGENT_MESSAGE_IMAGE_LIMIT + 1 }, () => file) },

      { get: () => file, read_image: vi.fn() },
      { prepare },
    ),
  ).rejects.toMatchObject({ code: "request.validation_failed" });
  expect(prepare).not.toHaveBeenCalled();
});
