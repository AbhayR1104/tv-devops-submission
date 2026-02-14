import express from "express";

const app = express();

const PORT = Number(process.env.PORT ?? 3000);
const HOST = "0.0.0.0";

// Health endpoint (used by ALB health checks)
app.get("/health", (_req, res) => {
  res.status(200).send("ok");
});

// Root endpoint (useful for demo/testing)
app.get("/", (_req, res) => {
  res.json({
    service: "tv-devops-service",
    status: "running",
    port: PORT
  });
});

app.listen(PORT, HOST, () => {
  console.log(`🚀 Server is running at http://${HOST}:${PORT}`);
});
