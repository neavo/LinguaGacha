/** 构造只含一页 Helvetica 文本的最小 PDF，xref 偏移按最终 bytes 精确计算。 */
export function build_text_pdf(text = "LinguaGacha PDF fixture"): Uint8Array {
  const escaped = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const content = `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET\n`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(content, "latin1").toString()} >>\nstream\n${content}endstream\nendobj\n`,
  ];
  return build_pdf(objects, 6);
}

/** 构造一页文本加一页无文本的混合 PDF，用于验证逐页容错。 */
export function build_mixed_pdf(text = "Mixed PDF text page"): Uint8Array {
  const escaped = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const text_content = `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET\n`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(text_content, "latin1")} >>\nstream\n${text_content}endstream\nendobj\n`,
    "6 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 7 0 R >>\nendobj\n",
    "7 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n",
  ];
  return build_pdf(objects, 8);
}

function build_pdf(objects: string[], object_count: number): Uint8Array {
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += object;
  }
  const xref_offset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${object_count}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${object_count} /Root 1 0 R >>\nstartxref\n${xref_offset.toString()}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}
