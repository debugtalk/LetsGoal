/**
 * 飞书文档操作模块
 *
 * 封装 lark-cli 命令行工具,提供创建和追加飞书文档的能力。
 * lark-cli 不可用时给出明确错误提示和安装引导。
 */

import { spawnSync } from "node:child_process";
import type { FeishuDocRef } from "./types.js";

const LARK_CLI = "lark-cli";
const CLI_TIMEOUT_MS = 30_000;

/**
 * 检查 lark-cli 是否可用。
 */
export function isLarkCliAvailable(): boolean {
  const r = spawnSync("which", [LARK_CLI], {
    encoding: "utf-8",
    timeout: 5_000,
  });
  return r.status === 0;
}

/**
 * 创建飞书文档,返回文档引用。
 *
 * @param title 文档标题
 * @param markdown 文档内容(Markdown 格式)
 * @returns FeishuDocRef 包含 doc_url 和 doc_id
 * @throws lark-cli 不可用或创建失败时抛出错误
 */
export async function createDoc(
  title: string,
  markdown: string,
): Promise<FeishuDocRef> {
  if (!isLarkCliAvailable()) {
    throw new Error(
      `lark-cli 未安装。请先安装: npm install -g lark-cli 或参考 https://github.com/larksuite/lark-cli`,
    );
  }

  const r = spawnSync(
    LARK_CLI,
    ["docs", "+create", "--title", title, "--markdown", markdown],
    {
      encoding: "utf-8",
      timeout: CLI_TIMEOUT_MS,
    },
  );

  if (r.error) {
    throw new Error(`lark-cli 执行失败: ${r.error.message}`);
  }
  if (r.status !== 0) {
    throw new Error(
      `lark-cli 创建文档失败(exit ${r.status}): ${(r.stderr ?? "").trim()}`,
    );
  }

  const stdout = (r.stdout ?? "").trim();
  return parseDocRef(stdout);
}

/**
 * 追加内容到飞书文档。
 *
 * @param docId 飞书文档 ID
 * @param markdown 要追加的 Markdown 内容
 * @throws lark-cli 不可用或追加失败时抛出错误
 */
export async function appendDoc(
  docId: string,
  markdown: string,
): Promise<void> {
  if (!isLarkCliAvailable()) {
    throw new Error(
      `lark-cli 未安装。请先安装: npm install -g lark-cli 或参考 https://github.com/larksuite/lark-cli`,
    );
  }

  const r = spawnSync(
    LARK_CLI,
    ["docs", "+update", "--doc", docId, "--mode", "append", "--markdown", markdown],
    {
      encoding: "utf-8",
      timeout: CLI_TIMEOUT_MS,
    },
  );

  if (r.error) {
    throw new Error(`lark-cli 执行失败: ${r.error.message}`);
  }
  if (r.status !== 0) {
    throw new Error(
      `lark-cli 追加文档失败(exit ${r.status}): ${(r.stderr ?? "").trim()}`,
    );
  }
}

/**
 * 从 lark-cli 创建文档的输出中解析 doc_id 和 doc_url。
 *
 * 预期输出格式(JSON):
 *   {"doc_id":"xxx","doc_url":"https://..."}
 * 也支持行内格式:
 *   doc_id: xxx
 *   doc_url: https://...
 */
function parseDocRef(stdout: string): FeishuDocRef {
  // 尝试 JSON 解析
  try {
    const obj = JSON.parse(stdout) as Record<string, unknown>;
    if (typeof obj.doc_id === "string" && typeof obj.doc_url === "string") {
      return { doc_id: obj.doc_id, doc_url: obj.doc_url };
    }
  } catch {
    // 非 JSON,继续尝试其他格式
  }

  // 尝试行内 key: value 格式
  const idMatch = /doc_id[:\s]+(\S+)/.exec(stdout);
  const urlMatch = /doc_url[:\s]+(\S+)/.exec(stdout);

  if (idMatch && urlMatch) {
    return { doc_id: idMatch[1], doc_url: urlMatch[1] };
  }

  throw new Error(
    `无法从 lark-cli 输出中解析文档引用。原始输出:\n${stdout}`,
  );
}
