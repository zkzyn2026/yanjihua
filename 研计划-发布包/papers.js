/* 文献阅读模块：列表 / 详情 / 进度 / 总结 / 笔记 / PDF 附件 / 导入 / 一键引用 */
"use strict";

const Papers = (function () {
  const Q = { q: "", status: "all" };

  function blank() {
    const p = BIB.blankPaper();
    p.id = IO.uid();
    p.createdAt = Date.now();
    p.updatedAt = Date.now();
    return p;
  }
  async function save(p) { p.updatedAt = Date.now(); await DB.put("papers", p); return p; }

  // ================= PDF 导入 + 全文索引 =================
  const PDF_MAX_PAGES = 200;    // 超过这个页数不抽全文，避免手机卡死
  const FT_HIT_LIMIT = 50;      // 全文检索结果上限
  const FT_PAD = 26;            // 命中片段左右各带多少字
  const FT_PER_PAPER = 3;       // 每篇最多给出几处命中
  const PAGE_SEP = "\f";        // 页分隔符：靠它把命中位置还原成页码
  const PDF_TIMEOUT = 20000;    // 等待 pdf.js 就绪的超时

  let _pdfLoad = null;

  function _setWorkerSrc(lib) {
    try {
      if (lib && lib.GlobalWorkerOptions && !lib.GlobalWorkerOptions.workerSrc) {
        lib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.js";
      }
    } catch (e) { /* worker 路径设置失败不阻断，后面会正常报错 */ }
    return lib;
  }

  // pdf.min.js 由 index.html 以 defer 引入（不阻塞首屏）；这里做惰性等待：
  // 库没就绪就等它，必要时兜底动态注入，超时或失败都明确报错，绝不静默失败。
  function ensurePdf(timeout) {
    const ms = Number(timeout) || PDF_TIMEOUT;
    if (window.pdfjsLib) return Promise.resolve(_setWorkerSrc(window.pdfjsLib));
    if (_pdfLoad) return _pdfLoad;
    _pdfLoad = new Promise((res, rej) => {
      const t0 = Date.now();
      const timer = setInterval(() => {
        if (window.pdfjsLib) { clearInterval(timer); res(_setWorkerSrc(window.pdfjsLib)); return; }
        if (Date.now() - t0 > ms) {
          clearInterval(timer);
          _pdfLoad = null;
          rej(new Error("PDF 解析库加载超时，请检查离线缓存后重试"));
        }
      }, 100);
      if (!document.querySelector('script[src$="vendor/pdf.min.js"]')) {
        const s = document.createElement("script");
        s.src = "./vendor/pdf.min.js";
        s.onerror = () => {
          clearInterval(timer);
          _pdfLoad = null;
          rej(new Error("PDF 解析库加载失败，离线缓存可能不完整"));
        };
        document.head.appendChild(s);
      }
    }).catch((e) => { _pdfLoad = null; throw e; });
    return _pdfLoad;
  }

  // 中文 PDF 抽不出文本是常态（扫描件 / 字体未嵌入 / CID 没有 ToUnicode 映射）。
  // empty  = 基本没有可用字符；garbled = 大量替换符或私用区字符（典型乱码特征）。
  function textQuality(text) {
    const s = String(text || "").replace(/\s+/g, "");
    if (s.length < 20) return "empty";
    let bad = 0;
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (c === 0xfffd || c < 0x20 || (c >= 0xe000 && c <= 0xf8ff) || (c >= 0xf0000 && c <= 0x10fffd)) bad++;
    }
    return bad / s.length > 0.2 ? "garbled" : "ok";
  }

  async function pdfInfo(doc) {
    const out = { title: "", authors: [], year: "" };
    try {
      const m = await doc.getMetadata();
      const info = (m && m.info) || {};
      const str = (v) => (typeof v === "string" ? v : (v && typeof v.str === "string" ? v.str : ""));
      out.title = str(info.Title).trim();
      out.authors = BIB.splitAuthors(str(info.Author).trim());
      const d = str(info.CreationDate) || str(info.ModDate);
      const mt = String(d).match(/(19|20)\d{2}/);
      if (mt) out.year = mt[0];
    } catch (e) { /* 元数据读不出来就用文件名兜底 */ }
    return out;
  }

  // 逐页取文本，页与页之间用 PAGE_SEP 分隔，检索时据此还原页码
  async function pdfExtractText(doc, maxPages) {
    const total = doc.numPages || 0;
    const n = Math.max(0, Math.min(total, maxPages));
    const pages = [];
    for (let i = 1; i <= n; i++) {
      IO.busy(true, "正在抽取全文（" + i + "/" + n + " 页）…");
      const page = await doc.getPage(i);
      let buf = "";
      try {
        const tc = await page.getTextContent();
        (tc.items || []).forEach((it) => {
          if (typeof it.str === "string" && it.str) buf += it.str;
          if (it.hasEOL) buf += "\n";
        });
      } finally {
        if (page && page.cleanup) page.cleanup();
      }
      pages.push(buf.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim());
    }
    return { text: pages.join(PAGE_SEP), pages: n, total: total };
  }

  function stripExt(name) { return String(name || "").replace(/\.[A-Za-z0-9]{1,6}$/, ""); }
  function normKey(s) { return String(s || "").toLowerCase().replace(/[^0-9a-z一-龥]/g, "").slice(0, 160); }

  // 判重：标题或文件名（去扩展名）命中已有文献 / 已有附件即视为同一篇
  async function findDup(title, fileName) {
    const all = await DB.all("papers");
    const tk = normKey(title), fk = normKey(stripExt(fileName));
    if (!tk && !fk) return null;
    for (const p of all) {
      const pt = normKey(p.title);
      if ((tk && pt === tk) || (fk && pt === fk)) return p;
      const hit = (p.files || []).some((f) => {
        const fn = normKey(stripExt(f.name));
        return (tk && fn === tk) || (fk && fn === fk);
      });
      if (hit) return p;
    }
    return null;
  }

  // 把导入的文献挂到竞赛 / 课题上
  async function linkPaper(storeName, recId, paperId) {
    if (!storeName || !recId || !paperId) return false;
    const rec = await DB.get(storeName, recId);
    if (!rec) return false;
    const s = new Set(rec.paperIds || []);
    if (s.has(paperId)) return true;
    s.add(paperId);
    rec.paperIds = Array.from(s);
    rec.updatedAt = Date.now();
    await DB.put(storeName, rec);
    return true;
  }

  // 单个 PDF 入库：存附件 → 建文献条目 → 抽全文写 ft 索引
  async function importPdfFile(file, opts) {
    const link = (opts && opts.link) || "";
    const recId = (opts && opts.id) || "";
    let lib;
    try {
      lib = await ensurePdf();
    } catch (e) {
      IO.toast(e && e.message ? e.message : "PDF 解析库加载失败");
      return { ok: false, reason: "parse" };
    }
    let doc = null;
    try {
      IO.busy(true, "正在解析 PDF…");
      const buf = await file.arrayBuffer();
      doc = await lib.getDocument({ data: buf, isEvalSupported: false }).promise;
      const total = doc.numPages || 0;
      const info = await pdfInfo(doc);
      // v1.5.0：info 字典常常是空的（国内期刊、扫描转文本、自己导出的 PDF 尤其如此），
      // 只靠它就会出现「佚名.原文[J].2026」这种引用。这里再读前两页正文做一次识别兜底。
      let headText = "";
      try { headText = (await pdfExtractText(doc, 2)).text || ""; } catch (e) { headText = ""; }
      const guess = BIB.extractMeta(headText, file.name);
      const fromName = !(info.title && info.title.length >= 4);
      const title = (fromName && guess.title ? guess.title : (info.title && info.title.length >= 4 ? info.title : stripExt(file.name))) || "未命名文献";
      IO.busy(false);
      const dup = await findDup(title, file.name);
      if (dup) {
        const again = await UI.confirm("文献库里已经有《" + dup.title + "》了（按标题或文件名判断是同一篇）。仍然再导入一次吗？",
          { ok: "仍然导入", title: "可能是重复导入" });
        if (!again) {
          IO.toast("已跳过《" + dup.title + "》，没有重复入库");
          return { ok: false, reason: "dup", paper: dup };
        }
      }
      const metas = await UI.attach.add([file], false);
      const meta = metas[0];
      const p = blank();
      p.title = title;
      p.authors = info.authors.length ? info.authors : (guess.authors || []);
      p.year = info.year || guess.year || "";
      p.journal = guess.journal || "";
      p.doi = guess.doi || "";
      p.volume = guess.volume || "";
      p.issue = guess.issue || "";
      p.pages = guess.pages || "";
      p.type = guess.type || "article";
      p.files = [meta];
      p.fileId = meta.id;   // 指向 files 表里的 PDF 二进制
      p.notes = p.notes || [];
      p.tags = p.tags || [];
      await save(p);
      if (link && recId) await linkPaper(link, recId, p.id);
      if (total > PDF_MAX_PAGES) {
        return { ok: true, paper: p, quality: "toolarge", pages: total };
      }
      IO.busy(true, "正在抽取全文…");
      const r = await pdfExtractText(doc, PDF_MAX_PAGES);
      const quality = textQuality(r.text);
      await DB.put("ft", { id: p.id, text: r.text, pages: r.pages, ts: Date.now(), quality: quality });
      return { ok: true, paper: p, quality: quality, pages: r.pages };
    } catch (e) {
      IO.toast("导入失败：" + (e && e.message ? e.message : e));
      return { ok: false, reason: "parse" };
    } finally {
      IO.busy(false);
      try { if (doc && doc.destroy) doc.destroy(); } catch (e) { /* 忽略 */ }
    }
  }

  async function importPdfFiles(files, opts) {
    const res = { created: [], warnings: [], skipped: [], failed: [], recognized: 0 };
    for (const f of files) {
      const isPdf = /\.pdf$/i.test(f.name || "") || f.type === "application/pdf";
      if (!isPdf) { res.failed.push({ name: f.name || "文件", msg: "不是 PDF 文件" }); continue; }
      const r = await importPdfFile(f, opts);
      if (!r.ok) {
        if (r.reason === "dup") res.skipped.push(r.paper ? r.paper.title : (f.name || "文件"));
        else res.failed.push({ name: f.name || "文件", msg: "解析失败" });
        continue;
      }
      res.created.push(r.paper);
      // 识别出作者又识别出期刊，才算「元数据认出来了」（只有其一多半是运气）
      if ((r.paper.authors || []).length && r.paper.journal) res.recognized++;
      if (r.quality === "empty" || r.quality === "garbled") {
        res.warnings.push({
          title: r.paper.title,
          msg: "这篇 PDF 没能提取到文字，可能是扫描件（或字体未嵌入），已入库但只能按标题检索。",
        });
      } else if (r.quality === "toolarge") {
        res.warnings.push({
          title: r.paper.title,
          msg: "这篇 PDF 共 " + r.pages + " 页，超过 " + PDF_MAX_PAGES + " 页上限，没抽取全文，只能按标题检索。",
        });
      }
    }
    return res;
  }

  // 统一入口：文献页 / 竞赛详情 / 课题详情都调它。
  // opts: { link: "contests" | "projects" | "", id: 记录 id }
  // 【手势纪律】UI.pickFile 必须在用户点击的同步栈里调用，前面不能有任何 await
  //（否则移动端浏览器不弹文件选择器且不报错）。所以第一步就是弹选择器，
  // ensurePdf() 挪到选完文件之后 —— 反正解析也要时间，体验没差别。
  async function importPdfDialog(opts) {
    const files = await UI.pickFile("application/pdf,.pdf", true);
    if (!files || !files.length) return;
    await importPdfPicked(files, opts);
  }

  // 处理已经选好的 PDF 文件：ensurePdf → 入库 → 提示 → 刷新。
  // 首页「导入今日文献」要先建今天的打卡记录再入库，直接调这个，不复制代码。
  async function importPdfPicked(files, opts) {
    try {
      await ensurePdf();
    } catch (e) {
      IO.toast(e && e.message ? e.message : "PDF 解析库加载失败");
      return;
    }
    const r = await importPdfFiles(files, opts);
    const done = () => {
      if (r.created.length) {
        IO.toast("已导入 " + r.created.length + " 篇文献" +
          (r.recognized ? "（" + r.recognized + " 篇自动认出了作者与期刊）" : "") +
          (r.warnings.length ? (r.recognized ? "，" : "（") + r.warnings.length + " 篇没能提取正文）" : ""));
      } else if (r.skipped.length) {
        IO.toast("已跳过 " + r.skipped.length + " 篇重复文献");
      } else if (r.failed.length) {
        IO.toast("导入失败：" + r.failed[0].msg);
      }
      App.refresh();
    };
    if (r.warnings.length) {
      // UI.modal 非阻塞：刷新只能放进 onClose，紧跟在后面调 App.refresh() 会抢跑
      UI.modal({
        title: "导入完成，但 " + r.warnings.length + " 篇没能提取正文",
        body: '<div class="muted" style="margin-bottom:8px">这些文献在库里能正常打开原文，但正文检索不可用。</div>' +
          r.warnings.map((w) => '<div style="padding:8px 0;border-top:1px solid var(--line2)">' +
            '<div style="font-size:13.5px">' + IO.esc(w.title) + "</div>" +
            '<div class="tiny" style="margin-top:3px">' + IO.esc(w.msg) + "</div></div>").join(""),
        actions: [{ label: "知道了", cls: "pri", fn: () => true }],
        onClose: done,
      });
      return;
    }
    done();
  }

  // 对已入库的 PDF 附件重新抽取全文（换过文件、上次抽取失败时用）
  async function reindexPaper(p) {
    const fid = p.fileId || ((p.files || [])[0] && (p.files || [])[0].id);
    if (!fid) { IO.toast("这篇文献还没有 PDF 附件，先上传原文再抽取"); return; }
    const f = await DB.get("files", fid);
    if (!f || !f.blob) { IO.toast("附件已丢失，无法抽取全文"); return; }
    let lib;
    try {
      lib = await ensurePdf();
    } catch (e) {
      IO.toast(e && e.message ? e.message : "PDF 解析库加载失败");
      return;
    }
    IO.busy(true, "正在抽取全文…");
    let doc = null;
    try {
      const buf = await f.blob.arrayBuffer();
      doc = await lib.getDocument({ data: buf, isEvalSupported: false }).promise;
      if ((doc.numPages || 0) > PDF_MAX_PAGES) {
        IO.toast("这篇 PDF 共 " + doc.numPages + " 页，超过 " + PDF_MAX_PAGES + " 页上限，未抽取");
        return;
      }
      const r = await pdfExtractText(doc, PDF_MAX_PAGES);
      const quality = textQuality(r.text);
      await DB.put("ft", { id: p.id, text: r.text, pages: r.pages, ts: Date.now(), quality: quality });
      if (quality === "ok") IO.toast("已抽取 " + r.pages + " 页正文，可以在列表里按正文检索了");
      else IO.toast("这篇 PDF 没能提取到文字，可能是扫描件，只能按标题检索");
    } catch (e) {
      IO.toast("抽取失败：" + (e && e.message ? e.message : e));
    } finally {
      IO.busy(false);
      try { if (doc && doc.destroy) doc.destroy(); } catch (e) { /* 忽略 */ }
    }
  }

  // 站内 PDF 阅读器：点「在线阅读」直接在本页翻页看原文，不跳系统浏览器、不下载。
  // 复用 ensurePdf() 加载 pdf.js；非 PDF 附件自动退回「打开」（下载）。
  // pid：所属文献 id（按钮上带的 data-pid）。有它才能做「阅读进度同步」。
  async function openPdfReader(fid, pid) {
    const f = await DB.get("files", fid);
    if (!f || !f.blob) { IO.toast("附件已丢失，可能备份时未包含"); return; }
    if (!isPdfFile(f)) { UI.attach.open(fid); return; }
    // 按钮没带 pid 时按附件反查：同一个 PDF 也可能从竞赛 / 课题页点进来
    const paper = pid ? await DB.get("papers", pid) : await findPaperByFile(fid);
    let lib;
    try { lib = await ensurePdf(); }
    catch (e) { IO.toast(e && e.message ? e.message : "PDF 解析库加载失败"); return; }
    IO.busy(true, "正在打开…");
    let doc = null;
    try {
      const buf = await f.blob.arrayBuffer();
      doc = await lib.getDocument({ data: buf, isEvalSupported: false }).promise;
    } catch (e) {
      IO.busy(false);
      IO.toast("这篇 PDF 无法打开：" + (e && e.message ? e.message : e));
      return;
    }
    IO.busy(false);
    buildReader(doc, (paper && paper.title) || f.name, paper);
  }

  // 按附件 id 反查它属于哪篇文献（游标扫，不把整表读进内存）
  async function findPaperByFile(fid) {
    let hit = null;
    await DB.each("papers", (p) => {
      if (p.fileId === fid) { hit = p; return false; }
      const ids = (p.files || []).map((x) => x && x.id);
      if (ids.indexOf(fid) >= 0) { hit = p; return false; }
      return true;
    });
    return hit;
  }

  // 阅读进度同步（v1.5.0）：翻到第几页就写到文献上，读到末页自动置「已读」。
  // 只增不减：回头翻看前面几页不会把进度倒退回去。
  async function syncRead(p, page, total) {
    if (!p || !total) return;
    const cur = await DB.get("papers", p.id);
    if (!cur) return;
    const prev = Math.min(Math.max(1, Number(cur.readPage) || 1), total);
    const maxPage = Math.max(prev, Math.min(page, total));
    if (Number(cur.readPage) === maxPage && Number(cur.progress) === Math.round(maxPage / total * 100)) return;
    cur.readPage = maxPage;
    cur.progress = Math.round(maxPage / total * 100);
    let tip = "";
    if (cur.progress >= 100) {
      if (cur.status !== "done") { cur.status = "done"; tip = "读完了，状态已标为「已读」"; }
    } else if (cur.status === "todo" && cur.progress > 0) {
      cur.status = "reading"; tip = "已标为「在读」";
    }
    await save(cur);
    if (tip) IO.toast(tip);
  }

  // 识别元数据弹窗：从 PDF 正文里认出来的结果先摆出来让用户核对，改完再存。
  // 老文献（信息缺失的）也能靠它一次性补上，不必手动逐条敲。
  async function autoMeta(id) {
    const p = await DB.get("papers", id);
    if (!p) { IO.toast("文献不存在"); return; }
    let text = "";
    const ft = await DB.get("ft", p.id);
    if (ft && ft.text) text = ft.text;
    if (!text) {
      const fid = p.fileId || ((p.files || [])[0] && (p.files || [])[0].id);
      if (!fid) { IO.toast("这篇文献还没有 PDF，先上传原文再识别"); return; }
      const f = await DB.get("files", fid);
      if (!f || !f.blob) { IO.toast("附件已丢失，无法识别"); return; }
      let lib;
      try { lib = await ensurePdf(); }
      catch (e) { IO.toast(e && e.message ? e.message : "PDF 解析库加载失败"); return; }
      IO.busy(true, "正在读取正文…");
      let doc = null;
      try {
        const buf = await f.blob.arrayBuffer();
        doc = await lib.getDocument({ data: buf, isEvalSupported: false }).promise;
        text = (await pdfExtractText(doc, 2)).text || "";
      } catch (e) {
        IO.busy(false); IO.toast("读取失败：" + (e && e.message ? e.message : e)); return;
      } finally {
        IO.busy(false);
        try { if (doc && doc.destroy) doc.destroy(); } catch (e) { /* 忽略 */ }
      }
    }
    const g = BIB.extractMeta(text, ((p.files || [])[0] || {}).name || p.title);
    UI.form({
      title: "识别文献信息",
      fields: [
        { k: "title", label: "标题", value: g.title || (p.title === "未命名文献" ? "" : p.title) },
        { k: "authors", label: "作者（多位用、分隔）", value: (g.authors || []).join("、") },
        { k: "journal", label: "期刊 / 会议 / 来源", value: g.journal },
        { k: "year", label: "发表年份", value: g.year },
        { k: "doi", label: "DOI（可留空）", value: g.doi },
      ],
      note: "这是从 PDF 正文里自动认出来的，不一定全对 —— 直接在上面改，改完点保存。" +
        (text ? "" : " 这篇 PDF 抽不出文字（可能是扫描件），识别不出来时请手动填写。"),
      submit: "保存",
      onSubmit: async (v) => {
        const cur = await DB.get("papers", id);
        if (!cur) return true;
        // 识别结果里常有空值（算法没认出来的字段）。空值绝不能覆盖已经填好的内容，
        // 否则反复点「自动识别元数据」会把作者 / 期刊越点越空。
        if (String(v.title || "").trim()) cur.title = String(v.title).trim();
        const au = BIB.splitAuthors(v.authors);
        if (au.length) cur.authors = au;
        if (String(v.journal || "").trim()) cur.journal = String(v.journal).trim();
        if (String(v.year || "").trim()) cur.year = String(v.year).trim();
        if (String(v.doi || "").trim()) cur.doi = String(v.doi).trim();
        await save(cur);
        IO.toast("元数据已更新");
        App.refresh();
        return true;
      },
    });
  }

  // 全屏覆盖层：逐页渲染到 canvas，支持上一页 / 下一页 / 跳 +/-10 / 首末页 / 键盘左右键 / Esc 关闭。
  // 一次只渲染当前页，避免长 PDF 在手机上一次性占满内存。
  function buildReader(doc, name, paper) {
    const total = doc.numPages || 0;
    if (!total) { try { doc.destroy(); } catch (e) {} IO.toast("这篇 PDF 没有可显示的页面"); return; }
    // 续读：上次读到第几页就从第几页打开（阅读进度同步的一半）
    const start = Math.min(Math.max(1, Number(paper && paper.readPage) || 1), total);
    let page = start, drawing = false, pending = false;
    const overlay = document.createElement("div");
    overlay.className = "pdf-reader";
    overlay.innerHTML =
      '<div class="pr-bar"><span class="pr-title">' + IO.esc(name || "PDF") + '</span>' +
      '<span class="pr-info" id="pr-info"></span>' +
      '<button class="pr-close" id="pr-close" aria-label="关闭">✕</button></div>' +
      '<div class="pr-scroll" id="pr-scroll"><canvas id="pr-canvas"></canvas></div>' +
      '<div class="pr-nav">' +
      '<button class="btn ghost sm" id="pr-first">首页</button>' +
      '<button class="btn ghost sm" id="pr-prev">‹ 上一页</button>' +
      '<button class="btn ghost sm" id="pr-prev10">-10</button>' +
      '<button class="btn ghost sm" id="pr-next10">+10</button>' +
      '<button class="btn ghost sm" id="pr-next">下一页 ›</button>' +
      '<button class="btn ghost sm" id="pr-last">末页</button>' +
      '</div>';
    document.body.appendChild(overlay);
    const canvas = overlay.querySelector("#pr-canvas");
    const ctx = canvas.getContext("2d");
    const info = overlay.querySelector("#pr-info");
    const scroll = overlay.querySelector("#pr-scroll");

    async function draw() {
      if (drawing) { pending = true; return; }
      drawing = true;
      try {
        const pg = await doc.getPage(page);
        const dpr = window.devicePixelRatio || 1;
        const avail = (scroll.clientWidth || window.innerWidth) - 24;   // 减去滚动区左右内边距
        const baseW = Math.max(120, Math.min(avail, 1000));
        const vp0 = pg.getViewport({ scale: 1 });
        const scale = (baseW / vp0.width) * dpr;
        const vp = pg.getViewport({ scale });
        canvas.width = Math.max(1, Math.floor(vp.width));
        canvas.height = Math.max(1, Math.floor(vp.height));
        canvas.style.width = (vp.width / dpr) + "px";
        canvas.style.height = (vp.height / dpr) + "px";
        await pg.render({ canvasContext: ctx, viewport: vp }).promise;
        pg.cleanup();
        info.textContent = page + " / " + total +
          (paper ? " · " + Math.round(page / total * 100) + "%" : "");
        scroll.scrollTop = 0;
      } catch (e) {
        IO.toast("渲染失败：" + (e && e.message ? e.message : e));
      } finally {
        drawing = false;
        if (pending) { pending = false; draw(); }
      }
    }
    function go(n) {
      const np = Math.max(1, Math.min(total, n));
      if (np === page) return;
      page = np; draw();
      scheduleSync();
    }
    // 翻页写回进度：连续翻页时抖一下，避免每页都写一次库
    let syncTimer = null;
    function scheduleSync() {
      if (!paper) return;
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => syncRead(paper, page, total), 350);
    }
    async function closeReader() {
      document.removeEventListener("keydown", onKey);
      clearTimeout(syncTimer);
      if (paper) await syncRead(paper, page, total);
      try { if (doc && doc.destroy) doc.destroy(); } catch (e) {}
      overlay.remove();
      if (paper) App.refresh();
    }
    function onKey(e) {
      if (e.key === "Escape") closeReader();
      else if (e.key === "ArrowRight" || e.key === "PageDown") go(page + 1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go(page - 1);
    }
    overlay.querySelector("#pr-close").addEventListener("click", closeReader);
    overlay.querySelector("#pr-first").addEventListener("click", () => go(1));
    overlay.querySelector("#pr-prev").addEventListener("click", () => go(page - 1));
    overlay.querySelector("#pr-prev10").addEventListener("click", () => go(page - 10));
    overlay.querySelector("#pr-next10").addEventListener("click", () => go(page + 10));
    overlay.querySelector("#pr-next").addEventListener("click", () => go(page + 1));
    overlay.querySelector("#pr-last").addEventListener("click", () => go(total));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeReader(); });
    document.addEventListener("keydown", onKey);
    draw();
  }

  function snippetHTML(text, pos, len) {
    const t = String(text || "");
    const a = Math.max(0, pos - FT_PAD);
    const b = Math.min(t.length, pos + len + FT_PAD);
    const clean = (x) => IO.esc(String(x).replace(/\s+/g, " "));
    return (a > 0 ? "…" : "") + clean(t.slice(a, pos)) +
      '<mark style="background:#ffe08a;color:inherit;padding:0 1px;border-radius:2px">' +
      clean(t.slice(pos, pos + len)) + "</mark>" +
      clean(t.slice(pos + len, b)) + (b < t.length ? "…" : "");
  }

  // 游标扫 ft 表，命中 FT_HIT_LIMIT 条就停，不把整张表读进内存
  async function searchFulltext(q, limit) {
    const needle = String(q || "").toLowerCase();
    const cap = Number(limit) || FT_HIT_LIMIT;
    if (!needle) return [];
    const hits = [];
    await DB.each("ft", (rec) => {
      if (!rec || typeof rec.text !== "string" || !rec.text) return true;
      const lower = rec.text.toLowerCase();
      let pos = lower.indexOf(needle);
      if (pos < 0) return true;
      const raw = rec.text.length === lower.length ? rec.text : lower;
      let got = 0;
      while (pos >= 0 && got < FT_PER_PAPER && hits.length < cap) {
        let page = 1;   // 页码 = 命中位置之前的页分隔符个数 + 1
        for (let i = 0; i < pos; i++) if (lower.charCodeAt(i) === 12) page++;
        hits.push({ id: rec.id, page: page, html: snippetHTML(raw, pos, needle.length) });
        got++;
        pos = lower.indexOf(needle, pos + needle.length);
      }
      return hits.length < cap;
    });
    return hits;
  }

  // 元数据命中（不含状态过滤），needle 必须是小写
  function metaHit(p, needle) {
    if (!needle) return true;
    const hay = [p.title, (p.authors || []).join(" "), p.journal, p.year, (p.tags || []).join(" "),
      p.summary, p.doi, (p.notes || []).map((n) => n.text).join(" ")]
      .join(" ").toLowerCase();
    return hay.indexOf(needle) >= 0;
  }

  // 列表查询：元数据 + 全文索引 -> { arr, ftMap, all }
  async function queryPapers(limit) {
    const all = await DB.all("papers");
    const q = (Q.q || "").trim();
    const cap = Number(limit) || FT_HIT_LIMIT;
    const ids = new Set();
    const ftMap = {};
    if (q) {
      const needle = q.toLowerCase();
      all.forEach((p) => { if (metaHit(p, needle)) ids.add(p.id); });
      const hits = await searchFulltext(needle, cap);
      hits.forEach((h) => {
        (ftMap[h.id] = ftMap[h.id] || []).push(h);
        ids.add(h.id);
      });
    } else {
      all.forEach((p) => ids.add(p.id));
    }
    const arr = all.filter((p) => ids.has(p.id) && (Q.status === "all" || p.status === Q.status))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, cap);
    return { arr: arr, ftMap: ftMap, all: all };
  }

  function ftHTML(hits) {
    if (!hits || !hits.length) return "";
    return '<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--line2)">' +
      hits.map((h) => '<div style="font-size:12.5px;line-height:1.65;color:var(--ink2)">' +
        '<span style="color:var(--brand);font-weight:600">第 ' + h.page + " 页</span>：" + h.html + "</div>").join("") +
      "</div>";
  }

  function oneLine(p) {
    const bits = [];
    if ((p.authors || []).length) bits.push((p.authors || []).slice(0, 3).join("、") + ((p.authors || []).length > 3 ? " 等" : ""));
    if (p.journal) bits.push(p.journal);
    if (p.year) bits.push(p.year);
    return bits.join(" · ") || "未填写作者 / 期刊";
  }

  function cardHTML(p, hits) {
    return '<div class="card tap" data-paper="' + IO.esc(p.id) + '">' +
      '<div class="ch"><h3>' + IO.esc(p.title || "未命名文献") + "</h3>" +
      '<span class="chip lit">' + IO.esc(CLabel(CONST.paperStatus, p.status)) + "</span></div>" +
      '<div class="tiny" style="margin-bottom:6px">' + IO.esc(oneLine(p)) + "</div>" +
      '<div class="bar"><i class="lit" style="width:' + (p.progress || 0) + '%"></i></div>' +
      ((p.tags && p.tags.length) ? '<div class="chips" style="margin-top:8px">' +
        p.tags.map((t) => '<span class="chip">' + IO.esc(t) + "</span>").join("") + "</div>" : "") +
      (p.summary ? '<div class="desc" style="margin-top:8px;font-size:13px;color:var(--ink2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + IO.esc(p.summary) + "</div>" : "") +
      ftHTML(hits) +
      "</div>";
  }

  async function listHTML() {
    const r = await queryPapers();
    const arr = r.arr, all = r.all, ftMap = r.ftMap;
    const cnt = { all: all.length };
    CONST.paperStatus.forEach((s) => { cnt[s.v] = all.filter((p) => p.status === s.v).length; });
    let h = '<div class="search"><input id="pq" placeholder="搜索标题 / 作者 / 期刊 / 标签 / 正文" value="' + IO.esc(Q.q) + '"></div>';
    h += '<div class="seg" id="pstat">' +
      [{ v: "all", l: "全部 " + cnt.all }].concat(CONST.paperStatus.map((s) => ({ v: s.v, l: s.l + " " + (cnt[s.v] || 0) })))
        .map((s) => '<button data-st="' + s.v + '" class="' + (Q.status === s.v ? "on" : "") + '">' + IO.esc(s.l) + "</button>").join("") +
      "</div>";
    h += '<div class="btnrow" style="margin-bottom:10px">' +
      '<button class="btn pri" id="padd">＋ 添加文献</button>' +
      '<button class="btn ghost" id="pimp">导入 PDF</button>' +
      '<button class="btn ghost" id="pref">引用中心</button>' +
      "</div>";
    h += '<div id="plist">';
    h += arr.length ? arr.map((p) => cardHTML(p, ftMap[p.id])).join("")
      : '<div class="empty">没有匹配的文献<br>点上面「添加文献」开始，或导入 BibTeX / RIS / PDF</div>';
    h += "</div>";
    return h;
  }

  // 重画列表（搜索 / 切状态共用），并重新绑定点击
  async function redrawList(box) {
    if (!box) return;
    const r = await queryPapers();
    box.innerHTML = r.arr.length ? r.arr.map((p) => cardHTML(p, r.ftMap[p.id])).join("")
      : '<div class="empty">没有匹配的文献</div>';
    box.querySelectorAll("[data-paper]").forEach((c) => c.addEventListener("click", () => App.go("papers", { id: c.getAttribute("data-paper") })));
  }

  // ---------- 详情 ----------
  async function detailHTML(id) {
    const p = await DB.get("papers", id);
    if (!p) return '<div class="empty">文献不存在或已被删除</div>';
    const projects = await DB.all("projects");
    const linked = projects.filter((x) => (x.paperIds || []).indexOf(id) >= 0);
    const ckAll = await DB.all("checkins");
    // 打卡类型可增删改，这里不再写死「文献阅读」：只要某条打卡关联过这篇文献就算读过
    const readDates = ckAll.filter((c) => (c.paperIds || []).indexOf(id) >= 0)
      .map((c) => c.date).sort().reverse();

    let h = '<div class="card">' +
      '<div style="font-size:16px;font-weight:600;line-height:1.5">' + IO.esc(p.title || "未命名文献") + "</div>" +
      '<div class="muted" style="margin-top:6px">' + IO.esc(oneLine(p)) + "</div>" +
      '<div class="chips" style="margin-top:8px">' +
      '<span class="chip lit">' + IO.esc(CLabel(CONST.paperStatus, p.status)) + "</span>" +
      '<span class="chip">' + IO.esc(CLabel(CONST.paperType, p.type)) + "</span>" +
      (p.volume ? '<span class="chip">卷 ' + IO.esc(p.volume) + "</span>" : "") +
      (p.issue ? '<span class="chip">期 ' + IO.esc(p.issue) + "</span>" : "") +
      (p.pages ? '<span class="chip">页 ' + IO.esc(p.pages) + "</span>" : "") +
      (p.doi ? '<span class="chip">DOI ' + IO.esc(p.doi) + "</span>" : "") +
      ((p.tags || []).map((t) => '<span class="chip">#' + IO.esc(t) + "</span>").join("")) +
      "</div></div>";

    h += '<div class="sec"><h2>阅读状态</h2></div><div class="card">' +
      '<div class="seg" id="dstat">' + CONST.paperStatus.map((s) =>
        '<button data-set="status" data-val="' + s.v + '" class="' + (p.status === s.v ? "on" : "") + '">' + s.l + "</button>").join("") + "</div>" +
      '<div style="display:flex;align-items:center;gap:10px;margin-top:4px">' +
      '<span class="muted" style="flex:none">进度</span>' +
      '<input type="range" min="0" max="100" step="5" value="' + (p.progress || 0) + '" data-set="progress" style="flex:1;padding:0">' +
      '<b id="pgv" style="flex:none;width:44px;text-align:right">' + (p.progress || 0) + "%</b></div>" +
      '<div class="btnrow" style="margin-top:10px">' +
      '<button class="btn ghost sm" data-act="todayread">标记今天读过</button>' +
      '<button class="btn ghost sm" data-act="autometa">自动识别元数据</button>' +
      '<button class="btn ghost sm" data-act="edit">编辑元数据</button>' +
      "</div>" +
      (p.readPage ? '<div class="tiny" style="margin-top:7px">上次读到第 ' + p.readPage +
        " 页 · 进度 " + (p.progress || 0) + "%，点「在线阅读」会接着往下读</div>" : "") +
      "</div>";

    h += '<div class="sec"><h2>总结</h2></div><div class="card">' +
      '<textarea data-set="summary" rows="5" placeholder="这篇讲了什么？方法、结论、可借鉴之处…">' + IO.esc(p.summary || "") + "</textarea>" +
      '<div class="tiny" style="margin-top:6px">写完点空白处即自动保存</div></div>';

    const notes = (p.notes || []).slice().sort((a, b) => b.ts - a.ts);
    h += '<div class="sec"><h2>笔记 <span style="font-weight:400">' + notes.length + " 条</span></h2>" +
      '<button class="more" data-act="addnote">＋ 添加</button></div>';
    h += '<div class="card">' + (notes.length
      ? notes.map((n, i) =>
        '<div style="padding:9px 0' + (i ? ";border-top:1px solid var(--line2)" : "") + '">' +
        '<div class="tiny">' + IO.fmtTime(n.ts) + "</div>" +
        '<div style="font-size:13.5px;line-height:1.65;white-space:pre-wrap;margin-top:3px">' + IO.esc(n.text) + "</div>" +
        '<div style="text-align:right;margin-top:4px"><button class="btn sm ghost" data-editnote="' + n.id + '">编辑</button> ' +
        '<button class="btn sm ghost" data-delnote="' + n.id + '">删除</button></div></div>').join("")
      : '<div class="empty" style="padding:20px 0">还没有笔记</div>') + "</div>";

    // 全文索引状态必须让用户看得见：抽不到文字时明确说明，不能静默失败
    const ft = await DB.get("ft", p.id);
    const ftTip = !ft ? "还没有全文索引，点右上角「抽取全文」可给 PDF 建正文检索"
      : (ft.quality === "ok" ? "已索引 " + (ft.pages || 0) + " 页正文，可在文献列表按正文检索"
        : "这篇 PDF 没能提取到文字，可能是扫描件，只能按标题检索");
    h += '<div class="sec"><h2>原文附件</h2>' +
      '<button class="more" data-act="reindex">抽取全文</button>' +
      '<button class="more" data-act="addfile">＋ 上传</button></div>';
    h += '<div class="card">' + filesHTML(p.files, p.id) +
      '<div class="tiny" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line2)">' + IO.esc(ftTip) + "</div></div>";

    h += '<div class="sec"><h2>引用</h2></div>';
    h += '<div class="card"><div class="btnrow">' +
      '<button class="btn pri" data-act="cite">一键引用</button>' +
      '<button class="btn ghost" data-act="copygb">复制 GB/T 7714</button>' +
      "</div></div>";

    h += '<div class="sec"><h2>关联课题 / 项目</h2></div>';
    h += '<div class="card">' + (linked.length
      ? linked.map((x) => '<div class="item" style="padding:9px 0"><div class="ib"><div class="t1">' + IO.esc(x.name) + "</div>" +
        '<div class="t2">' + IO.esc(CLabel(CONST.projStatus, x.status)) + " · 进度 " + (x.progress || 0) + "%</div></div>" +
        '<button class="btn sm ghost" data-go="projects" data-arg="' + IO.esc(x.id) + '">查看</button></div>').join("")
      : '<div class="empty" style="padding:20px 0">还没有课题引用它，可在课题详情里关联</div>') + "</div>";

    if (readDates.length) {
      h += '<div class="sec"><h2>阅读记录</h2></div><div class="card"><div class="chips">' +
        readDates.slice(0, 40).map((d) => '<span class="chip ok">' + IO.esc(IO.fmtMD(d)) + "</span>").join("") +
        "</div></div>";
    }

    h += '<div class="btnrow" style="margin-top:18px"><button class="btn dg" data-act="del">删除这篇文献</button></div>';
    return h;
  }

  function isPdfFile(f) { return /\.pdf$/i.test((f && f.name) || "") || (f && f.mime) === "application/pdf"; }

  // pid：所属文献 id。带上它，阅读器才能把「读到第几页」回写成阅读进度。
  function filesHTML(list, pid) {
    if (!list || !list.length) return '<div class="empty" style="padding:20px 0">暂无附件，可上传 PDF 原文</div>';
    return list.map((f) => {
      const ext = (f.name || "").split(".").pop().toUpperCase().slice(0, 4) || "文件";
      const pdf = isPdfFile(f);
      return '<div class="file"><div class="fi">' + IO.esc(ext) + "</div>" +
        '<div class="fb"><div class="fn">' + IO.esc(f.name) + '</div><div class="fs">' + IO.kb(f.size || 0) + "</div></div>" +
        (pdf ? '<button class="btn sm pri" data-readf="' + IO.esc(f.id) + '"' +
          (pid ? ' data-pid="' + IO.esc(pid) + '"' : "") + ">在线阅读</button>" : "") +
        '<button class="btn sm ghost" data-openf="' + IO.esc(f.id) + '">打开</button>' +
        '<button class="x" data-delf="' + IO.esc(f.id) + '">删除</button></div>';
    }).join("");
  }

  // ---------- 增删改 ----------
  async function addMenu() {
    UI.choose({
      title: "添加文献",
      items: [
        { v: "manual", l: "手动填写", sub: "标题 / 作者 / 期刊 / 年份…" },
        { v: "paste", l: "粘贴参考文献文本", sub: "支持中英文混合、GB/T 7714 与 APA 等" },
        { v: "bib", l: "导入 BibTeX（.bib）", sub: "知网、Google Scholar、Zotero 导出" },
        { v: "ris", l: "导入 RIS（.ris）", sub: "Web of Science、EndNote 导出" },
        { v: "pdf", l: "导入 PDF 原文", sub: "自动取标题 / 作者 / 年份，并建立正文检索索引" },
        { v: "doi", l: "用 DOI 自动补全", sub: "需联网，仅在你点击时进行" },
      ],
      onPick: async (v) => {
        if (v === "manual") return editForm(blank(), true);
        if (v === "doi") return doiForm();
        if (v === "pdf") return importPdfDialog({});
        if (v === "paste") return pasteDialog();
        const files = await UI.pickFile(v === "bib" ? ".bib,.bibtex,.txt" : ".ris,.txt", false);
        if (!files.length) return;
        const text = await IO.readText(files[0]);
        await importParsed(v === "bib" ? BIB.parseBib(text) : BIB.parseRis(text), files[0].name);
      },
    });
  }

  // 粘贴纯文本参考文献（中英文混合、GB/T 7714 / APA 等），尽力解析后进入导入预览
  function pasteDialog() {
    UI.form({
      title: "粘贴参考文献",
      fields: [{
        k: "text", label: "把参考文献列表粘到这里", type: "textarea", rows: 7,
        ph: "例如：\n[1] 张三, 李四. 深度学习应用[J]. 计算机学报, 2020, 43(5): 1-15.\nSmith, J. A., & Johnson, M. B. (2021). Attention mechanisms. JMLR, 22(3), 45-67.",
      }],
      note: "解析是尽力而为的：粘进来后会在下一步逐条预览，可取消或导入后再逐条编辑补正。",
      submit: "解析",
      onSubmit: async (v) => {
        const list = BIB.parseCitation(v.text);
        if (!list.length) { IO.toast("没能从文本里解析出文献条目，试试手动填写"); return true; }
        UI.close();
        await importParsed(list, "粘贴文本");
        return false;
      },
    });
  }

  async function importParsed(list, srcName) {
    if (!list.length) { IO.toast("没能从文件里解析出文献条目"); return; }
    UI.modal({
      title: "解析到 " + list.length + " 条文献",
      body: '<div class="muted" style="margin-bottom:8px">来源：' + IO.esc(srcName || "") + "（导入后状态默认为「待读」）</div>" +
        '<div style="max-height:44vh;overflow:auto">' + list.slice(0, 60).map((p) =>
          '<div style="padding:8px 0;border-top:1px solid var(--line2)"><div style="font-size:13.5px">' + IO.esc(p.title) + "</div>" +
          '<div class="tiny">' + IO.esc(oneLine(p)) + "</div></div>").join("") + "</div>" +
        (list.length > 60 ? '<div class="tiny" style="margin-top:6px">仅预览前 60 条</div>' : ""),
      actions: [
        { label: "取消", cls: "ghost", fn: () => true },
        {
          label: "全部导入", cls: "pri", fn: async () => {
            const now = Date.now();
            const arr = list.map((p, i) => {
              p.id = IO.uid(); p.createdAt = now + i; p.updatedAt = now + i;
              p.notes = p.notes || []; p.files = p.files || []; p.tags = p.tags || [];
              return p;
            });
            await DB.bulkPut("papers", arr);
            IO.toast("已导入 " + arr.length + " 条文献");
            App.refresh();
            return true;
          },
        },
      ],
    });
  }

  async function doiForm() {
    UI.form({
      title: "用 DOI 补全元数据",
      fields: [{ k: "doi", label: "DOI", ph: "如 10.1038/nature14539 或完整 doi.org 链接" }],
      note: "这一步会向 api.crossref.org 发一次请求，是软件里唯一联网的地方；不点就不会联网。",
      submit: "查询",
      onSubmit: async (v) => {
        IO.busy(true, "正在查询 DOI…");
        try {
          const p = await BIB.fetchDoi(v.doi);
          IO.busy(false);
          UI.close();
          editForm(p, true);
        } catch (e) {
          IO.busy(false);
          IO.toast(e && e.message ? e.message : "查询失败");
        }
        return false;
      },
    });
  }

  function editForm(p, isNew) {
    UI.form({
      title: isNew ? "添加文献" : "编辑元数据",
      fields: [
        { k: "title", label: "标题", value: p.title, ph: "论文标题" },
        { k: "authors", label: "作者", value: (p.authors || []).join("、"), ph: "多位作者用顿号、逗号或分号分隔" },
        { k: "type", label: "类型", type: "select", value: p.type || "article", opts: CONST.paperType },
        { k: "journal", label: "期刊 / 会议 / 出版社", value: p.journal },
        { k: "year", label: "年份", value: p.year },
        { k: "volume", label: "卷", value: p.volume },
        { k: "issue", label: "期", value: p.issue },
        { k: "pages", label: "页码", value: p.pages, ph: "如 12-25" },
        { k: "doi", label: "DOI", value: p.doi },
        { k: "url", label: "链接", value: p.url },
        { k: "publisher", label: "出版社 / 学校", value: p.publisher },
        { k: "tags", label: "标签", value: (p.tags || []).join("，"), ph: "用逗号分隔，如 综述,Transformer" },
      ],
      onSubmit: async (v) => {
        if (!v.title.trim()) { IO.toast("标题不能为空"); return false; }
        const cur = isNew ? Object.assign(blank(), {}) : (await DB.get("papers", p.id));
        if (!cur) { IO.toast("文献已不存在"); return true; }
        cur.title = v.title;
        cur.authors = BIB.splitAuthors(v.authors);
        cur.type = v.type; cur.journal = v.journal; cur.year = v.year;
        cur.volume = v.volume; cur.issue = v.issue; cur.pages = v.pages;
        cur.doi = v.doi; cur.url = v.url; cur.publisher = v.publisher;
        cur.tags = v.tags ? v.tags.split(/[，,]/).map((x) => x.trim()).filter(Boolean) : [];
        await save(cur);
        IO.toast(isNew ? "已添加" : "已保存");
        if (isNew) App.go("papers", { id: cur.id }); else App.refresh();
        return true;
      },
    });
  }

  // ---------- 引用 ----------
  // 引用格式列表：以 BIB.STYLES 为准，另外补上 IEEE 与国标·著者-出版年制。
  // bib.js 若已把这两项加进 STYLES 就不会重复；还没加时这里也能先跑起来。
  function citeStyles() {
    const base = (window.BIB && Array.isArray(BIB.STYLES)) ? BIB.STYLES.slice() : [];
    const has = {};
    base.forEach((s) => { has[s.v] = true; });
    [{ v: "ieee", l: "IEEE" }, { v: "gbay", l: "国标·著者出版年制" }].forEach((s) => {
      if (!has[s.v]) base.push(s);
    });
    return base;
  }

  async function citeModal(p) {
    let style = await DB.metaGet("citeStyle", "gb");
    const build = () => {
      const txt = BIB.cite(p, style);
      return '<div class="seg" id="cstyle">' + citeStyles().map((s) =>
        '<button data-cs="' + s.v + '" class="' + (style === s.v ? "on" : "") + '">' + s.l + "</button>").join("") + "</div>" +
        '<div class="cite-box">' + IO.esc(txt) + "</div>" +
        '<div class="tiny" style="margin-bottom:8px">文中引用角标：<b>[' + 1 + "]</b></div>" +
        '<button class="btn pri wide" data-copy="' + IO.esc(txt) + '">复制这条引用</button>';
    };
    const draw = (card) => {
      card.querySelector("#citewrap").innerHTML = build();
      card.querySelectorAll("[data-cs]").forEach((b) => {
        b.addEventListener("click", async () => {
          style = b.getAttribute("data-cs");
          await DB.metaSet("citeStyle", style);
          draw(card);
        });
      });
    };
    UI.modal({
      title: "引用这篇文献",
      body: '<div id="citewrap"></div>',
      actions: [{ label: "关闭", cls: "ghost", fn: () => true }],
      mount: (card) => draw(card),
    });
  }

  // 引用中心：勾选多篇 → 生成参考文献表
  async function refCenter(presetIds, title) {
    const all = await DB.all("papers");
    all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const sel = new Set(presetIds || []);
    let style = await DB.metaGet("citeStyle", "gb");
    const checked = () => Array.from(document.querySelectorAll("#reflist [data-rid]"))
      .filter((b) => b.querySelector(".tick").classList.contains("on"))
      .map((b) => b.getAttribute("data-rid"));
    const out = () => {
      const ids = checked();
      const box = document.getElementById("refout");
      const btn = document.getElementById("refcopy");
      const bibtn = document.getElementById("refbib");
      if (!ids.length) {
        box.innerHTML = '<div class="empty" style="padding:18px 0">先在上面勾选文献</div>';
        btn.setAttribute("data-copy", ""); return;
      }
      const arr = ids.map((id) => all.find((p) => p.id === id)).filter(Boolean);
      const txt = BIB.refList(arr, style);
      box.innerHTML = txt.split("\n").map((l) =>
        '<div class="refline"><span class="no">' + IO.esc(l.slice(0, l.indexOf("]") + 1)) + "</span>" +
        '<span class="tx">' + IO.esc(l.slice(l.indexOf("]") + 1).trim()) + "</span></div>").join("");
      btn.setAttribute("data-copy", txt);
      bibtn.setAttribute("data-bib", ids.join(","));
    };
    const body =
      '<div class="seg" id="rstyle">' + citeStyles().map((s) =>
        '<button data-cs="' + s.v + '" class="' + (style === s.v ? "on" : "") + '">' + s.l + "</button>").join("") + "</div>" +
      '<div id="reflist" style="max-height:36vh;overflow:auto;margin:0 -6px">' +
      (all.length ? all.map((p) =>
        '<button class="item" style="width:100%;text-align:left" data-rid="' + IO.esc(p.id) + '">' +
        '<span class="tick' + (sel.has(p.id) ? " on" : "") + '"></span>' +
        '<div class="ib"><div class="t1">' + IO.esc(p.title) + "</div>" +
        '<div class="t2">' + IO.esc(oneLine(p)) + "</div></div></button>").join("")
        : '<div class="empty">还没有文献</div>') +
      "</div>" +
      '<div class="sec" style="margin:12px 0 6px"><h2>参考文献表</h2></div>' +
      '<div id="refout"></div>' +
      '<div class="btnrow" style="margin-top:10px">' +
      '<button class="btn pri" id="refcopy" data-copy="">复制全部</button>' +
      '<button class="btn ghost" id="refbib" data-bib="">导出 .bib</button></div>';

    UI.modal({
      title: title || "引用中心",
      body,
      actions: [{ label: "关闭", cls: "ghost", fn: () => true }],
      mount: (card) => {
        card.querySelectorAll("[data-cs]").forEach((b) => {
          b.addEventListener("click", async () => {
            style = b.getAttribute("data-cs");
            await DB.metaSet("citeStyle", style);
            card.querySelectorAll("[data-cs]").forEach((x) => x.classList.toggle("on", x.getAttribute("data-cs") === style));
            out();
          });
        });
        card.querySelectorAll("[data-rid]").forEach((b) => {
          b.addEventListener("click", () => { b.querySelector(".tick").classList.toggle("on"); out(); });
        });
        const bibtn = card.querySelector("#refbib");
        bibtn.addEventListener("click", () => {
          const ids = (bibtn.getAttribute("data-bib") || "").split(",").filter(Boolean);
          if (!ids.length) { IO.toast("请先勾选文献"); return; }
          const arr = ids.map((id) => all.find((p) => p.id === id)).filter(Boolean);
          const txt = arr.map(BIB.toBib).join("\n");
          IO.download(new Blob([txt], { type: "text/plain;charset=utf-8" }), "研计划-参考文献.bib");
          IO.toast("已导出 " + arr.length + " 条 BibTeX");
        });
        out();
      },
    });
  }

  // ---------- 视图 ----------
  async function render() {
    if (App.arg && App.arg.id) return detailHTML(App.arg.id);
    return listHTML();
  }

  async function mount() {
    const root = document.getElementById("view");
    if (App.arg && App.arg.id) return mountDetail(root, App.arg.id);
    const inp = root.querySelector("#pq");
    if (inp) {
      let timer = null;
      // 防抖 300ms：全文检索要扫 ft 表，不能每敲一个字就全表扫一遍
      inp.addEventListener("input", () => {
        Q.q = inp.value;
        clearTimeout(timer);
        timer = setTimeout(() => { redrawList(root.querySelector("#plist")); }, 300);
      });
    }
    root.querySelectorAll("#pstat [data-st]").forEach((b) => {
      b.addEventListener("click", async () => {
        Q.status = b.getAttribute("data-st");
        root.querySelectorAll("#pstat [data-st]").forEach((x) => x.classList.toggle("on", x === b));
        await redrawList(root.querySelector("#plist"));
      });
    });
    const add = root.querySelector("#padd");
    if (add) add.addEventListener("click", addMenu);
    const imp = root.querySelector("#pimp");
    if (imp) imp.addEventListener("click", () => importPdfDialog({}));
    const rf = root.querySelector("#pref");
    if (rf) rf.addEventListener("click", () => refCenter([]));
    root.querySelectorAll("[data-paper]").forEach((c) => {
      c.addEventListener("click", () => App.go("papers", { id: c.getAttribute("data-paper") }));
    });
  }

  async function mountDetail(root, id) {
    let p = await DB.get("papers", id);
    if (!p) return;

    root.querySelectorAll("#dstat [data-set]").forEach((b) => {
      b.addEventListener("click", async () => {
        p = await DB.get("papers", id);
        p.status = b.getAttribute("data-val");
        await save(p);
        App.refresh();
      });
    });
    const range = root.querySelector('[data-set="progress"]');
    if (range) {
      range.addEventListener("change", async () => {
        p = await DB.get("papers", id);
        p.progress = IO.clamp(range.value, 0, 100);
        await save(p);
        App.refresh();
      });
      range.addEventListener("input", () => {
        const v = root.querySelector("#pgv");
        if (v) v.textContent = range.value + "%";
      });
    }
    const sum = root.querySelector('[data-set="summary"]');
    if (sum) sum.addEventListener("change", async () => {
      p = await DB.get("papers", id);
      p.summary = sum.value;
      await save(p);
      IO.toast("总结已保存");
    });

    root.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => {
      const a = b.getAttribute("data-act");
      // 【手势纪律】addfile 会调 UI.pickFile，必须排在下面那个 await DB.get 之前，
      // 否则 pickFile 落在 await 之后，手机浏览器静默不弹文件选择器。
      if (a === "addfile") {
        const files = await UI.pickFile("", true);
        if (!files.length) return;
        IO.busy(true, "上传中…");
        const metas = await UI.attach.add(files, false);
        p = await DB.get("papers", id);
        p.files = (p.files || []).concat(metas);
        await save(p);
        IO.busy(false);
        IO.toast("已添加 " + metas.length + " 个附件");
        App.refresh();
        return;
      }
      p = await DB.get("papers", id);
      if (!p) return;
      if (a === "edit") return editForm(p, false);
      // 自动识别元数据：读完正文后开的是表单弹窗（非阻塞），刷新由表单内部负责
      if (a === "autometa") { await autoMeta(id); return; }
      // reindexPaper 全程 await（内部只有 toast，没有非阻塞弹窗），可以安全地在后面刷新
      if (a === "reindex") { await reindexPaper(p); App.refresh(); return; }
      if (a === "cite") return citeModal(p);
      if (a === "copygb") {
        const t = BIB.cite(p, "gb");
        UI.modal({
          title: "GB/T 7714", body: '<div class="cite-box">' + IO.esc(t) + "</div>",
          actions: [{ label: "复制", cls: "pri", fn: async () => { await IO.copyText(t); IO.toast("已复制"); return true; } }],
        });
        return;
      }
      if (a === "todayread") {
        // 关联到「带导入文献入口」的那个打卡类型（默认就是「文献阅读」，改名后也跟得上）
        const tys = await Home.ckTypes();
        const tt = tys.find((x) => x.flags && x.flags.import) || { id: "lit" };
        const c = await Home.getCheckin(tt.id);
        const s = new Set(c.paperIds || []);
        s.add(id);
        await Home.saveCheckin(tt.id, { paperIds: Array.from(s) });
        IO.toast("已标记今天读过");
        App.refresh();
        return;
      }
      if (a === "addnote") {
        UI.form({
          title: "添加笔记",
          fields: [{ k: "text", label: "笔记内容", type: "textarea", rows: 5, ph: "这段的论证方式 / 可复用的实验设置…" }],
          onSubmit: async (v) => {
            if (!v.text.trim()) return false;
            p = await DB.get("papers", id);
            p.notes = p.notes || [];
            p.notes.push({ id: IO.uid(), ts: Date.now(), text: v.text });
            await save(p);
            App.refresh();
            return true;
          },
        });
        return;
      }
      if (a === "del") {
        const ok = await UI.confirm("删除《" + p.title + "》？笔记、总结和附件会一起删除，且无法恢复。", { danger: true, ok: "删除" });
        if (!ok) return;
        await DB.delWithFiles("papers", id, (p.files || []).map((f) => f.id));
        await DB.del("ft", id);   // 全文索引跟着一起清，避免留孤儿索引
        IO.toast("已删除");
        App.go("papers");
        return;
      }
    }));

    root.querySelectorAll("[data-editnote]").forEach((b) => b.addEventListener("click", async () => {
      p = await DB.get("papers", id);
      const n = (p.notes || []).find((x) => x.id === b.getAttribute("data-editnote"));
      if (!n) return;
      UI.form({
        title: "编辑笔记",
        fields: [{ k: "text", label: "笔记内容", type: "textarea", rows: 5, value: n.text }],
        onSubmit: async (v) => { n.text = v.text; n.ts = Date.now(); await save(p); App.refresh(); return true; },
      });
    }));
    root.querySelectorAll("[data-delnote]").forEach((b) => b.addEventListener("click", async () => {
      const ok = await UI.confirm("删除这条笔记？", { danger: true, ok: "删除" });
      if (!ok) return;
      p = await DB.get("papers", id);
      p.notes = (p.notes || []).filter((x) => x.id !== b.getAttribute("data-delnote"));
      await save(p);
      App.refresh();
    }));
    root.querySelectorAll("[data-openf]").forEach((b) => b.addEventListener("click", () => UI.attach.open(b.getAttribute("data-openf"))));
    root.querySelectorAll("[data-delf]").forEach((b) => b.addEventListener("click", async () => {
      const fid = b.getAttribute("data-delf");
      const ok = await UI.confirm("删除这个附件？", { danger: true, ok: "删除" });
      if (!ok) return;
      p = await DB.get("papers", id);
      p.files = (p.files || []).filter((f) => f.id !== fid);
      await save(p);
      await UI.attach.del(fid);
      App.refresh();
    }));
  }

  return {
    title: () => (App.arg && App.arg.id ? "文献详情" : "文献阅读"),
    render, mount,
    addMenu, editForm, citeModal, refCenter, importParsed, filesHTML, oneLine, cardHTML, blank, save,
    // 供竞赛 / 课题复用：PDF 导入与全文索引
    ensurePdf, importPdfDialog, importPdfPicked, importPdfFiles, reindexPaper, searchFulltext, citeStyles, PDF_MAX_PAGES,
    openPdfReader,
  };
})();
