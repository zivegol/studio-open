import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("local authentication configuration", () => {
  it("refuses startup without an administrator password", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "");
    vi.stubEnv("JWT_SECRET", "test-only-key-with-at-least-32-characters");
    const { registerOAuthRoutes } = await import("./_core/oauth");
    expect(() => registerOAuthRoutes(express())).toThrow("Set ADMIN_PASSWORD");
  });

  it("refuses startup with a missing or short signing key", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "test-only-password");
    vi.stubEnv("JWT_SECRET", "short");
    const { registerOAuthRoutes } = await import("./_core/oauth");
    expect(() => registerOAuthRoutes(express())).toThrow("JWT_SECRET");
  });

  it("registers authentication when credentials are supplied", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "test-only-password");
    vi.stubEnv("JWT_SECRET", "test-only-key-with-at-least-32-characters");
    const { registerOAuthRoutes } = await import("./_core/oauth");
    expect(() => registerOAuthRoutes(express())).not.toThrow();
  });
});
