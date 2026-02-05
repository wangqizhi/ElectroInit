const http = require("http");

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
});

const port = process.env.PORT || 3001;
server.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});
