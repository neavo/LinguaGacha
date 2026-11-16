import { expect, it } from "vitest";
import { image_fixture } from "../../../test/image-fixture";
import { type ImageTextSelection } from "../../../shared/image-text";
import { image_text_page_digest } from "./render";

it("阅读顺序与等价换行不改变页像素身份，底图、正文、方向和环境变化使其失效", () => {
  const fixture = image_fixture(["p"]);
  const page = fixture.book.pages[0]!;
  page.regions.push({ ...page.regions[0]!, regionId: "other" });
  const records = [
    { pageId: "p", regionId: "text", text: "中文\n正文" },
    { pageId: "p", regionId: "other", text: "A" },
  ];
  const environment = {
    fontSha256: "a".repeat(64),
    rendererSha256: "b".repeat(64),
    chromium: "fixture",
    platform: "fixture",
    arch: "fixture",
    raster: "chromium-native-dpr1" as const,
  };
  const digest = image_text_page_digest(page, "c".repeat(64), records, environment);
  const selected: ImageTextSelection[] = records.map((record) => ({
    regionId: record.regionId,
    candidateId: "C0",
    text: record.text,
    blocks: [
      {
        blockId: "B1",
        text: record.text,
        box: [0, 0, 1, 1],
        areaShare: 1,
        selection: page.regions[0]!.selection!,
      },
    ],
  }));
  expect(
    image_text_page_digest(page, "c".repeat(64), records, environment, [...selected].reverse()),
  ).toBe(image_text_page_digest(page, "c".repeat(64), records, environment, selected));
  expect(
    image_text_page_digest(
      { ...page, regions: [...page.regions].reverse() },
      "c".repeat(64),
      [records[1]!, { ...records[0]!, text: "中文正文" }],
      environment,
    ),
  ).toBe(digest);
  expect(image_text_page_digest(page, "d".repeat(64), records, environment)).not.toBe(digest);
  expect(
    image_text_page_digest(
      page,
      "c".repeat(64),
      [{ ...records[0]!, text: "改变" }, records[1]!],
      environment,
    ),
  ).not.toBe(digest);
  expect(
    image_text_page_digest(
      { ...page, regions: page.regions.map((r) => ({ ...r, direction: "horizontal-tb" })) },
      "c".repeat(64),
      records,
      environment,
    ),
  ).not.toBe(digest);
  expect(
    image_text_page_digest(page, "c".repeat(64), records, {
      ...environment,
      rendererSha256: "e".repeat(64),
    }),
  ).not.toBe(digest);
});
