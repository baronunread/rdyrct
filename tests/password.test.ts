import { describe, expect, test } from "bun:test";
import { hashPassword, verifyPassword } from "../src/worker/password";

describe("password hashing", () => {
  test("hash has the pbkdf2:iterations:salt:hash format", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const [scheme, iterations, salt, key] = hash.split(":");
    expect(scheme).toBe("pbkdf2");
    expect(Number(iterations)).toBe(100_000);
    expect(salt.length).toBeGreaterThan(0);
    expect(key.length).toBeGreaterThan(0);
  });

  test("same password hashes differently each time (random salt)", async () => {
    const a = await hashPassword("hunter2");
    const b = await hashPassword("hunter2");
    expect(a).not.toBe(b);
  });

  test("verify accepts the right password", async () => {
    const hash = await hashPassword("s3cret!");
    expect(await verifyPassword("s3cret!", hash)).toBe(true);
  });

  test("verify rejects a wrong password", async () => {
    const hash = await hashPassword("s3cret!");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  test("verify rejects malformed or foreign hashes", async () => {
    expect(await verifyPassword("x", "scrypt:1:aa:bb")).toBe(false);
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  });
});
