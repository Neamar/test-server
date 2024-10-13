import { createServer } from 'node:http';

const hostname = '127.0.0.1';
const port = process.env.PORT || 3000;
let rps = 0;

setInterval(() => {
  console.log("RPS: ", rps);
  rps = 0;
}, 1000);

const content = Array(50000).fill('a').join('');
const server = createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end(content);
  rps++;
});

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});
