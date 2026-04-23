const CORE_API_BASE_URL_ENV_NAME = "LINGUAGACHA_CORE_API_BASE_URL";
const CORE_API_BASE_URL_ARG_PREFIX = "--core-api-base-url=";
const CORE_API_HOST = "127.0.0.1";
const CORE_API_DEFAULT_PORT = 38191;

function normalize_core_api_base_url(base_url: string): string {
  return base_url.trim().replace(/\/+$/u, "");
}

function build_core_api_base_url(port: number): string {
  return `http://${CORE_API_HOST}:${port.toString()}`;
}

export function resolve_core_api_base_url(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const env_base_url = env[CORE_API_BASE_URL_ENV_NAME];

  if (typeof env_base_url === "string" && env_base_url.trim() !== "") {
    return normalize_core_api_base_url(env_base_url);
  }

  const matched_argument = argv.find((argument) =>
    argument.startsWith(CORE_API_BASE_URL_ARG_PREFIX),
  );
  if (matched_argument !== undefined) {
    return normalize_core_api_base_url(matched_argument.slice(CORE_API_BASE_URL_ARG_PREFIX.length));
  }

  return build_core_api_base_url(CORE_API_DEFAULT_PORT);
}
