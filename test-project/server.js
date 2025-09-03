const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`
    <h1>🚀 Navigrator Test App</h1>
    <p>Server running on port 8080</p>
    <p>Accessed via: <strong>${req.headers.host}</strong></p>
    <p>Current time: ${new Date().toISOString()}</p>
    <p>Headers received:</p>
    <pre>${JSON.stringify(req.headers, null, 2)}</pre>
  `);
});

server.listen(8080, () => {
  console.log('Test server running on http://localhost:8080');
});