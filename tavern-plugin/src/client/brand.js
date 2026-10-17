// The tavern shell owns the tab while it is mounted. Brand images reach the
// stylesheet through custom properties so tavern.css stays a verbatim asset.
// The icon link is appended last so it wins over the host icon; disposal
// restores the host icon.
function installTavernBrand(doc, urls) {
  const root = doc.documentElement;
  const properties = { '--dsh-tavern-logo': urls.logo, '--dsh-tavern-lockup': urls.lockup, '--dsh-tavern-lockup-dark': urls['lockup-dark'] };
  for (const [name, url] of Object.entries(properties)) root.style.setProperty(name, 'url("' + url + '")');
  const link = doc.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = urls.logo;
  link.dataset.plugin = 'dsh-tavern-plugin';
  doc.head.appendChild(link);
  // The host hardcodes its product name into document.title ("<session> — DeepSeek Harness").
  const hostTitle = 'DeepSeek Harness';
  function retitle() { if (doc.title.includes(hostTitle)) doc.title = doc.title.replace(hostTitle, 'DSH Tavern'); }
  const Observer = doc.defaultView && doc.defaultView.MutationObserver;
  const observer = Observer ? new Observer(retitle) : null;
  if (observer) observer.observe(doc.head, { childList: true, subtree: true, characterData: true });
  retitle();
  return function () {
    if (observer) observer.disconnect();
    link.remove();
    for (const name of Object.keys(properties)) root.style.removeProperty(name);
  };
}
