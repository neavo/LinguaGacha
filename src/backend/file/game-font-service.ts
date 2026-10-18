import path from "node:path";
import { default_native_fs, type NativeFs } from "../../native/native-fs";
import type { JsonRecord } from "../../domain/json";
import { AppError, read_error_message } from "../../shared/error";
import type { RuntimeOperationGate } from "../runtime-operation-gate";
import { read_font_family_names } from "./shared/game/font-name";
import { replace_game_font, type GameFont, type GameFontSource } from "./shared/game/font-replace";
import type { GamePrepareExecution } from "./shared/game/prepare-worker";
import { discover_source } from "./source-discovery";

type GameFontRequest = Readonly<{ font_path: string; game_path: string }>; // 游戏路径可以是启动程序或游戏目录。

/** 独立于工程会话修改游戏字体，写入目标由游戏程序或目录确定。 */
export class GameFontService {
  /** 注入写入互斥、准备任务与文件访问，检查和修改共用同一组依赖。 */
  public constructor(
    private readonly gate: Pick<RuntimeOperationGate, "run_project_write">, // 与导入、翻译共用游戏目录写入互斥。
    private readonly execute: GamePrepareExecution,
    private readonly fs: NativeFs = default_native_fs,
  ) {}

  /** 选择后尽早报告不支持的字体或游戏，不占用写入。 */
  public async inspect(body: JsonRecord): Promise<JsonRecord> {
    const request = read_request(body);
    this.read_font(request.font_path);
    await this.read_game(request.game_path);
    return {};
  }

  /** 写入占用覆盖重新识别、解包、替换、回滚和清理的全过程。 */
  public async apply(body: JsonRecord): Promise<JsonRecord> {
    const request = read_request(body);
    return this.gate.run_project_write(async (signal) => {
      const font = this.read_font(request.font_path);
      await replace_game_font(
        await this.read_game(request.game_path, signal),
        font,
        this.fs,
        this.execute,
        signal,
      );
      return {};
    });
  }

  /** 内部名称解析失败的文件不能作为字体写入游戏。 */
  private read_font(font_path: string): GameFont {
    const bytes = this.fs.read_file(font_path);
    try {
      return {
        bytes,
        file_name: path.basename(font_path),
        families: read_font_family_names(bytes),
      };
    } catch (cause) {
      throw new AppError("file.parse_failed", {
        cause,
        message: font_path + ": " + read_error_message(cause),
      });
    }
  }

  /** 沿用导入的游戏识别，只接受字体替换支持的引擎。 */
  private async read_game(game_path: string, signal?: AbortSignal): Promise<GameFontSource> {
    const { source } = await discover_source(game_path, this.fs, signal);
    if (source.kind === "failure") throw source.error;
    if (source.kind !== "wolfrpg" && source.kind !== "mv_mz")
      throw new AppError("file.invalid_structure", {
        message: "Unsupported game for font replacement: " + game_path,
      });
    return source;
  }
}

/** 原生选择与拖入共用请求形状，文件有效性由服务读取时检查。 */
function read_request(body: JsonRecord): GameFontRequest {
  const { font_path, game_path } = body;
  if (
    typeof font_path !== "string" ||
    !font_path.trim() ||
    typeof game_path !== "string" ||
    !game_path.trim()
  )
    throw new AppError("request.validation_failed");
  return { font_path, game_path };
}
