import { expect, it } from "vitest";
import { image_text_color } from "./image-text";

it("确认底色决定对比度更高的黑白字色", () => {
  expect(image_text_color([255, 255, 255])).toBe("black");
  expect(image_text_color([0, 0, 0])).toBe("white");
  expect(image_text_color([255, 220, 10])).toBe("black");
});
