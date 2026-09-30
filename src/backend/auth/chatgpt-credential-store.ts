import path from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";
import { default_native_fs } from "../../native/native-fs";
import { AppError } from "../../shared/error";
import type { ChatGPTCredential } from "./chatgpt-oauth";

/** 已验证账户与已签发客户端的映射，退出后保留用于再次授权。 */
export type ChatGPTRegistration = { client_id: string; subject: string; email: string };
type AccountFile = {
  host_id: string; // 同一应用数据目录的稳定安装标识。
  registration: ChatGPTRegistration | null; // 注册映射独立于 token 生命周期。
  credential: ChatGPTCredential | null; // 锁内整体替换的当前会话凭据。
  login_id: string | null; // 跨进程取消与退出使旧浏览器回调失效。
};

const LOCK_RETRIES = { retries: 100, minTimeout: 100, maxTimeout: 250 }; // 等待正在完成的刷新或撤销，最多约 25 秒。

/** 一个文件与一把跨进程锁拥有登录、刷新和退出写入，原子替换避免半份凭据。 */
export class ChatGPTCredentialStore implements CredentialStore {
  /** 文件路径由应用路径服务注入。 */
  public constructor(private readonly file_path: string) {}

  /** 缺失文件表示尚未注册，损坏文件保留 IO 错误供调用方处理。 */
  public read_account(): AccountFile {
    try {
      const value = JSON.parse(
        default_native_fs.read_file(this.file_path).toString("utf8"),
      ) as AccountFile;
      if (typeof value.host_id !== "string" || !Object.hasOwn(value, "credential"))
        throw new Error("Invalid ChatGPT credential file");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { host_id: "", registration: null, credential: null, login_id: null };
      throw new AppError("file.io_failed", { cause: error });
    }
  }

  /** Pi 读取原始凭据，到期判断交给 `Models.getAuth()`。 */
  public async read(provider_id: string): Promise<Credential | undefined> {
    return provider_id === "openai" ? (this.read_account().credential ?? undefined) : undefined;
  }

  /** 满足 Pi 凭据枚举契约，只返回非敏感元数据。 */
  public async list(): Promise<readonly { providerId: string; type: "oauth" }[]> {
    return this.read_account().credential === null ? [] : [{ providerId: "openai", type: "oauth" }];
  }

  /** Pi 刷新回调在文件锁内运行，明确失效时清除同一会话的 token。 */
  public async modify(
    _provider_id: string,
    change: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    return this.update(async (account) => {
      try {
        const credential = await change(account.credential ?? undefined);
        if (credential !== undefined) account.credential = credential as ChatGPTCredential;
      } catch (error) {
        // Pi 用 ModelsError 包装 refresh 错误；仍在同一锁内清除已确认失效的旧会话。
        for (let current = error; current instanceof Error; current = current.cause)
          if (
            current instanceof AppError &&
            (current.code === "model.auth_required" ||
              current.diagnostic_context["auth_invalid"] === true)
          ) {
            account.credential = null;
            this.save(account);
            break;
          }
        throw error;
      }
      return account.credential ?? undefined;
    });
  }

  /** Pi 删除契约与其它写入共用文件锁，账户注册信息继续保留。 */
  public async delete(): Promise<void> {
    await this.update(async (account) => {
      account.credential = null;
    });
  }

  /** 锁内总是重新读磁盘；浏览器等待不占锁，token 轮换从网络交换覆盖到落盘。 */
  public async update<T>(operation: (account: AccountFile) => Promise<T>): Promise<T> {
    default_native_fs.make_dir(path.dirname(this.file_path));
    const release = await lockfile.lock(this.file_path, {
      realpath: false,
      retries: LOCK_RETRIES,
    });
    try {
      const account = this.read_account();
      if (account.host_id === "") account.host_id = `urn:uuid:${randomUUID()}`;
      const result = await operation(account);
      this.save(account);
      return result;
    } finally {
      await release();
    }
  }

  /** 整份记录原子替换，写入失败传播给持锁调用者。 */
  private save(account: AccountFile): void {
    default_native_fs.write_file_atomic(this.file_path, JSON.stringify(account, null, 2));
  }
}
