        function RegexLibraryTab(props) {
            const h = React.createElement;
            const sessionId = props.scope?.sessionId;
            const importInput = React.useRef(null);
            const [items, setItems] = React.useState(null);
            const [busy, setBusy] = React.useState(false);
            const [notice, setNotice] = React.useState("");
            const [error, setError] = React.useState("");
            const askConfirm = useTavernConfirm(sessionId);
            async function refresh() {
                setError("");
                try { setItems((await rpc("listRegexLibrary", {}, sessionId)).items); }
                catch (err) { setError(String(err.message || err)); }
            }
            React.useEffect(() => {
                refresh();
                const onData = event => { if (tavernDataChangeAffects(event, ["regex-library"], "regex-library")) refresh(); };
                window.addEventListener("dsh-tavern-data-changed", onData);
                return () => window.removeEventListener("dsh-tavern-data-changed", onData);
            }, [sessionId]);
            async function importFiles(files) {
                if (!files.length) return;
                setBusy(true); setError(""); setNotice("");
                let count = 0;
                try {
                    for (const file of files) count += (await rpc("importRegexLibrary", { text: await file.text(), fileName: file.name.replace(/\.json$/i, "") }, sessionId)).items.length;
                    setNotice("已导入 " + count + " 条正则。");
                } catch (err) { setError((count ? "已导入 " + count + " 条，其余失败：" : "") + String(err.message || err)); }
                finally { await refresh(); notifyTavernDataChanged(["regex-library"], "regex-library"); setBusy(false); }
            }
            async function remove(item) {
                if (!await askConfirm("从正则库删除“" + item.name + "”吗？\n已写入人物卡或预设的正则不受影响。")) return;
                setBusy(true); setError(""); setNotice("");
                try {
                    await rpc("deleteRegexLibrary", { id: item.id, expected: item }, sessionId);
                    await refresh();
                    notifyTavernDataChanged(["regex-library"], "regex-library");
                } catch (err) { setError(String(err.message || err)); }
                finally { setBusy(false); }
            }
            function code(label, value) {
                return [h("div", { key: label, className: "dsh-tavern-regex-label" }, label), h("pre", { key: label + "-code", className: "dsh-tavern-regex-code" }, value || "（空）")];
            }
            return h("div", { className: "dsh-tavern-user-profile" },
                h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "正则库"),
                    h("button", { className: "dsh-tavern-btn primary", disabled: busy, onClick: () => importInput.current && importInput.current.click() }, "导入正则"),
                    h("input", { ref: importInput, type: "file", multiple: true, accept: ".json,application/json", style: { display: "none" }, onChange: event => { const files = Array.from(event.target.files || []); event.target.value = ""; importFiles(files); } })),
                h("div", { className: "dsh-tavern-user-profile-body" },
                    h("p", { className: "dsh-tavern-settings-desc" }, "存放从原版酒馆导出的正则（JSON）。正则库里的正则不会生效；需要时告诉卡片 Agent，例如“把正则库里的某某正则写进这张人物卡”或“写进某某预设”。"),
                    error ? h("p", { role: "alert" }, error) : null,
                    notice ? h("p", { role: "status" }, notice) : null,
                    items === null ? h("p", null, "正在读取正则库…") : !items.length ? h("p", { className: "dsh-tavern-status-empty" }, "暂无正则。点击“导入正则”选择酒馆正则 JSON 文件，可多选。") : items.map(item =>
                        h("section", { key: item.id, className: "dsh-tavern-guide-library" },
                            h("div", { className: "dsh-tavern-guide-heading" }, h("h3", null, item.name)),
                            h("details", null, h("summary", null, "查看正则"),
                                code("查找正则", item.script.findRegex), code("替换内容", item.script.replaceString),
                                h("div", { className: "dsh-tavern-regex-meta" }, "作用位置 placement: " + JSON.stringify(item.script.placement || []) + (item.script.markdownOnly ? " · 仅显示" : "") + (item.script.promptOnly ? " · 仅提示词" : ""))),
                            h("div", { className: "dsh-tavern-guide-actions" },
                                h("button", { className: "dsh-tavern-btn danger", disabled: busy, onClick: () => remove(item) }, "删除"))))));
        }
