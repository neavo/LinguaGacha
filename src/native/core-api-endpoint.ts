export const CORE_API_HOST = "127.0.0.1"; // Core API 只监听本机 IPv4 回环地址，renderer 通过 preload 获得完整 base URL

const CORE_API_BASE_URL_ARG_PREFIX = "--core-api-base-url=";

// base URL 在进入 renderer 前统一去掉尾部斜杠，避免调用层重复处理路径拼接
export function normalize_core_api_base_url(base_url: string): string {
  return base_url.trim().replace(/\/+$/u, "");
}

// 生命周期层只负责端口分配，公开访问地址由桌面契约层统一构造
export function build_core_api_base_url(port: number): string {
  return `http://${CORE_API_HOST}:${port.toString()}`;
}

// main 通过 BrowserWindow additionalArguments 注入地址，preload 只解析这一条显式契约
export function build_core_api_base_url_argument(base_url: string): string {
  return `${CORE_API_BASE_URL_ARG_PREFIX}${normalize_core_api_base_url(base_url)}`;
}

// 缺失或为空的启动参数表示窗口创建顺序错误，必须立即失败而不是猜测默认端口
export function resolve_core_api_base_url_from_argv(argv: readonly string[]): string {
  const matched_argument = argv.find((argument) =>
    argument.startsWith(CORE_API_BASE_URL_ARG_PREFIX),
  );

  if (matched_argument === undefined) {
    throw new Error("Core API base URL launch argument is missing.");
  }

  const base_url = normalize_core_api_base_url(
    matched_argument.slice(CORE_API_BASE_URL_ARG_PREFIX.length),
  );
  if (base_url === "") {
    throw new Error("Core API base URL launch argument is empty.");
  }

  return base_url;
}
