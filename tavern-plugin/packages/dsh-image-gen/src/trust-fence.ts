import type { IncomingMessage } from 'node:http'

/** DSH Host/Fetch-Metadata fence for the plugin's raw webServer routes. */
export function isTrustedApiRequest(req: IncomingMessage, trustedHosts: readonly string[] = []): boolean {
  const host = req.headers.host
  if (typeof host !== 'string' || req.headers['sec-fetch-site'] === 'cross-site') return false
  let url: URL
  try { url = new URL('http://' + host) } catch { return false }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return false
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(url.hostname)
  if (!loopback && !trustedHosts.some(entry => {
    const trusted = new URL('http://' + entry)
    const port = trusted.port || new URL('https://' + entry).port
    return port ? trusted.host === url.host : trusted.hostname === url.hostname
  })) return false
  const origin = req.headers.origin
  return origin === undefined || origin === 'http://' + host || origin === 'https://' + host
}
