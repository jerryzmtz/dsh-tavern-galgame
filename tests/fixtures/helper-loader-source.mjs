export function helperLoaderBootstrap(html) {
  const match = html.match(/<script data-dsh-tavern-helper-loader>([\s\S]*?)<\/script>/)
  if (!match) throw new Error('Missing Helper loader bootstrap')
  return match[1]
}
export function helperLoaderSource(html) {
  return JSON.parse(helperLoaderBootstrap(html).match(/\}\)\((.*)\);$/)[1])
}
