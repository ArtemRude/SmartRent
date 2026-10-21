import test from "node:test";
import assert from "node:assert/strict";
import { invitationTokenFromHash, hasPendingTeamInvitation } from "../src/lib/team-invitation.ts";

const token = "a1".repeat(32);
test("team invitation captures only the complete secret in the URL fragment", () => {
  assert.equal(invitationTokenFromHash(`#invite=${token}`), token);
  assert.equal(invitationTokenFromHash(`#other=value&invite=${token}`), token);
  for (const hash of [
    "",
    `?invite=${token}`,
    "#invite=short",
    `#invite=${token}extra`,
    `#invite=${token.toUpperCase()}`,
    "#invite=%3Cscript%3E",
  ])
    assert.equal(invitationTokenFromHash(hash), null);
});

test("sign-in returns to the team only for a valid pending invitation", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  let pending: string | null = token;
  try {
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: { getItem: () => pending },
    });
    assert.equal(hasPendingTeamInvitation(), true);
    pending = "invalid";
    assert.equal(hasPendingTeamInvitation(), false);
    pending = null;
    assert.equal(hasPendingTeamInvitation(), false);
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get: () => {
        throw new Error("Storage blocked");
      },
    });
    assert.equal(hasPendingTeamInvitation(), false);
  } finally {
    if (original) Object.defineProperty(globalThis, "sessionStorage", original);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});
