import { expect, it } from "vitest";

import { write_zip } from "../../../test/zip-fixture";
import { MediaFormat } from "./media-format";

const manifest = {
  source: { path: "C:/media/movie.mp4", size: 1, mtime_ns: "1", track: 0, language: "JA" },
  duration: 2,
  video: { width: 1920, height: 1080 },
  speech: null,
  asr: null,
  text: [],
};

it("媒体包读取正式清单并保留记录私有字段", async () => {
  const records = [
    { message: "原文", start: 0, end: 2, kind: "dialogue", private_locator: { cue: 1 } },
  ];
  const content = await write_zip(
    new Map([
      ["media.json", JSON.stringify(manifest)],
      ["items.json", JSON.stringify(records)],
    ]),
  );
  const format = new MediaFormat();
  const items = await format.read_from_stream(content, "movie.media");
  expect(items.map((item) => [item.src, item.row, item.file_type])).toEqual([["原文", 0, "MEDIA"]]);
  expect(
    JSON.parse(
      await format.render_text(
        content,
        [{ ...items[0]!, status: "PROCESSED", dst: "译文" }],
        "movie.media",
      ),
    ),
  ).toEqual([{ ...records[0], message: "译文" }]);
});

it("媒体格式把清单错误归入文件结构错误", async () => {
  const content = await write_zip(
    new Map([
      ["media.json", JSON.stringify({ ...manifest, text: undefined })],
      ["items.json", "[]"],
    ]),
  );
  await expect(new MediaFormat().read_from_stream(content, "bad.media")).rejects.toMatchObject({
    code: "file.invalid_structure",
  });
});
