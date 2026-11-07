import { expect, it } from "vitest";
import { VideoFormat } from "./video-format";
import { write_zip } from "../../../test/zip-fixture";

// 每例创建独立清单，错误场景只改动对应边界。
const manifest = () => ({
  video: { width: 1280, height: 720 },
  segments: [{ path: "segments/000.mp4", start: 0, end: 20 }],
  cues: [
    { start: 1.25, end: 3.5, kind: "dialogue", text: "原文" },
    { start: 2, end: 5, kind: "screen", text: "看板" },
  ],
});
// 媒体字节只需存在，格式解析不解码视频。
const archive = (data: unknown) =>
  write_zip(
    new Map([
      ["video.json", JSON.stringify(data)],
      ["segments/000.mp4", "media"],
    ]),
  );

it("字幕行固定坐标，生成双语、分层样式与源文回退", async () => {
  const format = new VideoFormat();
  const bytes = await archive(manifest());
  const items = await format.read_from_stream(bytes, "movie.video");
  expect(
    items.map(({ row, src, file_type, file_path }) => [row, src, file_type, file_path]),
  ).toEqual([
    [0, "原文", "VIDEO", "movie.video"],
    [1, "看板", "VIDEO", "movie.video"],
  ]);
  const result = await format.render(
    bytes,
    [{ ...items[0]!, status: "PROCESSED", dst: "译文\n{标签}\\N" }],
    "movie.video",
  );
  expect(result.translated).toContain("PlayResX: 1280\nPlayResY: 720");
  expect(result.translated).toContain(
    "Dialogue: 0,0:00:01.25,0:00:03.50,Dialogue,,0,0,0,,译文\\N\\{标签\\}\\\u2060N",
  );
  expect(result.translated).toContain("Screen,,0,0,0,,看板");
  expect(result.bilingual).toContain("原文\\N译文");
  await expect(
    format.render(bytes, [{ ...items[0]!, src: "错位" }], "movie.video"),
  ).rejects.toMatchObject({ code: "file.invalid_structure" });
  await expect(format.render(bytes, [items[0]!, items[0]!], "movie.video")).rejects.toMatchObject({
    code: "file.invalid_structure",
  });
});

it.each(["kind", "end", "order", "text", "segment", "member", "dst"])(
  "整包拒绝非法 %s，不过滤坏行",
  async (failure) => {
    const data = manifest();
    if (failure === "kind") data.cues[0]!.kind = "other";
    if (failure === "end") data.cues[0]!.end = data.cues[0]!.start;
    if (failure === "order") data.cues.reverse();
    if (failure === "text") data.cues[0]!.text = " \n";
    if (failure === "segment") data.segments[0]!.start = 1;
    if (failure === "member") data.segments[0]!.path = "segments/missing.mp4";
    const input =
      failure === "dst" ? { ...data, cues: [{ ...data.cues[0], dst: "禁止第二份译文" }] } : data;
    await expect(
      new VideoFormat().read_from_stream(await archive(input), "bad.video"),
    ).rejects.toMatchObject({ code: "file.invalid_structure" });
  },
);

it("纯音频和空字幕有默认画布，清单缺失失败", async () => {
  const format = new VideoFormat();
  const bytes = await archive({ ...manifest(), video: null, cues: [] });
  expect(await format.read_from_stream(bytes, "empty.video")).toEqual([]);
  const result = await format.render(bytes, [], "empty.video");
  expect(result.translated).toMatch(/PlayResX: [1-9]\d*\nPlayResY: [1-9]\d*/u);
  expect(result.translated).not.toContain("Dialogue: ");
  expect(result.bilingual).toBe(result.translated);
  await expect(
    format.read_from_stream(await write_zip(new Map([["other", "{}"]])), "bad.video"),
  ).rejects.toMatchObject({ code: "file.invalid_structure" });
});
