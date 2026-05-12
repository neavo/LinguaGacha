// 外链只允许交给系统浏览器处理 http / https，阻断 file 等本地协议注入。
export function resolve_external_url(url: string): string {
  const normalized_url = url.trim();

  if (normalized_url === "") {
    throw new Error("外部链接不能为空。");
  }

  const parsed_url = new URL(normalized_url);
  const protocol = parsed_url.protocol.toLowerCase();

  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("当前只支持通过系统浏览器打开 http 或 https 链接。");
  }

  return parsed_url.toString();
}
