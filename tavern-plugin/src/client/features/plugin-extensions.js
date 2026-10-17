		// Browser half of the public plugin API (docs/plugin-api.md): the `tavernUi`
		// service, plugin media under assistant text, markers and plugin buttons.
		// Only additive changes: published plugins depend on these names.
		// @include-domain plugin-text-segments.js

		function createTavernUiExtensions() {
			const mediaRenderers = new Map();
			const markers = [];
			const messageActions = [];
			const composerActions = [];
			const panels = new Map();
			const startGroups = [];
			const listeners = new Set();
			// Tavern's own context, for the sidebar a plugin panel opens in (set at apply).
			let host = null;
			let version = 0;
			function changed() { version += 1; Array.from(listeners).forEach(function (listener) { listener(); }); }
			function ownerOf(service) {
				const ctx = service && service.ctx;
				const fiber = ctx && (ctx[Symbol.for("cordis.shadow")] ? Object.getPrototypeOf(ctx) : ctx).fiber;
				return String(fiber && fiber.name || "插件");
			}
			function owned(service, register, label) {
				const ctx = service && service.ctx;
				return ctx && typeof ctx.effect === "function" ? ctx.effect(register, label) : register();
			}
			function addTo(list, entry) {
				list.push(entry);
				changed();
				return function () { const index = list.indexOf(entry); if (index >= 0) { list.splice(index, 1); changed(); } };
			}
			function action(input, kind) {
				if (!input || typeof input.label !== "string" || !input.label.trim()) throw new TypeError(kind + " 需要 label");
				if (typeof input.run !== "function") throw new TypeError(kind + " 需要 run 函数");
				if (input.when !== undefined && typeof input.when !== "function") throw new TypeError(kind + " 的 when 必须是函数");
				return { id: String(input.id || input.label), label: input.label.trim(), when: input.when, run: input.run };
			}
			// The input box of a game open in this page, for setInput / submitInput.
			function composerFor(input, label) {
				if (!input || typeof input.gameId !== "string" || !input.gameId) throw new TypeError(label + " 需要 gameId");
				if (typeof input.text !== "string") throw new TypeError(label + " 需要 text 字符串");
				const scope = host && host.sessions && host.sessions.scope(input.gameId);
				const conversation = host && typeof host.get === "function" && host.get("conversation");
				if (!scope || !conversation) throw new Error("这一局没有在当前页面打开，无法使用输入框");
				return { input: conversation.input.for(scope), text: input.text };
			}
			const service = {
				ctx: undefined,
				apiVersion: 2,
				registerMediaRenderer(kind, render) {
					if (typeof kind !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,63}$/.test(kind)) throw new TypeError("只能为插件自定义的 <插件名>/<类型> 注册显示方式");
					if (typeof render !== "function") throw new TypeError("registerMediaRenderer 需要 render 函数");
					const entry = { owner: ownerOf(this), render: render };
					return owned(this, function () {
						mediaRenderers.set(kind, entry);
						changed();
						return function () { if (mediaRenderers.get(kind) === entry) { mediaRenderers.delete(kind); changed(); } };
					}, "tavernUi.registerMediaRenderer()");
				},
				registerTextMarker(input) {
					if (!input || !(input.pattern instanceof RegExp)) throw new TypeError("registerTextMarker 需要正则 pattern");
					if (typeof input.render !== "function") throw new TypeError("registerTextMarker 需要 render 函数");
					const entry = { owner: ownerOf(this), pattern: input.pattern, render: input.render };
					return owned(this, function () { return addTo(markers, entry); }, "tavernUi.registerTextMarker()");
				},
				registerMessageAction(input) {
					const entry = Object.assign({ owner: ownerOf(this) }, action(input, "registerMessageAction"));
					return owned(this, function () { return addTo(messageActions, entry); }, "tavernUi.registerMessageAction()");
				},
				registerComposerAction(input) {
					const entry = Object.assign({ owner: ownerOf(this) }, action(input, "registerComposerAction"));
					return owned(this, function () { return addTo(composerActions, entry); }, "tavernUi.registerComposerAction()");
				},
				// Call a host handler registered with tavern.handle(name, handler); JSON in, JSON out.
				callHost(name, args) {
					if (typeof name !== "string" || !name) return Promise.reject(new TypeError("callHost 需要处理函数的名字"));
					return rpc("callPluginHandler", { name: name, args: args === undefined ? {} : args }).then(function (reply) { return reply ? reply.result : null; });
				},
				// A sidebar page of the plugin's own, for the game open beside it (apiVersion 2).
				registerPanel(input) {
					if (!input || typeof input.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(input.id)) throw new TypeError("registerPanel 的 id 只能用小写字母、数字、点、下划线和连字符");
					if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 40) throw new TypeError("registerPanel 需要 1–40 字的 title");
					if (typeof input.render !== "function") throw new TypeError("registerPanel 需要 render 函数");
					const owner = ownerOf(this);
					const tabId = "tavern-plugin:" + owner + ":" + input.id;
					const render = input.render, title = input.title.trim();
					return owned(this, function () {
						if (panels.has(tabId)) throw new Error("面板 " + input.id + " 已注册");
						if (!host || !host.betterSidebar || typeof host.betterSidebar.registerTab !== "function") throw new Error("当前界面没有侧栏，无法注册插件面板");
						// private fork (tab icons, owner 2026-10): a plugin panel's tab carries the host plugin glyph like every other tab.
						const PluginIcon = DshUi && DshUi.IconCordisPluginOutline14;
						const dispose = host.betterSidebar.registerTab({ id: tabId, title: title, order: 60, single: true,
							...(PluginIcon ? { icon: function (size) { return React.createElement(PluginIcon, { size: size || 16, width: size || 16, height: size || 16 }); } } : {}),
							component: function (props) {
								const gameId = props.scope && props.scope.sessionId || "";
								return React.createElement(tavernPluginBoundary(), { owner: owner, fallback: React.createElement("p", { className: "dsh-tavern-plugin-panel-error" }, "插件 " + owner + " 的面板出错了") },
									gameId ? render({ gameId: gameId, visible: props.visible !== false }) : React.createElement("p", { className: "dsh-tavern-plugin-panel-empty" }, "请先打开一局游戏。"));
							} });
						panels.set(tabId, owner);
						changed();
						return function () { if (typeof dispose === "function") dispose(); panels.delete(tabId); changed(); };
					}, "tavernUi.registerPanel()");
				},
				// URL of a file in the plugin folder's assets/ (images, maps, sounds, fonts).
				assetUrl(file) {
					if (typeof file !== "string" || !file || file.split("/").some(function (part) { return !part || part === "." || part === ".." || part.charAt(0) === "."; })) throw new TypeError("assetUrl 需要 assets/ 下的相对路径，例如 'map/forest.png'");
					return "/api/dsh-tavern/plugin-assets/" + ownerOf(this).split("/").map(encodeURIComponent).join("/") + "/" + file.split("/").map(encodeURIComponent).join("/");
				},
				// Where a game stands now (apiVersion 2): latest turn and whether a reply or settlement runs.
				getTurnState(gameId) {
					if (typeof gameId !== "string" || !gameId) return Promise.reject(new TypeError("getTurnState 需要 gameId"));
					return rpc("pluginTurnState", {}, gameId).then(function (reply) { return reply ? reply.state : null; });
				},
				// Calls listener with the state now and after every change, while that game is open here.
				watchTurnState(gameId, listener) {
					if (typeof gameId !== "string" || !gameId) throw new TypeError("watchTurnState 需要 gameId");
					if (typeof listener !== "function") throw new TypeError("watchTurnState 需要 listener 函数");
					const owner = ownerOf(this), getTurnState = service.getTurnState;
					return owned(this, function () {
						let disposed = false, queued = false, last = "", running;
						function refresh() {
							if (queued || disposed) return;
							queued = true;
							Promise.resolve().then(function () { queued = false; return disposed ? null : getTurnState(gameId); }).then(function (state) {
								const text = JSON.stringify(state);
								if (disposed || !state || text === last) return;
								last = text;
								try { listener(state); } catch (error) { try { tavernErrorHub.report("插件 " + owner, error); } catch (_) {} }
							}, function () {});
						}
						const list = host && host.sessions && host.sessions.list;
						// The session list changes while text streams; only a start or stop of this game matters.
						const stopSessions = list && typeof list.subscribe === "function" ? list.subscribe(function () {
							const next = list.getSnapshot().byId[gameId]?.running === true;
							if (next !== running) { running = next; refresh(); }
						}) : function () {};
						const stopView = liveTavernView.subscribe(gameId, refresh, [["latestAssistantTurn"], ["activity"], ["settlementTurn"], ["settleStatus"]]);
						return function () { disposed = true; stopView(); if (typeof stopSessions === "function") stopSessions(); };
					}, "tavernUi.watchTurnState()");
				},
				// Put text in the game's input box without sending it.
				setInput(input) {
					const composer = composerFor(input, "setInput");
					composer.input.setDraft(composer.text);
				},
				// Send text as the player's input; queued behind a reply already being written.
				submitInput(input) {
					let composer;
					try { composer = composerFor(input, "submitInput"); } catch (error) { return Promise.reject(error); }
					if (!composer.text.trim()) return Promise.reject(new TypeError("submitInput 的 text 不能为空"));
					composer.input.setDraft(composer.text);
					return Promise.resolve(composer.input.submit("queue")).then(function () { return { submitted: true }; });
				},
				// A layer over the whole page for the plugin's own screen (a battle, a map). Escape closes it
				// unless dismissible is false; it closes by itself when the plugin unloads.
				openOverlay(input) {
					if (!input || typeof input.render !== "function") throw new TypeError("openOverlay 需要 render 函数");
					if (input.onClose !== undefined && typeof input.onClose !== "function") throw new TypeError("openOverlay 的 onClose 必须是函数");
					if (typeof document === "undefined") throw new Error("当前环境没有页面，无法打开插件界面");
					const owner = ownerOf(this);
					let cleanup = function () {}, dispose = null;
					const handle = { close: function () { if (typeof dispose === "function") dispose(); else cleanup(); } };
					dispose = owned(this, function () {
						const container = document.createElement("div");
						container.className = "dsh-tavern-plugin-overlay";
						container.setAttribute("role", "dialog");
						container.setAttribute("aria-modal", "true");
						document.body.append(container);
						const root = require("react-dom/client").createRoot(container);
						let closed = false;
						function onKey(event) { if (event.key === "Escape" && input.dismissible !== false) { event.stopPropagation(); handle.close(); } }
						document.addEventListener("keydown", onKey, true);
						cleanup = function () {
							if (closed) return;
							closed = true;
							document.removeEventListener("keydown", onKey, true);
							root.unmount();
							container.remove();
							if (input.onClose) try { input.onClose(); } catch (error) { try { tavernErrorHub.report("插件 " + owner, error); } catch (_) {} }
						};
						const h = React.createElement;
						const fallback = h("div", { className: "dsh-tavern-plugin-overlay-error" }, "插件 " + owner + " 的界面出错了",
							h("button", { type: "button", onClick: handle.close }, "关闭"));
						function Screen() { return input.render({ gameId: String(input.gameId || ""), close: handle.close }); }
						root.render(h(tavernPluginBoundary(), { owner: owner, fallback: fallback }, h(Screen)));
						return function () { cleanup(); };
					}, "tavernUi.openOverlay()");
					return handle;
				},
				// A group of the plugin's own on the sidebar start page; tabs not in any group stay under 「插件」 or 「其他」.
				registerStartGroup(input) {
					if (!input || typeof input.title !== "string" || !input.title.trim() || input.title.trim().length > 20) throw new TypeError("registerStartGroup 需要 1–20 字的 title");
					if (!Array.isArray(input.tabs) || !input.tabs.length || input.tabs.length > 20 || !input.tabs.every(function (tab) { return typeof tab === "string" && tab.length > 0 && tab.length <= 160; })) throw new TypeError("registerStartGroup 的 tabs 需要 1–20 个侧栏页 id");
					const owner = ownerOf(this);
					// A bare id names the plugin's own registerPanel page; anything with ":" is a sidebar tab id as registered.
					const entry = { owner: owner, title: input.title.trim(), tabs: input.tabs.map(function (tab) { return tab.indexOf(":") >= 0 ? tab : "tavern-plugin:" + owner + ":" + tab; }) };
					return owned(this, function () { return addTo(startGroups, entry); }, "tavernUi.registerStartGroup()");
				}
			};
			Object.defineProperty(service, Symbol.for("cordis.tracker"), { value: { associate: "tavernUi", property: "ctx" } });
			return {
				service: service,
				attachHost: function (ctx) { host = ctx; },
				subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener); }; },
				getSnapshot: function () { return version; },
				mediaRenderer: function (kind) { return mediaRenderers.get(kind); },
				markers: function () { return markers.slice(); },
				messageActions: function () { return messageActions.slice(); },
				composerActions: function () { return composerActions.slice(); },
				startGroups: function () { return startGroups.map(function (group) { return { title: group.title, tabs: group.tabs.slice() }; }); }
			};
		}
		const tavernUiExtensions = createTavernUiExtensions();
		function useTavernUiExtensions() {
			return React.useSyncExternalStore(tavernUiExtensions.subscribe, tavernUiExtensions.getSnapshot, tavernUiExtensions.getSnapshot);
		}

		// Created on first use: React is the host's, not available at bundle load.
		let tavernPluginBoundaryClass = null;
		function tavernPluginBoundary() {
			if (tavernPluginBoundaryClass) return tavernPluginBoundaryClass;
			tavernPluginBoundaryClass = class TavernPluginBoundary extends React.Component {
				constructor(props) { super(props); this.state = { failed: false }; }
				static getDerivedStateFromError() { return { failed: true }; }
				componentDidCatch(error) { try { tavernErrorHub.report("插件 " + this.props.owner, error); } catch (_) {} }
				render() { return this.state.failed ? (this.props.fallback === undefined ? null : this.props.fallback) : this.props.children; }
			};
			return tavernPluginBoundaryClass;
		}

		// Per-session index of turns holding plugin items; refreshed by the host signal.
		const tavernPluginMediaIndex = (function () {
			const entries = new Map();
			function entryFor(sessionId) {
				let entry = entries.get(sessionId);
				if (entry) return entry;
				entry = { turns: new Set(), version: 0, listeners: new Set(), stop: null, revision: 0 };
				entries.set(sessionId, entry);
				return entry;
			}
			async function refresh(sessionId) {
				const entry = entryFor(sessionId);
				const requested = ++entry.revision;
				try {
					const result = await rpc("pluginMediaTurns", {}, sessionId);
					if (requested !== entry.revision) return;
					entry.turns = new Set((result.turns || []).map(Number));
				} catch (_) { if (requested !== entry.revision) return; }
				entry.version += 1;
				Array.from(entry.listeners).forEach(function (listener) { listener(); });
			}
			function subscribe(sessionId, listener) {
				const entry = entryFor(sessionId);
				entry.listeners.add(listener);
				if (!entry.stop) {
					let stop = function () {};
					try {
						if (tavernSessionSignals && typeof tavernSessionSignals.subscribe === "function") {
							stop = tavernSessionSignals.subscribe(sessionId, "plugin-media", function () { void refresh(sessionId); });
						}
					} catch (_) {}
					entry.stop = stop;
					void refresh(sessionId);
				}
				return function () {
					entry.listeners.delete(listener);
					if (!entry.listeners.size) { entry.stop(); entries.delete(sessionId); }
				};
			}
			return {
				subscribe: subscribe,
				version: function (sessionId) { return entries.get(sessionId) ? entries.get(sessionId).version : 0; },
				has: function (sessionId, turn) { return Boolean(entries.get(sessionId) && entries.get(sessionId).turns.has(Number(turn))); }
			};
		})();

		function useTavernPluginMedia(sessionId, turn, enabled) {
			const subscribe = React.useCallback(function (listener) { return sessionId ? tavernPluginMediaIndex.subscribe(sessionId, listener) : function () {}; }, [sessionId]);
			const indexVersion = React.useSyncExternalStore(subscribe, function () { return tavernPluginMediaIndex.version(sessionId); });
			const wanted = Boolean(enabled && sessionId && turn > 0 && tavernPluginMediaIndex.has(sessionId, turn));
			const [state, setState] = React.useState({ key: null, items: [] });
			React.useEffect(function () {
				let active = true;
				if (!wanted) { setState({ key: null, items: [] }); return; }
				rpc("pluginMediaForTurn", { turn: turn }, sessionId).then(function (result) {
					if (active) setState({ key: result.key || null, items: Array.isArray(result.items) ? result.items : [] });
				}, function () {});
				return function () { active = false; };
			}, [sessionId, turn, wanted, indexVersion]);
			return state;
		}

		function tavernPluginMediaUrl(sessionId, item) {
			return "/api/dsh-tavern/plugin-media?" + new URLSearchParams({ sessionId: sessionId, id: item.id, v: String(item.updatedAt || "") }).toString();
		}

		function TavernPluginMediaItem(props) {
			useTavernUiExtensions();
			const h = React.createElement;
			const item = props.item;
			const caption = item.caption ? h("figcaption", null, item.caption) : null;
			let body;
			if (item.kind.indexOf("/") > 0) {
				const renderer = tavernUiExtensions.mediaRenderer(item.kind);
				if (!renderer) return null;
				body = h(tavernPluginBoundary(), { owner: renderer.owner }, renderer.render({ item: Object.assign({}, item, { url: item.attachment ? tavernPluginMediaUrl(props.sessionId, item) : "" }), gameId: props.sessionId, turn: props.turn }));
			} else if (item.status === "pending") {
				body = h("div", { className: "dsh-tavern-plugin-media-pending", role: "status" }, typeof item.progress === "number" ? "生成中… " + Math.round(item.progress * 100) + "%" : "生成中…");
			} else if (item.status === "failed") {
				body = h("div", { className: "dsh-tavern-plugin-media-failed", role: "status" }, item.error ? "生成失败：" + item.error : "生成失败");
			} else if (item.attachment) {
				const url = tavernPluginMediaUrl(props.sessionId, item);
				if (item.kind === "image") body = h("a", { href: url, "aria-label": "放大插图", onClick: function (event) { event.preventDefault(); openSceneImagePreview(url, event.currentTarget); } }, h("img", { src: url, alt: item.caption || "插图", loading: "lazy" }));
				else if (item.kind === "video") body = h("video", { src: url, controls: true, preload: "metadata", playsInline: true });
				else body = h("audio", { src: url, controls: true, preload: "metadata" });
			}
			if (!body) return null;
			return h("figure", { className: "dsh-tavern-plugin-media dsh-tavern-illustration", "data-kind": item.kind, "data-owner": item.owner }, body, caption);
		}

		function TavernPluginMarker(props) {
			const marker = props.marker;
			const fallback = React.createElement("span", null, props.match[0]);
			let rendered;
			try {
				rendered = marker.render({ match: props.match[0], groups: props.match.slice(1), gameId: props.sessionId, turn: props.turn, streaming: Boolean(props.streaming) });
			} catch (error) {
				try { tavernErrorHub.report("插件 " + marker.owner, error); } catch (_) {}
				return fallback;
			}
			if (rendered === null || rendered === undefined) return fallback;
			return React.createElement(tavernPluginBoundary(), { owner: marker.owner, fallback: fallback }, rendered);
		}

		/**
		 * Context for renderTavernAssistantBlocks: which markers apply and which
		 * media still needs a place. `placed` collects anchored ids during render.
		 */
		function createTavernPluginTextContext(input) {
			const markers = tavernUiExtensions.markers();
			// `extras` are Tavern's own anchored elements (the built-in scene picture).
			const extras = new Map((input.extras || []).filter(function (extra) { return extra.anchor; }).map(function (extra) { return [extra.id, extra]; }));
			const anchored = input.items.filter(function (item) { return item.anchor; }).concat(Array.from(extras.values()));
			if (!markers.length && !anchored.length) return null;
			const byId = new Map(input.items.map(function (item) { return [item.id, item]; }));
			const placed = new Set();
			const anchors = input.streaming ? [] : anchored.map(function (item) { return { id: item.id, anchor: item.anchor }; });
			return {
				placed: placed,
				render: function (text, key, renderText) {
					const result = segmentPluginText(text, { markers: markers.map(function (marker) { return marker.pattern; }), anchors: anchors.filter(function (anchor) { return !placed.has(anchor.id); }) });
					result.placed.forEach(function (id) { placed.add(id); });
					if (result.segments.length === 1 && result.segments[0].kind === "text") return renderText(text, key, 0);
					// Private fork: retain source coordinates; media consumes no source text.
					let sourceOffset = 0;
					return React.createElement(React.Fragment, { key: key }, result.segments.map(function (segment, index) {
						const offset = sourceOffset;
						if (segment.kind === "text") { sourceOffset += segment.text.length; return renderText(segment.text, index, offset); }
						if (segment.kind === "marker") sourceOffset += segment.match[0].length;
						if (segment.kind === "media") return React.createElement(React.Fragment, { key: index }, segment.ids.map(function (id) {
							if (extras.has(id)) return React.createElement(React.Fragment, { key: id }, extras.get(id).render());
							return React.createElement(TavernPluginMediaItem, { key: id, item: byId.get(id), sessionId: input.sessionId, turn: input.turn });
						}));
						return React.createElement(TavernPluginMarker, { key: index, marker: markers[segment.marker], match: segment.match, sessionId: input.sessionId, turn: input.turn, streaming: input.streaming });
					}));
				},
				renderHtmlMarkers: function (html) {
					if (!markers.length) return { html: html, after: null };
					const extracted = extractPluginMarkers(html, markers.map(function (marker) { return marker.pattern; }));
					if (!extracted.markers.length) return { html: html, after: null };
					return { html: extracted.html, after: extracted.markers.map(function (segment, index) {
						return React.createElement(TavernPluginMarker, { key: "marker:" + index, marker: markers[segment.marker], match: segment.match, sessionId: input.sessionId, turn: input.turn, streaming: input.streaming });
					}) };
				}
			};
		}

		function TavernPluginActionButtons(props) {
			useTavernUiExtensions();
			const [busy, setBusy] = React.useState("");
			const context = props.context;
			const visible = props.actions.filter(function (entry) {
				if (!entry.when) return true;
				try { return Boolean(entry.when(Object.assign({}, context))); }
				catch (error) { try { tavernErrorHub.report("插件 " + entry.owner, error); } catch (_) {} return false; }
			});
			if (!visible.length) return null;
			return React.createElement("div", { className: props.className },
				visible.map(function (entry) {
					const key = entry.owner + ":" + entry.id;
					return React.createElement("button", { key: key, type: "button", className: props.buttonClassName, title: entry.owner, disabled: Boolean(busy) || props.disabled, onClick: async function () {
						setBusy(key);
						try { await entry.run(Object.assign({}, context)); }
						catch (error) { tavernErrorHub.report("插件 " + entry.owner, error); }
						finally { setBusy(""); }
					} }, busy === key ? entry.label + "…" : entry.label);
				}));
		}

		function TavernPluginMessageActions(props) {
			useTavernUiExtensions();
			const actions = tavernUiExtensions.messageActions();
			if (!actions.length) return null;
			return React.createElement(TavernPluginActionButtons, { actions: actions, className: "dsh-tavern-plugin-message-actions", buttonClassName: "dsh-tavern-btn",
				context: { gameId: props.sessionId, turn: props.turn, settled: props.settled } });
		}

		function TavernPluginComposerActions(props) {
			useTavernUiExtensions();
			const actions = tavernUiExtensions.composerActions();
			if (!actions.length) return null;
			return React.createElement(TavernPluginActionButtons, { actions: actions, className: "dsh-tavern-plugin-composer-actions", buttonClassName: "dsh-tavern-choice-trigger",
				disabled: props.running, context: { gameId: props.sessionId, turn: props.turn, busy: Boolean(props.running) } });
		}
