/**
 * 评测集版本冻结机制
 *
 * 自循环开始前冻结评测标准文件，确保迭代过程中评估标准不变。
 * plan 阶段冻结，evaluate 阶段前校验。
 */

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

export interface EvalSuiteConfig {
  version: string;
  files: string[];
}

export interface EvalSuiteRecord {
  eval_suite_version: string;
  eval_suite_hash: string;
  confirmed_at?: string;
  frozen: boolean;
}

function globToRegex(pattern: string): RegExp {
  let regex = "";
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "*" && pattern[i + 1] === "*") {
      if (pattern[i + 2] === "/") {
        regex += "(?:.*/)?";
        i += 3;
      } else {
        regex += ".*";
        i += 2;
      }
    } else if (pattern[i] === "*") {
      regex += "[^/]*";
      i++;
    } else if (pattern[i] === "?") {
      regex += "[^/]";
      i++;
    } else if (".+^${}()|[]\\".includes(pattern[i])) {
      regex += "\\" + pattern[i];
      i++;
    } else {
      regex += pattern[i];
      i++;
    }
  }
  return new RegExp(`^${regex}$`);
}

async function walkDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      files.push(...await walkDir(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

async function expandGlobs(projectRoot: string, patterns: string[]): Promise<string[]> {
  const allFiles = await walkDir(projectRoot);
  const matched = new Set<string>();
  for (const pattern of patterns) {
    const re = globToRegex(pattern);
    for (const filePath of allFiles) {
      const rel = relative(projectRoot, filePath);
      if (re.test(rel)) {
        matched.add(filePath);
      }
    }
  }
  return [...matched].sort();
}

export async function computeHash(projectRoot: string, files: string[]): Promise<string> {
  const expandedFiles = await expandGlobs(projectRoot, files);
  const hash = createHash("sha256");
  for (const filePath of expandedFiles) {
    const content = await readFile(filePath);
    hash.update(relative(projectRoot, filePath));
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function freezeEvalSuite(
  projectRoot: string,
  config: EvalSuiteConfig,
): Promise<EvalSuiteRecord> {
  const hash = await computeHash(projectRoot, config.files);
  return {
    eval_suite_version: config.version,
    eval_suite_hash: hash,
    confirmed_at: new Date().toISOString(),
    frozen: true,
  };
}

export async function verifyEvalSuite(
  projectRoot: string,
  record: EvalSuiteRecord,
  config: EvalSuiteConfig,
): Promise<boolean> {
  const currentHash = await computeHash(projectRoot, config.files);
  return currentHash === record.eval_suite_hash;
}
