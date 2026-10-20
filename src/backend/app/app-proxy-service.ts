import { read_proxy_setting } from "../../domain/setting";
import type { AppProxyApplier, AppProxyRuntimeStatus } from "../../shared/proxy";
import type { AppSettingService } from "./app-setting-service";

/**
 * 出站代理的下发入口：把生效配置交给宿主，并记录对外可见的运行期状态。
 *
 * 状态只存在于内存，不写入设置文件；重启后按持久化配置重新计算。
 */
export class AppProxyService {
  private status: AppProxyRuntimeStatus = {
    applied: false,
    effectiveMode: "system",
    failureReason: null,
  };

  /** 保存下发端口与设置读取入口；设置只用于启动期读取持久化配置。 */
  public constructor(
    private readonly applier: AppProxyApplier,
    private readonly settings: AppSettingService,
  ) {}

  /** 启动期按持久化配置下发；失败只降级为跟随系统并记录原因，不阻止启动。 */
  public async apply_persisted(): Promise<void> {
    try {
      await this.apply(this.settings.read_setting()["proxy"]);
    } catch (error) {
      this.status = {
        applied: false,
        effectiveMode: "system",
        failureReason: read_failure_reason(error),
      };
    }
  }

  /** 保存路径下发请求中的配置；失败只记录原因并抛出，由命令层跳过落盘。 */
  public async apply_or_throw(value: unknown): Promise<void> {
    try {
      await this.apply(value);
    } catch (error) {
      this.status = { ...this.status, failureReason: read_failure_reason(error) };
      throw error;
    }
  }

  /** 读取下发状态；未下发时按跟随系统出站。 */
  public read_status(): AppProxyRuntimeStatus {
    return this.status;
  }

  /** 生效模式由领域归一给出：手动字段不完整时按跟随系统出站。 */
  private async apply(value: unknown): Promise<void> {
    const resolved = read_proxy_setting(value);
    await this.applier.apply({
      mode: resolved.effective_mode,
      protocol: resolved.protocol,
      host: resolved.host,
      port: resolved.port,
      username: resolved.username,
      password: resolved.password,
    });
    this.status = { applied: true, effectiveMode: resolved.effective_mode, failureReason: null };
  }
}

/** 下发失败原因只取宿主错误文本；凭据从不进入宿主的代理配置。 */
function read_failure_reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
