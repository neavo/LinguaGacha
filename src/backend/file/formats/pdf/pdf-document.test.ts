import { expect, it, vi } from "vitest";
import * as mupdf from "mupdf";
import { create_pdf_fixture } from "./test-support";
import { read_pdf_document, build_pdf_document, render_pdf_page } from "./pdf-document";
import { type PDFTranslation, type PDFTranslationSection } from "../../../../shared/pdf";

function translation(sections: PDFTranslationSection[]): PDFTranslation {
  return { sections, reviewed_pages: [], notes: "" };
}

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

it("没有译稿时原样输出资产，不调用打印或图片宿主", async () => {
  const bytes = create_pdf_fixture();
  const document = read_pdf_document(bytes);
  const print = vi.fn();
  for (const value of [null, translation([])]) {
    expect(
      await build_pdf_document({
        title: "book",
        document: { ...document, translation: value },
        source_bytes: bytes,
        print,
      }),
    ).toEqual(bytes);
  }
  expect(print).not.toHaveBeenCalled();
});

it("混合导出保留头尾与中间原页，相邻译稿一起打印，译文可扩展页数", async () => {
  const original = new mupdf.PDFDocument(
    create_pdf_fixture([
      "Original 1",
      "Original 2",
      "Original 3",
      "Original 4",
      "Original 5",
      "Original 6",
      "Original 7",
    ]),
  );
  const original_page = original.loadPage(3);
  const object = original_page.getObject();
  object.put("Rotate", 90);
  object.destroy();
  original_page.destroy();
  const saved = original.saveToBuffer("");
  const bytes = new Uint8Array(saved.asUint8Array());
  saved.destroy();
  original.destroy();
  const document = read_pdf_document(bytes);
  document.translation = translation([
    { page_start: 2, page_end: 2, markdown: "# Second" },
    { page_start: 3, page_end: 3, markdown: "# Third" },
    { page_start: 5, page_end: 6, markdown: "# Fifth and sixth" },
  ]);
  const print = vi.fn(async (html: string) =>
    html.includes("Second")
      ? create_pdf_fixture(["Translated 2-3 A", "Translated 2-3 B", "Translated 2-3 C"])
      : create_pdf_fixture(["Translated 5-6"]),
  );
  const output = await build_pdf_document({
    title: "book",
    document,
    source_bytes: bytes,
    print,
  });
  expect(print).toHaveBeenCalledTimes(2);
  expect(print.mock.calls[0]![0]).toContain("Third");
  expect(await read_text(output)).toEqual([
    "Original 1",
    "Translated 2-3 A",
    "Translated 2-3 B",
    "Translated 2-3 C",
    "Original 4",
    "Translated 5-6",
    "Original 7",
  ]);
  const result = read_pdf_document(output);
  expect(result.source.pages[4]).toMatchObject({ rotation: 90, width: 300, height: 300 });
});

it("全篇译稿替换全部原页，打印失败和取消不回退原文", async () => {
  const bytes = create_pdf_fixture();
  const document = read_pdf_document(bytes);
  document.translation = translation([{ page_start: 1, page_end: 3, markdown: "全部译稿" }]);
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
  document.translation = translation([{ page_start: 2, page_end: 2, markdown: "Translation" }]);
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
