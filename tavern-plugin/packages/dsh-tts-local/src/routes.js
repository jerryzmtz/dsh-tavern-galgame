// Connection owns login-cookie authentication for the shared /api carrier.
// Keep a stricter same-origin check here, including read-only sensitive actions.
export function sameOrigin(request) {
  const url = new URL(request.url), origin = request.headers.get('origin'), site = request.headers.get('sec-fetch-site')
  // Connection's Fetch bridge deliberately uses http://dsh.internal, preserving Host.
  const authority = request.headers.get('host') || url.host
  if (site && site !== 'same-origin') return false
  return origin ? origin === 'http://' + authority || origin === 'https://' + authority : site === 'same-origin'
}
export function json(value, status = 200) { return Response.json(value, { status, headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'} }) }
export async function body(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw Object.assign(new Error(), {code:'INVALID_INPUT'})
  const reader = request.body?.getReader(); let size = 0; const chunks = []
  if (!reader) return {}
  try {
    while (true) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > 65536) throw new Error(); chunks.push(Buffer.from(value)) }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally { await reader.cancel().catch(() => {}) }
}
export function registerRoutes(ctx, prefix, dispatch, audio) {
  ctx.inject(['connection'], child => {
    const connection = child.get('connection')
    child.effect(() => connection.fetch.register({ path:prefix + '/control', methods:['POST'], requestBody:'streaming', fetch:request => handleControl(request, dispatch) }))
    if (audio) child.effect(() => connection.fetch.register({ path:prefix + '/audio', methods:['GET'], requestBody:'buffered', fetch:async request => {
      if (!sameOrigin(request)) return json({error:'FORBIDDEN'},403)
      try { const bytes = await audio(new URL(request.url).searchParams.get('ticket')); return new Response(bytes,{headers:{'Content-Type':'audio/wav','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}}) }
      catch { return json({error:'AUDIO_GONE'},410) }
    } }))
  })
}
export async function handleControl(request, dispatch) {
  if (!sameOrigin(request)) return json({error:'FORBIDDEN'},403)
  try { const input = await body(request); return json(await dispatch(input.method, input.args || {})) }
  catch (e) { return json({error: /^[A-Z_]+$/.test(e.code || '') ? e.code : 'REQUEST_FAILED'},400) }
}
