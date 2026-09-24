/* 考试与成绩模块：备考中 / 已考完两个独立分区 + 生词本
 * 覆盖的不只是英语：四六级、考研、计算机等级、软考、法考、CPA 等全国性考试都走这里。
 *
 * 状态流转：备考中 --(填入成绩)--> 已考完
 *   · 备考中的考试会在今日页自动拥有一张专属打卡卡（「六级备考」），见 Home.ensureExamType
 *   · 转成已考完的那一刻：专属打卡自动归档（不再要求每天打卡），
 *     并把备考期间的打卡统计成总结（天数 / 次数 / 累计学习量 / 起止日期）写进考试条目
 *   · 已考完卡片可以反复记历史成绩、上传证书与成绩单
 *
 * 生词本是英语学习的附属，已从本页移到首页快捷入口，这里只导出 openVocab() 弹窗供首页调用。
 */
"use strict";

const Exams = (function () {
  // Q.tab：当前看「备考中」还是「已考完」；Q.vocab：生词本筛选（弹窗用）
  const Q = { tab: "plan", vocab: "no" };
  const VOCAB_CAP = 100;   // 生词本弹窗里一次列出多少条
  const VFILTER = [{ v: "no", l: "未掌握" }, { v: "yes", l: "已掌握" }, { v: "all", l: "全部" }];

  function blankExam() {
    // score：考完后的实际得分（一眼要看到的是它，不是 target）
    // pass：及格 / 过关分；备考中填成绩且达标时自动改已考完并弹「恭喜上岸」
    // certs：已考完后上传的证书 / 成绩单附件
    // ck：备考期间是否在今日页关联一个专属打卡（默认开）
    // summary：转已考完那一刻自动算出来的备考总结（打卡天数 / 次数 / 累计）
    return { id: IO.uid(), type: "CET6", name: "", date: "", target: "", pass: "", score: "",
      state: "plan", scores: [], certs: [], ck: true, summary: null, createdAt: Date.now() };
  }
  async function saveExam(e) { await DB.put("exams", e); return e; }

  // 考试与它的专属打卡类型同步：
  // 备考中 → 建 / 恢复打卡类型；已考完 → 归档并生成总结。取消关联只是归档，绝不删历史记录。
  async function syncExam(e) {
    if (e.state === "done") {
      e.summary = await Home.archiveExamType(e);
    } else if (e.ck !== false) {
      await Home.ensureExamType(e);
      e.summary = null;
    } else {
      await Home.archiveExamType(e);
      e.summary = null;
    }
  }

  // 考试名：类型 + 备注名
  function examName(e) {
    const base = CLabel(CONST.examType, e && e.type);
    return base + (e && e.name ? " · " + e.name : "");
  }

  // 关联打卡这一行：从今日页那张专属打卡卡统计出来的进度
  function ckLine(e, types, pool) {
    const t = types.find((x) => x.examId === e.id);
    if (!t) return "";
    const sum = Home.totalsOf(t.id, pool);
    const bits = Home.metricsOf(t).map((m) => {
      const v = Number((sum.vals || {})[m.k]) || 0;
      return v ? v + (m.unit || "") : "";
    }).filter(Boolean);
    return '<div class="ex-ck">' +
      '<span class="chip en">关联打卡</span>' +
      '<span>' + IO.esc(t.name) + " · 已打卡 " + sum.n + " 天" +
      (bits.length ? " · 累计 " + IO.esc(bits.join(" · ")) : "") + "</span>" +
      '<button class="btn sm ghost mini" data-gotock="' + IO.esc(t.id) + '">去打卡</button></div>';
  }

  // 备考总结一行（已考完卡片用）
  function summaryLine(e) {
    const s = e.summary;
    if (!s || !s.n) return '<div class="ex-sum muted">备考期间没有打卡记录</div>';
    // 总结里存的是 {指标键: 累计值}，单位从当前打卡类型上取；类型已被归档也还能查到
    const bits = [];
    return '<div class="ex-sum"><span class="chip ok">备考总结</span>' +
      "备考 " + s.days + " 天 · 打卡 " + s.n + " 次" +
      (bits.length ? " · 累计 " + IO.esc(bits.join(" · ")) : "") +
      (s.from ? " · " + IO.fmtMD(s.from) + " → " + IO.fmtMD(s.to) : "") + "</div>";
  }

  // ---------- 备考中卡片 ----------
  function planCard(e, types, pool) {
    const d = e.date ? IO.diffDays(IO.today(), e.date) : null;
    const cls = d === null ? "" : (d < 0 ? "dg" : (d <= 30 ? "warn" : "ok"));
    return '<div class="card" data-exam="' + IO.esc(e.id) + '">' +
      '<div class="ch"><h3>' + IO.esc(examName(e)) + "</h3>" +
      (d === null ? '<span class="chip">未设日期</span>' :
        '<span class="chip ' + cls + '">' + (d < 0 ? "已过 " + (-d) + " 天" : (d === 0 ? "今天考" : "还有 " + d + " 天")) + "</span>") +
      "</div>" +
      '<div class="tiny" style="margin-bottom:8px">' +
      (e.date ? "考试日 " + IO.esc(IO.fmtMD(e.date)) + " · " : "") +
      (e.target ? "目标 " + IO.esc(e.target) + " · " : "") +
      (e.pass ? "及格 " + IO.esc(e.pass) : "") +
      "</div>" +
      ckLine(e, types, pool) +
      '<div class="btnrow" style="margin-top:10px">' +
      '<button class="btn pri" data-finish="' + IO.esc(e.id) + '" title="填入成绩后自动转为已考完，并生成备考总结">填写成绩</button>' +
      '<button class="btn ghost sm" data-editexam="' + IO.esc(e.id) + '">编辑</button>' +
      '<button class="btn ghost sm" data-delexam="' + IO.esc(e.id) + '">删除</button>' +
      "</div></div>";
  }

  // ---------- 已考完卡片 ----------
  function doneCard(e) {
    const scores = (e.scores || []).slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const best = scores.reduce((m, s) => Math.max(m, Number(s.total) || 0), 0);
    const certs = e.certs || [];
    const scoreTxt = e.score || (best ? String(best) : "");
    return '<div class="card" data-exam="' + IO.esc(e.id) + '">' +
      '<div class="ch"><h3>' + IO.esc(examName(e)) + '</h3><span class="chip ok">已考完</span></div>' +
      '<div class="ex-score">' +
      '<span class="muted" style="font-size:13px">成绩</span>' +
      "<b>" + IO.esc(scoreTxt || "—") + "</b>" +
      (e.target ? '<span class="tiny">目标 ' + IO.esc(e.target) + "</span>" : "") +
      (e.pass ? '<span class="tiny">及格 ' + IO.esc(e.pass) + "</span>" : "") +
      (Number(e.pass) ? '<span class="chip ' + (passit(e) ? "ok" : "dg") + '">' +
        (passit(e) ? "已过线" : "未过线") + "</span>" : "") +
      "</div>" +
      summaryLine(e) +
      '<div class="ex-sub">历史成绩记录 ' + scores.length + " 次" + (best ? " · 最好 " + best : "") + "</div>" +
      (scores.length ? scores.map((s, i) => scoreRow(s, e, i)).join("") :
        '<div class="tiny">还没有成绩记录</div>') +
      '<button class="btn ghost sm" data-addscore="' + IO.esc(e.id) + '" style="margin-top:8px">＋ 记一次成绩</button>' +
      '<div class="ex-sub" style="margin-top:12px;padding-top:8px;border-top:1px solid var(--line2)">' +
      "证书 / 成绩单 " + certs.length + " 个</div>" +
      Papers.filesHTML(certs) +
      '<button class="btn ghost sm" data-certfile="' + IO.esc(e.id) + '" style="margin-top:6px">上传证书 / 成绩单</button>' +
      '<div class="btnrow" style="margin-top:10px">' +
      '<button class="btn ghost sm" data-editexam="' + IO.esc(e.id) + '">编辑</button>' +
      '<button class="btn ghost sm" data-delexam="' + IO.esc(e.id) + '">删除</button>' +
      "</div></div>";
  }

  // 过线判定：填了及格分才算，没填就当作不判断
  function passit(e) {
    const p = Number(e.pass) || 0;
    if (!p) return false;
    return (Number(e.score) || 0) >= p;
  }

  function scoreRow(s, e, i) {
    return '<div style="padding:8px 0' + (i ? ";border-top:1px solid var(--line2)" : "") + '">' +
      '<div style="display:flex;align-items:center;gap:8px"><b style="font-size:16px">' + IO.esc(s.total || "-") + "</b>" +
      '<span class="tiny">' + IO.esc(s.date ? IO.fmtMD(s.date) : "") + "</span>" +
      '<button class="x" style="margin-left:auto" data-delscore="' + IO.esc(s.id) + '" data-exid="' + IO.esc(e.id) + '">删除</button></div>' +
      '<div class="chips" style="margin-top:5px">' +
      parts(s).map((p) => '<span class="chip en">' + IO.esc(p) + "</span>").join("") +
      "</div>" +
      (s.note ? '<div class="tiny" style="margin-top:5px;white-space:pre-wrap">' + IO.esc(s.note) + "</div>" : "") +
      '<div style="margin-top:4px">' + Papers.filesHTML(s.files) + "</div>" +
      '<button class="btn sm ghost" data-scorefile="' + IO.esc(s.id) + '" data-exid="' + IO.esc(e.id) + '" style="margin-top:6px">上传成绩单 / 证书</button>' +
      "</div>";
  }

  // 成绩分项：不同考试科目名不一样，这里只显示填了的字段
  function parts(s) {
    const out = [];
    const map = [["listening", "科目一"], ["reading", "科目二"], ["writing", "科目三"], ["speaking", "科目四"]];
    map.forEach((m) => { if (s[m[0]]) out.push(m[1] + " " + s[m[0]]); });
    return out;
  }

  // ---------- 生词本（已从本页移到首页快捷入口，这里保留弹窗供首页调用） ----------
  function vocabHTML(v) {
    return '<div class="item" style="padding:9px 0">' +
      '<button class="tick' + (v.mastered ? " on" : "") + '" data-vtoggle="' + IO.esc(v.id) + '"></button>' +
      '<div class="ib"><div class="t1"><b>' + IO.esc(v.word) + "</b>" +
      (v.mastered ? ' <span class="chip ok">已掌握</span>' : "") + "</div>" +
      '<div class="t2">' + IO.esc(v.meaning || "") + (v.note ? " · " + IO.esc(v.note) : "") + "</div></div>" +
      '<button class="btn sm ghost" data-vedit="' + IO.esc(v.id) + '">编辑</button>' +
      '<button class="x" data-vdel="' + IO.esc(v.id) + '">删除</button></div>';
  }

  function pickVocab(vs) {
    return Q.vocab === "yes" ? vs.filter((v) => v.mastered) :
      (Q.vocab === "no" ? vs.filter((v) => !v.mastered) : vs);
  }

  function filterSeg(id) {
    return '<div class="seg" id="' + id + '">' + VFILTER.map((s) =>
      '<button data-vf="' + s.v + '" class="' + (Q.vocab === s.v ? "on" : "") + '">' + s.l + "</button>").join("") +
      "</div>";
  }

  function vocabEmpty(total) {
    return '<div class="empty" style="padding:22px 0">' +
      (total ? "当前筛选下没有词，换一个筛选看看"
        : "还没有生词<br>读到不认识的词，用下面的「＋ 添加生词」随手记一条") +
      "</div>";
  }

  // repaint：改完数据后重画哪里 —— 弹窗里只重画弹窗自己的列表
  function bindVocabList(box, repaint) {
    box.querySelectorAll("[data-vtoggle]").forEach((b) => b.addEventListener("click", async () => {
      const v = await DB.get("vocab", b.getAttribute("data-vtoggle"));
      if (v) { v.mastered = !v.mastered; await DB.put("vocab", v); repaint(); }
    }));
    box.querySelectorAll("[data-vedit]").forEach((b) => b.addEventListener("click", async () => {
      const v = await DB.get("vocab", b.getAttribute("data-vedit"));
      if (v) vocabForm(v, repaint);
    }));
    box.querySelectorAll("[data-vdel]").forEach((b) => b.addEventListener("click", async () => {
      const ok = await UI.confirm("删除这个词？", { danger: true, ok: "删除" });
      if (!ok) return;
      await DB.del("vocab", b.getAttribute("data-vdel"));
      repaint();
    }));
  }

  // 首页「生词本 → 进入」调这个：不跳页面，弹窗里列出全部词，筛选 / 勾选 / 编辑 / 删除都能用
  function openVocab() {
    let cardRef = null;
    // 弹窗退出路径有「完成 / ✕ / 点遮罩」三条，用 once 保证只刷新一次
    let refreshed = false;
    const refreshOnce = () => { if (refreshed) return; refreshed = true; App.refresh(); };
    const paint = async () => {
      if (!cardRef) return;
      const wrap = cardRef.querySelector("#vwrap");
      if (!wrap) return;
      const vs = (await DB.all("vocab")).sort((a, b) => (b.ts || 0) - (a.ts || 0));
      const list = pickVocab(vs);
      wrap.innerHTML = filterSeg("mfilter") +
        '<button class="btn pri wide" id="mvadd" style="margin-top:8px;margin-bottom:8px">＋ 添加生词</button>' +
        '<div class="card">' + (list.length ? list.slice(0, VOCAB_CAP).map(vocabHTML).join("") : vocabEmpty(vs.length)) + "</div>";
      wrap.querySelectorAll("[data-vf]").forEach((b) => b.addEventListener("click", () => {
        Q.vocab = b.getAttribute("data-vf");
        paint();
      }));
      const va = wrap.querySelector("#mvadd");
      if (va) va.addEventListener("click", () => vocabForm(null, () => { paint(); App.refresh(); }));
      // 弹窗内删改数据后：重画弹窗列表，同时刷一下下面的页面（#view 与 #modal 互不影响）；
      // 这里的 App.refresh 不能省 —— 弹窗里再开二级弹窗（确认框）会覆盖 UI 的 onClose 钩子。
      bindVocabList(wrap, () => { paint(); App.refresh(); });
    };
    UI.modal({
      title: "生词本",
      body: '<div id="vwrap"></div>',
      actions: [{ label: "完成", cls: "pri", fn: () => { refreshOnce(); return true; } }],
      onClose: refreshOnce,
      mount: (card) => { cardRef = card; paint(); },
    });
  }

  // ---------- 页面 ----------
  async function render() {
    const exams = await DB.all("exams");
    const types = await Home.ckTypes();
    const pool = await DB.all("checkins");
    const byDate = (a, b) => String(a.date || "9999").localeCompare(String(b.date || "9999"));
    const plans = exams.filter((e) => e.state !== "done").sort(byDate);
    const dones = exams.filter((e) => e.state === "done").sort((a, b) => byDate(b, a));

    let h = '<div class="seg" id="etab">' +
      '<button data-et="plan" class="' + (Q.tab === "plan" ? "on" : "") + '">备考中 ' + plans.length + "</button>" +
      '<button data-et="done" class="' + (Q.tab === "done" ? "on" : "") + '">已考完 ' + dones.length + "</button>" +
      "</div>";

    h += '<button class="btn pri wide" id="eaddd" style="margin-bottom:10px">＋ 添加考试</button>';

    if (Q.tab === "plan") {
      h += plans.length ? plans.map((e) => planCard(e, types, pool)).join("") :
        '<div class="empty">还没有备考中的考试<br>四六级、考研、计算机二级、法考、CPA 都能建，<br>填了考试日期首页会显示倒计时</div>';
    } else {
      h += dones.length ? dones.map((e) => doneCard(e)).join("") :
        '<div class="empty">还没有已考完的考试<br>在「备考中」的卡片上点「填写成绩」就会转到这里</div>';
    }
    return h;
  }

  async function mount() {
    const root = document.getElementById("view");
    root.querySelectorAll("#etab [data-et]").forEach((b) => {
      b.addEventListener("click", () => { Q.tab = b.getAttribute("data-et"); App.refresh(); });
    });
    const eadd = root.querySelector("#eaddd");
    if (eadd) eadd.addEventListener("click", () => examForm(blankExam(), true));
    // 「去打卡」：跳到今日页（专属打卡卡就在那儿）
    root.querySelectorAll("[data-gotock]").forEach((b) => {
      b.addEventListener("click", () => App.go("home"));
    });

    root.querySelectorAll("[data-editexam]").forEach((b) => b.addEventListener("click", async () => {
      const e = await DB.get("exams", b.getAttribute("data-editexam"));
      if (e) examForm(e, false);
    }));
    root.querySelectorAll("[data-delexam]").forEach((b) => b.addEventListener("click", async () => {
      const id = b.getAttribute("data-delexam");
      const e = await DB.get("exams", id);
      const ok = await UI.confirm("删除「" + examName(e || {}) + "」？它的成绩记录、证书和关联打卡都会被清除。",
        { danger: true, ok: "删除" });
      if (!ok) return;
      const ids = [];
      ((e && e.scores) || []).forEach((s) => (s.files || []).forEach((f) => ids.push(f.id)));
      ((e && e.certs) || []).forEach((f) => ids.push(f.id));
      await DB.delWithFiles("exams", id, ids);
      // 关联的专属打卡类型与它的打卡记录一起清掉
      await Home.removeExamType(id);
      App.refresh();
    }));
    root.querySelectorAll("[data-finish]").forEach((b) => {
      b.addEventListener("click", () => scoreForm(b.getAttribute("data-finish")));
    });
    root.querySelectorAll("[data-addscore]").forEach((b) => {
      b.addEventListener("click", () => scoreForm(b.getAttribute("data-addscore")));
    });
    root.querySelectorAll("[data-delscore]").forEach((b) => b.addEventListener("click", async () => {
      const e = await DB.get("exams", b.getAttribute("data-exid"));
      if (!e) return;
      const s = (e.scores || []).find((x) => x.id === b.getAttribute("data-delscore"));
      e.scores = (e.scores || []).filter((x) => x.id !== b.getAttribute("data-delscore"));
      await saveExam(e);
      if (s) for (const f of (s.files || [])) await UI.attach.del(f.id);
      App.refresh();
    }));
    root.querySelectorAll("[data-scorefile]").forEach((b) => b.addEventListener("click", async () => {
      const files = await UI.pickFile("image/*,application/pdf", true);
      if (!files || !files.length) return;
      IO.busy(true, "上传中…");
      try {
        const metas = await UI.attach.add(files, true);
        const e = await DB.get("exams", b.getAttribute("data-exid"));
        const s = (e.scores || []).find((x) => x.id === b.getAttribute("data-scorefile"));
        if (s) { s.files = (s.files || []).concat(metas); await saveExam(e); }
        IO.toast("已上传成绩单");
      } catch (err) {
        IO.toast("上传失败：" + (err && err.message ? err.message : err));
      } finally { IO.busy(false); }
      App.refresh();
    }));
    root.querySelectorAll("[data-certfile]").forEach((b) => b.addEventListener("click", async () => {
      const files = await UI.pickFile("image/*,application/pdf,.doc,.docx", true);
      if (!files || !files.length) return;
      IO.busy(true, "上传中…");
      try {
        const metas = await UI.attach.add(files, true);
        const e = await DB.get("exams", b.getAttribute("data-certfile"));
        if (e) { e.certs = (e.certs || []).concat(metas); await saveExam(e); }
        IO.toast("已上传 " + metas.length + " 个证书 / 成绩单");
      } catch (err) {
        IO.toast("上传失败：" + (err && err.message ? err.message : err));
      } finally {
        IO.busy(false);
      }
      App.refresh();
    }));
    root.querySelectorAll("[data-openf]").forEach((b) => b.addEventListener("click", () => UI.attach.open(b.getAttribute("data-openf"))));
    root.querySelectorAll("[data-delf]").forEach((b) => b.addEventListener("click", async () => {
      const fid = b.getAttribute("data-delf");
      const all = await DB.all("exams");
      for (const e of all) {
        let hit = false;
        (e.scores || []).forEach((s) => {
          if ((s.files || []).some((f) => f.id === fid)) {
            s.files = s.files.filter((f) => f.id !== fid); hit = true;
          }
        });
        // 证书挂在考试条目本身（e.certs），删除时要一并摘掉
        if ((e.certs || []).some((f) => f.id === fid)) {
          e.certs = e.certs.filter((f) => f.id !== fid); hit = true;
        }
        if (hit) await saveExam(e);
      }
      await UI.attach.del(fid);
      App.refresh();
    }));
  }

  // 「恭喜上岸」庆祝层：独立覆盖层（不走 UI.modal，避免和刚关闭的成绩表单互相顶替）。
  // 可关闭；提供「上传成绩证书」入口，上传后证书挂在考试条目的 certs 上。
  function showCongrats(e) {
    const layer = document.createElement("div");
    layer.className = "congrats-layer";
    layer.innerHTML =
      '<div class="cg-card">' +
      '<div class="cg-emoji">🎉</div>' +
      '<div class="cg-title">恭喜上岸！</div>' +
      '<div class="cg-sub">你通过了 ' + IO.esc(examName(e)) + "</div>" +
      '<div class="cg-score">成绩 ' + IO.esc(String(e.score || "")) +
      (e.pass ? ' <span class="cg-pass">（及格线 ' + IO.esc(String(e.pass)) + "）</span>" : "") + "</div>" +
      '<div class="cg-tip">这一路不容易，留个纪念吧。</div>' +
      '<div class="btnrow">' +
      '<button class="btn pri" id="cg-upload">上传成绩证书</button>' +
      '<button class="btn ghost" id="cg-later">稍后再说</button>' +
      "</div></div>";
    document.body.appendChild(layer);
    function close() { layer.remove(); App.refresh(); }
    layer.addEventListener("click", (ev) => { if (ev.target === layer) close(); });
    layer.querySelector("#cg-later").addEventListener("click", close);
    layer.querySelector("#cg-upload").addEventListener("click", async () => {
      const files = await UI.pickFile("image/*,application/pdf,.doc,.docx", true);
      if (!files || !files.length) return;
      IO.busy(true, "上传中…");
      try {
        const metas = await UI.attach.add(files, true);
        const cur = await DB.get("exams", e.id);
        if (cur) { cur.certs = (cur.certs || []).concat(metas); await saveExam(cur); }
        IO.toast("已上传 " + metas.length + " 个证书");
        close();
      } catch (err) {
        IO.toast("上传失败：" + (err && err.message ? err.message : err));
      } finally { IO.busy(false); }
    });
  }

  function examForm(e, isNew) {
    UI.form({
      title: isNew ? "添加考试" : "编辑考试",
      fields: [
        { k: "type", label: "考试类型", type: "select", value: e.type, opts: CONST.examType },
        { k: "name", label: "备注名（可留空）", value: e.name, ph: "如 2026年6月六级 / 计算机二级 Python" },
        { k: "date", label: "考试日期", type: "date", value: e.date },
        { k: "target", label: "目标分（备考时用，可留空）", value: e.target, ph: "如 六级 550 / 雅思 7.0" },
        { k: "ck", label: "备考期间在今日页关联一个打卡", type: "check", value: e.ck !== false },
      ],
      note: "关联打卡后，今日页会多出一张「" + IO.esc(examCkPreviewName(e)) +
        "」打卡卡；考完填成绩时它会自动归档，并把备考期间的打卡统计成总结。",
      onSubmit: async (v) => {
        const cur = isNew ? blankExam() : (await DB.get("exams", e.id));
        if (!cur) { IO.toast("记录已不存在"); return true; }
        cur.type = v.type; cur.name = v.name; cur.date = v.date;
        // 及格分已从表单里去掉（v1.5.0）：新建一律为空，编辑时保留这条考试原有的及格线
        cur.target = v.target; cur.ck = !!v.ck;
        // 考试类型 / 备注名变了，关联的打卡类型名要跟着改（已考完的一律保持归档）
        await syncExam(cur);
        await saveExam(cur);
        IO.toast(isNew ? "已添加" : "已保存");
        App.refresh();
        return true;
      },
    });
  }

  // 表单里预览关联打卡的名字（用当前表单值拼，纯展示）
  function examCkPreviewName(e) {
    const base = CLabel(CONST.examType, e.type) || "考试";
    return (e.name || base) + "备考";
  }

  // 成绩表单：备考中点进来 = 填完成绩直接转已考完；已考完点进来 = 补记一次历史成绩
  function scoreForm(examId) {
    UI.form({
      title: "记录一次成绩",
      fields: [
        { k: "date", label: "考试 / 出分日期", type: "date", value: IO.today() },
        { k: "total", label: "总分 / 总成绩" },
        { k: "listening", label: "科目一（可留空）" },
        { k: "reading", label: "科目二（可留空）" },
        { k: "writing", label: "科目三（可留空）" },
        { k: "speaking", label: "科目四（可留空）" },
        { k: "note", label: "备注", type: "textarea", rows: 2 },
      ],
      note: "单项留空即可，不影响总分。科目一~四随考试类型自己定：英语可填听力/阅读/写作/口语。",
      onSubmit: async (v) => {
        const e = await DB.get("exams", examId);
        if (!e) return true;
        const total = v.total;
        e.scores = (e.scores || []).concat([{
          id: IO.uid(), date: v.date, total: total, listening: v.listening,
          reading: v.reading, writing: v.writing, speaking: v.speaking, note: v.note, files: [],
        }]);
        if (total) e.score = total;
        // 备考中填成绩 → 自动记录一次成绩、状态改为「已考完」，
        // 同时把关联的专属打卡归档并生成备考总结（打卡天数 / 次数 / 累计）
        const wasPlan = e.state !== "done";
        if (wasPlan) {
          e.state = "done";
          e.summary = await Home.archiveExamType(e);
        }
        await saveExam(e);
        IO.toast(wasPlan ? "成绩已记录，已转为已考完" : "成绩已记录");
        if (wasPlan) Q.tab = "done";   // 直接切到已考完区，让用户立刻看到结果与总结
        App.refresh();
        // 达标（分数 >= 及格分）才弹「恭喜上岸」；不达标只记录成绩（手动上传入口仍在）
        if (wasPlan) {
          const pass = Number(e.pass) || 0;
          const sc = Number(total) || 0;
          if (pass > 0 && sc >= pass) showCongrats(e);
        }
        return true;
      },
    });
  }

  // repaint 可选：在弹窗里调用时传弹窗自己的重画函数
  function vocabForm(v, repaint) {
    const after = repaint || (() => App.refresh());
    UI.form({
      title: v ? "编辑生词" : "添加生词",
      fields: [
        { k: "word", label: "单词 / 短语", value: v ? v.word : "" },
        { k: "meaning", label: "释义", value: v ? v.meaning : "" },
        { k: "note", label: "例句 / 备注", type: "textarea", rows: 2, value: v ? v.note : "" },
      ],
      onSubmit: async (x) => {
        if (!x.word.trim()) { IO.toast("不能为空"); return false; }
        const cur = v || { id: IO.uid(), mastered: false };
        cur.word = x.word; cur.meaning = x.meaning; cur.note = x.note;
        cur.ts = cur.ts || Date.now();
        await DB.put("vocab", cur);
        after();
        // 从生词本弹窗里进来时，UI.form 会把整个弹窗一起关掉；
        // 这里在下一轮事件循环重新打开，连续记词不用反复点「进入」。
        if (repaint) setTimeout(() => openVocab(), 0);
        return true;
      },
    });
  }

  return { title: "考试", render, mount, blankExam, examForm, scoreForm, vocabForm, openVocab, examName };
})();
