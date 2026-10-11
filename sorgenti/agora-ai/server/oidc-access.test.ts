import { describe, expect, it } from "vitest";
import { isOidcSubjectAllowed, oauthStateRecoveryPath } from "./_core/oauth";

describe("OIDC access control", () => {
  it("fails closed in production when the allowlist is empty", () => {
    expect(isOidcSubjectAllowed("owner", [], true)).toBe(false);
  });

  it("accepts only explicitly allowed subjects", () => {
    expect(isOidcSubjectAllowed("owner", ["owner", "colleague"], true)).toBe(true);
    expect(isOidcSubjectAllowed("intruder", ["owner", "colleague"], true)).toBe(false);
  });

  it("uses a recovery page without weakening callback validation", () => {
    expect(oauthStateRecoveryPath()).toContain("oauth_error=state_expired");
  });
});
