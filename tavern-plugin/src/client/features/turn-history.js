		function TavernDockedPanel(props) {
			const ref = React.useRef(null);
			React.useLayoutEffect(function () {
				tavernPanelRegistry.dock(props.id, ref.current);
				return function () { tavernPanelRegistry.restore(props.id); };
			}, [props.id]);
			return React.createElement("div", { ref: ref });
		}
		function TavernPersistentStatusRuntime(props) {
			const entries = React.useSyncExternalStore(tavernPanelRegistry.subscribe, tavernPanelRegistry.inspect);
			const [selected, setSelected] = React.useState("");
			const [refreshes, setRefreshes] = React.useState({});
			const view = props.view;
			const statuses = view && isPlayMode(view.mode) ? (view.tavernStatusViews || []) : [];
			const manual = entries.filter(function (entry) { return entry.sessionId === props.sessionId && entry.pinned; });
			const newest = manual.reduce(function (latest, entry) { return !latest || entry.activation > latest.activation ? entry : latest; }, null);
			React.useEffect(function () { if (newest) setSelected(newest.id); }, [props.sessionId, newest && newest.activation]);
			const ids = statuses.map(function (panel) { return panel.viewId; }).concat(manual.map(function (entry) { return entry.id; }));
			const active = ids.includes(selected) ? selected : ids[0];
			if (!view || !view.tavernHelper || !ids.length) return null;
			const h = React.createElement;
			return h("section", { className: "dsh-tavern-status-runtime" + (ids.length === 1 ? " single-panel" : "") },
				h("div", { className: "dsh-tavern-panel-toolbar" }, ids.length > 1 ? h("div", { className: "dsh-tavern-panel-tabs", role: "tablist", "aria-label": "人物卡面板" },
					statuses.concat(manual.map(function (entry) { return { viewId: entry.id, title: entry.title }; })).map(function (panel) {
						return h("button", { key: panel.viewId, role: "tab", type: "button", "aria-selected": active === panel.viewId,
							className: "dsh-tavern-panel-tab", onClick: function () { setSelected(panel.viewId); } }, panel.title || "角色状态");
					})) : null,
                    statuses.some(panel => panel.viewId === active) ? h("button", { type: "button", className: "dsh-tavern-panel-refresh", "aria-label": "放大面板", title: "全屏查看此面板", onClick: function (event) { expandTavernFrame(event.currentTarget.closest(".dsh-tavern-status-runtime")?.querySelector('[role="tabpanel"]:not([hidden])')); } }, "⤢") : null,
                    statuses.some(panel => panel.viewId === active) ? h("button", { type: "button", className: "dsh-tavern-panel-refresh", "aria-label": "刷新状态", title: "重新加载此面板，未保存的输入会清空", onClick: function () { tavernRetainedFrames.invalidatePanel(props.sessionId, active); setRefreshes(function (previous) { return Object.assign({}, previous, { [active]: (previous[active] || 0) + 1 }); }); } }, "↻") : null),
				statuses.map(function (statusView) { return h("div", { key: props.sessionId + statusView.viewId, role: "tabpanel", hidden: active !== statusView.viewId,
					"data-status-view-id": statusView.viewId, "data-template-revision": statusView.templateRevision },
					h(TavernMessageFrame, {
					key: props.sessionId + statusView.viewId + (refreshes[statusView.viewId] || 0),
					content: String(statusView.content), sessionId: props.sessionId,
					turn: Math.max(1, Number(statusView.targetTurn) || 1), partIndex: Math.max(0, Number(statusView.sourcePartIndex) || 0),
					panelId: statusView.viewId, helperContext: view.tavernHelper,
                    frameSizing: view.tavernRuntimePolicy?.frameSizing,
					trustedCardMode: Boolean(view.tavernRuntimePolicy && view.tavernRuntimePolicy.trustedCardMode),
					eager: true, persistent: true, executeSlash: props.executeSlash,
					observeMvuView: false, runtimeReporting: true
				})); }),
				manual.map(function (entry) { return h("div", { key: entry.id, role: "tabpanel", hidden: active !== entry.id },
					h("button", { type: "button", className: "dsh-tavern-btn", onClick: function () { tavernPanelRegistry.pin(entry.id, false); } }, "返回正文栏"),
					h(TavernDockedPanel, { id: entry.id })); })
			);
		}

		function latestTavernAssistantMessageId(snapshot) {
			// alpha.2 keeps message projections on Chat, separate from Session lifecycle.
			const nodes = snapshot && snapshot.legacy && snapshot.legacy.nodes || [];
			for (let index = nodes.length - 1; index >= 0; index -= 1) {
				if (nodes[index].kind === "assistant" && nodes[index].messageId) return nodes[index].messageId;
			}
			return null;
		}

		// @include turn-error-controls.js

		// @include fork-debug.js






		// @include card-stage.js
        // private fork: shared physical sizing contract and candidate-only measurement.
        // @include-protocol fork-figure-scale.cjs
        // @include fork-figure-measure.js
		// @include fork-gal-motion.js
		// @include fork-gal-scene.js
// @include fork-gal-effects.js
		// @include fork-widget-definitions.cjs
		// @include fork-stage-widgets.cjs
		// @include fork-widget-sandbox.js
		// @include fork-gal-widgets.js
        // @include fork-cg-stage.js
		// @include fork-gal-stage.js
		// @include fork-gal-config.js
        // @include fork-danmaku-ui.js
		// @include fork-bgm-player.js
		// @include fork-gal-backlog.js

		function createSupersededErrorProjection(root) {
			const owned = new Map();
			function restore(row, previous) {
				row.hidden = previous.hidden;
				if (row.style) row.style.display = previous.display;
			}
			function dispose() {
				for (const [row, previous] of owned) restore(row, previous);
				owned.clear();
			}
			function apply(turns) {
				const hidden = new Set(turns.map(String));
				const rows = root.querySelectorAll('[data-chat-flow-kind]');
				const keep = new Set();
				let pending = [];
				let failedTurn = "";
				function flush(turn) {
					for (const row of pending) {
						const owner = row.getAttribute("data-chat-turn") || turn;
						if (!hidden.has(owner)) continue;
						keep.add(row);
						if (!owned.has(row)) owned.set(row, { hidden: row.hidden, display: row.style && row.style.display });
						row.hidden = true;
						// Native process rows update `hidden` themselves when folding.
						// Keep suppression independent of that presentation state.
						if (row.style) row.style.display = "none";
					}
					pending = [];
				}
				for (const row of rows) {
					pending.push(row);
					const kind = row.getAttribute("data-chat-flow-kind");
					if (kind !== "turn-error" && kind !== "turn-tail") { failedTurn = ""; continue; }
					// Legacy rows have message IDs, not turn IDs. The terminal error or
					// tail anchors the whole turn, including its input and reasoning.
					// A failed tail can be empty, so inherit its preceding error's turn.
					const key = row.getAttribute("data-chat-flow-key") || "";
					const prefix = kind.length + ":" + kind;
					const keyTurn = key.startsWith(prefix) ? key.slice(prefix.length) : "";
					const tail = kind === "turn-tail" && row.querySelector ? row.querySelector("[data-turn-tail]") : null;
					const turn = row.getAttribute("data-chat-turn") || row.getAttribute("data-turn-tail") || (tail && tail.getAttribute("data-turn-tail")) || (/^\d+$/.test(keyTurn) ? keyTurn : "") || (kind === "turn-tail" ? failedTurn : "");
					flush(turn);
					failedTurn = kind === "turn-error" ? turn : "";
				}
				// alpha has explicit ownership even before its tail is mounted.
				flush("");
				for (const [row, previous] of owned) {
					if (!keep.has(row)) { restore(row, previous); owned.delete(row); }
				}
			}
			return { apply: apply, dispose: dispose };
		}
		// One owner for persisted suppression and legacy browser-only history records.
		// Kept in the loader bundle so DSH needs no new browser module protocol.
		function createTurnHistoryProjection(options) {
			options = options || {};
			const root = options.root || function () { return document; };
			const storage = options.storage || function () { return window.localStorage; };
        const hiddenRows = new Map();
        function hideRow(row) {
            if (!hiddenRows.has(row)) hiddenRows.set(row, row.style.display);
            row.style.display = "none";
        }
        function restoreHiddenRows() {
            for (const [row, previous] of hiddenRows) {
                if (row.style.display === "none") row.style.display = previous;
            }
            hiddenRows.clear();
        }
		const HIDDEN_TURNS_KEY = "dsh-tavern-hidden-turns";
		const ROLLED_BACK_TURNS_KEY = "dsh-tavern-rolled-back-turns";
		const HIDDEN_REGEN_USER_TURNS_KEY = "dsh-tavern-hidden-regen-user-turns";
		function forgetHiddenTurn(storageKey, sessionId, turn) {
			try {
				const all = JSON.parse(storage().getItem(storageKey) || "{}");
				const list = Array.isArray(all[sessionId]) ? all[sessionId].filter(function (item) { return Number(item) !== Number(turn); }) : [];
				if (list.length) all[sessionId] = list;
				else delete all[sessionId];
				storage().setItem(storageKey, JSON.stringify(all));
			} catch (err) {}
		}
		// Rows of the same turn before its tail, nearest first. Every DSH conversation row
		// carries data-chat-flow-kind; anything without it (pagination, host controls)
		// is outside the conversation and ends the turn as surely as the previous tail.
		function turnRowsBefore(tail, owner) {
			const rows = [];
			for (let sib = tail.previousElementSibling; sib; sib = sib.previousElementSibling) {
				const kind = sib.getAttribute("data-chat-flow-kind");
				if (!kind || kind === "turn-tail") break;
				const siblingTurn = sib.getAttribute("data-chat-turn");
				if (owner && siblingTurn && siblingTurn !== owner) break;
				rows.push(sib);
			}
			return rows;
		}
		// Rows up to, but not including, the turn's user input.
		function turnReplyRowsBefore(tail, owner) {
			const rows = turnRowsBefore(tail, owner);
			const user = rows.findIndex(function (row) { return row.getAttribute("data-chat-flow-kind") === "user"; });
			return user === -1 ? rows : rows.slice(0, user);
		}
		function hideUserForTurnTail(tail) {
			if (!tail) return;
			const user = turnRowsBefore(tail, tailTurnOf(tail)).find(function (row) { return row.getAttribute("data-chat-flow-kind") === "user"; });
			if (user) hideRow(user);
		}
		function applyHiddenRegenUserTurns(sessionId) {
			try {
				const all = JSON.parse(storage().getItem(HIDDEN_REGEN_USER_TURNS_KEY) || "{}");
				const turns = all[sessionId];
				if (!Array.isArray(turns) || turns.length === 0) return;
				const set = new Set(turns.map(String));
				const tails = root().querySelectorAll('[data-chat-flow-kind="turn-tail"]');
				for (let i = 0; i < tails.length; i++) {
					const tail = tails[i];
					if (!set.has(tailTurnOf(tail))) continue;
					hideUserForTurnTail(tail);
				}
			} catch (err) {}
		}
		function hideTurnTail(el) {
			if (!el) return;
			hideRow(el);
			turnReplyRowsBefore(el, tailTurnOf(el)).forEach(hideRow);
		}
		function showTurnTail(el) {
			if (!el) return;
			el.style.display = "";
			turnReplyRowsBefore(el, tailTurnOf(el)).forEach(function (row) { row.style.display = ""; });
		}
		function hideTurnTailWithUser(el) {
			if (!el) return;
			hideRow(el);
			// System prompts precede the user row. Hide through the turn boundary,
			// not just through its input; alpha also supplies explicit ownership.
			turnRowsBefore(el, el.getAttribute("data-chat-turn")).forEach(hideRow);
		}
		function tailTurnOf(el) {
			if (!el) return "";
			if (el.getAttribute("data-chat-turn")) return el.getAttribute("data-chat-turn");
			if (el.getAttribute("data-turn-tail")) return el.getAttribute("data-turn-tail");
			const inner = el.querySelector("[data-turn-tail]");
			return inner ? inner.getAttribute("data-turn-tail") : "";
		}
		function applyHiddenTurns(sessionId) {
			try {
				const all = JSON.parse(storage().getItem(HIDDEN_TURNS_KEY) || "{}");
				const turns = all[sessionId];
				if (!Array.isArray(turns) || turns.length === 0) return;
				const set = new Set(turns.map(String));
				const tails = root().querySelectorAll('[data-chat-flow-kind="turn-tail"]');
				for (let i = 0; i < tails.length; i++) {
					const tail = tails[i];
					if (!set.has(tailTurnOf(tail))) continue;
					hideTurnTail(tail);
				}
			} catch (err) {}
		}
		function applyRolledBackTurns(sessionId) {
			try {
				const all = JSON.parse(storage().getItem(ROLLED_BACK_TURNS_KEY) || "{}");
				const turns = all[sessionId];
				if (!Array.isArray(turns) || turns.length === 0) return;
				const set = new Set(turns.map(String));
				const tails = root().querySelectorAll('[data-chat-flow-kind="turn-tail"]');
				for (let i = 0; i < tails.length; i++) {
					const tail = tails[i];
					if (!set.has(tailTurnOf(tail))) continue;
					hideTurnTailWithUser(tail);
				}
			} catch (err) {}
		}
		function applySuppressedDshTurns(turns, regeneratedDshTurns) {
			const set = new Set((Array.isArray(turns) ? turns : []).map(String));
			if (set.size === 0) return;
			const visibleRegenerations = new Set(Object.values(regeneratedDshTurns && typeof regeneratedDshTurns === "object" ? regeneratedDshTurns : {}).map(String));
			const tails = root().querySelectorAll('[data-chat-flow-kind="turn-tail"]');
			for (let i = 0; i < tails.length; i++) {
				const tail = tails[i];
				const turn = tailTurnOf(tail);
				if (!set.has(turn)) continue;
				if (visibleRegenerations.has(turn)) {
					showTurnTail(tail);
					hideUserForTurnTail(tail);
				} else hideTurnTailWithUser(tail);
			}
		}
		function applyRegeneratedDshTurns(regeneratedDshTurns) {
			const mappings = regeneratedDshTurns && typeof regeneratedDshTurns === "object" ? regeneratedDshTurns : {};
			const hiddenStoryTurns = new Set(Object.keys(mappings).map(String));
			if (hiddenStoryTurns.size === 0) return;
			const tails = root().querySelectorAll('[data-chat-flow-kind="turn-tail"]');
			for (let i = 0; i < tails.length; i++) {
				const tail = tails[i];
				if (hiddenStoryTurns.has(tailTurnOf(tail))) hideTurnTail(tail);
			}
		}
			function apply(sessionId, turns, regeneratedDshTurns) {
                // Reconcile both directions: an older observer may have hidden a
                // restored turn after the action's immediate DOM update.
                restoreHiddenRows();
				applySuppressedDshTurns(turns, regeneratedDshTurns);
				applyRegeneratedDshTurns(regeneratedDshTurns);
                // Native rows can mount without their turn tail. Explicit ownership
                // must remain authoritative during streaming and partial hydration.
                const suppressed = new Set((Array.isArray(turns) ? turns : []).map(String));
                const mappings = regeneratedDshTurns || {};
                const replacements = new Set(Object.values(mappings).map(String));
                for (const row of root().querySelectorAll('[data-chat-turn]')) {
                    const turn = row.getAttribute("data-chat-turn");
                    const kind = row.getAttribute("data-chat-flow-kind");
                    if (!kind) continue;
                    if (suppressed.has(turn) && (!replacements.has(turn) || kind === "user")) hideRow(row);
                    if (Object.prototype.hasOwnProperty.call(mappings, turn) && kind !== "user") hideRow(row);
                }
				applyHiddenTurns(sessionId);
				applyRolledBackTurns(sessionId);
				applyHiddenRegenUserTurns(sessionId);
                for (const row of root().querySelectorAll('[data-chat-flow-kind="context"]')) {
                    const source = row.querySelector('[data-context-source]');
                    if (source && source.textContent.trim() === "dsh-tavern-surface-restore") hideRow(row);
                }
			}
			function regenerated(sessionId, view, tail) {
				const adopted = view && view.adopted;
				if (adopted && Number(adopted.hiddenTurn) > 0) forgetHiddenTurn(HIDDEN_TURNS_KEY, sessionId, Number(adopted.hiddenTurn));
				if (adopted && Number(adopted.syntheticTurn) > 0) forgetHiddenTurn(HIDDEN_REGEN_USER_TURNS_KEY, sessionId, Number(adopted.syntheticTurn));
				apply(sessionId, view && view.suppressedDshTurns, view && view.regeneratedDshTurns);
			}
            function restored(sessionId, view) {
                const turn = Number(view && view.undoneRollback && view.undoneRollback.turn);
                const turns = [turn].concat(Object.values(view && view.regeneratedDshTurns || {})).map(String);
                for (const restoredTurn of turns) {
                    forgetHiddenTurn(ROLLED_BACK_TURNS_KEY, sessionId, restoredTurn);
                    forgetHiddenTurn(HIDDEN_TURNS_KEY, sessionId, restoredTurn);
                }
                const tails = root().querySelectorAll('[data-chat-flow-kind="turn-tail"]');
                for (const tail of tails) {
                    if (!turns.includes(tailTurnOf(tail))) continue;
                    tail.style.display = "";
                    turnRowsBefore(tail, tail.getAttribute("data-chat-turn")).forEach(function (row) { row.style.display = ""; });
                }
                apply(sessionId, view && view.suppressedDshTurns, view && view.regeneratedDshTurns);
            }
			function rolledBack(sessionId, view) {
				apply(sessionId, view && view.suppressedDshTurns, view && view.regeneratedDshTurns);
			}
			return Object.freeze({ apply: apply, regenerated: regenerated, rolledBack: rolledBack, restored: restored });
		}
		function applyBodyRegenerationResult(options) {
			options.liveTavernView.setView(options.sessionId, options.view);
			options.historyProjection.regenerated(options.sessionId, options.view, options.tail);
		}

		function resolveConversationChatBinding(uiConversation, binding) {
			if (uiConversation && typeof uiConversation.binding === "function") {
				return uiConversation.binding(binding).target("chat");
			}
			if (!binding || !binding.session || typeof binding.session.subscribe !== "function" || typeof binding.session.getSnapshot !== "function") {
				throw new Error("当前 DSHA 无法提供酒馆状态所需的对话消息");
			}
			return {
				subscribe: function (listener) { return binding.session.subscribe(listener); },
				getSnapshot: function () {
					const snapshot = binding.session.getSnapshot();
					if (!snapshot || !snapshot.chat) throw new Error("当前 DSHA 的对话消息尚未就绪");
					return snapshot.chat;
				}
			};
		}
