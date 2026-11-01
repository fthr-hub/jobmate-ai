export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
    const json = (data, status = 200, extra = {}) =>
      Response.json(data, { status, headers: { ...cors, ...extra } });

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const uid = "personal";
    const ensureUser = () => env.DB.prepare(
      "INSERT OR IGNORE INTO users(telegram_id, first_name) VALUES(?, ?)"
    ).bind(uid, "Pengguna").run();

    if (url.pathname === "/api/health") {
      return json({ success: true, app: "JobMate AI", status: "online", model: "gemini-3.5-flash-lite" });
    }

    if (url.pathname === "/api/me" || url.pathname === "/api/profile") {
      await ensureUser();
      const profile = await env.DB.prepare(
        "SELECT * FROM profiles WHERE telegram_id = ?"
      ).bind(uid).first();

      if (url.pathname === "/api/me") {
        return json({ success: true, user: { first_name: "Pengguna", username: null }, profile: profile || {} });
      }
      if (request.method === "GET") {
        return json({ success: true, profile: profile || {
          full_name: "", email: "", phone: "", address: "", skills: "", experience: "", education: ""
        } });
      }
      if (!["PUT", "POST"].includes(request.method)) {
        return json({ success: false, error: "Method not allowed." }, 405);
      }

      const body = await request.json();
      const fields = ["full_name", "email", "phone", "address", "skills", "experience", "education"];
      const values = fields.map(key => String(body[key] ?? "").slice(0, 12000));
      await env.DB.prepare(
        "INSERT INTO profiles(telegram_id,full_name,email,phone,address,skills,experience,education,updated_at) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) " +
        "ON CONFLICT(telegram_id) DO UPDATE SET full_name=excluded.full_name,email=excluded.email,phone=excluded.phone,address=excluded.address,skills=excluded.skills,experience=excluded.experience,education=excluded.education,updated_at=CURRENT_TIMESTAMP"
      ).bind(uid, ...values).run();
      const saved = await env.DB.prepare("SELECT * FROM profiles WHERE telegram_id = ?").bind(uid).first();
      return json({ success: true, profile: saved });
    }

    if (url.pathname === "/api/applications") {
      await ensureUser();
      if (request.method === "GET") {
        const result = await env.DB.prepare(
          "SELECT * FROM applications WHERE telegram_id = ? ORDER BY COALESCE(applied_at, created_at) DESC"
        ).bind(uid).all();
        return json({ success: true, applications: result.results || [] });
      }
      if (request.method === "POST") {
        const body = await request.json();
        const id = crypto.randomUUID();
        const statuses = ["draft", "applied", "interview", "accepted", "rejected"];
        const status = statuses.includes(body.status) ? body.status : "draft";
        await env.DB.prepare(
          "INSERT INTO applications(id,telegram_id,company_name,position,job_description,status,notes,applied_at) VALUES(?,?,?,?,?,?,?,?)"
        ).bind(id, uid, String(body.company_name || "").slice(0, 200),
          String(body.position || "").slice(0, 200), String(body.job_description || "").slice(0, 12000),
          status, String(body.notes || "").slice(0, 12000), body.applied_at || null).run();
        const application = await env.DB.prepare("SELECT * FROM applications WHERE id = ?").bind(id).first();
        return json({ success: true, application }, 201);
      }
      return json({ success: false, error: "Method not allowed." }, 405);
    }

    let match = url.pathname.match(/^\/api\/applications\/([^/]+)$/);
    if (match) {
      await ensureUser();
      const id = match[1];
      if (request.method === "PUT") {
        const body = await request.json();
        const statuses = ["draft", "applied", "interview", "accepted", "rejected"];
        const status = statuses.includes(body.status) ? body.status : "draft";
        const result = await env.DB.prepare(
          "UPDATE applications SET company_name=?,position=?,job_description=?,status=?,notes=?,applied_at=? WHERE id=? AND telegram_id=?"
        ).bind(String(body.company_name || "").slice(0, 200), String(body.position || "").slice(0, 200),
          String(body.job_description || "").slice(0, 12000), status, String(body.notes || "").slice(0, 12000),
          body.applied_at || null, id, uid).run();
        if (!result.meta?.changes) return json({ success: false, error: "Lamaran tidak ditemukan." }, 404);
        const application = await env.DB.prepare("SELECT * FROM applications WHERE id = ?").bind(id).first();
        return json({ success: true, application });
      }
      if (request.method === "DELETE") {
        const result = await env.DB.prepare("DELETE FROM applications WHERE id = ? AND telegram_id = ?").bind(id, uid).run();
        return result.meta?.changes ? json({ success: true }) : json({ success: false, error: "Lamaran tidak ditemukan." }, 404);
      }
      return json({ success: false, error: "Method not allowed." }, 405);
    }

    if (url.pathname === "/api/documents") {
      await ensureUser();
      if (request.method === "GET") {
        const result = await env.DB.prepare(
          "SELECT id,file_name,file_type,created_at FROM documents WHERE telegram_id = ? ORDER BY created_at DESC"
        ).bind(uid).all();
        return json({ success: true, documents: result.results || [] });
      }
      if (request.method === "POST") {
        const form = await request.formData();
        const file = form.get("file");
        if (!file || typeof file.arrayBuffer !== "function") {
          return json({ success: false, error: "Pilih file CV terlebih dahulu." }, 400);
        }
        const allowed = [
          "application/pdf",
          "application/msword",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ];
        const type = file.type || "application/octet-stream";
        if (!allowed.includes(type)) return json({ success: false, error: "Format file harus PDF, DOC, atau DOCX." }, 415);
        if (file.size > 900000) return json({ success: false, error: "Ukuran file maksimal 900 KB sementara." }, 413);

        const id = crypto.randomUUID();
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        const name = String(file.name || "CV").replace(/[\\/\\0]/g, "_").slice(0, 180);
        await env.DB.prepare(
          "INSERT INTO documents(id,telegram_id,file_name,file_type,storage_key) VALUES(?,?,?,?,?)"
        ).bind(id, uid, name, type, id).run();
        await env.DB.prepare(
          "INSERT INTO document_contents(document_id,content_base64,content_type) VALUES(?,?,?)"
        ).bind(id, btoa(binary), type).run();
        let extracted = false;
        let extractionMessage = "CV tersimpan. Ekstraksi otomatis membutuhkan AI aktif dan format PDF.";
        if (type === "application/pdf" && env.GEMINI_API_KEY) {
          try {
            const prompt = "Ekstrak data CV dari PDF. Balas JSON valid saja dengan properti full_name,email,phone,address,skills,experience,education. skills, experience, education berupa teks ringkas bahasa Indonesia. Jangan menebak; gunakan string kosong jika tidak ditemukan. Untuk experience cantumkan jabatan, perusahaan, periode, dan tugas yang tertulis.";
            const ai = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent", {method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":env.GEMINI_API_KEY},body:JSON.stringify({contents:[{parts:[{text:prompt},{inline_data:{mime_type:"application/pdf",data:btoa(binary)}}]}],generationConfig:{temperature:0.1,maxOutputTokens:1800,responseMimeType:"application/json"}})});
            const parsed=await ai.json(), raw=parsed.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("");
            if(ai.ok&&raw){const cv=JSON.parse(raw),keys=["full_name","email","phone","address","skills","experience","education"],values=keys.map(k=>String(cv[k]||"").slice(0,12000));
              await env.DB.prepare("INSERT INTO profiles(telegram_id,full_name,email,phone,address,skills,experience,education,updated_at) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(telegram_id) DO UPDATE SET full_name=CASE WHEN COALESCE(profiles.full_name,'')='' THEN excluded.full_name ELSE profiles.full_name END,email=CASE WHEN COALESCE(profiles.email,'')='' THEN excluded.email ELSE profiles.email END,phone=CASE WHEN COALESCE(profiles.phone,'')='' THEN excluded.phone ELSE profiles.phone END,address=CASE WHEN COALESCE(profiles.address,'')='' THEN excluded.address ELSE profiles.address END,skills=CASE WHEN COALESCE(profiles.skills,'')='' THEN excluded.skills ELSE profiles.skills END,experience=CASE WHEN COALESCE(profiles.experience,'')='' THEN excluded.experience ELSE profiles.experience END,education=CASE WHEN COALESCE(profiles.education,'')='' THEN excluded.education ELSE profiles.education END,updated_at=CURRENT_TIMESTAMP").bind(uid,...values).run();
              extracted=true;extractionMessage="CV tersimpan dan informasi karier berhasil diekstrak. Periksa hasilnya di Profil.";
            } else extractionMessage="CV tersimpan, tetapi AI belum berhasil membaca isinya.";
          } catch(e){extractionMessage="CV tersimpan, tetapi ekstraksi otomatis gagal. Coba lagi nanti.";}
        }
        return json({success:true,extracted,message:extractionMessage,document:{id,file_name:name,file_type:type}},201);
      }
      return json({ success: false, error: "Method not allowed." }, 405);
    }

    match = url.pathname.match(/^\/api\/documents\/([^/]+)$/);
    if (match) {
      await ensureUser();
      const id = match[1];
      if (request.method === "DELETE") {
        await env.DB.prepare("DELETE FROM document_contents WHERE document_id = ? AND document_id IN (SELECT id FROM documents WHERE id = ? AND telegram_id = ?)").bind(id, id, uid).run();
        const result = await env.DB.prepare("DELETE FROM documents WHERE id = ? AND telegram_id = ?").bind(id, uid).run();
        return result.meta?.changes ? json({ success: true }) : json({ success: false, error: "Dokumen tidak ditemukan." }, 404);
      }
      if (request.method === "GET") {
        const doc = await env.DB.prepare(
          "SELECT d.file_name,c.content_base64,c.content_type FROM documents d JOIN document_contents c ON c.document_id=d.id WHERE d.id=? AND d.telegram_id=?"
        ).bind(id, uid).first();
        if (!doc) return json({ success: false, error: "Dokumen tidak ditemukan." }, 404);
        const binary = atob(doc.content_base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const safeName = doc.file_name.replace(/["\r\n]/g, "_");
        return new Response(bytes, { headers: {
          ...cors, "Content-Type": doc.content_type,
          "Content-Disposition": 'attachment; filename="' + safeName + '"',
          "Cache-Control": "no-store"
        } });
      }
      return json({ success: false, error: "Method not allowed." }, 405);
    }

    if (url.pathname === "/api/image-usage") {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("jobmate-image-quota-v1:" + ip));
      const hash = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
      const day = new Date().toISOString().slice(0, 10);
      const row = await env.DB.prepare("SELECT image_count FROM image_usage WHERE ip_hash=? AND usage_date=?").bind(hash, day).first();
      const used = row?.image_count || 0;
      return json({ success: true, used, limit: 10, remaining: Math.max(0, 10 - used), resets: "00:00 UTC" });
    }

    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") return json({ success: false, error: "Method not allowed." }, 405);
      if (!env.GEMINI_API_KEY) return json({ success: false, error: "AI belum aktif di staging. Hubungkan GEMINI_API_KEY terlebih dahulu." }, 503);
      try {
        const body = await request.json();
        const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
        const clean = messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content || "").slice(0, 6000) }] })).filter(m => m.parts[0].text.trim());
        if (!clean.length || clean[clean.length - 1].role !== "user") return json({ success: false, error: "Tulis pertanyaan terlebih dahulu." }, 400);
        await ensureUser();
        const profile = await env.DB.prepare("SELECT full_name,skills,experience,education FROM profiles WHERE telegram_id=?").bind(uid).first();
        const system = "Kamu adalah JobMate AI, career coach pribadi yang ramah, kritis, praktis, dan jujur. Jawab dalam bahasa Indonesia natural. Bantu CV, ATS, lowongan, interview, dan strategi karier. Jangan mengarang fakta. KONTEKS PROFIL: " + JSON.stringify(profile || {});
        const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent", { method:"POST", headers:{"Content-Type":"application/json","x-goog-api-key":env.GEMINI_API_KEY}, body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents:clean,generationConfig:{temperature:0.55,maxOutputTokens:1800}}) });
        const result = await response.json();
        if (!response.ok) return json({success:false,error:result.error?.message||"AI gagal menjawab."},502);
        const answer=result.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("").trim();
        return answer?json({success:true,answer}):json({success:false,error:"AI tidak memberikan jawaban."},502);
      } catch(e) { return json({success:false,error:"Terjadi kesalahan saat menghubungi AI."},500); }
    }

    if (url.pathname === "/api/analyze" || url.pathname === "/api/analyze-image") {
      if (request.method !== "POST") return json({ success: false, error: "Method not allowed." }, 405);
      if (!env.GEMINI_API_KEY) return json({ success: false, error: "Gemini API key belum terhubung." }, 500);
      try {
        const body = await request.json();
        let parts;
        if (url.pathname === "/api/analyze") {
          const vacancy = body.vacancy?.trim();
          if (!vacancy) return json({ success: false, error: "Deskripsi lowongan wajib diisi." }, 400);
          if (vacancy.length > 12000) return json({ success: false, error: "Deskripsi terlalu panjang. Maksimal 12.000 karakter." }, 413);
          const prompt = "Kamu adalah JobMate AI, asisten karier profesional. Analisis lowongan berikut dalam bahasa Indonesia dengan bagian: ringkasan, tanggung jawab, kualifikasi, kata kunci ATS, tingkat kesulitan untuk pemula, tips melamar, dan hal yang perlu diperhatikan. Jangan mengarang informasi.\n\n" + vacancy;
          parts = [{ text: prompt }];
        } else {
          if (!env.DB) return json({ success: false, error: "Database belum terhubung." }, 500);
          if (typeof body.image !== "string" || !body.image) return json({ success: false, error: "Pilih foto lowongan terlebih dahulu." }, 400);
          if (!["image/jpeg", "image/png", "image/webp"].includes(body.mimeType)) return json({ success: false, error: "Format foto harus JPG, PNG, atau WEBP." }, 415);
          if (body.image.length > 8000000) return json({ success: false, error: "Ukuran foto terlalu besar. Maksimal sekitar 6 MB." }, 413);
          const ip = request.headers.get("CF-Connecting-IP") || "unknown";
          const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("jobmate-image-quota-v1:" + ip));
          const hash = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
          const day = new Date().toISOString().slice(0, 10);
          const quota = await env.DB.prepare(
            "INSERT INTO image_usage(ip_hash,usage_date,image_count) VALUES(?,?,1) ON CONFLICT(ip_hash,usage_date) DO UPDATE SET image_count=image_count+1 WHERE image_count<10 RETURNING image_count"
          ).bind(hash, day).first();
          if (!quota) return json({ success: false, error: "Kuota foto hari ini sudah habis (10/10). Coba lagi besok.", used: 10, limit: 10, remaining: 0 }, 429);
          const prompt = "Baca teks pada gambar lowongan. Analisis ringkasan perusahaan, tanggung jawab, kualifikasi, kata kunci ATS, kecocokan untuk pemula, tips melamar, dan hal yang perlu dikonfirmasi. Jangan mengarang; sebutkan jika teks tidak terbaca.";
          parts = [{ text: prompt }, { inline_data: { mime_type: body.mimeType, data: body.image } }];
        }

        const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
          body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.35, maxOutputTokens: 2500 } })
        });
        const result = await response.json();
        if (!response.ok) return json({ success: false, error: result.error?.message || "Gemini gagal memproses." }, 502);
        const answer = result.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("").trim();
        return answer ? json({ success: true, model: "gemini-3.5-flash-lite", result: answer }) : json({ success: false, error: "Gemini tidak memberikan hasil." }, 502);
      } catch (error) {
        return json({ success: false, error: "Terjadi kesalahan saat memproses permintaan." }, 500);
      }
    }

    if (url.pathname.startsWith("/api/")) return json({ success: false, error: "Endpoint belum tersedia." }, 404);
    return env.ASSETS.fetch(request);
  }
};