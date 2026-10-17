// private fork: deterministic hook renderer for the extracted asset views (no browser globals).
export function assetRenderer() {
  const instances = new Map(), effects = []
  let active, cursor, root, props, tree
  const React = {
    Fragment:'Fragment',
    createElement:(type, props, ...children) => ({type, props:props || {}, children:children.flat(Infinity).filter(value => value != null && value !== false)}),
    useState(initial) {
      const slots = active, index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
    },
    useRef(initial) { return React.useState(() => ({current:initial}))[0] },
    useReducer(reduce, initial) { const [value, set] = React.useState(initial); return [value, action => set(before => reduce(before, action))] },
    useEffect(fn, deps) {
      const slots = active, index = cursor++, before = slots[index]
      if (!before || !deps || deps.some((value, i) => value !== before.deps?.[i])) {
        slots[index] = {deps, cleanup:before?.cleanup}
        effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = fn() })
      }
    },
    useLayoutEffect(fn, deps) { return React.useEffect(fn, deps) },
    useMemo(fn, deps) {
      const slots = active, index = cursor++, before = slots[index]
      if (!before || !deps || deps.some((value, i) => value !== before.deps?.[i])) slots[index] = {deps, value:fn()}
      return slots[index].value
    },
    useId:() => 'fixture-id'
  }
  function expand(node, path = 'root') {
    if (!node || typeof node !== 'object') return node
    if (typeof node.type === 'function') {
      const key = path + ':' + node.type.name + ':' + (node.props.key || '')
      if (!instances.has(key)) instances.set(key, [])
      active = instances.get(key); cursor = 0
      return expand(node.type({...node.props, children:node.children}), key)
    }
    return {...node, children:node.children.map((child, index) => expand(child, path + '/' + index))}
  }
  const render = (fn = root, input = props) => { root = fn; props = input; tree = expand(React.createElement(fn, input)); return tree }
  return {React, render, async settle() {
    for (let n = 0; n < 6; n++) { while (effects.length) effects.shift()(); await new Promise(resolve => setImmediate(resolve)); render() }
    return tree
  }, dispose() { for (const slots of instances.values()) for (const slot of slots) slot?.cleanup?.() }}
}
export const walk = tree => tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(walk), ...(tree.props.tools ? walk(tree.props.tools) : [])] : []
export const text = tree => tree && typeof tree === 'object' ? tree.children.map(text).join(' ').trim() : String(tree ?? '')
export const ui = {Section:'Section', Icon:'Icon', Help:'HelpTip', Popover:'Popover', Modal:'Modal'}
