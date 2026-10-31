
async function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
    return null;
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

  let difference = 0;

  for (let i = 0; i < 64; i++) {
    difference |= calculatedHex.charCodeAt(i) ^ receivedHash.toLowerCase().charCodeAt(i);
  }

  if (difference !== 0) return null;

  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);

  if (!Number.isFinite(authDate) || authDate <= 0 ||
      authDate > now + 30 || now - authDate > 3600) {
    return null;
  }

  try {
    const user = JSON.parse(params.get("user") || "null");

    if (!user || !user.id || user.is_bot) return null;

    return user;
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
      if (request.method !== "GET") {
        return Response.json(
          { success: false, error: "Method not allowed" },
          { status: 405 }
        );
      }

      const initData = request.headers.get("X-Telegram-Init-Data");

      const user = await verifyTelegramInitData(
        initData,
        env.TELEGRAM_BOT_TOKEN
      );

      if (!user) {
        return Response.json(
          { success: false, error: "Telegram authentication required" },
          { status: 401 }
        );
      }

      if (url.pathname === "/api/me") {
        return Response.json({
          success: true,
          user: {
            id: String(user.id),
            first_name: user.first_name || "",
            username: user.username || null
          }
        });
      }

      return Response.json(
        { success: false, error: "Not found" },
        { status: 404 }
      );
    }

    return env.ASSETS.fetch(request);
  }
};
