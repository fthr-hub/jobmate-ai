
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS untuk akses dari frontend JobMate
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // Helper response JSON
    const json = (data, status = 200) =>
      Response.json(data, {
        status,
        headers: corsHeaders
      });

    // Status aplikasi
    if (url.pathname === "/api/health") {
      return json({
        success: true,
        app: "JobMate AI",
        status: "online",
        model: "gemini-3.5-flash-lite"
      });
    }

    // Profil sederhana tanpa login
    if (url.pathname === "/api/me") {
      return json({
        success: true,
        user: {
          first_name: "Pengguna",
          username: null
        }
      });
    }

    // Analisis lowongan dengan Gemini
    if (url.pathname === "/api/analyze") {
      if (request.method !== "POST") {
        return json({
          success: false,
          error: "Method not allowed"
        }, 405);
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
          return json({
            success: false,
            error: "Deskripsi lowongan wajib diisi."
          }, 400);
        }

        if (vacancy.length > 12000) {
          return json({
            success: false,
            error: "Deskripsi terlalu panjang. Maksimal 12.000 karakter."
          }, 413);
        }

        const prompt = `
Kamu adalah JobMate AI, asisten karier profesional.

Analisis lowongan pekerjaan berikut secara teliti.
Gunakan bahasa Indonesia yang natural, jelas,
profesional, dan mudah dipahami.

Susun hasil dengan format:

1. RINGKASAN LOWONGAN
Jelaskan posisi, perusahaan jika tercantum,
dan gambaran pekerjaan.

2. TANGGUNG JAWAB
Jelaskan tugas utama dari posisi tersebut.

3. KUALIFIKASI
Jelaskan pendidikan, pengalaman, dan keterampilan
yang dibutuhkan.

4. KATA KUNCI ATS
Berikan kata kunci penting untuk CV pelamar.

5. TINGKAT KESULITAN
Jelaskan apakah pekerjaan cocok untuk pemula
atau membutuhkan pengalaman khusus.

6. TIPS MELAMAR
Berikan saran praktis untuk mempersiapkan lamaran
dan menghadapi proses seleksi.

7. HAL YANG PERLU DIPERHATIKAN
Tunjukkan informasi yang tidak jelas atau
perlu dikonfirmasi kepada perusahaan.

Jangan mengarang informasi.
Jika informasi tidak tercantum, katakan bahwa
informasi tersebut tidak disebutkan.

DESKRIPSI LOWONGAN:

${vacancy}
`;

        const geminiResponse = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": env.GEMINI_API_KEY
            },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text: prompt
                    }
                  ]
                }
              ],
              generationConfig: {
                temperature: 0.4,
                maxOutputTokens: 2500
              }
            })
          }
        );

        const result = await geminiResponse.json();

        if (!geminiResponse.ok) {
          return json({
            success: false,
            error: result.error?.message ||
              "Gemini gagal memproses permintaan."
          }, 502);
        }

        const answer = result.candidates?.[0]?.content?.parts
          ?.map(part => part.text || "")
          .join("")
          .trim();

        if (!answer) {
          return json({
            success: false,
            error: "Gemini tidak memberikan hasil."
          }, 502);
        }

        return json({
          success: true,
          model: "gemini-3.5-flash-lite",
          result: answer
        });

      } catch (error) {
        return json({
          success: false,
          error: "Terjadi kesalahan: " + error.message
        }, 500);
      }
    }

    // Endpoint API yang belum tersedia
    if (url.pathname.startsWith("/api/")) {
      return json({
        success: false,
        error: "Endpoint belum tersedia."
      }, 404);
    }

    // Tampilkan frontend
    return env.ASSETS.fetch(request);
  }
};
