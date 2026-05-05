interface RawConfig {
  host?: string;
  port?: number;
  debug?: boolean;
  timeout?: number;
  retries?: number;
}

interface Config {
  host: string;
  port: number;
  debug: boolean;
  timeout: number;
  retries: number;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a raw config object and return detailed errors.
 * Bug: The function returns RawConfig where Config is expected,
 * causing a type error under strict mode.
 * Additionally, the error messages don't match what the tests expect.
 */
function validateConfig(raw: unknown): { result: ValidationResult; config: Config } {
  const errors: string[] = [];

  if (typeof raw !== "object" || raw === null) {
    return { result: { valid: false, errors: ["Input must be a non-null object"] }, config: {} as Config };
  }

  const input = raw as RawConfig;

  if (input.host !== undefined && typeof input.host !== "string") {
    errors.push("host must be a string if provided");
  }
  if (input.port !== undefined && typeof input.port !== "number") {
    errors.push("port must be a number if provided");
  }
  if (input.debug !== undefined && typeof input.debug !== "boolean") {
    errors.push("debug must be a boolean if provided");
  }
  if (input.timeout !== undefined && typeof input.timeout !== "number") {
    errors.push("timeout must be a number if provided");
  }
  if (input.retries !== undefined && (typeof input.retries !== "number" || input.retries < 0 || !Number.isInteger(input.retries))) {
    errors.push("retries must be a non-negative integer");
  }

  return {
    result: { valid: errors.length === 0, errors },
    config: input as Config,
  };
}

/**
 * Resolve a partial config by merging with defaults.
 * Bug: Wrong spread order - defaults override user input.
 */
function resolveConfig(raw: unknown, defaults: Partial<Config>): Config {
  const { result, config } = validateConfig(raw);

  if (!result.valid) {
    throw new Error(`Config validation failed: ${result.errors.join(", ")}`);
  }

  return { ...defaults, ...config };
}

export { validateConfig, resolveConfig };
export type { Config, RawConfig, ValidationResult };
