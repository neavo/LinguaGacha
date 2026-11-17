import { expect, it } from "vitest";

import {
  read_media_items,
  read_media_package_manifest,
  read_media_writeback_items,
  read_media_work_manifest,
} from "./media-package";

const base = {
  source: { path: "C:/media/movie.mp4", size: 1, mtime_ns: "1", track: 0, language: "JA" },
  duration: 10,
  video: { width: 1920, height: 1080 },
};

it("媒体工作清单允许并行分支未完成，正式清单要求全部结算", () => {
  expect(read_media_work_manifest(base)).toMatchObject({ source: base.source });
  expect(() => read_media_package_manifest(base)).toThrow("package manifest");
  expect(read_media_package_manifest({ ...base, speech: null, asr: null, text: [] })).toMatchObject(
    { source: base.source },
  );
});

it("媒体写回输入允许已确认的空译文", () => {
  expect(
    read_media_writeback_items(
      [{ message: "", start: 1, end: 2, kind: "dialogue" }],
      base.duration,
      base.video,
    ),
  ).toHaveLength(1);
});

it("媒体条目校验时间、画面分支与归一化 box", () => {
  expect(
    read_media_items(
      [{ message: "标题", start: 1, end: 2, kind: "screen", box: [0.1, 0.2, 0.8, 0.9] }],
      base.duration,
      base.video,
    ),
  ).toHaveLength(1);
  expect(() =>
    read_media_items(
      [{ message: "标题", start: 1, end: 2, kind: "screen", box: [0.8, 0.2, 0.1, 0.9] }],
      base.duration,
      base.video,
    ),
  ).toThrow("item");
  expect(() =>
    read_media_items([{ message: "标题", start: 1, end: 2, kind: "screen" }], base.duration, null),
  ).toThrow("item");
});
