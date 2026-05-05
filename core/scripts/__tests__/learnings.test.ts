import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { readLearnings, appendLearning } from "../learnings.js";

describe("readLearnings", () => {
  it("returns empty string when file does not exist", () => {
    const tmpDir = mkdtempSync(resolve(tmpdir(), "lg-learnings-test-"));
    try {
      expect(readLearnings(tmpDir)).toBe("");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns trimmed content when file exists", () => {
    const tmpDir = mkdtempSync(resolve(tmpdir(), "lg-learnings-test-"));
    try {
      const p = resolve(tmpDir, ".letsgoal", "learnings.md");
      mkdirSync(resolve(tmpDir, ".letsgoal"), { recursive: true });
      writeFileSync(p, "  hello world  \n", "utf-8");

      expect(readLearnings(tmpDir)).toBe("hello world");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("appendLearning", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(tmpdir(), "lg-learnings-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates file and dir when they do not exist", () => {
    appendLearning(tmpDir, "first learning");
    const p = resolve(tmpDir, ".letsgoal", "learnings.md");
    expect(existsSync(p)).toBe(true);
  });

  it("appends timestamped block", () => {
    appendLearning(tmpDir, "avoid using any type");
    const content = readFileSync(
      resolve(tmpDir, ".letsgoal", "learnings.md"),
      "utf-8",
    );
    expect(content).toContain("## Learning:");
    expect(content).toContain("avoid using any type");
  });

  it("appends multiple blocks in order", () => {
    appendLearning(tmpDir, "first");
    appendLearning(tmpDir, "second");
    const content = readFileSync(
      resolve(tmpDir, ".letsgoal", "learnings.md"),
      "utf-8",
    );
    const firstIdx = content.indexOf("first");
    const secondIdx = content.indexOf("second");
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(-1);
    expect(firstIdx).toBeLessThan(secondIdx);
  });
});
