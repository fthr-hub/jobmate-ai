
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health check backend
    if (url.pathname === "/api/health") {
      return Response.json({
        success: true,
        app: "JobMate AI",
        status: "online"
      });
    }

    // Serve Mini App frontend
    return env.ASSETS.fetch(request);
  }
};
