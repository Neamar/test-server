Using node 20,
No custom nginx

## TEST 1 : no custom nginx

Code: https://github.com/Neamar/test-server/blob/e20996d444b286e9e87802176c7c150898653126/index.js

With 100 concurrent connections, default Nginx config, it peaks around 5k RPS, averages 4k.

After some time, we exhaust the available ports:

```
2024/10/13 06:50:41 [crit] 2198837#2198837: *3796375 connect() to 172.17.0.19:5000 failed (99: Cannot assign requested address) while connecting to upstream, client: 176.9.18.46, server: test-server.neamar.fr, request: "GET / HTTP/1.1", upstream: "http://172.17.0.19:5000/", host: "test-server.neamar.fr"
```

and then only get errors from there for 120s:

> At high traffic volumes, opening a new connection for every request can exhaust system resources and make it impossible to open connections at all. Here’s why: for each connection the 4-tuple of source address, source port, destination address, and destination port must be unique. For connections from NGINX to an upstream server, three of the elements (the first, third, and fourth) are fixed, leaving only the source port as a variable. When a connection is closed, the Linux socket sits in the TIME‑WAIT state for two minutes, which at high traffic volumes increases the possibility of exhausting the pool of available source ports. If that happens, NGINX cannot open new connections to upstream servers.

## TEST 2 : custom nginx with keepalive
