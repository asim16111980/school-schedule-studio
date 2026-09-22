import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  // The server is always expected to serve the Vite production build.
  // This path works both from the source server/ folder and from dist/index.js.
  const staticPath = path.resolve(__dirname, "..", "dist", "public");
  const indexPath = path.join(staticPath, "index.html");

  if (!fs.existsSync(indexPath)) {
    console.error("");
    console.error("❌ Production build not found.");
    console.error(`   Missing: ${indexPath}`);
    console.error("");
    console.error("💡 Run this command first:");
    console.error("   pnpm run build");
    console.error("");
    process.exit(1);
  }

  app.use(express.static(staticPath));

  // Handle client-side routes (React/Vite SPA).
  app.get("*", (_req, res) => {
    res.sendFile(indexPath);
  });

  const port = Number(process.env.PORT) || 3001;

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error("");
      console.error(`❌ Port ${port} is already in use.`);
      console.error("");
      console.error("💡 PowerShell:");
      console.error("   $env:PORT=3002");
      console.error("   pnpm run server");
      console.error("");
      process.exit(1);
    }

    console.error("❌ Server error:", error);
    process.exit(1);
  });

  server.listen(port, () => {
    console.log("");
    console.log("========================================");
    console.log(" School Schedule Studio Server");
    console.log("========================================");
    console.log(`✅ Server: http://localhost:${port}/`);
    console.log(`📁 Static: ${staticPath}`);
    console.log("========================================");
    console.log("");
  });
}

startServer().catch((error) => {
  console.error("❌ Failed to start server:", error);
  process.exit(1);
});
