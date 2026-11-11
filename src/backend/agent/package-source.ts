import { workspace_requests } from "./workspace/runtime/request-channel";

/** npm 与 uv 自动默认源的选择，具体地址由各自入口持有。 */
export type PackageSource = "official" | "mirror";
type Region = "mainland" | "outside" | "unknown";

const REGION_TIMEOUT_MS = 8_000; // 每路请求含响应体读取的上限，两路并发等待。
const IPIP_URL = "https://myip.ipip.net/";
const IPWHO_URL = "https://ipwho.is/";
const NON_MAINLAND_NAMES = new Set(["香港", "澳门", "台湾"]); // IPIP 在「中国」之后给出的港澳台名称。
const REGION_CODE = /^[A-Z]{2}$/u;
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
  if (typeof body !== "object" || body === null) return "unknown";
  const { success, country_code: code } = body as Record<string, unknown>;
  if (success !== true || typeof code !== "string" || !REGION_CODE.test(code)) return "unknown";
  if (code === "ZZ" || read_region_names().display.of(code) === undefined) return "unknown";
  return code === "CN" ? "mainland" : "outside";
}

/** IPIP 只接受「当前 IP：… 来自于：国家 …」结构，先区分港澳台再判断大陆。 */
function read_ipip_region(text: string): Region {
  const location = /^当前 IP：\S+\s+来自于：(.+)$/u.exec(text.trim())?.[1];
  const [country, area] = location?.trim().split(/\s+/u) ?? [];
  if (country === undefined) return "unknown";
  if (NON_MAINLAND_NAMES.has(country)) return "outside";
  if (country === "中国")
    return area !== undefined && NON_MAINLAND_NAMES.has(area) ? "outside" : "mainland";
  return read_region_names().countries.has(country) ? "outside" : "unknown";
}

/** 宿主内按对话缓存默认源判定，应用重启后重新判断，不写入任何持久化位置。 */
export class AgentPackageSources {
  private readonly entries = new Map<string, Promise<PackageSource>>(); // 同步登记，npm 与 uv 并发首查共用一次请求
  private readonly closing = new AbortController(); // 应用关闭时中止未完成查询

  /** `fetch` 默认使用应用安装的全局代理客户端，测试注入替身。 */
  public constructor(
    private readonly options: {
      log: (message: string) => void;
      fetch?: typeof globalThis.fetch;
    },
  ) {}

  /** 复用该对话的判定。取消不形成结果，下次调用重新查询。 */
  public resolve(chat_id: string, signal: AbortSignal): Promise<PackageSource> {
    const cached = this.entries.get(chat_id);
    if (cached !== undefined) return cached;
    const entry = this.lookup(AbortSignal.any([signal, this.closing.signal]));
    this.entries.set(chat_id, entry);
    entry.catch(() => {
      // 只移除自己的记录，重置后较新的查询不受迟到的取消影响。
      if (this.entries.get(chat_id) === entry) this.entries.delete(chat_id);
    });
    return entry;
  }

  /** 删除或重置对话时丢弃旧判定。 */
  public forget(chat_id: string): void {
    this.entries.delete(chat_id);
  }

  /** 中止未完成查询并释放全部判定。 */
  public close(): void {
    this.closing.abort(new Error("Agent package sources closed."));
    this.entries.clear();
  }

  /** 两路并发各自限时，普通失败归未知，只有执行取消向上传播。 */
  private async lookup(signal: AbortSignal): Promise<PackageSource> {
    const regions = await Promise.all([
      this.read_region(IPIP_URL, read_ipip_region, signal),
      this.read_region(IPWHO_URL, read_ipwho_region, signal),
    ]);
    // 至少一路有效且所有有效结果都在大陆以外时使用官方源。
    const source =
      regions.includes("outside") && !regions.includes("mainland") ? "official" : "mirror";
    const [ipip, ipwho] = regions;
    this.options.log(`Agent 默认包源：${source}（myip.ipip.net=${ipip}，ipwho.is=${ipwho}）`);
    return source;
  }

  /** 响应体读取同受时限约束。HTTP、限流、解析和超时失败都不能证明地区。 */
  private async read_region(
    url: string,
    read: (text: string) => Region,
    signal: AbortSignal,
  ): Promise<Region> {
    const fetch = this.options.fetch ?? globalThis.fetch;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(REGION_TIMEOUT_MS)]),
      });
      const text = await response.text();
      return response.ok ? read(text) : "unknown";
    } catch {
      if (signal.aborted) throw signal.reason;
      return "unknown"; // 查询不可用只降级为镜像判定，不影响后续安装。
    }
  }
}

/** 根进程经 IPC 取得当前对话的默认源，对话身份由宿主在受理执行时绑定。 */
export async function request_package_source(): Promise<PackageSource> {
  const source = await workspace_requests().call({ kind: "resolve_package_source" });
  if (source !== "official" && source !== "mirror")
    throw new Error("Invalid package source response.");
  return source;
}
