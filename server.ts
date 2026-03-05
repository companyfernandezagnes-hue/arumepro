import express from "express";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Proxy API to bypass CORS
  app.post("/api/proxy", async (req, res) => {
    const { url, method, body, headers } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      const response = await fetch(url, {
        method: method || "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers
        },
        body: body ? JSON.stringify(body) : undefined
      });

      const data = await response.text();
      let jsonData;
      try {
        jsonData = JSON.parse(data);
      } catch (e) {
        jsonData = data;
      }

      res.status(response.status).json(jsonData);
    } catch (error: any) {
      console.error("Proxy error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile("dist/index.html", { root: "." });
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
