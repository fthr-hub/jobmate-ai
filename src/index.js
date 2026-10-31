
async function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash) return null;

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

  if (calculatedHex !== receivedHash) return null;

  const authDate = Number(params.get("auth_date"));

  if (!authDate || Date.now() / 1000 - authDate > 3600) {
    return null;
  }

  try {
    return JSON.parse(params.get("user") || "null");
  } catch {
    return null;
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
      const initData = request.headers.get("X-Telegram-Init-Data");

      const user = await verifyTelegramInitData(
        initData,
        env.TELEGRAM_BOT_TOKEN
      );

      if (!user || String(user.id) !== String(env.ALLOWED_TELEGRAM_ID)) {
        return Response.json(
          { success: false, error: "Unauthorized" },
          { status: 401 }
        );
      }

      return Response.json({
        success: true,
        message: "Telegram authentication verified"
      });
    }

    return env.ASSETS.fetch(request);
  }
};
