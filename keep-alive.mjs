import http from 'http';

export function startKeepAlive(port = 8080) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running');
  });

  server.listen(port, () => {
    console.log(`Keep-alive server running on port ${port}`);
  });
}
