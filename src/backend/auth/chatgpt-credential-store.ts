import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { default_native_fs } from "../../native/native-fs";
import { AppError } from "../../shared/error";
import type { ChatGPTCredential } from "./chatgpt-oauth";

type AccountFile = {
  host_id: string; // 同一应用数据目录的稳定安装标识。
  credential: ChatGPTCredential | null; // 锁内整体替换的当前会话凭据。
  login_id: string | null; // 跨进程取消与退出使旧浏览器回调失效。
};

const LOCK_RETRIES = { retries: 100, minTimeout: 100, maxTimeout: 250 }; // 跨进程锁等待有界，刷新锁覆盖最长 15 秒的 token 请求。

/** 账户写锁只保护本地提交，会话刷新锁单独协调网络轮换。 */
export class ChatGPTCredentialStore {
  /** 文件路径由应用路径服务注入。 */
  public constructor(private readonly file_path: string) {}

  /** 只读取当前字段，旧文件的注册绑定在下次原子写入时自然移除。 */
  public read_account(): AccountFile {
    try {
      const value = JSON.parse(
        default_native_fs.read_file(this.file_path).toString("utf8"),
      ) as AccountFile;
      if (typeof value.host_id !== "string" || !Object.hasOwn(value, "credential"))
        throw new Error("Invalid ChatGPT credential file");
      return { host_id: value.host_id, credential: value.credential, login_id: value.login_id };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { host_id: "", credential: null, login_id: null };
      throw new AppError("file.io_failed", { cause: error });
    }
  }

  /** 同一会话的刷新跨进程串行，新登录使用独立的锁，不等待旧会话网络请求。 */
  public async with_refresh_lock<T>(session_id: string, operation: () => Promise<T>): Promise<T> {
    default_native_fs.make_dir(path.dirname(this.file_path));
    const session_key = createHash("sha256").update(session_id).digest("hex");
    // proper-lockfile 按目标路径登记锁，刷新与账户写入必须使用不同目标。
    const release = await lockfile.lock(`${this.file_path}.refresh-${session_key}`, {
      realpath: false,
      retries: LOCK_RETRIES,
    });
    try {
      return await operation();
    } finally {
      await release();
    }
  }

  /** 锁内重新读磁盘并同步提交；回调只修改本地记录，不执行网络操作。 */
  public async update<T>(operation: (account: AccountFile) => T): Promise<T> {
    default_native_fs.make_dir(path.dirname(this.file_path));
    const release = await lockfile.lock(this.file_path, {
      realpath: false,
      retries: LOCK_RETRIES,
    });
    try {
      const account = this.read_account();
      if (account.host_id === "") account.host_id = `urn:uuid:${randomUUID()}`;
      const result = operation(account);
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
