import { expect, it } from "vitest";
import { image_text_color, normalize_image_text } from "./image-text";

it("正文规范化保留词段、显式空格与段落，并保持组合与双向字符", () => {
  expect(normalize_image_text("中文\r\n对白 New\nYork\n123\n\n\n次の\n段落")).toBe(
    "中文对白 New York 123\n\n次の段落",
  );
  expect(normalize_image_text("a\nb\nc café\n\n\u200fعربي")).toBe("a b c café\n\n\u200fعربي");
  expect(normalize_image_text("保留 \n 空格\u0000正文")).toBe("保留  空格\u0000正文");
  expect(normalize_image_text("café\nNew\nYork Привет\nмир 中文\n对白 カー\nド")).toBe(
    "café New York Привет мир 中文对白 カード",
  );
});

it("确认底色决定对比度更高的黑白字色", () => {
  expect(image_text_color([255, 255, 255])).toBe("black");
  expect(image_text_color([0, 0, 0])).toBe("white");
  expect(image_text_color([255, 220, 10])).toBe("black");
});
