import { default_native_fs } from "../../../native/native-fs";
import { workspace_requests } from "../workspace/runtime/request-channel";

/** 打印结果经临时文件传递，读取结束即释放该文件。 */
export async function printPdf(html: string): Promise<Uint8Array> {
  const result = await workspace_requests().call({ kind: "print_pdf", html });
  try {
    return new Uint8Array(default_native_fs.read_file(result.path));
  } finally {
    default_native_fs.unlink(result.path, { force: true }); // 文件已被移除时保留原始读取错误。
  }
}
