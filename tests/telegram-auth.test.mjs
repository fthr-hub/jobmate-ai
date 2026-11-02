import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";

globalThis.crypto ??= webcrypto;

const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
const { default: worker } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);

const BOT_TOKEN = "123456:TEST_TOKEN_NOT_REAL";
const OWNER_ID = "99887766";

async function signedInitData(userId = OWNER_ID, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "AAE-test-query",
    user: JSON.stringify({ id: Number(userId), first_name: "Test User" })
  });
  const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const checkString = entries.map(([key, value]) => key + "=" + value).join("\n");
  const enc = new TextEncoder();
  const importHmac = key => crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const secretKey = await importHmac(enc.encode("WebAppData"));
  const secret = new Uint8Array(await crypto.subtle.sign("HMAC", secretKey, enc.encode(BOT_TOKEN)));
  const dataKey = await importHmac(secret);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", dataKey, enc.encode(checkString)));
  params.set("hash", [...digest].map(byte => byte.toString(16).padStart(2, "0")).join(""));
  return params.toString();
}

function mockEnv() {
  return {
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    OWNER_TELEGRAM_ID: OWNER_ID,
    ASSETS: { fetch: async () => new Response("static asset") },
    DB: {
      prepare(sql) {
        return {
          bind() {
            return {
              run: async () => ({ success: true, meta: { changes: 1 } }),
              first: async () => sql.includes("SELECT * FROM profiles")
                ? { full_name: "Test Owner" }
                : null,
              all: async () => ({ results: [] })
            };
          }
        };
      }
    }
  };
}

test("accepts a fresh Telegram initData signed for the configured owner", async () => {
  const initData = await signedInitData();
  const response = await worker.fetch(
    new Request("https://jobmate.test/api/profile", {
      headers: { Authorization: "tma " + initData }
    }),
    mockEnv()
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.profile.full_name, "Test Owner");
});

test("rejects a correctly signed Telegram session belonging to another user", async () => {
  const initData = await signedInitData("11223344");
  const response = await worker.fetch(
    new Request("https://jobmate.test/api/profile", {
      headers: { Authorization: "tma " + initData }
    }),
    mockEnv()
  );
  assert.equal(response.status, 401);
});

test("rejects tampered Telegram initData", async () => {
  const initData = await signedInitData();
  const tampered = initData.replace("Test+User", "Intruder");
  const response = await worker.fetch(
    new Request("https://jobmate.test/api/profile", {
      headers: { Authorization: "tma " + tampered }
    }),
    mockEnv()
  );
  assert.equal(response.status, 401);
});

test("rejects expired Telegram initData", async () => {
  const initData = await signedInitData(OWNER_ID, Math.floor(Date.now() / 1000) - 3601);
  const response = await worker.fetch(
    new Request("https://jobmate.test/api/profile", {
      headers: { Authorization: "tma " + initData }
    }),
    mockEnv()
  );
  assert.equal(response.status, 401);
});
