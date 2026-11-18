import { expect, it } from "vitest";
import { ImageFormat, build_image_text_input, image_record_identities } from "./image-format";
import { image_fixture } from "../../../test/image-fixture";

it("图片译文快照区分完成空正文、排除与未翻译", async () => {
  const fixture = image_fixture(["blank", "excluded", "unfinished"]);
  const bytes = await fixture.pack();
  const { items } = await new ImageFormat().read(bytes, "book.image");
  items[0]!.status = "PROCESSED";
  items[0]!.dst = "";
  items[1]!.status = "EXCLUDED";
  items[1]!.dst = "既有译文";
  const { textRecords } = await build_image_text_input(bytes, items, "book.image");
  expect(textRecords).toMatchObject([
    { output: "translated", text: "" },
    { output: "original" },
    { output: null },
  ]);
});

it("重新准备仅改变包号和页号时保留原稿身份", () => {
  const fixture = image_fixture();
  const recreated = structuredClone(fixture.book);
  recreated.bookId = "recreated";
  recreated.pages[0]!.pageId = "recreated-page";
  const records = structuredClone(fixture.records);
  records[0]!.pageId = "recreated-page";
  expect(image_record_identities(recreated, records)).toEqual(
    image_record_identities(fixture.book, fixture.records),
  );
});
