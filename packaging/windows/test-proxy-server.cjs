// Minimal HTTP/CONNECT proxy for installer network tests.
// Usage: node test-proxy-server.cjs <port> <host-log-file>
// Names are resolved with dns.Resolver (DNS servers, not the hosts file), so the proxy
// still reaches hosts that test-system-proxy.ps1 blackholes for direct connections.
// Each requested host name is appended once to the log file.
const http = require('node:http')
const net = require('node:net')
const fs = require('node:fs')
const { Resolver } = require('node:dns').promises

const [port, logFile] = process.argv.slice(2)
const resolver = new Resolver()
const seen = new Set()
const note = host => { if (!seen.has(host)) { seen.add(host); fs.appendFileSync(logFile, `${host}\n`) } }
const address = async host => (net.isIP(host) ? host : (await resolver.resolve4(host))[0])

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url)
    note(url.hostname)
    const upstream = http.request({ host: await address(url.hostname), port: url.port || 80, path: url.pathname + url.search,
      method: req.method, headers: req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res) })
    upstream.on('error', error => { res.writeHead(502); res.end(String(error)) })
    req.pipe(upstream)
  } catch (error) { res.writeHead(502); res.end(String(error)) }
})

server.on('connect', async (req, socket, head) => {
  const [host, targetPort] = req.url.split(':')
  note(host)
  socket.on('error', () => {})
  try {
    const upstream = net.connect(Number(targetPort) || 443, await address(host), () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head?.length) upstream.write(head)
      upstream.pipe(socket); socket.pipe(upstream)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('close', () => upstream.destroy())
  } catch { socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n') }
})

server.listen(Number(port), '127.0.0.1', () => fs.appendFileSync(logFile, '# listening\n'))
