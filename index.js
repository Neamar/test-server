import { createServer } from 'node:http';

const port = process.env.PORT || 3000;
let rps = 0;

setInterval(() => {
  console.log("RPS: ", rps);
  rps = 0;
}, 1000);

const content = Array(50000).fill('a').join('') + '\n';
const server = createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end(content);
  rps++;
});

server.listen(port, () => {
  console.log(`Server running on port ${port}/`);
});
