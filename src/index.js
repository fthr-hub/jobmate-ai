
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Status aplikasi
    if (url.pathname === "/api/health") {
      return Response.json({
        success: true,
        app: "JobMate AI",
        status: "online",
        authentication: "disabled"
      });
    }

    // Profil pengguna tanpa login
    if (url.pathname === "/api/me") {
      return Response.json({
        success: true,
        user: {
          first_name: "Pengguna",
          username: null
        }
      });
    }

    // Endpoint API yang belum tersedia
    if (url.pathname.startsWith("/api/")) {
      return Response.json(
        {
          success: false,
          error: "Endpoint belum tersedia"
        },
        { status: 404 }
      );
    }

    // Tampilkan Mini App
    return env.ASSETS.fetch(request);
  }
};
