import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { computeHash, freezeEvalSuite, verifyEvalSuite } from "../eval_suite.js";
import type { EvalSuiteConfig } from "../eval_suite.js";

describe("computeHash", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "eval-suite-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should compute SHA-256 hash for multiple files", async () => {
    await writeFile(join(tempDir, "a.txt"), "hello");
    await writeFile(join(tempDir, "b.txt"), "world");

    const hash = await computeHash(tempDir, ["*.txt"]);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should produce different hashes for different content", async () => {
    await writeFile(join(tempDir, "a.txt"), "hello");
    const hash1 = await computeHash(tempDir, ["*.txt"]);

    await writeFile(join(tempDir, "a.txt"), "goodbye");
    const hash2 = await computeHash(tempDir, ["*.txt"]);

    expect(hash1).not.toBe(hash2);
  });

  it("should produce same hash regardless of glob order", async () => {
    await writeFile(join(tempDir, "a.txt"), "hello");
    await writeFile(join(tempDir, "b.txt"), "world");

    const hash1 = await computeHash(tempDir, ["a.txt", "b.txt"]);
    const hash2 = await computeHash(tempDir, ["b.txt", "a.txt"]);

    expect(hash1).toBe(hash2);
  });

  it("should handle globstar patterns", async () => {
    await mkdir(join(tempDir, "sub"));
    await writeFile(join(tempDir, "root.txt"), "root");
    await writeFile(join(tempDir, "sub", "nested.txt"), "nested");

    const hash = await computeHash(tempDir, ["**/*.txt"]);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    // Changing a nested file should change the hash
    const hashBefore = await computeHash(tempDir, ["**/*.txt"]);
    await writeFile(join(tempDir, "sub", "nested.txt"), "changed");
    const hashAfter = await computeHash(tempDir, ["**/*.txt"]);
    expect(hashBefore).not.toBe(hashAfter);
  });
});

describe("freezeEvalSuite", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "eval-suite-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should return frozen record with correct fields", async () => {
    await writeFile(join(tempDir, "test.txt"), "content");

    const config: EvalSuiteConfig = { version: "1.0", files: ["*.txt"] };
    const record = await freezeEvalSuite(tempDir, config);

    expect(record.eval_suite_version).toBe("1.0");
    expect(record.eval_suite_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.frozen).toBe(true);
    expect(record.confirmed_at).toBeDefined();
  });
});

describe("verifyEvalSuite", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "eval-suite-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should return true when files are unchanged", async () => {
    await writeFile(join(tempDir, "test.txt"), "content");

    const config: EvalSuiteConfig = { version: "1.0", files: ["*.txt"] };
    const record = await freezeEvalSuite(tempDir, config);
    const result = await verifyEvalSuite(tempDir, record, config);

    expect(result).toBe(true);
  });

  it("should return false when files have changed", async () => {
    await writeFile(join(tempDir, "test.txt"), "content");

    const config: EvalSuiteConfig = { version: "1.0", files: ["*.txt"] };
    const record = await freezeEvalSuite(tempDir, config);

    await writeFile(join(tempDir, "test.txt"), "modified content");
    const result = await verifyEvalSuite(tempDir, record, config);

    expect(result).toBe(false);
  });
});
