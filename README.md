tl;dr: this pull request allows a single docker container to increase throughput from 4000 RPS (requests per second) to 12,000 RPS. YMMV.

Fix #7250.
Keep-alive connection is a HTTP mechanism that allows multiple requests to reuse the same underlying HTTP connection.
Nginx enables keep alive connections with downstream (between the end user and nginx) by default.
However, it needs to be manually added for upstream connections (between nginx and the docker container running the app). This seems to be mostly for legacy reasons:

- there were some security concerns with older framework reusing the same connection. I'm not aware of this issue in any modern (>2015) frameworks
- there were some memory concerns as the same connection is reused and can grow in size, but we're talking about kB of memory here; and Nginx recycles the connection after 100 reuses by default, preventing this from growing unchecked.

Overall, it seems like enabling keep-alive would be a good default option, rather than putting it behind a flag.

_Additional (speculative) note_: to enable keepalive, one should usually prevent nginx from sending `Connection: Close` header.
It turns out the default nginx sigil has `proxy_set_header Connection $http_connection;`, which echoes back the value of the "Connection" header field (see [$http\_](http://nginx.org/en/docs/http/ngx_http_core_module.html#var_http_)). I think this is is here for websocket support (to forward "upgrade" requests) but it also means by default, for standard HTTP connection, it'll be "" (at least that's how I understand this).
If I understand correctly, it means with this config, the current nginx establishes a new connection each time (because there is no keepalive), but does not close it automatically, leading to pool exhaustion faster?

# Load test details

Using node 20 and a simple app that returns 50kB of static content each time.

Application code:

https://github.com/Neamar/test-server/blob/89bc58d3e195a61c8ca5fbf0d6d224214cfca0ef/index.js#L1-L21

This app is not representative of real life (!), for most users the app itself will be a bottleneck way before nginx. But for simple or heavily optimized applications, this is important.
While not measured here, skipping the initial part of the request by reusing the connection also speeds up the overall response cycle, shaving off a couple milliseconds each time.

I used `autocannon -c 100 -d 60 -t 2` to load test, running this from the same machine. When feasible, I ran multiple instance of the above in parallel to use multiple cores, and summed the returned stats.
I did not `ps:scale` the web worker, so everything was served from a single upstream docker container (goal is to optimize nginx to upstream)

## TEST 1 : no custom nginx

With 100 concurrent connections, default Nginx config, it peaks around 5k RPS, averages 4k.

After some time (around 30s), we exhaust the available ports, and Nginx returns error messages:

```
2024/10/13 06:50:41 [crit] 2198837#2198837: *3796375 connect() to 172.17.0.19:5000 failed (99: Cannot assign requested address) while connecting to upstream, client: 176.9.18.46, server: test-server.neamar.fr, request: "GET / HTTP/1.1", upstream: "http://172.17.0.19:5000/", host: "test-server.neamar.fr"
```

From then on, the app does not receive any new connections, and requests from downstreams only get errors for 120s, as explained [here](https://www.f5.com/company/blog/nginx/avoiding-top-10-nginx-configuration-mistakes):

> At high traffic volumes, opening a new connection for every request can exhaust system resources and make it impossible to open connections at all. Here’s why: for each connection the 4-tuple of source address, source port, destination address, and destination port must be unique. For connections from NGINX to an upstream server, three of the elements (the first, third, and fourth) are fixed, leaving only the source port as a variable. When a connection is closed, the Linux socket sits in the TIME‑WAIT state for two minutes, which at high traffic volumes increases the possibility of exhausting the pool of available source ports. If that happens, NGINX cannot open new connections to upstream servers.

Extending port range in `/proc/sys/net/ipv4/ip_local_port_range` does not help much, so something else is needed.

## TEST 2 : custom nginx with keepalive

Code: https://github.com/Neamar/test-server/commit/89bc58d3e195a61c8ca5fbf0d6d224214cfca0ef#diff-649c1d1d510c39320e5b464c9e2758c468c4e1b4f7521a8950ac0018c99b00a9

Simply adding `keepalive 16` in the upstream block.

With 200 concurrent connections (twice as many as test 1), we get 12.6k RPS on average (mostly constant over all test). That's 300% more connections that can be served with a single line of change.

It doesn't exhaust available ports and remains at the same throughput.

Note: to enable keepalive, one should usually prevent nginx from sending "Connection: Close" headers.
It turns out the default nginx sigil has `proxy_set_header Connection $http_connection;`, which sends the value of the "Connection" header field. I think this is is here for websocket support (to send "upgrade?") but it also means by default, for standard HTTP connection, it'll be "".

As a side-note: I wonder if this could explain the poor performance and port exhaustion in the first test above: the connection isn't closed, but also isn't reused.

## TEST 3 : disable Nagle

Adding options to make nginx more lightweight (and better suited for modern web apps)

```
  sendfile           on;
  sendfile_max_chunk 1m;
  tcp_nopush on;
  tcp_nodelay       on;
```

Yields the same results as test 2, so probably not worth the risk.

## Scaling web worker

I switched back to "TEST 2", and tried with `ps:scale web=2`. I was able to run 300 concurrent connections at 19k RPS: it does not scale linearly, but I was also running the load test from the same server (16 core) and most CPUs were getting closer to 100 (3 CPUs at 100% for autocannon, 2CPUs at 100% for the node upstream app, and a bunch of nginx worker around 40% each).
