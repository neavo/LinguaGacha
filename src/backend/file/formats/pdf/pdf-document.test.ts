import { expect, it, vi } from "vitest";
import * as mupdf from "mupdf";
import { create_pdf_fixture } from "./test-support";
import { read_pdf_document, build_pdf_document, render_pdf_page } from "./pdf-document";
it("按原页尺寸和背景分组，省略页不占位置，背景位于每张译文页底层", async () => {
  const original = new mupdf.PDFDocument(
    create_pdf_fixture(["One", "Two", null, "Four", "Five", "Six"]),
  );
  const changed = original.loadPage(4);
  changed.setPageBox("MediaBox", [0, 0, 400, 300]);
  changed.destroy();
  const saved = original.saveToBuffer("");
  const bytes = new Uint8Array(saved.asUint8Array());
  saved.destroy();
  original.destroy();
  const document = read_pdf_document(bytes);
  const background = { page: 3, x: 40, y: 180, width: 80, height: 73 };
  document.pages[0]!.translation = { kind: "translate", markdown: "First", background };
  document.pages[1]!.translation = {
    kind: "translate",
    markdown: "Second",
    background: { ...background },
  };
  document.pages[2]!.translation = { kind: "omit", reason: "装饰页" };
  document.pages[3]!.translation = { kind: "translate", markdown: "Fourth" };
  document.pages[4]!.translation = { kind: "translate", markdown: "Fifth" };
  const print = vi.fn(async (html: string) =>
    create_pdf_fixture(html.includes("First") ? ["A", "B"] : [html.includes("Fourth") ? "C" : "D"]),
  );
  const result = await build_pdf_document({ title: "test", document, source_bytes: bytes, print });
  expect(print).toHaveBeenCalledTimes(3);
  expect(print.mock.calls[0]![0]).toContain("Second");
  expect(print.mock.calls[0]![0]).toContain("size:300pt 300pt");
  expect(print.mock.calls[2]![0]).toContain("size:400pt 300pt");
  expect(await read_text(result)).toEqual(["A", "B", "C", "D", "Six"]);
  const pdf = new mupdf.PDFDocument(result);
  try {
    for (const [index, color] of [
      [0, [25, 102, 204]],
      [1, [25, 102, 204]],
      [2, [255, 255, 255]],
    ] as const) {
      const page = pdf.loadPage(index);
      const pixmap = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false);
      try {
        expect(Array.from(pixmap.getPixels().subarray(0, 3))).toEqual(color);
      } finally {
        pixmap.destroy();
        page.destroy();
      }
    }
  } finally {
    pdf.destroy();
  }
});

/** 从最终 PDF 页序读取文本，验证替换与保留的实际结果。 */
async function read_text(bytes: Uint8Array): Promise<string[]> {
  const pdf = new mupdf.PDFDocument(bytes);
  try {
    return Array.from({ length: pdf.countPages() }, (_, index) => {
      const page = pdf.loadPage(index);
      const text = page.toStructuredText("");
      try {
        return text.asText().trim();
      } finally {
        text.destroy();
        page.destroy();
      }
    });
  } finally {
    pdf.destroy();
  }
}

it("待处理与确认保留页共同原样输出资产，无需打印", async () => {
  const bytes = create_pdf_fixture();
  const document = read_pdf_document(bytes);
  document.pages[0]!.translation = { kind: "keep", reason: "已确认无需翻译" };
  const print = vi.fn();
  expect(await build_pdf_document({ title: "book", document, source_bytes: bytes, print })).toEqual(
    bytes,
  );
  expect(print).not.toHaveBeenCalled();
});

it("混合导出保留头尾与中间原页，译稿跨过空页连续打印，译文可扩展页数", async () => {
  const original = new mupdf.PDFDocument(
    create_pdf_fixture(Array.from({ length: 8 }, (_, index) => `Original ${index + 1}`)),
  );
  const original_page = original.loadPage(4);
  const object = original_page.getObject();
  object.put("Rotate", 90);
  object.destroy();
  original_page.destroy();
  const saved = original.saveToBuffer("");
  const bytes = new Uint8Array(saved.asUint8Array());
  saved.destroy();
  original.destroy();
  const document = read_pdf_document(bytes);
  document.pages[4]!.translation = { kind: "keep", reason: "原页无需翻译" };
  document.pages[1]!.translation = { kind: "translate", markdown: "# Second" };
  document.pages[2]!.translation = { kind: "translate", markdown: "" };
  document.pages[3]!.translation = { kind: "translate", markdown: "# Fourth" };
  document.pages[5]!.translation = { kind: "translate", markdown: "# Sixth and seventh" };
  document.pages[6]!.translation = { kind: "translate", markdown: "" };
  const print = vi.fn(async (html: string) =>
    html.includes("Second")
      ? create_pdf_fixture(["Translated 2-4 A", "Translated 2-4 B", "Translated 2-4 C"])
      : create_pdf_fixture(["Translated 6-7"]),
  );
  const output = await build_pdf_document({
    title: "book",
    document,
    source_bytes: bytes,
    print,
  });
  expect(print).toHaveBeenCalledTimes(2);
  expect(print.mock.calls[0]![0]).toContain("Fourth");
  expect(await read_text(output)).toEqual([
    "Original 1",
    "Translated 2-4 A",
    "Translated 2-4 B",
    "Translated 2-4 C",
    "Original 5",
    "Translated 6-7",
    "Original 8",
  ]);
  const result = read_pdf_document(output);
  expect(result.pages[4]).toMatchObject({ rotation: 90, width: 300, height: 300 });
});

it("全篇译稿替换全部原页，打印失败和取消不回退原文", async () => {
  const bytes = create_pdf_fixture();
  const document = read_pdf_document(bytes);
  document.pages[0]!.translation = { kind: "translate", markdown: "" };
  document.pages[1]!.translation = { kind: "translate", markdown: "全部译稿" };
  document.pages[2]!.translation = { kind: "translate", markdown: "" };
  const args = {
    title: "book",
    document,
    source_bytes: bytes,
  };
  expect(
    await read_text(
      await build_pdf_document({
        ...args,
        print: async () => create_pdf_fixture(["All translated"]),
      }),
    ),
  ).toEqual(["All translated"]);
  const error = new Error("Printing failed");
  await expect(
    build_pdf_document({
      ...args,
      print: async () => {
        throw error;
      },
    }),
  ).rejects.toBe(error);
  const controller = new AbortController();
  controller.abort();
  const print = vi.fn();
  await expect(build_pdf_document({ ...args, print, signal: controller.signal })).rejects.toThrow();
  expect(print).not.toHaveBeenCalled();
});

it("页面裁剪使用左上角坐标，旋转后尺寸与导入一致并限制像素分配", async () => {
  const pdf = new mupdf.PDFDocument(create_pdf_fixture());
  try {
    const bytes = render_pdf_page(pdf, {
      page: 3,
      scale: 1,
      region: { page: 3, x: 40, y: 180, width: 120, height: 80 },
    });
    const image = new mupdf.Image(bytes);
    const pixels = image.toPixmap();
    try {
      expect([pixels.getWidth(), pixels.getHeight()]).toEqual([120, 80]);
      expect(Array.from(pixels.getPixels().subarray(0, 3))).toEqual([25, 102, 204]);
    } finally {
      pixels.destroy();
      image.destroy();
    }
    const page = pdf.loadPage(2);
    const object = page.getObject();
    object.put("Rotate", 90);
    object.put("MediaBox", [0, 0, 300, 400]);
    object.destroy();
    page.destroy();
    const rotated = new mupdf.Image(render_pdf_page(pdf, { page: 3, scale: 1 }));
    try {
      expect([rotated.getWidth(), rotated.getHeight()]).toEqual([400, 300]);
    } finally {
      rotated.destroy();
    }
    expect(() => render_pdf_page(pdf, { page: 3, scale: 100 })).toThrow("pixel limit");
    expect(() =>
      render_pdf_page(pdf, {
        page: 3,
        scale: 1,
        region: { page: 3, x: 390, y: 0, width: 20, height: 20 },
      }),
    ).toThrow("outside");
    const cropped_page = pdf.loadPage(2);
    const cropped_object = cropped_page.getObject();
    cropped_object.put("CropBox", [20, 20, 280, 280]);
    cropped_object.put("UserUnit", 2);
    cropped_object.destroy();
    cropped_page.destroy();
    const crop = new mupdf.Image(
      render_pdf_page(pdf, {
        page: 3,
        scale: 1,
        region: { page: 3, x: 40, y: 40, width: 160, height: 240 },
      }),
    );
    const crop_pixels = crop.toPixmap();
    try {
      expect([crop_pixels.getWidth(), crop_pixels.getHeight()]).toEqual([160, 240]);
      expect(Array.from(crop_pixels.getPixels().subarray(0, 3))).toEqual([25, 102, 204]);
    } finally {
      crop_pixels.destroy();
      crop.destroy();
    }
  } finally {
    pdf.destroy();
  }
});

it("部分替换保留原页批注，并迁移译文外链与内部页跳转", async () => {
  const original = new mupdf.PDFDocument(create_pdf_fixture());
  const first = original.loadPage(0);
  const note = first.createAnnotation("Text");
  note.setContents("Keep this note");
  note.update();
  note.destroy();
  first.destroy();
  const source_buffer = original.saveToBuffer("");
  const bytes = new Uint8Array(source_buffer.asUint8Array());
  source_buffer.destroy();
  original.destroy();
  const printed = new mupdf.PDFDocument(create_pdf_fixture(["Translated A", "Translated B"]));
  const page = printed.loadPage(0);
  page.createLink([10, 10, 80, 25], "https://example.com/").destroy();
  page.createLink([10, 30, 80, 45], "#page=2").destroy();
  page.destroy();
  const print_buffer = printed.saveToBuffer("");
  const printed_bytes = new Uint8Array(print_buffer.asUint8Array());
  print_buffer.destroy();
  printed.destroy();
  const document = read_pdf_document(bytes);
  document.pages[0]!.translation = { kind: "keep", reason: "保留原页与批注" };
  document.pages[1]!.translation = { kind: "translate", markdown: "Translation" };
  const result = new mupdf.PDFDocument(
    await build_pdf_document({
      title: "test",
      document,
      source_bytes: bytes,
      print: async () => printed_bytes,
    }),
  );
  try {
    const original_page = result.loadPage(0);
    const notes = original_page.getAnnotations();
    try {
      expect(notes.map((value) => value.getContents())).toContain("Keep this note");
    } finally {
      for (const value of notes) value.destroy();
      original_page.destroy();
    }
    const translated_page = result.loadPage(1);
    const links = translated_page.getLinks();
    try {
      expect(links.map((link) => link.getURI())).toContain("https://example.com/");
      const internal = links.find((link) => link.getURI().startsWith("#"));
      expect(internal && result.resolveLink(internal)).toBe(2);
    } finally {
      for (const link of links) link.destroy();
      translated_page.destroy();
    }
  } finally {
    result.destroy();
  }
});
