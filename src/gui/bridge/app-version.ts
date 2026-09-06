const APP_VERSION_ARG_PREFIX = "--app-version=";

/** main 将后端版本随窗口启动参数交给 preload。 */
export function build_app_version_argument(version: string): string {
  return `${APP_VERSION_ARG_PREFIX}${version}`;
}

/** 版本必须随窗口创建注入；缺失表示桌面启动契约不完整。 */
export function resolve_app_version_from_argv(argv: readonly string[]): string {
  const version = argv
    .find((argument) => argument.startsWith(APP_VERSION_ARG_PREFIX))
    ?.slice(APP_VERSION_ARG_PREFIX.length)
    .trim();
  if (version === undefined || version === "") {
    throw new Error("App version launch argument is missing or empty.");
  }
  return version;
}
