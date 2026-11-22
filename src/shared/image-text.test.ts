import { expect, it } from "vitest";
import { image_text_color, image_text_stroke_width } from "./image-text";

it("描边按字号的 10% 增长，限制在 1 到 2.5 像素", () => {
  expect([4, 16, 25, 50].map(image_text_stroke_width)).toEqual([1, 1.6, 2.5, 2.5]);
});

it("确认底色决定对比度更高的黑白字色", () => {
  expect(image_text_color([255, 255, 255])).toBe("black");
  expect(image_text_color([0, 0, 0])).toBe("white");
  expect(image_text_color([255, 220, 10])).toBe("black");
});
