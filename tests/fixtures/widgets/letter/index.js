'use strict';
let token = '', hostOrigin = '';
function send(type, fields = {}) {
  if (token) parent.postMessage({ channel: 'dsh-widget', version: 2, token, type, ...fields }, hostOrigin);
}
function theme(tokens) {
  for (const [key, property] of Object.entries({surfaceText:'--gal-ui-ink',surface:'--gal-ui-surface-2',fontFamily:'--gal-ui-font',accent:'--gal-ui-accent'})) {
    if (typeof tokens?.[key] === 'string') document.documentElement.style.setProperty(property, tokens[key]);
  }
}
function render(props) {
  document.getElementById('body').textContent = props.body;
}
window.addEventListener('message', event => {
  if (event.source !== parent || !/^https?:\/\//.test(event.origin)) return;
  const data = event.data;
  if (!data || data.channel !== 'dsh-widget' || data.version !== 2 || typeof data.token !== 'string') return;
  if (token && (data.token !== token || event.origin !== hostOrigin)) return;
  if (data.type === 'init') {
    token = data.token; hostOrigin = event.origin;
    theme(data.theme); render(data.state);
    document.getElementById('signature').textContent = data.settings.signature || '';
    send('ready');
  } else if (!token) return;
  else if (data.type === 'update') render(data.state);
  else if (data.type === 'settings') document.getElementById('signature').textContent=data.settings?.signature || '';
  else if (data.type === 'theme') theme(data.theme);
  else if (data.type === 'hide') document.body.hidden = true;
});
document.getElementById('close').addEventListener('click', () => send('action',{action:'hide'}));
