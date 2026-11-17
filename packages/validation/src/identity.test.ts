import { describe, expect, it } from "vitest";
import { acceptsMutation, applicationMode, authInputSchema, authRedirect, supportInputSchema, trustedOrigin } from "./identity";

describe("connected identity boundaries", () => {
  it("fails closed instead of defaulting to demo personas", () => {
    expect(applicationMode(undefined)).toBe("connected");
    expect(applicationMode("demo")).toBe("demo");
    expect(() => applicationMode("demo", "production")).toThrow();
    expect(() => applicationMode("typo")).toThrow();
  });
  it("rejects arbitrary redirects and external origins", () => {
    for (const target of ["//evil.test", "/\\evil.test", "https://evil.test", "/admin"]) expect(authRedirect(target)).toBe("/account");
    expect(authRedirect("/auth/password")).toBe("/auth/password");
    expect(trustedOrigin("http://127.0.0.1:3107")).toBe("http://127.0.0.1:3107");
    for (const origin of ["http://beetip.test", "https://user:pass@beetip.test", "https://beetip.test/path"]) expect(() => trustedOrigin(origin)).toThrow();
  });
  it("requires same-origin JSON mutations", () => {
    expect(acceptsMutation("https://beetip.test", "https://beetip.test", "application/json; charset=utf-8")).toBe(true);
    expect(acceptsMutation("https://evil.test", "https://beetip.test", "application/json")).toBe(false);
    expect(acceptsMutation(null, "https://beetip.test", "text/plain")).toBe(false);
  });
  it("does not accept client roles or actors", () => {
    expect(authInputSchema.safeParse({ action: "signup", email: "member@example.com", password: "long-password-123", name: "Member", admin: true }).success).toBe(false);
    expect(supportInputSchema.safeParse({ operationId: crypto.randomUUID(), body: "Help", actorId: "another-member" }).success).toBe(false);
    expect(supportInputSchema.safeParse({ operationId: crypto.randomUUID(), body: "   " }).success).toBe(false);
  });
});
