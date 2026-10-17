'use strict';

function forkItemsStagePresentation() {
    return {
        kind:'dsh.items.item',
        media(performance) {
            return performance.payload.iconRef ? {image:{ref:performance.payload.iconRef,slot:'image'}} : {};
        },
        render(React, performance, media, {CutinCard}) {
            const value=performance.payload;
            const label={gain:'\u83b7\u5f97',lose:'\u5931\u53bb',show:'\u51fa\u793a'}[value.action];
            // No description in the payload: the subtitle is the genre label, or nothing. The icon slot is reserved while
            // the image loads so the showcase does not move when it arrives.
            return React.createElement(CutinCard,{tone:value.action,label,title:value.name,subtitle:value.genre || undefined,iconExpected:!!value.iconRef,
                amount:value.action!=='show' ? value.count : undefined,
                image:media.image ? React.createElement('img',{src:media.image,alt:'',onError:event=>{event.currentTarget.hidden=true;}}) : null});
        },
    };
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {forkItemsStagePresentation};
