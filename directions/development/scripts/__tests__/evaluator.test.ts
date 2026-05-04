import { describe, it, expect } from "vitest";
import { detectLanguage, discoverCommand } from "../evaluator.js";
import type { DevTaskRequest } from "../types.js";

describe("detectLanguage", () => {
  it("should return explicit language when provided", () => {
    expect(detectLanguage("/some/path", "python")).toBe("python");
    expect(detectLanguage("/some/path", "rust")).toBe("rust");
  });

  it("should default to other for unknown paths", () => {
    expect(detectLanguage("/tmp/nonexistent")).toBe("other");
  });
});

describe("discoverCommand", () => {
  const baseTask: DevTaskRequest = {
    project_root: "/nonexistent",
  };

  it("should return explicit command when provided", () => {
    const task: DevTaskRequest = {
      ...baseTask,
      commands: { lint: "eslint ." },
    };

    const result = discoverCommand("lint", task, "typescript");

    expect(result).toBeDefined();
    expect(result!.command).toBe("eslint .");
    expect(result!.source).toBe("explicit");
  });

  it("should return undefined when no command found", () => {
    const result = discoverCommand("lint", baseTask, "other");

    expect(result).toBeUndefined();
  });

  it("should fall back to language default", () => {
    const result = discoverCommand("typecheck", baseTask, "typescript");

    expect(result).toBeDefined();
    expect(result!.command).toBe("tsc --noEmit");
    expect(result!.source).toBe("language_default");
  });

  it("should return undefined for typecheck in javascript (no default)", () => {
    const result = discoverCommand("typecheck", baseTask, "javascript");

    expect(result).toBeUndefined();
  });

  it("should prefer explicit over language default", () => {
    const task: DevTaskRequest = {
      ...baseTask,
      commands: { typecheck: "tsc --noEmit -p tsconfig.strict.json" },
    };

    const result = discoverCommand("typecheck", task, "typescript");

    expect(result!.command).toBe("tsc --noEmit -p tsconfig.strict.json");
    expect(result!.source).toBe("explicit");
  });

  it("should find command from package.json scripts", () => {
    const pkgScripts = { lint: "eslint . --ext .ts" };

    const result = discoverCommand("lint", baseTask, "typescript", pkgScripts);

    expect(result).toBeDefined();
    expect(result!.command).toBe("npm run lint");
    expect(result!.source).toBe("package_scripts");
  });

  it("should find command from .letsgoal-dev.json", () => {
    const devJson = { commands: { test: "vitest run --reporter verbose" } };

    const result = discoverCommand("test", baseTask, "typescript", null, devJson);

    expect(result).toBeDefined();
    expect(result!.command).toBe("vitest run --reporter verbose");
    expect(result!.source).toBe("letsgoal_dev_json");
  });

  it("should follow priority: explicit > package_scripts > letsgoal_dev_json > language_default", () => {
    const task: DevTaskRequest = {
      ...baseTask,
      commands: { lint: "explicit-lint" },
    };
    const pkgScripts = { lint: "pkg-lint" };
    const devJson = { commands: { lint: "devjson-lint" } };

    // Explicit wins
    const r1 = discoverCommand("lint", task, "typescript", pkgScripts, devJson);
    expect(r1!.source).toBe("explicit");

    // Package scripts wins over devjson and default
    const r2 = discoverCommand("lint", baseTask, "typescript", pkgScripts, devJson);
    expect(r2!.source).toBe("package_scripts");

    // DevJson wins over default
    const r3 = discoverCommand("lint", baseTask, "typescript", null, devJson);
    expect(r3!.source).toBe("letsgoal_dev_json");

    // Language default as last resort
    const r4 = discoverCommand("lint", baseTask, "typescript", null, null);
    expect(r4!.source).toBe("language_default");
  });

  it("should support python language defaults", () => {
    expect(discoverCommand("lint", baseTask, "python")!.command).toBe("ruff check");
    expect(discoverCommand("typecheck", baseTask, "python")!.command).toBe("mypy .");
    expect(discoverCommand("test", baseTask, "python")!.command).toBe("pytest");
  });

  it("should support rust language defaults", () => {
    expect(discoverCommand("lint", baseTask, "rust")!.command).toContain("cargo clippy");
    expect(discoverCommand("typecheck", baseTask, "rust")!.command).toBe("cargo check --all-targets");
    expect(discoverCommand("test", baseTask, "rust")!.command).toBe("cargo test");
  });

  it("should support go language defaults", () => {
    expect(discoverCommand("lint", baseTask, "go")!.command).toBe("golangci-lint run");
    expect(discoverCommand("typecheck", baseTask, "go")!.command).toBe("go vet ./...");
    expect(discoverCommand("test", baseTask, "go")!.command).toBe("go test ./...");
  });
});
