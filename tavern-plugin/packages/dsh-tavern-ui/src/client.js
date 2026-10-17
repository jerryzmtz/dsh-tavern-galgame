window.__ModuleLoader__.load({
    id: "dsh-tavern-ui",
    factory(require) {
        const React = require("react"), ReactDOM = require("react-dom");
        // Native modelDirectories resolves cold sessions in this consumer context.
        const inject = ["slots", "sessions", "theme", "modelDirectories", "remote", "remote.session", "tavernFonts", "tavernView", "tavernPresentation"];
        function apply(ctx) {
            const presentation = ctx.tavernPresentation;
            const ForkFontPicker = presentation.getFontPicker(), ForkHelpTip = presentation.getHelpTip(), ForkSpinner = presentation.getSpinner();
            // @include fork-shell.js
            // @include fork-appearance.js
            // @include fork-accessibility.js
            // @include fork-font-wheel.js
            // @include fork-model-control.js
            // @include fork-sidebar-nav.js
            // @include fork-composer-metrics.js
            // @include fork-surfaces.js
            ctx.effect(() => {
                const style = document.createElement("style");
                style.dataset.pluginCss = "dsh-tavern-ui/shell.css";
                style.textContent = __SHELL_CSS__;
                // Base Tavern CSS precedes shell overrides; feature CSS follows them.
                const features = document.querySelector('[data-plugin-css="dsh-tavern-plugin/features.css"]');
                document.head.insertBefore(style, features);
                document.body.classList.add("dsh-tavern-ui-active");
                return () => { style.remove(); document.body.classList.remove("dsh-tavern-ui-active"); };
            });
            ctx.effect(() => installForkSurfaces(document, presentation));
            ctx.effect(() => installForkAccessibility());
            ctx.effect(() => installForkFontWheel(ctx.theme));
            ctx.effect(() => installForkModelControl(ctx));
            ctx.effect(() => installForkAppearance(ctx));
            ctx.effect(() => installForkSidebarNav(ctx));
            const slots = ctx.slots;
            ctx.effect(() => slots.inject("tavern.sidebar.chrome", () => slots.register(
                { name: "tavern.sidebar.chrome", id: "theme-menu" },
                () => React.createElement(ForkThemeMenuDock, { theme: ctx.theme })
            )));
            ctx.effect(() => slots.inject("settings.tavern.appearance", () => slots.register(
                { name: "settings.tavern.appearance", id: "ui-size" }, ForkUiSizeSetting
            )));
            ctx.effect(() => slots.inject("conversation.input.right", () => slots.register(
                { name: "conversation.input.right", id: "dsh-fork-composer-metrics", order: 100 },
                props => React.createElement(ForkComposerMetrics, Object.assign({}, props, { presentation }))
            )));
            ctx.effect(() => slots.inject("conversation.session.header.utilities", () => slots.register(
                { name: "conversation.session.header.utilities", id: "dsh-fork-session-marker", order: -200 },
                props => React.createElement(ForkSessionMarker, { key: props.sessionId, sessionId: props.sessionId, view: ctx.tavernView })
            )));
        }
        return { name: "dsh-tavern-ui-client", inject, apply };
    }
});
