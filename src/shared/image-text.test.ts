import { expect, it } from "vitest";
import { image_text_color, image_text_stroke_width } from "./image-text";

it("小字至少保留一个像素描边，大字最多使用两个像素", () => {
  expect([4, 50].map(image_text_stroke_width)).toEqual([1, 2]);
});

it("确认底色决定对比度更高的黑白字色", () => {
  expect(image_text_color([255, 255, 255])).toBe("black");
  expect(image_text_color([0, 0, 0])).toBe("white");
  expect(image_text_color([255, 220, 10])).toBe("black");
});
