// 外链只允许交给系统浏览器处理 http / https，阻断 file 等本地协议注入
export function resolve_external_url(url: string): string {
  const normalized_url = url.trim();

  if (normalized_url === "") {
    throw new Error("External URL must not be empty.");
  }

  const parsed_url = new URL(normalized_url);
  const protocol = parsed_url.protocol.toLowerCase();

  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("Only http and https URLs can be opened in the system browser.");
  }

  return parsed_url.toString();
}
