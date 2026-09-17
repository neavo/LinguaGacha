import { onTestFinished } from "vitest";
import type { PDFHost } from "../../../../shared/pdf";
import { PDFWorker, type PDFExecution } from "./pdf-worker";

/** 测试显式选择同进程执行，并在用例结束时排空执行队列。 */
export function create_pdf_execution(print?: PDFHost): PDFExecution {
  const worker = new PDFWorker(null, print);
  onTestFinished(() => worker.dispose());
  return worker.run;
}

/** 有文字、跨页片段和纯图页的独立 PDF 夹具，直接构造标准对象和 xref。 */
export function create_pdf_fixture(
  texts: readonly (string | null)[] = ["First half", "second half", null],
  size: readonly [number, number] = [300, 300],
): Uint8Array {
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const pages: number[] = [];
  for (const text of texts) {
    const page = objects.length + 1;
    pages.push(page);
    const content =
      text === null
        ? "0.1 0.4 0.8 rg 40 40 120 80 re f"
        : `BT /F1 18 Tf 40 240 Td (${text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size[0]} ${size[1]}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${page + 1} 0 R >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${pages.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf));
}
