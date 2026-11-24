import type { TextResolver } from "../../shared/i18n";
import { workspace_requests } from "./workspace/runtime/request-channel";
import { wait_for_operation } from "./wait-for-operation";

/** npm 与 uv 自动默认源的选择，具体地址由各自入口持有。 */
export type PackageSource = "official" | "mirror";

/** 对照两路检测时使用固定日志标签，`China` 指中国大陆。 */
enum Region {
  Mainland = "China",
  Outside = "Global",
  Unknown = "Unknown",
}

const REGION_TIMEOUT_MS = 8_000; // 两路并发查询共享时限，包含响应体读取。
const IPIP_HOST = "myip.ipip.net";
const IPWHO_HOST = "ipwho.is";
const NON_MAINLAND_NAMES = new Set(["香港", "澳门", "台湾"]); // IPIP 在「中国」之后给出的港澳台名称。
const REGION_CODE = /^[A-Z]{2}$/u; // ipwho 提供两位大写代码，Intl 还接受三位数字地区代码。
let region_names: Readonly<{ display: Intl.DisplayNames; countries: Set<string> }> | undefined; // 首次判定时构建，根进程只引用请求函数

/** CLDR 中文地区名（标准 Intl 数据），用于确认接口给出的是已知国家或地区，未识别文本归未知。 */
function read_region_names(): NonNullable<typeof region_names> {
  if (region_names !== undefined) return region_names;
  const display = new Intl.DisplayNames(["zh-Hans"], { type: "region", fallback: "none" });
  const countries = new Set(
    Array.from({ length: 26 * 26 }, (_, index) =>
      String.fromCharCode(65 + Math.floor(index / 26), 65 + (index % 26)),
    )
      .filter((code) => code !== "ZZ") // 「未知地区」不是国家。
      .map((code) => display.of(code))
      .filter((name): name is string => name !== undefined),
  );
  return (region_names = { display, countries });
}

/** ipwho.is 只认业务成功且国家代码有效的结果。 */
function read_ipwho_region(text: string): Region {
  const body: unknown = JSON.parse(text);
  if (typeof body !== "object" || body === null) return Region.Unknown;
  const { success, country_code: code } = body as Record<string, unknown>;
  if (success !== true || typeof code !== "string" || !REGION_CODE.test(code))
    return Region.Unknown;
  if (code === "ZZ" || read_region_names().display.of(code) === undefined) return Region.Unknown;
  return code === "CN" ? Region.Mainland : Region.Outside;
}

/** IPIP 只接受「当前 IP：… 来自于：国家 …」结构，先区分港澳台再判断大陆。 */
function read_ipip_region(text: string): Region {
  const location = /^当前 IP：\S+\s+来自于：(.+)$/u.exec(text.trim())?.[1];
  const [country, area] = location?.trim().split(/\s+/u) ?? [];
  if (country === undefined) return Region.Unknown;
  if (NON_MAINLAND_NAMES.has(country)) return Region.Outside;
  if (country === "中国")
    return area !== undefined && NON_MAINLAND_NAMES.has(area) ? Region.Outside : Region.Mainland;
  return read_region_names().countries.has(country) ? Region.Outside : Region.Unknown;
}

/** 宿主缓存默认源判定，应用重启后重新查询。 */
export class AgentPackageSources {
  private entry: Promise<PackageSource> | undefined;
  private readonly closing = new AbortController(); // 应用关闭时中止未完成查询

  /** `fetch` 默认使用应用安装的全局代理客户端，测试注入替身。 */
  public constructor(
    private readonly options: {
      log: (message: string) => void;
      t: TextResolver;
      fetch?: typeof globalThis.fetch;
    },
  ) {}

  /** 并发脚本共用一次查询，取消其中一条只结束它自己的等待。 */
  public async resolve(signal: AbortSignal): Promise<PackageSource> {
    const waiting = AbortSignal.any([signal, this.closing.signal]);
    waiting.throwIfAborted();
    this.entry ??= this.lookup(this.closing.signal).catch((error: unknown) => {
      this.entry = undefined;
      throw error;
    });
    return await wait_for_operation(this.entry, waiting);
  }

  /** 中止未完成查询并释放全部判定。 */
  public close(): void {
    this.closing.abort(new Error("Agent package sources closed."));
    this.entry = undefined;
  }

  /** 两路并发按同一个时限收尾，执行取消时直接传回原因。 */
  private async lookup(signal: AbortSignal): Promise<PackageSource> {
    const lookup_signal = AbortSignal.any([signal, AbortSignal.timeout(REGION_TIMEOUT_MS)]);
    const regions = await Promise.all([
      this.read_region(`https://${IPWHO_HOST}/`, read_ipwho_region, lookup_signal),
      this.read_region(`https://${IPIP_HOST}/`, read_ipip_region, lookup_signal),
    ]);
    signal.throwIfAborted(); // 区分执行取消与地区查询超时，后者仍允许采用另一路结果。
    // 至少一路有效且所有有效结果都在大陆以外时使用官方源。
    const source =
      regions.includes(Region.Outside) && !regions.includes(Region.Mainland)
        ? "official"
        : "mirror";
    const [ipwho, ipip] = regions;
    const { log, t } = this.options;
    // 同一次判定共用一条日志，只写地区标签和结论。
    log(
      [
        `${IPWHO_HOST} = ${ipwho}`,
        `${IPIP_HOST} = ${ipip}`,
        t(`app.log.package_source.${source}`),
      ].join("\n"),
    );
    return source;
  }

  /** HTTP、限流、解析和超时失败都不能证明地区。 */
  private async read_region(
    url: string,
    read: (text: string) => Region,
    signal: AbortSignal,
  ): Promise<Region> {
    const fetch = this.options.fetch ?? globalThis.fetch;
    try {
      const response = await fetch(url, { signal });
      const text = await response.text();
      return response.ok ? read(text) : Region.Unknown;
    } catch {
      return Region.Unknown; // 该路查询失败时仍可采用另一路结果。
    }
  }
}

/** 根进程经 IPC 取得应用默认源。 */
export async function request_package_source(): Promise<PackageSource> {
  return workspace_requests().call({ kind: "resolve_package_source" });
}
