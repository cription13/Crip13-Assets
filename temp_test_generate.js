const http = require('http');
const data = JSON.stringify({ source: 'admin-panel' });
const opts = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/vault/generate',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
    'X-Admin-Key': 'prime'
  }
};

const req = http.request(opts, (res) => {
  let body = '';
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log(body);
  });
});

req.on('error', (err) => {
  console.error('Request error:', err);
});

req.write(data);
req.end();
