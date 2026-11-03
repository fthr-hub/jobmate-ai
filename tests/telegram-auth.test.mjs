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
              first: async () => sql.includes("SELECT 1 AS ok")
                ? { ok: 1 }
                : sql.includes("SELECT * FROM profiles")
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

test("keeps a dependency-aware health endpoint available without Telegram authentication", async () => {
  const env = mockEnv();
  env.GEMINI_API_KEY = "test-gemini-key";
  const response = await worker.fetch(
    new Request("https://jobmate.test/api/health"),
    env
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "online");
  assert.deepEqual(body.checks, { database: "ok", gemini: "configured", telegram_auth: "configured" });
});

test("reports degraded health when a required AI binding is missing", async () => {
  const env = mockEnv();
  delete env.GEMINI_API_KEY;
  const response = await worker.fetch(new Request("https://jobmate.test/api/health"), env);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.status, "degraded");
  assert.equal(body.checks.gemini, "missing");
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


test("restores chat quota when Gemini returns an upstream error", async () => {
  const env = mockEnv();
  env.GEMINI_API_KEY = "test-gemini-key";
  let chatCount = 0;
  env.DB = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            run: async () => {
              if (sql.startsWith("UPDATE ai_usage SET chat_count=")) {
                chatCount = Math.max(0, chatCount - 1);
              }
              return { success: true, meta: { changes: 1 } };
            },
            first: async () => {
              if (sql.startsWith("INSERT INTO ai_usage")) {
                if (chatCount >= 30) return null;
                chatCount += 1;
                return { chat_count: chatCount };
              }
              if (sql.includes("SELECT text_count,image_count,chat_count")) {
                return { text_count: 0, image_count: 0, chat_count: chatCount };
              }
              return null;
            },
            all: async () => ({ results: [] })
          };
        }
      };
    }
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: { message: "simulated Gemini outage" } }),
    { status: 503, headers: { "Content-Type": "application/json" } }
  );
  try {
    const response = await worker.fetch(
      new Request("https://jobmate.test/api/chat", {
        method: "POST",
        headers: {
          Authorization: "tma " + await signedInitData(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ messages: [{ role: "user", content: "Bantu cek CV saya" }] })
      }),
      env
    );
    assert.equal(response.status, 502);
    assert.equal(chatCount, 0, "failed Gemini requests must not consume chat quota");
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("uses the saved candidate profile in both text and image vacancy analysis", async () => {
  const env = mockEnv();
  env.GEMINI_API_KEY = "test-gemini-key";
  const profile = {
    full_name: "Test Candidate",
    skills: "warehouse, picking, packing, quality control",
    experience: "Warehouse Operator",
    education: "SMK"
  };
  env.DB = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            run: async () => ({ success: true, meta: { changes: 1 } }),
            first: async () => {
              if (sql.includes("FROM profiles")) return profile;
              if (sql.startsWith("INSERT INTO ai_usage")) {
                const column = sql.includes("image_count") ? "image_count" : "text_count";
                return { [column]: 1 };
              }
              return null;
            },
            all: async () => ({ results: [] })
          };
        }
      };
    }
  };
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "Analisis selesai." }] } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const auth = "tma " + await signedInitData();
    const textResponse = await worker.fetch(
      new Request("https://jobmate.test/api/analyze", {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ vacancy: "Dicari operator gudang dengan pengalaman picking dan packing." })
      }),
      env
    );
    assert.equal(textResponse.status, 200);
    const textPrompt = requests[0].contents[0].parts[0].text;
    assert.match(textPrompt, /Test Candidate/);
    assert.match(textPrompt, /Warehouse Operator/);
    assert.match(textPrompt, /DESKRIPSI LOWONGAN/);

    const imageResponse = await worker.fetch(
      new Request("https://jobmate.test/api/analyze-image", {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ image: "aGVsbG8=", mimeType: "image/png" })
      }),
      env
    );
    assert.equal(imageResponse.status, 200);
    const imagePrompt = requests[1].contents[0].parts[0].text;
    assert.match(imagePrompt, /Test Candidate/);
    assert.match(imagePrompt, /Warehouse Operator/);
    assert.equal(requests[1].contents[0].parts[1].inline_data.mime_type, "image/png");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resets daily AI quota using Indonesia western time", () => {
  assert.match(source, /Date\.now\(\)\+7\*60\*60\*1000/);
  assert.match(source, /resets:"00:00 WIB"/);
});


test("rejects invalid profile email before writing profile data", async () => {
  const env = mockEnv();
  const writes = [];
  env.DB = {
    prepare(sql) {
      return { bind(...values) { return {
        run: async () => { writes.push({ sql, values }); return { success: true, meta: { changes: 1 } }; },
        first: async () => null,
        all: async () => ({ results: [] })
      }; } };
    }
  };
  const response = await worker.fetch(new Request("https://jobmate.test/api/profile", {
    method: "PUT",
    headers: { Authorization: "tma " + await signedInitData(), "Content-Type": "application/json" },
    body: JSON.stringify({ full_name: "Test", email: "not-an-email" })
  }), env);
  assert.equal(response.status, 400);
  assert.equal(writes.some(x => x.sql.startsWith("INSERT INTO profiles")), false);
});

test("rejects application creation when company or position is missing", async () => {
  const env = mockEnv();
  const writes = [];
  env.DB = {
    prepare(sql) {
      return { bind(...values) { return {
        run: async () => { writes.push({ sql, values }); return { success: true, meta: { changes: 1 } }; },
        first: async () => null,
        all: async () => ({ results: [] })
      }; } };
    }
  };
  const response = await worker.fetch(new Request("https://jobmate.test/api/applications", {
    method: "POST",
    headers: { Authorization: "tma " + await signedInitData(), "Content-Type": "application/json" },
    body: JSON.stringify({ company_name: " ", position: "" })
  }), env);
  assert.equal(response.status, 400);
  assert.equal(writes.some(x => x.sql.startsWith("INSERT INTO applications")), false);
});

test("rejects CV files whose extension does not match their MIME type", async () => {
  const env = mockEnv();
  let batches = 0;
  env.DB = {
    prepare(sql) {
      return { bind() { return { run: async () => ({ success: true, meta: { changes: 1 } }), sql }; } };
    },
    batch: async () => { batches++; return []; }
  };
  const form = new FormData();
  form.append("file", new File(["not a pdf"], "resume.pdf", { type: "application/msword" }));
  const response = await worker.fetch(new Request("https://jobmate.test/api/documents", {
    method: "POST",
    headers: { Authorization: "tma " + await signedInitData() },
    body: form
  }), env);
  assert.equal(response.status, 415);
  assert.equal(batches, 0);
});


test("starts Gmail OAuth with owner-bound state and PKCE", async () => {
  const env = mockEnv();
  env.GOOGLE_CLIENT_ID = "google-client-id";
  env.GOOGLE_CLIENT_SECRET = "google-client-secret";
  env.GMAIL_TOKEN_ENCRYPTION_KEY = "test-encryption-key";
  const writes = [];
  env.DB = {
    prepare(sql) {
      return { bind(...values) { return {
        run: async () => { writes.push({ sql, values }); return { success: true, meta: { changes: 1 } }; },
        first: async () => null,
        all: async () => ({ results: [] })
      }; } };
    }
  };
  const response = await worker.fetch(new Request("https://jobmate.test/api/gmail/connect", {
    method: "POST",
    headers: { Authorization: "tma " + await signedInitData() }
  }), env);
  assert.equal(response.status, 200);
  const data = await response.json();
  const authUrl = new URL(data.auth_url);
  assert.equal(authUrl.origin, "https://accounts.google.com");
  assert.equal(authUrl.searchParams.get("client_id"), "google-client-id");
  assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authUrl.searchParams.get("scope"), "https://www.googleapis.com/auth/gmail.readonly");
  assert.ok(authUrl.searchParams.get("state"));
  assert.ok(authUrl.searchParams.get("code_challenge"));
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /INSERT INTO gmail_oauth_states/);
  assert.equal(writes[0].values[1], OWNER_ID);
});

test("does not start Gmail OAuth when Google secrets are missing", async () => {
  const env = mockEnv();
  const response = await worker.fetch(new Request("https://jobmate.test/api/gmail/connect", {
    method: "POST",
    headers: { Authorization: "tma " + await signedInitData() }
  }), env);
  assert.equal(response.status, 503);
  const data = await response.json();
  assert.match(data.error, /belum dikonfigurasi/i);
});

test("Gmail OAuth callback fails closed for an unknown state", async () => {
  const env = mockEnv();
  env.DB = {
    prepare() { return { bind() { return { first: async () => null, run: async () => ({ success: true }) }; } }; }
  };
  env.GOOGLE_CLIENT_ID = "google-client-id";
  env.GOOGLE_CLIENT_SECRET = "google-client-secret";
  env.GMAIL_TOKEN_ENCRYPTION_KEY = "test-encryption-key";
  const response = await worker.fetch(new Request("https://jobmate.test/oauth/gmail/callback?code=sample&state=unknown"), env);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Sesi kedaluwarsa/);
});


test("Gmail inbox sync requires a previously connected owner account", async () => {
  const env = mockEnv();
  env.DB = {
    prepare() {
      return { bind() { return {
        first: async () => null,
        run: async () => ({ success: true, meta: { changes: 0 } }),
        all: async () => ({ results: [] })
      }; } };
    }
  };
  const response = await worker.fetch(new Request("https://jobmate.test/api/gmail/messages", {
    method: "GET",
    headers: { Authorization: "tma " + await signedInitData() }
  }), env);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Hubungkan Gmail/i);
});

test("Gmail callback encrypts tokens before storing the connection", async () => {
  const env = mockEnv();
  env.GOOGLE_CLIENT_ID = "google-client-id";
  env.GOOGLE_CLIENT_SECRET = "google-client-secret";
  env.GMAIL_TOKEN_ENCRYPTION_KEY = "a-long-random-test-encryption-key";
  const writes = [];
  env.DB = {
    prepare(sql) {
      return { bind(...values) { return {
        first: async () => {
          if (sql.includes("gmail_oauth_states")) return { telegram_id: OWNER_ID, code_verifier: "pkce-verifier", expires_at: Date.now() + 60000 };
          if (sql.includes("gmail_connections")) return null;
          return null;
        },
        run: async () => { writes.push({ sql, values }); return { success: true, meta: { changes: 1 } }; },
        all: async () => ({ results: [] })
      }; } };
    }
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).includes("oauth2.googleapis.com/token")) return new Response(JSON.stringify({
      access_token: "plain-access-token",
      refresh_token: "plain-refresh-token",
      expires_in: 3600,
      scope: "https://www.googleapis.com/auth/gmail.readonly"
    }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (String(url).includes("userinfo")) return new Response(JSON.stringify({ email: "owner@example.com" }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
    throw new Error("Unexpected fetch");
  };
  try {
    const response = await worker.fetch(new Request("https://jobmate.test/oauth/gmail/callback?code=sample-code&state=sample-state"), env);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Gmail berhasil terhubung/);
    const insert = writes.find(x => x.sql.includes("INSERT INTO gmail_connections"));
    assert.ok(insert);
    assert.equal(insert.values[1], "owner@example.com");
    assert.equal(String(insert.values[2]).includes("plain-refresh-token"), false);
    assert.equal(writes.some(x => x.sql.includes("DELETE FROM gmail_oauth_states")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("Job Match ranks every supplied vacancy and returns bounded structured results", async () => {
  const env = mockEnv();
  env.GEMINI_API_KEY = "test-gemini-key";
  const statements = [];
  env.DB = {
    prepare(sql) {
      return { bind(...values) { return {
        first: async () => { statements.push({ sql, values }); return { text_count: 1 }; },
        run: async () => { statements.push({ sql, values }); return { success: true, meta: { changes: 1 } }; }
      }; } };
    }
  };
  const originalFetch = globalThis.fetch;
  const aiMatches = {
    matches: [
      { job_index: 1, company: "Gudang B", position: "Warehouse Operator", score: 92, summary: "Pengalaman gudang relevan.", matching_requirements: ["Picking dan packing"], gaps: ["WMS lanjutan belum disebut"], truthful_actions: ["Tonjolkan pengalaman scanner yang benar-benar dimiliki."] },
      { job_index: 0, company: "Pabrik A", position: "Operator Produksi", score: 78, summary: "Pengalaman produksi relevan.", matching_requirements: ["QC produk"], gaps: ["Mesin tertentu belum disebut"], truthful_actions: ["Jelaskan pengalaman QC yang benar-benar dilakukan."] }
    ]
  };
  let requestBody;
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /gemini-3\.5-flash-lite:generateContent/);
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(aiMatches) }] } }] }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  };
  try {
    const response = await worker.fetch(new Request("https://jobmate.test/api/job-match", {
      method: "POST",
      headers: { Authorization: "tma " + await signedInitData(), "Content-Type": "application/json" },
      body: JSON.stringify({ cv_text: "CV kandidat", jobs: ["Pabrik A | Operator Produksi\\nSyarat QC", "Gudang B | Warehouse Operator\\nPicking packing"] })
    }), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.matches.length, 2);
    assert.equal(body.matches[0].job_index, 1);
    assert.equal(body.matches[0].score, 92);
    assert.equal(body.matches[1].job_index, 0);
    assert.equal(requestBody.generationConfig.responseMimeType, "application/json");
    assert.equal(requestBody.generationConfig.maxOutputTokens, 2600);
    assert.equal(Object.hasOwn(requestBody.generationConfig, "temperature"), false);
    assert.ok(statements.some(x => x.sql.includes("INSERT INTO ai_usage")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Job Match rejects too few vacancies before reserving quota or calling Gemini", async () => {
  const env = mockEnv();
  env.GEMINI_API_KEY = "test-gemini-key";
  let dbCalls = 0;
  env.DB = { prepare() { dbCalls++; throw new Error("Quota must not be touched"); } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Gemini must not be called"); };
  try {
    const response = await worker.fetch(new Request("https://jobmate.test/api/job-match", {
      method: "POST",
      headers: { Authorization: "tma " + await signedInitData(), "Content-Type": "application/json" },
      body: JSON.stringify({ cv_text: "CV kandidat", jobs: ["Hanya satu lowongan"] })
    }), env);
    assert.equal(response.status, 400);
    assert.equal(dbCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("manual email helper does not expose inactive Gmail OAuth controls", async () => {
  const marker = "const APP_HTML=";
  const start = source.indexOf(marker) + marker.length;
  const end = source.indexOf(";\nexport default", start);
  const html = JSON.parse(source.slice(start, end));
  assert.match(html, /data-tab="gmail">Email &amp; Follow-up|data-tab="gmail">Email & Follow-up/);
  assert.match(html, /id="emailSource"[^>]*maxlength="6000"/);
  assert.match(html, /id="emailSummarize"/);
  assert.match(html, /id="emailDraftReply"/);
  assert.doesNotMatch(html, /id="gmailConnect"/);
  assert.doesNotMatch(html, /id="gmailSync"/);
  assert.match(html, /data tidak tepercaya/);
});
