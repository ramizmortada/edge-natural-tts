const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', function connection(ws, req) {
  console.log('--- NEW CONNECTION ---');
  console.log('Headers received:');
  console.log(req.headers);
  ws.close();
});

console.log('Listening on ws://localhost:8080');
