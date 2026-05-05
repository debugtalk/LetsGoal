/**
 * 经验沉淀模块 — 读写 `<workspace>/.letsgoal/learnings.md`
 *
 * 双层来源:
 *   - AI 自省(一手经验): executor prompt 要求 Claude 输出反思
 *   - 归因提炼(公式化建议): diagnose 从 category 生成修复建议
 *
 * 格式为自由 Markdown,供 AI 阅读而非程序解析。
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { resolve, dirname } from "node:path";

const LG_SUBDIR = ".letsgoal";
const LEARNINGS_FILENAME = "learnings.md";

function learningsPath(workspacePath: string): string {
  return resolve(workspacePath, LG_SUBDIR, LEARNINGS_FILENAME);
}

/**
 * 读取已沉淀的经验全文。文件不存在时返回空字符串。
 */
export function readLearnings(workspacePath: string): string {
  const p = learningsPath(workspacePath);
  if (!existsSync(p)) return "";
  try {
    return readFileSync(p, "utf-8").trim();
  } catch {
    return "";
  }
}

/**
 * 追加一条学习到文件。
 *
 * content 会被包装为带时间戳的 Markdown 块:
 *   ## Learning: YYYY-MM-DD HH:mm
 *   <content>
 *
 * 若文件尚不存在则自动创建。
 */
export function appendLearning(workspacePath: string, content: string): void {
  const p = learningsPath(workspacePath);
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const block = `\n## Learning: ${timestamp}\n${content.trim()}\n`;

  appendFileSync(p, block, "utf-8");
}
