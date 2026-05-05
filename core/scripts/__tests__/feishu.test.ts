import { describe, it, expect, vi, beforeEach } from "vitest";
import { isLarkCliAvailable, createDoc, appendDoc } from "../feishu.js";
import { spawnSync } from "node:child_process";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

const mockedSpawnSync = vi.mocked(spawnSync);

describe("feishu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isLarkCliAvailable", () => {
    it("returns true when which lark-cli succeeds", () => {
      mockedSpawnSync.mockReturnValue({
        status: 0,
        stdout: "/usr/local/bin/lark-cli\n",
        stderr: "",
      } as ReturnType<typeof spawnSync>);

      expect(isLarkCliAvailable()).toBe(true);
    });

    it("returns false when which lark-cli fails", () => {
      mockedSpawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "not found",
      } as ReturnType<typeof spawnSync>);

      expect(isLarkCliAvailable()).toBe(false);
    });
  });

  describe("createDoc", () => {
    it("throws when lark-cli is not available", async () => {
      // which lark-cli fails
      mockedSpawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "not found",
      } as ReturnType<typeof spawnSync>);

      await expect(createDoc("test", "content")).rejects.toThrow(
        "lark-cli 未安装",
      );
    });

    it("creates doc and returns FeishuDocRef from JSON output", async () => {
      // first call: which lark-cli succeeds
      // second call: lark-cli docs +create succeeds
      mockedSpawnSync
        .mockReturnValueOnce({
          status: 0,
          stdout: "/usr/local/bin/lark-cli\n",
          stderr: "",
        } as ReturnType<typeof spawnSync>)
        .mockReturnValueOnce({
          status: 0,
          stdout: JSON.stringify({ doc_id: "abc123", doc_url: "https://feishu.cn/doc/abc123" }),
          stderr: "",
        } as ReturnType<typeof spawnSync>);

      const ref = await createDoc("Test Doc", "## Hello");
      expect(ref.doc_id).toBe("abc123");
      expect(ref.doc_url).toBe("https://feishu.cn/doc/abc123");
    });

    it("creates doc and parses key:value format output", async () => {
      mockedSpawnSync
        .mockReturnValueOnce({
          status: 0,
          stdout: "/usr/local/bin/lark-cli\n",
          stderr: "",
        } as ReturnType<typeof spawnSync>)
        .mockReturnValueOnce({
          status: 0,
          stdout: "doc_id: xyz789\ndoc_url: https://feishu.cn/doc/xyz789",
          stderr: "",
        } as ReturnType<typeof spawnSync>);

      const ref = await createDoc("Test", "content");
      expect(ref.doc_id).toBe("xyz789");
      expect(ref.doc_url).toBe("https://feishu.cn/doc/xyz789");
    });

    it("throws when lark-cli returns non-zero exit", async () => {
      mockedSpawnSync
        .mockReturnValueOnce({
          status: 0,
          stdout: "/usr/local/bin/lark-cli\n",
          stderr: "",
        } as ReturnType<typeof spawnSync>)
        .mockReturnValueOnce({
          status: 1,
          stdout: "",
          stderr: "permission denied",
        } as ReturnType<typeof spawnSync>);

      await expect(createDoc("Test", "content")).rejects.toThrow(
        "lark-cli 创建文档失败",
      );
    });

    it("throws when output is unparseable", async () => {
      mockedSpawnSync
        .mockReturnValueOnce({
          status: 0,
          stdout: "/usr/local/bin/lark-cli\n",
          stderr: "",
        } as ReturnType<typeof spawnSync>)
        .mockReturnValueOnce({
          status: 0,
          stdout: "some random output",
          stderr: "",
        } as ReturnType<typeof spawnSync>);

      await expect(createDoc("Test", "content")).rejects.toThrow(
        "无法从 lark-cli 输出中解析文档引用",
      );
    });
  });

  describe("appendDoc", () => {
    it("throws when lark-cli is not available", async () => {
      mockedSpawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "not found",
      } as ReturnType<typeof spawnSync>);

      await expect(appendDoc("doc123", "content")).rejects.toThrow(
        "lark-cli 未安装",
      );
    });

    it("appends content successfully", async () => {
      mockedSpawnSync
        .mockReturnValueOnce({
          status: 0,
          stdout: "/usr/local/bin/lark-cli\n",
          stderr: "",
        } as ReturnType<typeof spawnSync>)
        .mockReturnValueOnce({
          status: 0,
          stdout: "OK",
          stderr: "",
        } as ReturnType<typeof spawnSync>);

      await expect(appendDoc("doc123", "## More content")).resolves.toBeUndefined();
    });

    it("throws when lark-cli append fails", async () => {
      mockedSpawnSync
        .mockReturnValueOnce({
          status: 0,
          stdout: "/usr/local/bin/lark-cli\n",
          stderr: "",
        } as ReturnType<typeof spawnSync>)
        .mockReturnValueOnce({
          status: 1,
          stdout: "",
          stderr: "not found doc",
        } as ReturnType<typeof spawnSync>);

      await expect(appendDoc("doc123", "content")).rejects.toThrow(
        "lark-cli 追加文档失败",
      );
    });
  });
});
