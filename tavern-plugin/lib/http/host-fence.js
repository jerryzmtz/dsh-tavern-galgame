// Opaque card frames are cross-site even for local resources; only Host is shared here.
export function isTrustedHostRequest(req) {
  const host = req.headers.host
  if (typeof host !== 'string') return false
  let url
  try { url = new URL('http://' + host) } catch { return false }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return false
  return url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(url.hostname)
}
