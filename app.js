(() => {
  "use strict";

  const I18N = {
    CN: { brand: "讲义图书馆", library: "我的图书馆", contents: "本页目录", slidesList: "讲义页面", top: "↑ 回到顶部",
          filter: "搜索资料…", empty: "library/CN 文件夹中还没有资料。", noMatch: "没有匹配的资料。",
          welcome: "选择左侧的一份资料开始阅读", welcomeSub: "资料来自 library/CN 文件夹", noToc: "本文没有章节标题。",
          loadFail: "加载失败", notes: "笔记", slides: "讲义", page: "第 {n} 页", fullscreen: "全屏 (F)",
          prev: "上一页", next: "下一页", noVariant: "这份资料还没有对应的{m}版本" },
    EN: { brand: "Notes Library", library: "My Library", contents: "On this page", slidesList: "Slides", top: "↑ Back to top",
          filter: "Search notes…", empty: "No documents in library/EN yet.", noMatch: "No matching documents.",
          welcome: "Pick a document from the library to start reading", welcomeSub: "Documents come from library/EN", noToc: "No sections in this document.",
          loadFail: "Failed to load", notes: "Notes", slides: "Slides", page: "Slide {n}", fullscreen: "Fullscreen (F)",
          prev: "Previous", next: "Next", noVariant: "No {m} version for this document yet" },
  };
  const BOOK = '<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>';
  const DECK = '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/></svg>';
  const KATEX_MACROS = { "\\R": "\\mathbb{R}", "\\E": "\\mathbb{E}", "\\P": "\\mathbb{P}" };
  const SLIDE_W = 1280, SLIDE_H = 720;

  const $ = (s) => document.querySelector(s);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  let library = { CN: [], EN: [] };
  let lang = store.get("lang") || "CN";
  let mode = store.get("mode") || "notes";
  let currentPath = null;
  let deck = null; // {slides, index}

  const t = (k, vars = {}) => I18N[lang][k].replace(/\{(\w+)\}/g, (_, v) => vars[v]);

  // ------------------------------------------------------------------ i18n & theme
  function applyLang() {
    document.documentElement.lang = lang === "CN" ? "zh-CN" : "en";
    document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
    $("#filter").placeholder = t("filter");
    document.querySelectorAll("#lang-switch button").forEach((b) => b.classList.toggle("on", b.dataset.lang === lang));
    document.querySelectorAll("#mode-switch button").forEach((b) => (b.textContent = t(b.dataset.mode)));
    $(".side-title.right-title").textContent = deck ? t("slidesList") : t("contents");
    if (!currentPath) document.title = t("brand");
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $("#hl-light").disabled = theme === "dark";
    $("#hl-dark").disabled = theme !== "dark";
  }

  $("#btn-theme").onclick = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    store.set("theme", next);
    applyTheme(next);
  };

  const entryOf = (path) => {
    for (const l of Object.keys(library)) {
      const d = library[l].find((x) => x.notes === path || x.slides === path);
      if (d) return d;
    }
    return null;
  };
  const keyOf = (path) => path.split("/").slice(1).join("/").replace(/\.slides\.md$|\.md$/, "");

  function updateModeSwitch() {
    const d = currentPath && entryOf(currentPath);
    document.querySelectorAll("#mode-switch button").forEach((b) => {
      b.classList.toggle("on", b.dataset.mode === (deck ? "slides" : "notes"));
      const missing = d && !d[b.dataset.mode];
      b.disabled = !!missing;
      b.title = missing ? t("noVariant", { m: t(b.dataset.mode) }) : "";
    });
  }

  $("#mode-switch").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    mode = b.dataset.mode;
    store.set("mode", mode);
    const d = currentPath && entryOf(currentPath);
    if (d && d[mode] && d[mode] !== currentPath) openDoc(d[mode]);
    else updateModeSwitch();
  };

  $("#lang-switch").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b || b.dataset.lang === lang) return;
    lang = b.dataset.lang;
    store.set("lang", lang);
    applyLang();
    renderLibrary();
    if (currentPath) {
      const key = keyOf(currentPath);
      const twin = library[lang].find((d) => keyOf(d.path) === key);
      if (twin) openDoc(twin[deck ? "slides" : "notes"] || twin.path);
      else if (!currentPath.startsWith(lang + "/")) showWelcome(true);
    }
  };

  // ------------------------------------------------------------------ library
  const FOLDER = '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  const CHEVRON = '<svg viewBox="0 0 24 24" class="chev"><path d="M9 6l6 6-6 6"/></svg>';
  let collapsed;
  try { collapsed = new Set(JSON.parse(store.get("collapsed") || "[]")); } catch (e) { collapsed = new Set(); }

  function docLink(d) {
    const on = currentPath && (d.notes === currentPath || d.slides === currentPath);
    const badges = (d.notes ? `<span class="badge">${t("notes")}</span>` : "") +
                   (d.slides ? `<span class="badge">${t("slides")}</span>` : "");
    return `<a class="doc-link${on ? " on" : ""}" href="?doc=${encodeURIComponent(d.path)}" data-path="${esc(d.path)}">` +
           `${d.notes ? BOOK : DECK}<span class="doc-meta"><span>${esc(d.title)}</span><span class="badges">${badges}</span></span></a>`;
  }

  function renderLibrary() {
    const q = $("#filter").value.trim().toLowerCase();
    const match = (d) => !q || (d.title + " " + d.path + " " + (d.category || []).map((c) => c.title).join(" ")).toLowerCase().includes(q);
    const docs = library[lang].filter(match);
    const nav = $("#lib-list");
    if (!library[lang].length) { nav.innerHTML = `<div class="empty">${t("empty")}</div>`; return; }
    if (!docs.length) { nav.innerHTML = `<div class="empty">${t("noMatch")}</div>`; return; }
    // build the category tree
    const root = { children: new Map(), docs: [] };
    for (const d of docs) {
      let node = root;
      for (const c of d.category || []) {
        if (!node.children.has(c.key)) node.children.set(c.key, { key: c.key, title: c.title, children: new Map(), docs: [] });
        node = node.children.get(c.key);
      }
      node.docs.push(d);
    }
    const count = (n) => n.docs.length + [...n.children.values()].reduce((s, c) => s + count(c), 0);
    const hasCurrent = (n) => n.docs.some((d) => d.notes === currentPath || d.slides === currentPath) ||
                              [...n.children.values()].some(hasCurrent);
    const render = (n, depth) => {
      let html = "";
      for (const c of n.children.values()) {
        const id = lang + ":" + c.key;
        const open = q || hasCurrent(c) || !collapsed.has(id);
        html += `<div class="cat${open ? " open" : ""}" data-cat="${esc(id)}">` +
                `<button class="cat-head">${CHEVRON}${FOLDER}` +
                `<span class="cat-title">${esc(c.title)}</span><span class="cat-count">${count(c)}</span></button>` +
                `<div class="cat-body">${render(c, depth + 1)}</div></div>`;
      }
      html += n.docs.map(docLink).join("");
      return html;
    };
    nav.innerHTML = render(root, 0);
  }

  $("#filter").oninput = renderLibrary;
  $("#lib-list").onclick = (e) => {
    const head = e.target.closest(".cat-head");
    if (head) {
      const cat = head.parentElement, id = cat.dataset.cat;
      cat.classList.toggle("open");
      if (cat.classList.contains("open")) collapsed.delete(id); else collapsed.add(id);
      store.set("collapsed", JSON.stringify([...collapsed]));
      return;
    }
    const a = e.target.closest("a.doc-link");
    if (!a) return;
    e.preventDefault();
    const d = entryOf(a.dataset.path);
    openDoc((d && d[mode]) || a.dataset.path);
    document.body.classList.remove("lib-open");
  };

  // ------------------------------------------------------------------ document
  function showWelcome(push) {
    currentPath = null;
    leaveDeck();
    $("#doc").innerHTML = `<div class="welcome">${BOOK}<h1>${t("welcome")}</h1><div>${t("welcomeSub")}</div></div>`;
    $("#toc").innerHTML = "";
    $("#crumb").textContent = "";
    document.title = t("brand");
    if (push) history.pushState({}, "", location.pathname);
    renderLibrary();
    updateModeSwitch();
  }

  async function openDoc(path, push = true, hash = "", slideIndex = 0) {
    const docEl = $("#doc");
    docEl.classList.add("loading");
    let data;
    try {
      const r = await fetch("api/doc/" + path.split("/").map(encodeURIComponent).join("/") + ".json");
      data = await r.json();
      if (!r.ok) throw new Error(data.error || r.status);
    } catch (err) {
      docEl.classList.remove("loading");
      docEl.innerHTML = `<div class="welcome"><h1>${t("loadFail")}</h1><div>${esc(String(err.message || err))}</div></div>`;
      return;
    }
    currentPath = path;
    const docLang = path.split("/")[0];
    if (docLang !== lang && I18N[docLang]) { lang = docLang; store.set("lang", lang); }
    mode = data.mode;
    store.set("mode", mode);

    if (data.mode === "slides") renderDeck(data, slideIndex);
    else renderNotes(data, hash);

    applyLang();
    renderLibrary();
    updateModeSwitch();
    docEl.classList.remove("loading");
    $("#crumb").textContent = data.title + " · " + t(data.mode);
    document.title = data.title + " · " + t("brand");
    if (push) {
      const extra = data.mode === "slides" && slideIndex ? "&s=" + (slideIndex + 1) : "";
      history.pushState({ path }, "", "?doc=" + encodeURIComponent(path) + extra + (hash || ""));
    }
  }

  function renderNotes(data, hash) {
    leaveDeck();
    const docEl = $("#doc");
    docEl.innerHTML = data.html;
    enhance(docEl);
    buildToc(data.toc);
    const target = hash && document.getElementById(decodeURIComponent(hash.slice(1)));
    if (target) target.scrollIntoView();
    else window.scrollTo({ top: 0, behavior: "instant" });
    onScroll();
  }

  function renderMath(root) {
    root.querySelectorAll(".math-inline, .math-display").forEach((el) => {
      const display = el.classList.contains("math-display");
      try {
        katex.render(el.textContent, el, {
          displayMode: display, throwOnError: false, strict: "ignore", trust: false, macros: KATEX_MACROS,
        });
      } catch (e) {
        el.classList.add("math-error");
      }
    });
  }

  function enhance(root, anchors = true) {
    renderMath(root);
    if (window.hljs) root.querySelectorAll("pre code").forEach((c) => hljs.highlightElement(c));
    if (!anchors) return;
    root.querySelectorAll("h2[id], h3[id]").forEach((h) => {
      const a = document.createElement("a");
      a.className = "anchor"; a.href = "#" + h.id; a.textContent = "#";
      h.appendChild(a);
    });
  }

  // ------------------------------------------------------------------ slides
  const ICON = {
    prev: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>',
    full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  };

  function renderDeck(data, start) {
    const slides = data.slides;
    deck = { slides, index: -1, fitted: new Set() };
    document.body.classList.add("slides-mode");
    heads = [];
    const docEl = $("#doc");
    docEl.innerHTML =
      `<div class="deck" id="deck">
         <div class="stage" id="stage">${slides.map((s, i) =>
           `<section class="slide ${esc(s.cls)}" data-i="${i}"><div class="slide-inner">${s.html}</div>
              <div class="slide-foot"><span>${esc(data.title)}</span><span>${i + 1} / ${slides.length}</span></div></section>`).join("")}
           <button class="stage-hit prev" aria-label="${t("prev")}"></button>
           <button class="stage-hit next" aria-label="${t("next")}"></button>
         </div>
         <div class="deck-bar">
           <button class="icon-btn" id="sl-prev" title="${t("prev")}">${ICON.prev}</button>
           <div class="deck-progress"><div id="sl-bar"></div></div>
           <span class="deck-count" id="sl-count"></span>
           <button class="icon-btn" id="sl-next" title="${t("next")}">${ICON.next}</button>
           <button class="icon-btn" id="sl-full" title="${t("fullscreen")}">${ICON.full}</button>
         </div>
       </div>`;
    enhance(docEl, false);
    // slide list in the right panel
    $("#toc").innerHTML = slides.map((s, i) => {
      const title = s.title ? s.title : t("page", { n: i + 1 });
      return `<a class="slide-link${s.level === 1 ? " sec" : ""}" href="#" data-i="${i}"><span class="num">${i + 1}</span><span>${title}</span></a>`;
    }).join("");
    renderMath($("#toc"));
    $("#sl-prev").onclick = () => go(deck.index - 1);
    $("#sl-next").onclick = () => go(deck.index + 1);
    $("#sl-full").onclick = toggleFullscreen;
    docEl.querySelector(".stage-hit.prev").onclick = () => go(deck.index - 1);
    docEl.querySelector(".stage-hit.next").onclick = () => go(deck.index + 1);
    // swipe left/right on touch screens
    const stageEl = $("#stage");
    let tx = null, ty = null;
    stageEl.addEventListener("touchstart", (e) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
    stageEl.addEventListener("touchend", (e) => {
      if (tx === null) return;
      const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
      tx = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) go(deck.index + (dx < 0 ? 1 : -1));
    }, { passive: true });
    window.scrollTo({ top: 0, behavior: "instant" });
    layoutStage();
    go(Math.min(Math.max(start, 0), slides.length - 1), false);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { deck && (deck.fitted.clear(), fit(deck.index)); });
  }

  function leaveDeck() {
    if (!deck) return;
    deck = null;
    document.body.classList.remove("slides-mode");
    if (document.fullscreenElement) document.exitFullscreen();
  }

  function layoutStage() {
    const stage = $("#stage");
    if (!stage) return;
    const full = document.fullscreenElement === $("#deck");
    const w = stage.clientWidth, h = stage.clientHeight;
    const k = full ? Math.min(w / SLIDE_W, h / SLIDE_H) : w / SLIDE_W;
    const ox = (w - SLIDE_W * k) / 2, oy = full ? (h - SLIDE_H * k) / 2 : 0;
    stage.querySelectorAll(".slide").forEach((s) => (s.style.transform = `translate(${ox}px, ${oy}px) scale(${k})`));
  }

  // shrink text until the slide content fits its box
  function fit(i) {
    if (!deck || deck.fitted.has(i)) return;
    const inner = document.querySelector(`.slide[data-i="${i}"] .slide-inner`);
    if (!inner) return;
    const over = () => inner.scrollHeight > inner.clientHeight + 2;
    const svgs = [...inner.querySelectorAll("figure .svg svg")];
    let figH = 410, size = 100;
    inner.style.fontSize = "";
    svgs.forEach((s) => (s.style.maxHeight = figH + "px"));
    // figures give up space first, then the text shrinks
    while (over() && svgs.length && figH > 230) {
      figH -= 20;
      svgs.forEach((s) => (s.style.maxHeight = figH + "px"));
    }
    while (over() && size > 60) {
      size -= 4;
      inner.style.fontSize = size + "%";
    }
    deck.fitted.add(i);
  }

  function go(i, record = true) {
    if (!deck) return;
    const n = deck.slides.length;
    i = Math.max(0, Math.min(n - 1, i));
    if (i === deck.index) return;
    deck.index = i;
    document.querySelectorAll(".slide").forEach((s) => s.classList.toggle("active", +s.dataset.i === i));
    fit(i);
    $("#sl-count").textContent = `${i + 1} / ${n}`;
    $("#sl-bar").style.width = ((i + 1) / n) * 100 + "%";
    document.querySelectorAll("#toc a").forEach((a) => {
      const on = +a.dataset.i === i;
      a.classList.toggle("on", on);
      if (on) {
        const panel = $("#toc-panel"), r = a.getBoundingClientRect(), pr = panel.getBoundingClientRect();
        if (r.top < pr.top + 60 || r.bottom > pr.bottom - 60) panel.scrollTop += r.top - pr.top - pr.height / 3;
      }
    });
    if (record) {
      const u = new URL(location.href);
      u.searchParams.set("s", i + 1);
      history.replaceState(history.state, "", u);
    }
  }

  function toggleFullscreen() {
    const el = $("#deck");
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el.requestFullscreen) {
      el.requestFullscreen().then(() => {
        try { screen.orientation && screen.orientation.lock && screen.orientation.lock("landscape").catch(() => {}); } catch (e) {}
      }).catch(() => {});
    }
  }
  document.addEventListener("fullscreenchange", () => requestAnimationFrame(layoutStage));
  addEventListener("resize", () => requestAnimationFrame(layoutStage));

  addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      $("#lightbox").classList.remove("open");
      document.body.classList.remove("lib-open", "toc-open");
    }
    if (!deck || e.target.closest("input, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(k)) { e.preventDefault(); go(deck.index + 1); }
    else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(k)) { e.preventDefault(); go(deck.index - 1); }
    else if (k === "Home") go(0);
    else if (k === "End") go(deck.slides.length - 1);
    else if (k === "f" || k === "F") toggleFullscreen();
  });

  // ------------------------------------------------------------------ toc & scroll spy (notes)
  let heads = [];
  function buildToc(toc) {
    const nav = $("#toc");
    if (!toc.length) { nav.innerHTML = `<div class="empty">${t("noToc")}</div>`; heads = []; return; }
    nav.innerHTML = toc.map((h) => `<a class="l${h.level}" href="#${encodeURIComponent(h.id)}" data-id="${esc(h.id)}">${h.html}</a>`).join("");
    renderMath(nav);
    heads = toc.map((h) => document.getElementById(h.id)).filter(Boolean);
  }

  let ticking = false;
  function onScroll() {
    ticking = false;
    const doc = document.documentElement;
    const max = doc.scrollHeight - innerHeight;
    $("#progress").style.width = deck ? "0" : (max > 0 ? (scrollY / max) * 100 : 0) + "%";
    if (deck) return;
    let active = null;
    for (const h of heads) {
      if (h.getBoundingClientRect().top < 120) active = h; else break;
    }
    if (!active && heads.length) active = heads[0];
    document.querySelectorAll("#toc a").forEach((a) => {
      const on = active && a.dataset.id === active.id;
      if (on && !a.classList.contains("on")) {
        a.classList.add("on");
        const panel = $("#toc-panel"), r = a.getBoundingClientRect(), pr = panel.getBoundingClientRect();
        if (r.top < pr.top + 40 || r.bottom > pr.bottom - 40) panel.scrollTop += r.top - pr.top - pr.height / 3;
      } else if (!on) a.classList.remove("on");
    });
  }
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });

  $("#toc").onclick = (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    e.preventDefault();
    document.body.classList.remove("toc-open");
    if (deck) { go(+a.dataset.i); return; }
    const el = document.getElementById(a.dataset.id);
    if (el) { el.scrollIntoView({ behavior: "smooth" }); history.replaceState(history.state, "", "#" + encodeURIComponent(a.dataset.id)); }
  };
  $("#to-top").onclick = () => (deck ? go(0) : scrollTo({ top: 0, behavior: "smooth" }));

  // in-document links: other library docs and lightbox
  $("#doc").onclick = (e) => {
    const zoom = e.target.closest("a.zoom");
    if (zoom) {
      e.preventDefault();
      $("#lightbox img").src = zoom.getAttribute("href");
      $("#lightbox").classList.add("open");
      return;
    }
    // in-page anchors (table of contents, heading "#" links): scroll without reloading
    const hashLink = e.target.closest("a[href^='#']");
    if (hashLink) {
      e.preventDefault();
      const id = decodeURIComponent(hashLink.getAttribute("href").slice(1));
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
        history.replaceState(history.state, "", "#" + encodeURIComponent(id));
      }
      return;
    }
    const a = e.target.closest("a[href^='?doc=']");
    if (a) {
      e.preventDefault();
      const u = new URL(a.href);
      openDoc(u.searchParams.get("doc"), true, u.hash);
    }
  };
  $("#lightbox").onclick = () => $("#lightbox").classList.remove("open");

  // mobile drawers
  $("#btn-lib").onclick = () => { document.body.classList.toggle("lib-open"); document.body.classList.remove("toc-open"); };
  $("#btn-toc").onclick = () => { document.body.classList.toggle("toc-open"); document.body.classList.remove("lib-open"); };
  $("#scrim").onclick = () => document.body.classList.remove("lib-open", "toc-open");

  addEventListener("popstate", () => route(false));

  function route(push) {
    const params = new URLSearchParams(location.search);
    const p = params.get("doc");
    const slide = (parseInt(params.get("s"), 10) || 1) - 1;
    // same document (e.g. only the #hash changed): just move, don't re-render
    if (p && p === currentPath) {
      if (deck) go(slide, false);
      else {
        const el = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
        if (el) el.scrollIntoView();
      }
      return;
    }
    if (p) openDoc(p, push, location.hash, slide);
    else showWelcome(false);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ------------------------------------------------------------------ boot
  applyTheme(document.documentElement.dataset.theme);
  applyLang();
  fetch("api/library.json").then((r) => r.json()).then((lib) => {
    library = lib;
    if (!new URLSearchParams(location.search).get("doc")) {
      const first = library[lang][0];
      if (first) return openDoc(first[mode] || first.path, false);
      return showWelcome(false);
    }
    route(false);
  });
})();
