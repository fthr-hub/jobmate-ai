
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const json = (data, status = 200) =>
      Response.json(data, { status, headers: corsHeaders });

    if (url.pathname === "/api/health") {
      return json({
        success: true,
        app: "JobMate AI",
        status: "online",
        model: "gemini-3.5-flash-lite"
      });
    }

    if (url.pathname === "/api/me") {
      return json({
        success: true,
        user: { first_name: "Pengguna", username: null }
      });
    }

    if (url.pathname === "/api/image-usage") {
      if (!env.DB) {
        return json({ success: false, error: "Database belum terhubung." }, 500);
      }

      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode("jobmate-image-quota-v1:" + ip)
      );
      const ipHash = [...new Uint8Array(digest)]
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");

      const today = new Date().toISOString().slice(0, 10);
      const row = await env.DB.prepare(
        "SELECT image_count FROM image_usage WHERE ip_hash = ? AND usage_date = ?"
      ).bind(ipHash, today).first();

      const used = row?.image_count || 0;

      return json({
        success: true,
        used,
        limit: 10,
        remaining: Math.max(0, 10 - used),
        resets: "00:00 UTC"
      });
    }

    if (url.pathname === "/api/analyze-image") {
      if (request.method !== "POST") {
        return json({ success: false, error: "Method not allowed." }, 405);
      }

      if (!env.GEMINI_API_KEY) {
        return json({ success: false, error: "Gemini API key belum terhubung." }, 500);
      }

      if (!env.DB) {
        return json({ success: false, error: "Database belum terhubung." }, 500);
      }

      try {
        const body = await request.json();
        const image = body.image;
        const mimeType = body.mimeType;

        if (typeof image !== "string" || !image) {
          return json({ success: false, error: "Pilih foto lowongan terlebih dahulu." }, 400);
        }

        if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
          return json({ success: false, error: "Format foto harus JPG, PNG, atau WEBP." }, 415);
        }

        if (image.length > 8000000) {
          return json({ success: false, error: "Ukuran foto terlalu besar. Maksimal sekitar 6 MB." }, 413);
        }

        const ip = request.headers.get("CF-Connecting-IP") || "unknown";
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode("jobmate-image-quota-v1:" + ip)
        );
        const ipHash = [...new Uint8Array(digest)]
          .map(b => b.toString(16).padStart(2, "0"))
          .join("");

        const today = new Date().toISOString().slice(0, 10);

        const quota = await env.DB.prepare(
          `INSERT INTO image_usage (ip_hash, usage_date, image_count)
           VALUES (?, ?, 1)
           ON CONFLICT(ip_hash, usage_date)
           DO UPDATE SET image_count = image_count + 1
           WHERE image_count < 10
           RETURNING image_count`
        ).bind(ipHash, today).first();

        if (!quota) {
          return json({
            success: false,
            error: "Kuota foto hari ini sudah habis (10/10). Coba lagi besok.",
            used: 10,
            limit: 10,
            remaining: 0
          }, 429);
        }

        const prompt = `Kamu adalah JobMate AI, asisten karier profesional.
Baca seluruh teks yang terlihat pada gambar lowongan kerja ini.
Analisis dengan bahasa Indonesia yang natural dan jelas menggunakan bagian:
1. Ringkasan lowongan dan perusahaan
2. Tanggung jawab
3. Kualifikasi
4. Kata kunci ATS
5. Kecocokan untuk pemula
6. Tips melamar
7. Hal yang perlu dikonfirmasi

Jika ada teks yang tidak terbaca, sebutkan.
Jangan mengarang informasi.
Jika gambar bukan lowongan kerja, jelaskan apa yang terlihat dan minta pengguna mengirim foto lowongan.`;

        const response = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": env.GEMINI_API_KEY
            },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: prompt },
                  {
                    inline_data: {
                      mime_type: mimeType,
                      data: image
                    }
                  }
                ]
              }],
              generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 2500
              }
            })
          }
        );

        const result = await response.json();

        if (!response.ok) {
          return json({
            success: false,
            error: result.error?.message || "Gemini gagal membaca foto."
          }, 502);
        }

        const answer = result.candidates?.[0]?.content?.parts
          ?.map(p => p.text || "")
          .join("")
          .trim();

        if (!answer) {
          return json({ success: false, error: "Gemini tidak memberikan hasil." }, 502);
        }

        return json({
          success: true,
          result: answer,
          used: quota.image_count,
          limit: 10,
          remaining: 10 - quota.image_count
        });

      } catch (error) {
        return json({
          success: false,
          error: "Terjadi kesalahan saat membaca foto."
        }, 500);
      }
    }

    if (url.pathname === "/api/analyze") {
      if (request.method !== "POST") {
        return json({ success: false, error: "Method not allowed." }, 405);
      }

      if (!env.GEMINI_API_KEY) {
        return json({
          success: false,
          error: "GEMINI_API_KEY belum terhubung ke Cloudflare Worker."
        }, 500);
      }

      try {
        const body = await request.json();
        const vacancy = body.vacancy?.trim();

        if (!vacancy) {
          return json({ success: false, error: "Deskripsi lowongan wajib diisi." }, 400);
        }

        if (vacancy.length > 12000) {
          return json({
            success: false,
            error: "Deskripsi terlalu panjang. Maksimal 12.000 karakter."
          }, 413);
        }

        const prompt = `Kamu adalah JobMate AI, asisten karier profesional.
Analisis lowongan berikut dalam bahasa Indonesia yang natural dan jelas.
Susun:
1. Ringkasan lowongan
2. Tanggung jawab
3. Kualifikasi
4. Kata kunci ATS
5. Tingkat kesulitan untuk pemula
6. Tips melamar
7. Hal yang perlu diperhatikan

Jangan mengarang informasi; sebutkan jika data tidak tersedia.

DESKRIPSI LOWONGAN:
${vacancy}`;

        const response = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": env.GEMINI_API_KEY
            },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.4,
                maxOutputTokens: 2500
              }
            })
          }
        );

        const result = await response.json();

        if (!response.ok) {
          return json({
            success: false,
            error: result.error?.message || "Gemini gagal memproses permintaan."
          }, 502);
        }

        const answer = result.candidates?.[0]?.content?.parts
          ?.map(p => p.text || "")
          .join("")
          .trim();

        if (!answer) {
          return json({ success: false, error: "Gemini tidak memberikan hasil." }, 502);
        }

        return json({
          success: true,
          model: "gemini-3.5-flash-lite",
          result: answer
        });

      } catch (error) {
        return json({
          success: false,
          error: "Terjadi kesalahan saat menganalisis."
        }, 500);
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ success: false, error: "Endpoint belum tersedia." }, 404);
    }

    return env.ASSETS.fetch(request);
  }
};
