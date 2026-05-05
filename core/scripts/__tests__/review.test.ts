import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  reviewRequirement,
  generateReviewMarkdown,
  applyReviewFeedback,
} from "../review.js";
import { spawnSync } from "node:child_process";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

const mockedSpawnSync = vi.mocked(spawnSync);

describe("review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("reviewRequirement", () => {
    it("parses JSON output from claude", async () => {
      const reviewOutput = {
        raw_requirement: "实现用户登录",
        clarified_goal: "实现基于 JWT 的用户登录功能",
        suggested_constraints: ["使用 bcrypt 加密密码"],
        suggested_stories: [{ id: "story-1", title: "实现登录 API" }],
        questions: ["是否需要支持 OAuth2?"],
        confidence: 0.7,
      };

      mockedSpawnSync.mockReturnValue({
        status: 0,
        stdout: JSON.stringify(reviewOutput),
        stderr: "",
      } as ReturnType<typeof spawnSync>);

      const result = await reviewRequirement("实现用户登录");
      expect(result.clarified_goal).toBe("实现基于 JWT 的用户登录功能");
      expect(result.suggested_constraints).toEqual(["使用 bcrypt 加密密码"]);
      expect(result.suggested_stories).toHaveLength(1);
      expect(result.questions).toEqual(["是否需要支持 OAuth2?"]);
      expect(result.confidence).toBe(0.7);
    });

    it("handles claude --output-format json wrapper", async () => {
      const reviewOutput = {
        raw_requirement: "test",
        clarified_goal: "test goal",
        suggested_constraints: [],
        suggested_stories: [],
        questions: [],
        confidence: 0.5,
      };

      // claude --output-format json wraps output in {"result": "..."}
      mockedSpawnSync.mockReturnValue({
        status: 0,
        stdout: JSON.stringify({ result: JSON.stringify(reviewOutput) }),
        stderr: "",
      } as ReturnType<typeof spawnSync>);

      const result = await reviewRequirement("test");
      expect(result.clarified_goal).toBe("test goal");
    });

    it("returns default ReviewOutput when claude fails", async () => {
      mockedSpawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "error",
      } as ReturnType<typeof spawnSync>);

      await expect(reviewRequirement("test")).rejects.toThrow(
        "claude 需求结构化失败",
      );
    });

    it("returns default ReviewOutput when output is unparseable", async () => {
      mockedSpawnSync.mockReturnValue({
        status: 0,
        stdout: "not json at all",
        stderr: "",
      } as ReturnType<typeof spawnSync>);

      const result = await reviewRequirement("原始需求文本");
      expect(result.raw_requirement).toBe("原始需求文本");
      expect(result.confidence).toBe(0.1);
    });

    it("clamps confidence to [0, 1]", async () => {
      const reviewOutput = {
        raw_requirement: "test",
        clarified_goal: "test",
        suggested_constraints: [],
        suggested_stories: [],
        questions: [],
        confidence: 1.5,
      };

      mockedSpawnSync.mockReturnValue({
        status: 0,
        stdout: JSON.stringify(reviewOutput),
        stderr: "",
      } as ReturnType<typeof spawnSync>);

      const result = await reviewRequirement("test");
      expect(result.confidence).toBe(1);
    });
  });

  describe("generateReviewMarkdown", () => {
    it("generates markdown with all sections", () => {
      const review = {
        raw_requirement: "实现登录",
        clarified_goal: "实现 JWT 登录",
        suggested_constraints: ["使用 bcrypt"],
        suggested_stories: [{ id: "story-1", title: "登录 API" }],
        questions: ["需要 OAuth2 吗?"],
        confidence: 0.8,
      };

      const md = generateReviewMarkdown(review);
      expect(md).toContain("## 澄清后的目标");
      expect(md).toContain("实现 JWT 登录");
      expect(md).toContain("## 建议的约束");
      expect(md).toContain("使用 bcrypt");
      expect(md).toContain("## 建议的 Stories");
      expect(md).toContain("story-1");
      expect(md).toContain("## 需要确认的问题");
      expect(md).toContain("需要 OAuth2 吗?");
      expect(md).toContain("## 置信度");
      expect(md).toContain("80%");
      expect(md).toContain("实现登录");
    });

    it("omits empty sections", () => {
      const review = {
        raw_requirement: "简单任务",
        clarified_goal: "简单任务",
        suggested_constraints: [],
        suggested_stories: [],
        questions: [],
        confidence: 0.9,
      };

      const md = generateReviewMarkdown(review);
      expect(md).not.toContain("## 建议的约束");
      expect(md).not.toContain("## 建议的 Stories");
      expect(md).not.toContain("## 需要确认的问题");
    });
  });

  describe("applyReviewFeedback", () => {
    it("increases confidence when feedback is provided", () => {
      const review = {
        raw_requirement: "test",
        clarified_goal: "test goal",
        suggested_constraints: [],
        suggested_stories: [],
        questions: [],
        confidence: 0.6,
      };

      const updated = applyReviewFeedback(review, "确认,没问题");
      expect(updated.confidence).toBe(0.8);
    });

    it("clamps confidence to 1", () => {
      const review = {
        raw_requirement: "test",
        clarified_goal: "test goal",
        suggested_constraints: [],
        suggested_stories: [],
        questions: [],
        confidence: 0.9,
      };

      const updated = applyReviewFeedback(review, "OK");
      expect(updated.confidence).toBe(1);
    });

    it("does not increase confidence on empty feedback", () => {
      const review = {
        raw_requirement: "test",
        clarified_goal: "test goal",
        suggested_constraints: [],
        suggested_stories: [],
        questions: [],
        confidence: 0.5,
      };

      const updated = applyReviewFeedback(review, "");
      expect(updated.confidence).toBe(0.5);
    });
  });
});
