// Vercel/Netlify-style serverless proxy: POST /api/forecast → FORECAST_API_URL/forecast
// Set FORECAST_API_URL in your host's env (e.g. https://api.superbrains.dev).
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ detail: "POST only" });
  }
  const base = process.env.FORECAST_API_URL;
  if (!base) {
    return res.status(503).json({ detail: "FORECAST_API_URL not configured" });
  }
  try {
    const upstream = await fetch(`${base}/forecast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body ?? {}),
    });
    const data = await upstream.json().catch(() => ({}));
    return res.status(upstream.status).json(data);
  } catch (e) {
    return res.status(502).json({ detail: `forecast upstream unreachable: ${e.message}` });
  }
}
