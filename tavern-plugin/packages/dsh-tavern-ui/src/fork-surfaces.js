function installForkSurfaces(doc, presentation) {
    const style = doc.createElement('style'); style.dataset.forkSurfaces = '';
    const previous = doc.body.getAttribute('data-fk-context');
    doc.head.appendChild(style);
    function refresh() {
        const computed = getComputedStyle(doc.body), read = key => computed.getPropertyValue('--dsw-' + key).trim();
        const result = presentation.getSurfaceStyles({ bg: read('alias-bg-base') || read('specific-menu'), menu: read('specific-menu'), fg: read('alias-label-primary'), fgMuted: read('alias-label-secondary'), accent: read('alias-brand-primary') || read('alias-button-info-fill'), dark: computed.colorScheme === 'dark' || doc.documentElement.classList.contains('dark') });
        if (style.textContent !== result.css) style.textContent = result.css;
        if (doc.body.dataset.fkContext !== result.context) doc.body.dataset.fkContext = result.context;
    }
    refresh();
    const observer = new MutationObserver(records => {
        // Same-value attribute rewrites (classList.remove of an absent class) cannot change host colours,
        // nor can the stage cover marker; reading styles then would force a whole-page restyle mid-transition.
        if (records.some(record => record.target !== style && !style.contains(record.target)
            && (record.type !== 'attributes' || record.attributeName !== 'data-fork-gal-stage' && record.oldValue !== record.target.getAttribute(record.attributeName)))) refresh();
    });
    for (const node of [doc.documentElement, doc.body]) observer.observe(node, { attributes: true, attributeOldValue: true });
    observer.observe(doc.head, { childList: true, subtree: true, characterData: true });
    const media = matchMedia('(prefers-color-scheme: dark)'); media.addEventListener('change', refresh);
    return () => {
        observer.disconnect(); media.removeEventListener('change', refresh); style.remove();
        if (previous === null) doc.body.removeAttribute('data-fk-context'); else doc.body.setAttribute('data-fk-context', previous);
    };
}
