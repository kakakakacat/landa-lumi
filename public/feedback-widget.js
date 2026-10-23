/*!
 * feedback-widget.js — drop-in floating feedback widget.
 * Sends a message + attachments straight to your inbox via Web3Forms.
 * Zero dependencies. Works on any static site.
 *
 * Usage — one script tag (data attributes configure it):
 *   <script src="/feedback-widget.js"
 *           data-access-key="YOUR_WEB3FORMS_KEY"
 *           data-site="My Site"
 *           data-accent="#ff4c61"></script>
 *
 * Features: floating button + modal, message + optional contact, paste
 * (screenshots), drag & drop and click to attach any files, per-file size
 * guard (Web3Forms free plan allows ≤5MB per file).
 */
(function () {
  "use strict";

  var script = document.currentScript;
  var CFG = {
    accessKey: (script && script.getAttribute("data-access-key")) || "",
    site: (script && script.getAttribute("data-site")) || document.title || "网站",
    accent: (script && script.getAttribute("data-accent")) || "#ff4c61",
    // Same-origin endpoint that stores attachments in R2 and returns links.
    // When empty, the file UI is hidden and only text is sent.
    uploadUrl: (script && script.getAttribute("data-upload-url")) || "",
    maxFileMB: Number((script && script.getAttribute("data-max-file-mb")) || 100),
    // Cloudflare Turnstile site key. When set, a human check is required.
    turnstileKey: (script && script.getAttribute("data-turnstile-key")) || "",
  };
  var ENDPOINT = "https://api.web3forms.com/submit";

  // ---------- styles (scoped with .fbw-) ----------
  var css =
    ".fbw-fab{position:fixed;right:22px;bottom:22px;z-index:2147483000;display:inline-flex;align-items:center;gap:8px;" +
    "padding:13px 18px;border:none;border-radius:999px;color:#fff;font-size:14.5px;font-weight:600;cursor:pointer;" +
    "font-family:-apple-system,BlinkMacSystemFont,system-ui,'PingFang SC','Microsoft YaHei',sans-serif;" +
    "background:var(--fbw-accent);box-shadow:0 12px 30px -8px var(--fbw-glow);transition:transform .22s cubic-bezier(.34,1.56,.64,1),box-shadow .25s}" +
    ".fbw-fab:hover{transform:translateY(-2px);box-shadow:0 18px 42px -8px var(--fbw-glow)}" +
    ".fbw-fab:active{transform:scale(.96)}" +
    ".fbw-overlay{position:fixed;inset:0;z-index:2147483001;display:flex;align-items:center;justify-content:center;padding:18px;" +
    "background:rgba(0,0,0,.5);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);opacity:0;transition:opacity .25s ease}" +
    ".fbw-overlay.fbw-show{opacity:1}" +
    ".fbw-modal{width:100%;max-width:480px;max-height:90vh;overflow:auto;border-radius:22px;padding:24px;color:#f5f5f7;" +
    "font-family:-apple-system,BlinkMacSystemFont,system-ui,'PingFang SC','Microsoft YaHei',sans-serif;" +
    "background:rgba(28,28,34,.85);border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(30px) saturate(160%);-webkit-backdrop-filter:blur(30px) saturate(160%);" +
    "box-shadow:0 40px 80px -30px rgba(0,0,0,.8);transform:translateY(16px) scale(.98);transition:transform .3s cubic-bezier(.22,1,.36,1)}" +
    ".fbw-overlay.fbw-show .fbw-modal{transform:none}" +
    ".fbw-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}" +
    ".fbw-head h3{margin:0;font-size:1.2rem;font-weight:650;letter-spacing:-.02em}" +
    ".fbw-x{border:none;background:rgba(255,255,255,.1);color:#f5f5f7;width:30px;height:30px;border-radius:50%;font-size:18px;cursor:pointer;line-height:1}" +
    ".fbw-x:hover{background:rgba(255,255,255,.2)}" +
    ".fbw-field{width:100%;box-sizing:border-box;margin-bottom:12px;padding:13px 14px;border-radius:13px;border:1px solid rgba(255,255,255,.12);" +
    "background:rgba(0,0,0,.28);color:#f5f5f7;font-size:14.5px;font-family:inherit;transition:border-color .2s,box-shadow .2s}" +
    ".fbw-field::placeholder{color:rgba(235,235,245,.4)}" +
    ".fbw-field:focus{outline:none;border-color:var(--fbw-accent);box-shadow:0 0 0 4px var(--fbw-ring)}" +
    "textarea.fbw-field{min-height:110px;resize:vertical}" +
    ".fbw-drop{border:1.5px dashed rgba(255,255,255,.22);border-radius:14px;padding:16px;text-align:center;color:rgba(235,235,245,.6);" +
    "font-size:13.5px;cursor:pointer;transition:border-color .2s,background .2s}" +
    ".fbw-drop:hover,.fbw-drop.fbw-over{border-color:var(--fbw-accent);background:var(--fbw-tint)}" +
    ".fbw-list{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}" +
    ".fbw-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:11px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);font-size:13px}" +
    ".fbw-item .fbw-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".fbw-item .fbw-sz{color:rgba(235,235,245,.5);font-size:12px;white-space:nowrap}" +
    ".fbw-item .fbw-rm{border:none;background:transparent;color:rgba(235,235,245,.6);cursor:pointer;font-size:16px;padding:0 2px}" +
    ".fbw-item .fbw-rm:hover{color:#fff}" +
    ".fbw-item.fbw-big{border-color:rgba(255,90,90,.5)}" +
    ".fbw-ts{margin-bottom:12px;width:100%;min-height:65px;display:flex;justify-content:center}" +
    ".fbw-ts iframe{max-width:100%}" +
    ".fbw-foot{display:flex;align-items:center;gap:12px;margin-top:16px}" +
    ".fbw-status{flex:1;font-size:12.5px;color:rgba(235,235,245,.6)}" +
    ".fbw-status.fbw-err{color:#ff8a8a}.fbw-status.fbw-ok{color:#7fe0a3}" +
    ".fbw-send{border:none;border-radius:13px;padding:12px 24px;color:#fff;font-weight:600;font-size:14.5px;cursor:pointer;font-family:inherit;" +
    "background:var(--fbw-accent);box-shadow:0 10px 26px -10px var(--fbw-glow);transition:transform .2s cubic-bezier(.34,1.56,.64,1),opacity .2s}" +
    ".fbw-send:hover{transform:translateY(-1px)}.fbw-send:active{transform:scale(.97)}.fbw-send:disabled{opacity:.6;cursor:default;transform:none}" +
    "@media (prefers-reduced-motion:reduce){.fbw-fab,.fbw-overlay,.fbw-modal,.fbw-send{transition:none}}";

  function hex2rgba(hex, a) {
    var h = hex.replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }

  function fmtSize(n) {
    var u = ["B", "KB", "MB", "GB"], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toFixed(1)) + " " + u[i];
  }

  // ---------- build DOM ----------
  var files = [];
  var overlay, modal, listEl, statusEl, sendBtn, fileInput, dropEl, msgEl, contactEl;

  // ---------- Cloudflare Turnstile (optional) ----------
  var tsWidgetId = null, tsReady = false, tsContainer = null;

  function loadTurnstile() {
    if (!CFG.turnstileKey || document.getElementById("fbw-ts-script")) return;
    window.__fbwTsReady = function () { tsReady = true; renderTurnstile(); };
    var s = document.createElement("script");
    s.id = "fbw-ts-script";
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__fbwTsReady";
    s.async = true; s.defer = true;
    document.head.appendChild(s);
  }
  function renderTurnstile() {
    if (!tsReady || !tsContainer || tsWidgetId !== null || !window.turnstile) return;
    try {
      tsWidgetId = window.turnstile.render(tsContainer, {
        sitekey: CFG.turnstileKey,
        theme: "dark",
        size: "flexible", // fill the container width so it never gets clipped
        retry: "auto",
        "error-callback": function () {
          setStatus("人机验证加载失败，请刷新或检查网络。", "err");
        },
      });
    } catch (e) {
      setStatus("人机验证加载失败：" + (e.message || e), "err");
    }
  }
  function turnstileToken() {
    if (!CFG.turnstileKey) return null; // verification not enabled
    return window.turnstile && tsWidgetId !== null ? window.turnstile.getResponse(tsWidgetId) : "";
  }
  function turnstileReset() {
    if (window.turnstile && tsWidgetId !== null) window.turnstile.reset(tsWidgetId);
  }

  function injectStyle() {
    var style = document.createElement("style");
    style.textContent =
      ":root{--fbw-accent:" + CFG.accent + ";--fbw-glow:" + hex2rgba(CFG.accent, 0.5) +
      ";--fbw-ring:" + hex2rgba(CFG.accent, 0.18) + ";--fbw-tint:" + hex2rgba(CFG.accent, 0.08) + "}" + css;
    document.head.appendChild(style);
  }

  function buildFab() {
    var fab = document.createElement("button");
    fab.className = "fbw-fab";
    fab.type = "button";
    fab.innerHTML = "✉️ 留言";
    fab.addEventListener("click", open);
    document.body.appendChild(fab);
  }

  function buildModal() {
    // File UI only appears when an upload endpoint is configured.
    var fileUI = CFG.uploadUrl
      ? '<div class="fbw-drop">📎 点击、拖拽或粘贴，添加图片 / 文件<br>' +
        '<span style="font-size:12px;opacity:.7">单个文件 ≤ ' + CFG.maxFileMB + "MB，随留言以链接发送</span></div>" +
        '<input type="file" multiple hidden />' +
        '<ul class="fbw-list"></ul>'
      : "";

    overlay = document.createElement("div");
    overlay.className = "fbw-overlay";
    overlay.innerHTML =
      '<div class="fbw-modal" role="dialog" aria-modal="true" aria-label="留言反馈">' +
      '<div class="fbw-head"><h3>给我留言</h3><button class="fbw-x" type="button" aria-label="关闭">×</button></div>' +
      '<textarea class="fbw-field fbw-msg" placeholder="写下你的想法、建议或问题…（可直接粘贴截图）"></textarea>' +
      '<input class="fbw-field fbw-contact" type="text" placeholder="你的邮箱或联系方式（选填，方便回复你）" />' +
      fileUI +
      (CFG.turnstileKey ? '<div class="fbw-ts"></div>' : "") +
      '<div class="fbw-foot"><span class="fbw-status"></span><button class="fbw-send" type="button">发送留言</button></div>' +
      "</div>";
    document.body.appendChild(overlay);

    tsContainer = overlay.querySelector(".fbw-ts");
    modal = overlay.querySelector(".fbw-modal");
    listEl = overlay.querySelector(".fbw-list");
    statusEl = overlay.querySelector(".fbw-status");
    sendBtn = overlay.querySelector(".fbw-send");
    fileInput = overlay.querySelector('input[type="file"]');
    dropEl = overlay.querySelector(".fbw-drop");
    msgEl = overlay.querySelector(".fbw-msg");
    contactEl = overlay.querySelector(".fbw-contact");

    overlay.querySelector(".fbw-x").addEventListener("click", close);
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) close(); });
    sendBtn.addEventListener("click", send);

    if (dropEl && fileInput) {
      dropEl.addEventListener("click", function () { fileInput.click(); });
      fileInput.addEventListener("change", function () { addFiles(fileInput.files); fileInput.value = ""; });
      ["dragenter", "dragover"].forEach(function (ev) {
        dropEl.addEventListener(ev, function (e) { e.preventDefault(); dropEl.classList.add("fbw-over"); });
      });
      ["dragleave", "drop"].forEach(function (ev) {
        dropEl.addEventListener(ev, function (e) { e.preventDefault(); dropEl.classList.remove("fbw-over"); });
      });
      dropEl.addEventListener("drop", function (e) { if (e.dataTransfer) addFiles(e.dataTransfer.files); });
    }
  }

  function onPaste(e) {
    if (!CFG.uploadUrl || !e.clipboardData) return;
    var added = [];
    var items = e.clipboardData.files;
    if (items && items.length) added = Array.prototype.slice.call(items);
    if (added.length) { addFiles(added); e.preventDefault(); }
  }

  function addFiles(fileList) {
    Array.prototype.forEach.call(fileList, function (f) {
      // de-dupe by name+size
      if (!files.some(function (x) { return x.name === f.name && x.size === f.size; })) files.push(f);
    });
    renderList();
  }

  function renderList() {
    if (!listEl) return;
    listEl.innerHTML = "";
    files.forEach(function (f, i) {
      var big = f.size > CFG.maxFileMB * 1024 * 1024;
      var li = document.createElement("li");
      li.className = "fbw-item" + (big ? " fbw-big" : "");
      li.innerHTML =
        '<span class="fbw-name">' + (big ? "⚠️ " : "📄 ") + escapeHtml(f.name) + "</span>" +
        '<span class="fbw-sz">' + fmtSize(f.size) + "</span>" +
        '<button class="fbw-rm" type="button" title="移除">×</button>';
      li.querySelector(".fbw-rm").addEventListener("click", function () {
        files.splice(i, 1);
        renderList();
      });
      listEl.appendChild(li);
    });
    if (files.some(function (f) { return f.size > CFG.maxFileMB * 1024 * 1024; })) {
      setStatus("有文件超过 " + CFG.maxFileMB + "MB，可能发送失败，请压缩后再试。", "err");
    } else {
      setStatus("");
    }
  }

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "fbw-status" + (kind ? " fbw-" + kind : "");
  }

  function open() {
    overlay.style.display = "flex";
    requestAnimationFrame(function () { overlay.classList.add("fbw-show"); });
    document.addEventListener("keydown", onKey);
    document.addEventListener("paste", onPaste);
    loadTurnstile();
    renderTurnstile();
    setTimeout(function () { msgEl.focus(); }, 50);
  }

  function close() {
    overlay.classList.remove("fbw-show");
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("paste", onPaste);
    setTimeout(function () { overlay.style.display = "none"; }, 250);
  }

  function onKey(e) { if (e.key === "Escape") close(); }

  async function send() {
    var msg = msgEl.value.trim();
    var contact = contactEl.value.trim();
    if (!msg && !files.length) { setStatus("请先写点什么，或添加一个文件。", "err"); return; }
    if (!CFG.accessKey) { setStatus("未配置 access key。", "err"); return; }

    // Turnstile guards the R2 upload endpoint (the flood-sensitive one), so it
    // is only required when there are attachments to upload.
    var tsTok = turnstileToken();
    if (CFG.turnstileKey && files.length && !tsTok) { setStatus("请先完成人机验证。", "err"); return; }

    sendBtn.disabled = true;
    var orig = sendBtn.textContent;
    sendBtn.textContent = "发送中…";

    try {
      // 1) Upload any attachments to R2 (same-origin endpoint) → get links.
      var attachText = "";
      if (files.length) {
        if (!CFG.uploadUrl) throw new Error("未配置文件上传地址");
        setStatus("正在上传附件…");
        var ufd = new FormData();
        files.forEach(function (f) { ufd.append("files", f, f.name); });
        if (tsTok) ufd.append("cf-turnstile-response", tsTok);
        var ur = await fetch(CFG.uploadUrl, { method: "POST", body: ufd });
        var uj = await ur.json().catch(function () { return {}; });
        if (!ur.ok || !uj.files) throw new Error((uj && uj.error) || "上传失败 HTTP " + ur.status);
        attachText = "\n\n附件（" + uj.files.length + "）：\n" +
          uj.files.map(function (f) { return "• " + f.name + " (" + fmtSize(f.size) + ")\n  " + f.url; }).join("\n");
        turnstileReset(); // token is single-use
      }

      // 2) Send the message (with attachment links) via Web3Forms — text only,
      //    which the free plan allows.
      setStatus("正在发送…");
      var body =
        "站点：" + CFG.site + "\n\n留言：\n" + (msg || "（无文字）") +
        "\n\n联系方式：" + (contact || "（未填写）") + attachText;

      var fd = new FormData();
      fd.append("access_key", CFG.accessKey);
      fd.append("subject", CFG.site + " · 新留言");
      fd.append("from_name", CFG.site);
      fd.append("botcheck", "");
      fd.append("message", body);
      if (/.+@.+\..+/.test(contact)) fd.append("email", contact); // reply-to

      var res = await fetch(ENDPOINT, { method: "POST", body: fd });
      var jr = await res.json().catch(function () { return {}; });
      if (res.ok && jr.success) {
        setStatus("已收到，谢谢你的留言！", "ok");
        msgEl.value = ""; contactEl.value = ""; files = []; renderList();
        setTimeout(close, 1400);
      } else {
        setStatus("发送失败：" + (jr.message || "HTTP " + res.status), "err");
      }
    } catch (err) {
      turnstileReset(); // let the user get a fresh token and retry
      setStatus("发送失败：" + (err.message || err), "err");
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = orig;
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function init() {
    injectStyle();
    buildFab();
    buildModal();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
