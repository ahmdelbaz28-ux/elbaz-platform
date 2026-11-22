// LOCAL REVERSE PROXY — measures the REAL production origin (HF Space with
// x-forwarded-host) without the qzz.io edge challenge. Lighthouse targets
// http://localhost:4174 and sees the exact production build + data.
import http from "node:http";
import https from "node:https";

const ORIGIN = "ahmdelbaz28-ahmdrtap.hf.space";
const FWD_HOST = "ahmedelbaz.qzz.io";
const PORT = Number(process.argv[2] || 4174);

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const body = Buffer.concat(chunks);

  const headers = {
    ...req.headers,
    "x-forwarded-host": FWD_HOST,
    "x-forwarded-proto": "https",
    host: ORIGIN,
  };
  delete headers.connection;

  const upstream = https.request(
    { hostname: ORIGIN, port: 443, path: req.url, method: req.method, headers },
    (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (e) => {
    res.writeHead(502);
    res.end("proxy error: " + e.message);
  });
  if (body.length) upstream.write(body);
  upstream.end();
});

server.listen(PORT, () => console.log(`production proxy on :${PORT} → ${ORIGIN} (host=${FWD_HOST})`));
