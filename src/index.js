
async function verifyTelegramInitData(initData, botToken) {
  if (!initData) {
    return { ok: false, reason: "INIT_DATA_MISSING" };
  }

  if (!botToken) {
    return { ok: false, reason: "BOT_TOKEN_MISSING" };
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
    return { ok: false, reason: "HASH_MISSING_OR_INVALID" };
  }

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const encoder = new TextEncoder();

  const secretKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const secret = await crypto.subtle.sign(
    "HMAC",
    secretKey,
    encoder.encode(botToken)
  );

  const validationKey = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const calculatedHash = await crypto.subtle.sign(
    "HMAC",
    validationKey,
    encoder.encode(dataCheckString)
  );

  const calculatedHex = [...new Uint8Array(calculatedHash)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");

  if (calculatedHex !== receivedHash.toLowerCase()) {
    return { ok: false, reason: "HASH_MISMATCH" };
  }

  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);

  if (
    !Number.isFinite(authDate) ||
    authDate <= 0 ||
    authDate > now + 30 ||
    now - authDate > 3600
  ) {
    return { ok: false, reason: "AUTH_DATE_INVALID_OR_EXPIRED" };
  }

  try {
    const user = JSON.parse(params.get("user") || "null");

    if (!user || !user.id || user.is_bot) {
      return { ok: false, reason: "USER_DATA_INVALID" };
    }

    return { ok: true, user };
  } catch {
    return { ok: false, reason: "USER_JSON_INVALID" };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        success: true,
        app: "JobMate AI",
        status: "online"
      });
    }

    if (url.pathname.startsWith("/api/")) {
      if (request.method !== "GET") {
        return Response.json(
          { success: false, error: "Method not allowed" },
          { status: 405 }
        );
      }

      const initData = request.headers.get("X-Telegram-Init-Data");

      const result = await verifyTelegramInitData(
        initData,
        env.TELEGRAM_BOT_TOKEN
      );

      if (!result.ok) {
        return Response.json(
          {
            success: false,
            error: "Telegram authentication failed",
            reason: result.reason
          },
          { status: 401 }
        );
      }

      if (url.pathname === "/api/me") {
        try {
          await env.DB.prepare(`
            INSERT INTO users (telegram_id, first_name, username)
            VALUES (?, ?, ?)
            ON CONFLICT(telegram_id) DO UPDATE SET
              first_name = excluded.first_name,
              username = excluded.username
          `).bind(
            String(result.user.id),
            result.user.first_name || "",
            result.user.username || null
          ).run();

          return Response.json({
            success: true,
            user: {
              id: String(result.user.id),
              first_name: result.user.first_name || "",
              username: result.user.username || null
            }
          });
        } catch {
          return Response.json(
            {
              success: false,
              error: "Database operation failed"
            },
            { status: 500 }
          );
        }
      }

      return Response.json(
        { success: false, error: "Not found" },
        { status: 404 }
      );
    }

    return env.ASSETS.fetch(request);
  }
};
