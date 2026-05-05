import { describe, it, expect } from "vitest";
import { validateConfig, resolveConfig } from "../src/config-parser.js";
import type { Config } from "../src/config-parser.js";

describe("validateConfig", () => {
  it("should validate a complete config", () => {
    const { result, config } = validateConfig({
      host: "localhost",
      port: 8080,
      debug: true,
      timeout: 30,
      retries: 3,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(config.host).toBe("localhost");
  });

  it("should report error for invalid port type", () => {
    const { result } = validateConfig({ port: "not-a-number" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("port must be a number if provided");
  });

  it("should report error for invalid retries type", () => {
    const { result } = validateConfig({ retries: -1 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("retries must be a non-negative integer");
  });

  it("should report error for non-integer retries", () => {
    const { result } = validateConfig({ retries: 1.5 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("retries must be a non-negative integer");
  });

  it("should reject non-object input", () => {
    const { result } = validateConfig(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Input must be a non-null object");
  });
});

describe("resolveConfig", () => {
  const defaults: Partial<Config> = {
    host: "0.0.0.0",
    port: 8080,
    debug: false,
    timeout: 60,
    retries: 3,
  };

  it("should merge defaults for missing fields", () => {
    const result = resolveConfig({ port: 3000 }, defaults);
    expect(result.host).toBe("0.0.0.0");
    expect(result.port).toBe(3000);
    expect(result.debug).toBe(false);
    expect(result.timeout).toBe(60);
    expect(result.retries).toBe(3);
  });

  it("should use all defaults when input is empty", () => {
    const result = resolveConfig({}, defaults);
    expect(result).toEqual({
      host: "0.0.0.0",
      port: 8080,
      debug: false,
      timeout: 60,
      retries: 3,
    });
  });

  it("should override all defaults when input is complete", () => {
    const result = resolveConfig(
      { host: "example.com", port: 443, debug: true, timeout: 10, retries: 5 },
      defaults,
    );
    expect(result.host).toBe("example.com");
    expect(result.port).toBe(443);
    expect(result.debug).toBe(true);
    expect(result.timeout).toBe(10);
    expect(result.retries).toBe(5);
  });
});
