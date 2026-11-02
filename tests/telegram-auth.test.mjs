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
  const entries = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
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


test("does not delete document contents unless the document belongs to the owner", async () => {
  const initData = await signedInitData();
  const statements = [];
  const env = mockEnv();
  env.DB = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            run: async () => {
              statements.push({ sql, values });
              return { success: true, meta: { changes: sql.startsWith("DELETE FROM documents") ? 0 : 0 } };
            },
            first: async () => null,
            all: async () => ({ results: [] })
          };
        }
      };
    }
  };
  const response = await worker.fetch(
    new Request("https://jobmate.test/api/documents/not-owned", {
      method: "DELETE",
      headers: { Authorization: "tma " + initData }
    }),
    env
  );
  assert.equal(response.status, 404);
  const contentDelete = statements.find(x => x.sql.startsWith("DELETE FROM document_contents"));
  assert.ok(contentDelete, "document content deletion statement should execute");
  assert.match(contentDelete.sql, /EXISTS\s*\(SELECT 1 FROM documents/);
  assert.deepEqual(contentDelete.values, ["not-owned", "not-owned", OWNER_ID]);
});


test("keeps the frontend and backend image upload limits aligned at 6 MiB", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /f\.size\s*>\s*6\s*\*\s*1024\s*\*\s*1024/);
  assert.match(source, /maxImageBase64Length\s*=\s*4\s*\*\s*Math\.ceil\(\(6\s*\*\s*1024\s*\*\s*1024\)\s*\/\s*3\)/);
});


test("keeps chat usage separate from vacancy text analysis quota", async () => {
  assert.match(source, /consumeAiQuota\("chat"\)/);
  assert.match(source, /chat_count/);
  assert.match(source, /consumeAiQuota\("text"\)/);
});

test("keeps the Worker-embedded dashboard identical to the public dashboard", async () => {
  const publicHtml = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const marker = "const APP_HTML=";
  const start = source.indexOf(marker) + marker.length;
  const end = source.indexOf(";\nexport default", start);
  assert.ok(start >= marker.length && end > start, "APP_HTML literal should be present");
  const embeddedHtml = JSON.parse(source.slice(start, end));
  assert.equal(embeddedHtml, publicHtml);
});


test("uses deterministic code-point ordering for Telegram signature fields", () => {
  assert.match(source, /sort\(\(\[a\],\[b\]\)=>a<b\?-1:a>b\?1:0\)/);
});


test("returns the verified Telegram identity from the authenticated session", async () => {
  const initData = await signedInitData();
  const response = await worker.fetch(
    new Request("https://jobmate.test/api/me", {
      headers: { Authorization: "tma " + initData }
    }),
    mockEnv()
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.user.first_name, "Test User");
  assert.equal(body.user.username, null);
});


test("rejects requests without a Telegram authorization header", async () => {
  const response = await worker.fetch(
    new Request("https://jobmate.test/api/profile"),
    mockEnv()
  );
  assert.equal(response.status, 401);
});

test("fails closed when the Telegram bot token is not configured", async () => {
  const initData = await signedInitData();
  const env = mockEnv();
  delete env.TELEGRAM_BOT_TOKEN;
  const response = await worker.fetch(
    new Request("https://jobmate.test/api/profile", {
      headers: { Authorization: "tma " + initData }
    }),
    env
  );
  assert.equal(response.status, 401);
});

test("rejects Telegram initData signed more than 30 seconds in the future", async () => {
  const initData = await signedInitData(OWNER_ID, Math.floor(Date.now() / 1000) + 120);
  const response = await worker.fetch(
    new Request("https://jobmate.test/api/profile", {
      headers: { Authorization: "tma " + initData }
    }),
    mockEnv()
  );
  assert.equal(response.status, 401);
});

test("rejects duplicate Telegram hash parameters", async () => {
  const initData = await signedInitData();
  const hash = new URLSearchParams(initData).get("hash");
  const response = await worker.fetch(
    new Request("https://jobmate.test/api/profile", {
      headers: { Authorization: "tma " + initData + "&hash=" + hash }
    }),
    mockEnv()
  );
  assert.equal(response.status, 401);
});

test("keeps the public health endpoint available without Telegram authentication", async () => {
  const response = await worker.fetch(
    new Request("https://jobmate.test/api/health"),
    mockEnv()
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "online");
});

test("includes the additive chat quota migration", async () => {
  const migration = await readFile(
    new URL("../migrations/0002_chat_usage.sql", import.meta.url),
    "utf8"
  );
  assert.match(migration, /ALTER TABLE ai_usage ADD COLUMN chat_count INTEGER NOT NULL DEFAULT 0/);
});


test("stores CV metadata and file content in one atomic D1 batch", async () => {
  const env = mockEnv();
  const batches = [];
  env.DB = {
    prepare(sql) {
      return {
        bind(...values) {
          return { run: async () => ({ success: true, meta: { changes: 1 } }), sql, values };
        }
      };
    },
    batch: async statements => {
      batches.push(statements);
      return [];
    }
  };
  const form = new FormData();
  form.append("file", new File(["sample CV"], "resume.pdf", { type: "application/pdf" }));
  const response = await worker.fetch(
    new Request("https://jobmate.test/api/documents", {
      method: "POST",
      headers: { Authorization: "tma " + await signedInitData() },
      body: form
    }),
    env
  );
  assert.equal(response.status, 201);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 2);
  assert.match(batches[0][0].sql, /INSERT INTO documents/);
  assert.match(batches[0][1].sql, /INSERT INTO document_contents/);
});


test("does not send unsupported sampling parameters to Gemini 3.5 Flash-Lite", async () => {
  assert.doesNotMatch(source, /generationConfig:\{[^}]*temperature\s*:/);
  assert.match(source, /generationConfig:\{maxOutputTokens:1800\}/);
  assert.match(source, /generationConfig:\{maxOutputTokens:2500\}/);
});


test("scopes application update and delete operations to the authenticated owner", async () => {
  for (const method of ["PUT", "DELETE"]) {
    const initData = await signedInitData();
    const statements = [];
    const env = mockEnv();
    env.DB = {
      prepare(sql) {
        return {
          bind(...values) {
            return {
              run: async () => {
                statements.push({ sql, values });
                return { success: true, meta: { changes: 0 } };
              },
              first: async () => null,
              all: async () => ({ results: [] })
            };
          }
        };
      }
    };
    const response = await worker.fetch(
      new Request("https://jobmate.test/api/applications/not-owned", {
        method,
        headers: {
          Authorization: "tma " + initData,
          "Content-Type": "application/json"
        },
        ...(method === "PUT" ? { body: JSON.stringify({ company_name: "Other", position: "Role" }) } : {})
      }),
      env
    );
    assert.equal(response.status, 404);
    const mutation = statements.find(x => x.sql.startsWith(method === "PUT" ? "UPDATE applications" : "DELETE FROM applications"));
    assert.ok(mutation, "application mutation should execute");
    assert.match(mutation.sql, /WHERE id=\? AND telegram_id=\?/);
    assert.equal(mutation.values.at(-1), OWNER_ID);
  }
});

test("scopes document downloads to the authenticated owner", async () => {
  const initData = await signedInitData();
  let statement;
  const env = mockEnv();
  env.DB = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            run: async () => ({ success: true, meta: { changes: 0 } }),
            first: async () => {
              statement = { sql, values };
              return null;
            },
            all: async () => ({ results: [] })
          };
        }
      };
    }
  };
  const response = await worker.fetch(
    new Request("https://jobmate.test/api/documents/not-owned", {
      headers: { Authorization: "tma " + initData }
    }),
    env
  );
  assert.equal(response.status, 404);
  assert.match(statement.sql, /d\.telegram_id=\?/);
  assert.deepEqual(statement.values, ["not-owned", OWNER_ID]);
});


test("refunds reserved AI quota after upstream Gemini failures", () => {
  assert.match(source, /const releaseAiQuota=async\(kind\)=>/);
  assert.match(source, /UPDATE ai_usage SET \$\{column\}=MAX\(\$\{column\}-1,0\) WHERE telegram_id=\? AND usage_date=\?/);
  assert.match(source, /releaseAiQuota\("chat"\)/);
  assert.match(source, /releaseAiQuota\(reservedQuotaKind\)/);
  assert.match(source, /reservedQuotaKind="text"/);
  assert.match(source, /reservedQuotaKind="image"/);
});
