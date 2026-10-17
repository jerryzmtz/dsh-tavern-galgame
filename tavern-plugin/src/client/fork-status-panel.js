// Private fork (docs/fork/ui-design.md): the play status side panel, redesigned.
// Rendering only. All state, RPC and rules stay in TavernStatusPanel; this module is
// included inside the play-controls feature module so it can reuse its components.

function ForkStatusTabIcon(props) {
    const h = React.createElement;
    const sessionId = React.useSyncExternalStore(function (fn) { return props.sessions.list.subscribe(fn); }, function () { return props.sessions.list.getSnapshot().current || ""; });
    const state = useLiveTavernView(sessionId);
    const settle = state && state.view && state.view.settleStatus;
    const label = settle === "running" ? "正在更新状态" : settle === "error" ? "状态更新失败，请打开酒馆状态重试" : "酒馆状态";
    return h("span", { className: "fork-status-tab-icon", "data-state": settle || "done", role: "img", "aria-label": label, title: label, style: { width: props.size, height: props.size } },
        settle === "running" ? h(ForkSpinner, { className: "fork-status-tab-spinner" })
            : settle === "error" ? h("span", { className: "fork-status-tab-error", "aria-hidden": true }, "!")
            : DshUi.IconGaugeOutline16 ? h(DshUi.IconGaugeOutline16, { size: props.size, width: props.size, height: props.size }) : null);
}

function ForkStatusPanelView(p) {
    const h = React.createElement;
    const view = p.view, running = p.running;
    // The composer's guide chip asks the panel to focus the guide input.
    React.useEffect(function () {
        function focus() { const node = p.guideInputRef.current; if (node) { node.scrollIntoView({ block: "center", behavior: "smooth" }); node.focus({ preventScroll: true }); } }
        window.addEventListener("dsh-fork-focus-guide", focus);
        return function () { window.removeEventListener("dsh-fork-focus-guide", focus); };
    }, []);
    const settle = view.settleStatus || "done";
    const guides = view.guides || [];
    const characters = view.characterDesigns && view.characterDesigns.characters || [];
    const designTask = view.characterDesignTask || {};
    // Upstream keeps card/worldbook reload available in every story/script game; only surface it as an alert when action is needed.
    const reloadable = ["story", "script"].includes(view.mode || "story") && view.requestMode !== "sillytavern" && view.cardUpdate ? view.cardUpdate : null;
    const update = reloadable && (reloadable.available || reloadable.worldbookSyncRequired || reloadable.legacy || reloadable.error) ? reloadable : null;
    const updateLabel = !update ? "" : update.error ? "世界书更新暂不可用：" + update.error
        : update.worldbookSyncRequired ? "旧存档需同步一次世界书版本" : update.legacy ? "此存档尚未记录人物卡版本"
        : update.worldbookChanged ? (update.cardChanged ? "人物卡与世界书有新版本" : "世界书有新版本") : "人物卡有新版本";
    const reloadDisabled = running || p.cardUpdateBusy || settle === "running" || !!(reloadable && reloadable.error);

    function section(key, title, extra, body) {
        return h("section", { key, className: "fork-status-section" },
            h("header", null, h("h3", null, title), extra || null), body);
    }
    function onGuideKey(event) {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent?.isComposing) { event.preventDefault(); p.addGuide(); }
    }

    return h("aside", { className: "dsh-tavern-status fork-status" },
        h("div", { className: "dsh-tavern-status-body fork-status-body" },
            // Alerts: one line each, action on the right.
            h(TavernBackgroundWait, { sessionId: p.props.sessionId, activity: view.activity }),
            h(TavernStorageMigration, { key: p.props.sessionId, sessionId: p.props.sessionId, busy: running || view.activity?.busy || settle === "running" }),
            h("nav", { className: "dsh-tavern-status-resource-links", "aria-label": "本局资料" },
                h("button", { type: "button", disabled: !view.card.path, onClick: () => p.props.openStyleTab("dsh-tavern:cards", { cardPath: view.card.path }) }, "打开人物卡 ↗"),
                h("button", { type: "button", disabled: !view.card.path || p.resourceLinkBusy || !p.currentResourceBinding || p.noWorldBook || p.unavailableWorldBook, onClick: p.openWorldBookDetail }, "打开世界书 ↗")),
            p.resourceLinkError ? h("p", { role: "status" }, p.resourceLinkError) : null,
            update ? h("div", { className: "fork-status-alert", "data-kind": update.error ? "error" : "info" },
                h("span", { title: "保留剧情和数值，替换本局世界书" }, updateLabel),
                update.error ? null : h("button", { type: "button", disabled: reloadDisabled, onClick: p.applyUpdatedCard }, p.cardUpdateBusy ? "加载中…" : "重新加载"),
                p.cardUpdateError ? h("div", { className: "fork-status-alert-detail", role: "alert" }, p.cardUpdateError) : null) : null,
            settle === "error" ? h("div", { className: "fork-status-alert", "data-kind": "error" },
                h("span", null, view.settleError || "后台结算失败"),
                h("button", { type: "button", disabled: p.settlementRetryBusy, onClick: p.retrySettlement }, p.settlementRetryBusy ? "重试中…" : "重试")) : null,
            view.worldBookError ? h("div", { className: "fork-status-alert", "data-kind": "error" }, h("span", null, "世界书召回失败：" + view.worldBookError)) : null,
            view.foregroundError ? h("div", { className: "fork-status-alert", "data-kind": "error" }, h("span", null, view.foregroundError.message || "正文生成失败，请重新生成本轮。")) : null,
            (view.presentationWarnings || []).map(function (warning, index) { return h("div", { key: "w" + index, className: "fork-status-alert", "data-kind": "warn" }, h("span", null, warning)); }),

            h(TavernCardAppDock, { sessionId: p.props.sessionId }),
            view.tavernHelper && view.statusBarPlacement !== "body" ? h("div", { className: "fork-status-card" },
                h(TavernPersistentStatusRuntime, { sessionId: p.props.sessionId, view: view, executeSlash: p.props.executeSlash })) : null,

            view.posture ? section("now", "此刻", null, h("p", { className: "fork-status-now" }, view.posture)) : null,

            view.mode === "script" && view.scriptProgress ? h(ScriptNavigation, { sessionId: p.props.sessionId, cursor: view.scriptProgress.cursor, total: view.scriptProgress.totalChunks, chunkSize: view.scriptProgress.chunkSize,
                    busy: running || view.activity?.busy || view.regenInProgress }) : null,

            section("guide", "Guide", h("span", { className: "fork-status-count", title: "Guide 会注入之后的正文、候选与变量结算" }, guides.length ? String(guides.length) : ""),
                h(React.Fragment, null,
                    guides.length ? h("ul", { className: "fork-status-guides" }, guides.map(function (guide, index) {
                        return h("li", { key: guide.id || index },
                            h("span", null, guide.text),
                            h("button", { type: "button", "aria-label": "删除这条指引", title: "删除", disabled: p.guideBusy, onClick: function () { p.removeGuide(guide, index); } }, "×"));
                    })) : null,
                    h("div", { className: "dsh-tavern-guide-actions" },
                        h("button", { type: "button", onClick: () => p.props.openStyleTab("dsh-tavern:guide-library") }, "打开 Guide 库 ↗"),
                        h("button", { type: "button", disabled: p.guideBusy || !guides.length, onClick: p.saveGuideLibrary }, "保存到 Guide 库")),
                    p.guideNotice ? h("p", { role: "status" }, p.guideNotice) : null,
                    h(ForkTextArea, { className: "fork-status-guide-input", inputRef: p.guideInputRef, "aria-label": "新 Guide 内容", rows: 1, maxLength: 2000, value: p.guideDraft, disabled: p.guideBusy,
                        placeholder: guides.length ? "再加一条…（回车保存）" : "例如：多写心理活动，对话不超过三句（回车保存）",
                        onChange: function (text) { p.setGuideDraft(text); }, onKeyDown: onGuideKey }),
                    p.guideError ? h("div", { className: "fork-status-alert", "data-kind": "error" }, h("span", null, p.guideError)) : null)),

            section("people", "人物档案",
                h("button", { type: "button", className: "fork-status-link", disabled: running || view.activity?.busy || designTask.status === "running",
                    title: "根据当前剧情设计或补充人物档案，可附加要求",
                    onClick: function () { p.designCharacter(designTask.status === "failed" ? designTask.guidance : ""); } },
                    designTask.status === "running" ? "设计中…" : designTask.status === "failed" ? "重试" : "＋ 设计"),
                h(React.Fragment, null,
                    designTask.status === "failed" ? h("div", { className: "fork-status-alert", "data-kind": "error", role: "alert" }, h("span", null, designTask.error)) : null,
                    designTask.status === "done" && designTask.published?.length ? h("p", { role: "status" }, "已写入世界书并同步到本局：" + designTask.published.join("、")) : null,
                    designTask.status === "done" && designTask.reused?.length ? h("p", { role: "status" }, "已复用本局世界书：" + designTask.reused.join("、") + "，未重复建立档案。") : null,
                    characters.length ? h("div", { className: "fork-status-people" }, characters.map(function (character, index) {
                        const summary = character.identity || character.narrativeRole || "";
                        const aliases = Array.isArray(character.aliases) && character.aliases.length ? character.aliases.join("、") : "";
                        return h(TavernLazyDetails, { key: character.name || index,
                            summary: h("summary", null, h("b", null, character.name), summary ? h("span", null, summary) : null),
                            render: () => h("div", { className: "fork-status-person" },
                                aliases ? h("p", null, h("em", null, "别名"), aliases) : null,
                                (character.sections || []).map(function (s) { return h("p", { key: s.key }, h("em", null, s.label), s.text); }),
                                h("button", { type: "button", className: "dsh-tavern-btn danger", disabled: Boolean(p.designRemoving) || running || designTask.status === "running", onClick: function () { void p.removeCharacterDesign(character.name); } }, p.designRemoving === character.name ? "删除中…" : "删除这个人物档案")) });
                    })) : h("p", { className: "fork-status-empty" }, "还没有人物档案"))),

            h(TavernPluginTasks, { sessionId: p.props.sessionId, activity: view.activity, busy: running || view.activity?.busy || view.activity?.phase === "pending" }),
            h(TavernLedger, { sessionId: p.props.sessionId, ledger: view.ledger, ledgerTask: view.ledgerTask, busy: running || view.activity?.busy }),

            h("footer", { className: "fork-status-foot" },
                h("details", { className: "fork-status-menu" },
                    h("summary", null, "调整文风"),
                    h("div", null,
                        h("button", { type: "button", onClick: function () { window.dispatchEvent(new CustomEvent("dsh-fork-focus-guide")); } }, "只改这一局", h("small", null, "写作指引")),
                        h("button", { type: "button", onClick: function () { p.props.openStyleTab("dsh-tavern:user-profile"); } }, "以后都这样", h("small", null, "用户画像")),
                        h("button", { type: "button", disabled: running, onClick: function () { window.dispatchEvent(new CustomEvent("dsh-tavern-adjust-card-style", { detail: { card: view.card } })); } }, "改这张卡", h("small", null, "卡片助手")),
                        h("button", { type: "button", onClick: function () { p.props.openStyleTab("dsh-tavern:presets"); } }, "换预设", h("small", null, "预设库")))),
                reloadable && !update ? h("button", { type: "button", className: "fork-status-link", disabled: reloadDisabled, onClick: p.applyUpdatedCard,
                    title: "从资源库重新加载人物卡与世界书：保留剧情和数值，替换本局世界书" }, p.cardUpdateBusy ? "加载中…" : "重新加载卡") : null,
                h("button", { type: "button", className: "fork-status-link", disabled: p.debugBusy || !p.latestDebugTurn, onClick: p.openDebugger,
                    title: "状态栏、正则、美化或内容不对时，把这一轮交给卡片 Agent 排查" }, p.debugBusy ? "打开中…" : "排查这张卡")))
    );
}
