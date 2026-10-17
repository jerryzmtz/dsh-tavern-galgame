// One request per loaded client, including failure. No timers or retries.
function createHostCompatibilityNotice(load, storage) {
    let request;
    return {
        load: function () { return request || (request = Promise.resolve().then(load).then(result => result.compatibility).catch(() => null)); },
        dismissed: function (info) { try { return storage.getItem('dsh-tavern-host-dismissed') === (info.version || 'unknown'); } catch (_) { return false; } },
        dismiss: function (info) { try { storage.setItem('dsh-tavern-host-dismissed', info.version || 'unknown'); } catch (_) {} }
    };
}
const hostCompatibilityNotice = createHostCompatibilityNotice(function () { return rpc('getHostCompatibility'); }, {
    getItem: function (key) { return window.localStorage.getItem(key); },
    setItem: function (key, value) { window.localStorage.setItem(key, value); }
});
function TavernHostCompatibility() {
    const [info, setInfo] = React.useState(null);
    const [dismissed, setDismissed] = React.useState(false);
    React.useEffect(function () {
        let active = true;
        hostCompatibilityNotice.load().then(function (value) {
            if (!active || !value) return;
            setInfo(value); setDismissed(hostCompatibilityNotice.dismissed(value));
        });
        return function () { active = false; };
    }, []);
    if (!info) return null;
    // A verified host needs no sidebar line; mismatches and unread notices stay visible.
    if (info.status === 'verified' && !(info.message && !dismissed)) return null;
    return React.createElement('div', { className: 'dsh-tavern-update-status' },
        React.createElement('div', null, 'DSH 核心 ' + (info.version || '版本未知') + ' · ' + (info.status === 'verified' ? '适配' : '不适配') + ' · 唯一适配版本 ' + info.adaptedVersion),
        info.message && !dismissed ? React.createElement('div', { role: 'status' }, info.message,
            React.createElement('button', { type: 'button', className: 'dsh-tavern-btn', onClick: function () { hostCompatibilityNotice.dismiss(info); setDismissed(true); } }, '此版本不再提示')) : null);
}
