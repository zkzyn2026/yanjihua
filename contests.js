/* 竞赛记录模块：赛程轮次 / 阶段推进、关键节点、作品附件、获奖证书、队友与指导老师 */
"use strict";

const Contests = (function () {
  const Q = { f: "all" };
  const DEFAULT_ROUNDS = ["报名", "初赛", "复赛", "决赛"];

  // 赛程轮次（v1.5.0）：轮次名与日期都能改能删，比赛有几轮就配几轮，
  // 进度按「实际配的轮次」算，不再固定成报名/初赛/复赛/决赛四段。
  function defaultRounds() {
    return DEFAULT_ROUNDS.map((n) => ({ id: IO.uid(), name: n, date: "", done: false }));
  }
  // 老数据没有 rounds 字段：按空数组处理，详情页给「使用默认四轮」一键生成
  function roundsOf(c) { return Array.isArray(c && c.rounds) ? c.rounds : []; }

  // 赛程进度：一轮都没填日期 / 没勾完成 = 用户还没用上赛程，继续用手填进度；
  // 一旦用上就按「已完成轮次 / 实际轮次」算。
  function roundStat(c) {
    const rs = roundsOf(c);
    if (!rs.length) return null;
    if (!rs.some((r) => r.done || r.date)) return null;
    const done = rs.filter((r) => r.done).length;
    return { done: done, total: rs.length, pct: Math.round(done / rs.length * 100) };
  }
  function progressOf(c) { const s = roundStat(c); return s ? s.pct : (Number(c.progress) || 0); }
  // 轮次变动后把进度写回（全部轮次勾完自动置「已结束」）
  function syncProgress(c) {
    const s = roundStat(c);
    if (!s) return;
    c.progress = s.pct;
    if (s.pct >= 100 && c.stage !== "done") c.stage = "done";
  }

  function blank() {
    return {
      id: IO.uid(), name: "", level: "校级", org: "", start: IO.today(), deadline: "",
      stage: "prep", progress: 0, nodes: [], rounds: defaultRounds(),
      works: [], awards: [], paperIds: [],
      members: "", teacher: "", note: "", createdAt: Date.now(), updatedAt: Date.now(),
    };
  }
  async function save(c) { c.updatedAt = Date.now(); await DB.put("contests", c); return c; }

  function nextNode(c) {
    const pend = []
      .concat((c.nodes || []).filter((n) => n.date && !n.done).map((n) => ({ name: n.name, date: n.date })))
      .concat(roundsOf(c).filter((r) => r.date && !r.done).map((r) => ({ name: r.name, date: r.date })))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (pend.length) return pend[0];
    if (c.deadline) return { name: "截止", date: c.deadline };
    return null;
  }
  function daysText(c) {
    const n = nextNode(c);
    if (!n) return "未设置节点";
    const d = IO.diffDays(IO.today(), n.date);
    if (d < 0) return n.name + " 已逾期 " + (-d) + " 天";
    if (d === 0) return n.name + " 就是今天";
    return n.name + " 还有 " + d + " 天";
  }

  function cardHTML(c) {
    const n = nextNode(c);
    const d = n ? IO.diffDays(IO.today(), n.date) : null;
    const cls = d === null ? "" : (d < 0 ? "dg" : (d <= 7 ? "warn" : "ok"));
    return '<div class="card tap" data-ct="' + IO.esc(c.id) + '">' +
      '<div class="ch"><h3>' + IO.esc(c.name || "未命名竞赛") + "</h3>" +
      '<span class="chip ct">' + IO.esc(CLabel(CONST.contestStage, c.stage)) + "</span></div>" +
      '<div class="tiny" style="margin-bottom:6px">' +
      (c.org ? IO.esc(c.org) + " · " : "") + IO.esc(c.level || "") +
      (((c.awards || []).length) ? " · 获奖 " + c.awards.length + " 项" : "") + "</div>" +
      '<div class="bar"><i class="ct" style="width:' + progressOf(c) + '%"></i></div>' +
      '<div class="tiny" style="margin-top:7px">' +
      (n ? '<span class="chip ' + cls + '">' + IO.esc(daysText(c)) + "</span>" : '<span class="chip">未设置节点</span>') +
      "</div></div>";
  }

  async function listHTML() {
    const all = await DB.all("contests");
    const arr = all.filter((c) => {
      if (Q.f === "run") return c.stage !== "done";
      if (Q.f === "done") return c.stage === "done";
      if (Q.f === "award") return (c.awards || []).length > 0;
      return true;
    }).sort((a, b) => {
      const ad = a.deadline || "9999-12-31", bd = b.deadline || "9999-12-31";
      if (a.stage === "done" && b.stage !== "done") return 1;
      if (b.stage === "done" && a.stage !== "done") return -1;
      return ad.localeCompare(bd);
    });
    let h = '<div class="seg" id="cfilter">' +
      [{ v: "all", l: "全部" }, { v: "run", l: "进行中" }, { v: "done", l: "已结束" }, { v: "award", l: "有获奖" }]
        .map((s) => '<button data-cf="' + s.v + '" class="' + (Q.f === s.v ? "on" : "") + '">' + s.l + "</button>").join("") +
      "</div>";
    h += '<button class="btn pri wide" id="cadd" style="margin-bottom:10px">＋ 新建竞赛</button>';
    h += '<div id="clist">' + (arr.length ? arr.map(cardHTML).join("") :
      '<div class="empty">还没有竞赛记录<br>参加过或正在准备的比赛都可以记一条</div>') + "</div>";
    return h;
  }

  async function detailHTML(id) {
    const c = await DB.get("contests", id);
    if (!c) return '<div class="empty">竞赛不存在或已被删除</div>';
    let h = '<div class="card">' +
      '<div style="font-size:16px;font-weight:600;line-height:1.5">' + IO.esc(c.name || "未命名竞赛") + "</div>" +
      '<div class="chips" style="margin-top:8px">' +
      '<span class="chip ct">' + IO.esc(CLabel(CONST.contestStage, c.stage)) + "</span>" +
      (c.level ? '<span class="chip">' + IO.esc(c.level) + "</span>" : "") +
      (c.org ? '<span class="chip">' + IO.esc(c.org) + "</span>" : "") +
      (c.deadline ? '<span class="chip">截止 ' + IO.esc(IO.fmtMD(c.deadline)) + "</span>" : "") +
      "</div>" +
      '<div class="bar" style="margin-top:10px"><i class="ct" style="width:' + progressOf(c) + '%"></i></div>' +
      '<div class="tiny" style="margin-top:6px">进度 ' + progressOf(c) + "% · " + IO.esc(daysText(c)) + "</div></div>";

    h += '<div class="sec"><h2>阶段</h2></div><div class="card">' +
      '<div class="seg" id="cstage">' + CONST.contestStage.map((s) =>
        '<button data-set="stage" data-val="' + s.v + '" class="' + (c.stage === s.v ? "on" : "") + '">' + s.l + "</button>").join("") + "</div>";
    const st = roundStat(c);
    if (st) {
      // 用上了赛程：进度由轮次完成情况自动算，不再让手填的滑块和它对不上
      h += '<div style="display:flex;align-items:center;gap:10px;margin-top:8px">' +
        '<div class="bar" style="flex:1"><i class="ct" style="width:' + st.pct + '%"></i></div>' +
        '<b id="cpg" style="flex:none;width:44px;text-align:right">' + st.pct + "%</b></div>" +
        '<div class="tiny" style="margin-top:6px">按赛程自动算：' + st.done + " / " + st.total +
        " 轮已完成（在下面「赛程轮次」里勾选）</div>";
    } else {
      h += '<div style="display:flex;align-items:center;gap:10px;margin-top:4px">' +
        '<span class="muted" style="flex:none">进度</span>' +
        '<input type="range" min="0" max="100" step="5" value="' + (c.progress || 0) + '" data-set="progress" style="flex:1;padding:0">' +
        '<b id="cpg" style="flex:none;width:44px;text-align:right">' + (c.progress || 0) + "%</b></div>";
    }
    h += "</div>";

    // 赛程轮次：轮次名 / 日期 / 是否完成都可编辑，几轮比赛就配几轮
    const rs = roundsOf(c);
    h += '<div class="sec"><h2>赛程轮次</h2><button class="more" data-act="addround">＋ 添加</button></div>';
    h += '<div class="card">' + (rs.length ? rs.map(roundRow).join("") :
      '<div class="empty" style="padding:20px 0">还没设置轮次，比如报名 / 初赛 / 决赛</div>' +
      '<button class="btn ghost sm" data-act="defrounds" style="margin-top:8px">使用默认四轮</button>') +
      (rs.length ? '<div class="tiny" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line2)">' +
        "名字、日期都能直接改；临近 24 小时的轮次会在打开应用时提醒一次。</div>" : "") + "</div>";

    h += '<div class="sec"><h2>基本信息</h2><button class="more" data-act="edit">编辑</button></div>';
    h += '<div class="card">' +
      kv("主办方", c.org) + kv("级别", c.level) + kv("开始日期", c.start ? IO.fmtMD(c.start) : "") +
      kv("截止日期", c.deadline ? IO.fmtMD(c.deadline) : "") +
      kv("指导老师", c.teacher) +
      // 队友与分工要保留换行，不能走 kv()（它会把整段再 esc 一遍，标签就显示成文字了）
      '<div class="kv"><div class="k">队友与分工</div><div class="v">' +
      (c.members ? '<div style="white-space:pre-wrap">' + IO.esc(c.members) + "</div>" : '<span class="muted">未填</span>') +
      "</div></div>" +
      "</div>";

    const nodes = (c.nodes || []).slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    h += '<div class="sec"><h2>关键节点</h2><button class="more" data-act="addnode">＋ 添加</button></div>';
    h += '<div class="card">' + (nodes.length ? nodes.map((n) => {
      const d = n.date ? IO.diffDays(IO.today(), n.date) : null;
      const cls = n.done ? "ok" : (d === null ? "" : (d < 0 ? "dg" : (d <= 7 ? "warn" : "")));
      return '<div class="item" style="padding:9px 0">' +
        '<button class="tick' + (n.done ? " on" : "") + '" data-togglenode="' + IO.esc(n.id) + '"></button>' +
        '<div class="ib"><div class="t1">' + IO.esc(n.name) + "</div>" +
        '<div class="t2">' + (n.date ? IO.fmtMD(n.date) + " · " : "") +
        '<span class="chip ' + cls + '">' + (n.done ? "已完成" : (d === null ? "无日期" : (d < 0 ? "逾期 " + (-d) + " 天" : (d === 0 ? "今天" : "还有 " + d + " 天")))) + "</span></div></div>" +
        '<button class="x" data-delnode="' + IO.esc(n.id) + '">删除</button></div>';
    }).join("") : '<div class="empty" style="padding:20px 0">还没有节点，比如「提交作品 5月20日」</div>') + "</div>";

    h += '<div class="sec"><h2>作品附件</h2><button class="more" data-act="addwork">＋ 上传</button></div>';
    h += '<div class="card">' + Papers.filesHTML(c.works) + "</div>";

    const aws = c.awards || [];
    h += '<div class="sec"><h2>获奖记录</h2><button class="more" data-act="addaward">＋ 添加</button></div>';
    h += '<div class="card">' + (aws.length ? aws.map((a, i) =>
      '<div style="padding:10px 0' + (i ? ";border-top:1px solid var(--line2)" : "") + '">' +
      '<div style="display:flex;align-items:center;gap:8px"><b style="flex:1;font-size:14.5px;font-weight:600">' + IO.esc(a.title) + "</b>" +
      '<button class="x" data-delaward="' + IO.esc(a.id) + '">删除</button></div>' +
      '<div class="chips" style="margin-top:6px">' +
      (a.rank ? '<span class="chip ok">' + IO.esc(a.rank) + "</span>" : "") +
      (a.date ? '<span class="chip">' + IO.esc(IO.fmtMD(a.date)) + "</span>" : "") + "</div>" +
      (a.note ? '<div class="tiny" style="margin-top:6px;white-space:pre-wrap">' + IO.esc(a.note) + "</div>" : "") +
      '<div style="margin-top:6px">' + Papers.filesHTML(a.files) + "</div>" +
      '<button class="btn sm ghost" data-awardfile="' + IO.esc(a.id) + '" style="margin-top:6px">上传证书</button>' +
      "</div>").join("") : '<div class="empty" style="padding:20px 0">还没有获奖记录</div>') + "</div>";

    // 关联文献：导入的 PDF 会同时进文献库并挂到这条竞赛上（复用 Papers 的入库函数）
    const papers = [];
    for (const pid of (c.paperIds || [])) { const x = await DB.get("papers", pid); if (x) papers.push(x); }
    h += '<div class="sec"><h2>关联文献 <span style="font-weight:400">' + papers.length + " 篇</span></h2>" +
      '<button class="more" data-act="importpapers">导入 PDF</button></div>';
    h += '<div class="card">' + (papers.length
      ? papers.map((x) => '<div class="item" style="padding:8px 0"><div class="ib"><div class="t1">' + IO.esc(x.title) + "</div>" +
        '<div class="t2">' + IO.esc(Papers.oneLine(x)) + "</div></div>" +
        '<button class="btn sm ghost" data-go="papers" data-arg="' + IO.esc(x.id) + '">查看</button>' +
        '<button class="x" data-unlinkpaper="' + IO.esc(x.id) + '">取消关联</button></div>').join("") +
        '<div class="btnrow" style="margin-top:10px">' +
        '<button class="btn pri" data-act="citeref">生成参考文献表</button>' +
        '<button class="btn ghost" data-act="unlinkall">全部取消关联</button></div>'
      : '<div class="empty" style="padding:20px 0">还没有关联文献<br>点上面「导入 PDF」可直接把参考文献收进文献库</div>' +
        '<div class="btnrow" style="margin-top:10px">' +
        '<button class="btn pri" data-act="importpapers">导入 PDF 文献</button></div>') + "</div>";

    h += '<div class="sec"><h2>备注</h2></div><div class="card">' +
      '<textarea data-set="note" rows="4" placeholder="赛题、思路、踩过的坑…">' + IO.esc(c.note || "") + "</textarea>" +
      '<div class="tiny" style="margin-top:6px">点空白处自动保存</div></div>';

    h += '<div class="btnrow" style="margin-top:18px"><button class="btn dg" data-act="del">删除这条竞赛</button></div>';
    return h;
  }

  function kv(k, v) {
    return '<div class="kv"><div class="k">' + IO.esc(k) + '</div><div class="v">' + (v ? IO.esc(v) : '<span class="muted">未填</span>') + "</div></div>";
  }

  // 一轮赛程：完成勾选 + 可改名的输入框 + 可改日期的日期框 + 倒计时 + 删除
  function roundRow(r) {
    const d = r.date ? IO.diffDays(IO.today(), r.date) : null;
    const cls = r.done ? "ok" : (d === null ? "" : (d < 0 ? "dg" : (d <= 1 ? "warn" : "")));
    const tip = r.done ? "已完成" : (d === null ? "未设日期" :
      (d < 0 ? "逾期 " + (-d) + " 天" : (d === 0 ? "就是今天" : (d === 1 ? "明天" : "还有 " + d + " 天"))));
    return '<div class="rd">' +
      '<button class="tick' + (r.done ? " on" : "") + '" data-rdtog="' + IO.esc(r.id) + '" aria-label="完成"></button>' +
      '<input class="rd-name" data-rdname="' + IO.esc(r.id) + '" value="' + IO.esc(r.name || "") + '" placeholder="轮次名">' +
      '<input type="date" class="rd-date" data-rddate="' + IO.esc(r.id) + '" value="' + IO.esc(r.date || "") + '">' +
      '<span class="chip ' + cls + '" style="flex:none">' + IO.esc(tip) + "</span>" +
      '<button class="x" data-rddel="' + IO.esc(r.id) + '">删除</button></div>';
  }

  function editForm(c, isNew) {
    UI.form({
      title: isNew ? "新建竞赛" : "编辑竞赛",
      fields: [
        { k: "name", label: "竞赛名称", value: c.name, ph: "如 全国研究生数学建模竞赛" },
        { k: "org", label: "主办方", value: c.org },
        { k: "level", label: "级别", type: "select", value: c.level || "校级",
          opts: [{ v: "校级", l: "校级" }, { v: "省级", l: "省级" }, { v: "国家级", l: "国家级" }, { v: "国际", l: "国际" }, { v: "其他", l: "其他" }] },
        { k: "start", label: "开始日期", type: "date", value: c.start },
        { k: "deadline", label: "截止日期", type: "date", value: c.deadline },
        { k: "teacher", label: "指导老师", value: c.teacher },
        { k: "members", label: "队友与分工", type: "textarea", rows: 3, value: c.members, ph: "每行一位，如：李雷 建模\n韩梅梅 写代码" },
      ],
      onSubmit: async (v) => {
        if (!v.name.trim()) { IO.toast("名称不能为空"); return false; }
        const cur = isNew ? blank() : (await DB.get("contests", c.id));
        if (!cur) { IO.toast("记录已不存在"); return true; }
        Object.assign(cur, v);
        await save(cur);
        IO.toast(isNew ? "已创建" : "已保存");
        if (isNew) App.go("contests", { id: cur.id }); else App.refresh();
        return true;
      },
    });
  }

  async function render() {
    if (App.arg && App.arg.id) return detailHTML(App.arg.id);
    return listHTML();
  }

  async function mount() {
    const root = document.getElementById("view");
    if (App.arg && App.arg.id) return mountDetail(root, App.arg.id);
    root.querySelectorAll("#cfilter [data-cf]").forEach((b) => {
      b.addEventListener("click", async () => {
        Q.f = b.getAttribute("data-cf");
        root.querySelectorAll("#cfilter [data-cf]").forEach((x) => x.classList.toggle("on", x === b));
        App.refresh();
      });
    });
    root.querySelector("#cadd").addEventListener("click", () => editForm(blank(), true));
    bindCards(root);
  }

  function bindCards(root) {
    root.querySelectorAll("[data-ct]").forEach((c) => {
      c.addEventListener("click", () => App.go("contests", { id: c.getAttribute("data-ct") }));
    });
  }

  async function mountDetail(root, id) {
    let c = await DB.get("contests", id);
    if (!c) return;
    root.querySelectorAll("#cstage [data-set]").forEach((b) => {
      b.addEventListener("click", async () => {
        c = await DB.get("contests", id);
        c.stage = b.getAttribute("data-val");
        if (c.stage === "done") c.progress = 100;
        await save(c);
        App.refresh();
      });
    });
    const rg = root.querySelector('[data-set="progress"]');
    if (rg) {
      rg.addEventListener("change", async () => {
        c = await DB.get("contests", id);
        c.progress = IO.clamp(rg.value, 0, 100);
        await save(c); App.refresh();
      });
      rg.addEventListener("input", () => { const v = root.querySelector("#cpg"); if (v) v.textContent = rg.value + "%"; });
    }
    const nt = root.querySelector('[data-set="note"]');
    if (nt) nt.addEventListener("change", async () => {
      c = await DB.get("contests", id);
      c.note = nt.value; await save(c); IO.toast("备注已保存");
    });

    // ---- 赛程轮次：勾选完成 / 改名 / 改日期 / 删除 ----
    root.querySelectorAll("[data-rdtog]").forEach((b) => b.addEventListener("click", async () => {
      const rid = b.getAttribute("data-rdtog");
      c = await DB.get("contests", id);
      const r = roundsOf(c).find((x) => x.id === rid);
      if (!r) return;
      r.done = !r.done;
      if (r.done) IO.toast(r.name + " 已完成");
      syncProgress(c);
      await save(c);
      App.refresh();
    }));
    // 改名 / 改日期不整页重绘（会打断输入），只落库
    root.querySelectorAll("[data-rdname]").forEach((inp) => inp.addEventListener("change", async () => {
      const rid = inp.getAttribute("data-rdname");
      c = await DB.get("contests", id);
      const r = roundsOf(c).find((x) => x.id === rid);
      if (!r) return;
      r.name = inp.value.trim() || r.name;
      await save(c);
      IO.toast("轮次名已保存");
    }));
    root.querySelectorAll("[data-rddate]").forEach((inp) => inp.addEventListener("change", async () => {
      const rid = inp.getAttribute("data-rddate");
      c = await DB.get("contests", id);
      const r = roundsOf(c).find((x) => x.id === rid);
      if (!r) return;
      r.date = inp.value || "";
      r.alerted = 0;          // 改了日期就重新提醒一次
      await save(c);
      IO.toast(r.date ? "日期已保存" : "已清除日期");
    }));
    root.querySelectorAll("[data-rddel]").forEach((b) => b.addEventListener("click", async () => {
      const rid = b.getAttribute("data-rddel");
      c = await DB.get("contests", id);
      c.rounds = roundsOf(c).filter((x) => x.id !== rid);
      syncProgress(c);
      await save(c);
      App.refresh();
    }));

    root.querySelectorAll("[data-togglenode]").forEach((b) => b.addEventListener("click", async () => {
      c = await DB.get("contests", id);
      const n = (c.nodes || []).find((x) => x.id === b.getAttribute("data-togglenode"));
      if (n) { n.done = !n.done; await save(c); App.refresh(); }
    }));
    root.querySelectorAll("[data-delnode]").forEach((b) => b.addEventListener("click", async () => {
      c = await DB.get("contests", id);
      c.nodes = (c.nodes || []).filter((x) => x.id !== b.getAttribute("data-delnode"));
      await save(c); App.refresh();
    }));
    root.querySelectorAll("[data-unlinkpaper]").forEach((b) => b.addEventListener("click", async () => {
      const pid = b.getAttribute("data-unlinkpaper");
      c = await DB.get("contests", id);
      c.paperIds = (c.paperIds || []).filter((x) => x !== pid);
      await save(c);
      IO.toast("已取消关联（文献本身还在文献库里）");
      App.refresh();
    }));
    root.querySelectorAll("[data-delaward]").forEach((b) => b.addEventListener("click", async () => {
      const ok = await UI.confirm("删除这条获奖记录？证书附件也会一起删除。", { danger: true, ok: "删除" });
      if (!ok) return;
      c = await DB.get("contests", id);
      const a = (c.awards || []).find((x) => x.id === b.getAttribute("data-delaward"));
      c.awards = (c.awards || []).filter((x) => x.id !== b.getAttribute("data-delaward"));
      await save(c);
      if (a) for (const f of (a.files || [])) await UI.attach.del(f.id);
      App.refresh();
    }));
    root.querySelectorAll("[data-awardfile]").forEach((b) => b.addEventListener("click", async () => {
      const files = await UI.pickFile("image/*,application/pdf", true);
      if (!files.length) return;
      IO.busy(true, "上传中…");
      const metas = await UI.attach.add(files, true);
      c = await DB.get("contests", id);
      const a = (c.awards || []).find((x) => x.id === b.getAttribute("data-awardfile"));
      if (a) { a.files = (a.files || []).concat(metas); await save(c); }
      IO.busy(false); IO.toast("已上传证书");
      App.refresh();
    }));
    root.querySelectorAll("[data-openf]").forEach((b) => b.addEventListener("click", () => UI.attach.open(b.getAttribute("data-openf"))));
    root.querySelectorAll("[data-delf]").forEach((b) => b.addEventListener("click", async () => {
      const ok = await UI.confirm("删除这个附件？", { danger: true, ok: "删除" });
      if (!ok) return;
      const fid = b.getAttribute("data-delf");
      c = await DB.get("contests", id);
      c.works = (c.works || []).filter((f) => f.id !== fid);
      (c.awards || []).forEach((a) => { a.files = (a.files || []).filter((f) => f.id !== fid); });
      await save(c);
      await UI.attach.del(fid);
      App.refresh();
    }));

    root.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => {
      const a = b.getAttribute("data-act");
      // 【手势纪律】下面两个分支会调 UI.pickFile，必须排在下面那个 await DB.get 之前，
      // 否则 pickFile 落在 await 之后，手机浏览器会「点了没反应」且不报错。
      // 导入 PDF 由 Papers 统一实现：入库 + 关联 + 刷新都在它内部完成（刷新挂在弹窗 onClose 上）
      if (a === "importpapers") { await Papers.importPdfDialog({ link: "contests", id: id }); return; }
      if (a === "addwork") {
        const files = await UI.pickFile("", true);
        if (!files.length) return;
        IO.busy(true, "上传中…");
        const metas = await UI.attach.add(files, false);
        c = await DB.get("contests", id);
        c.works = (c.works || []).concat(metas);
        await save(c);
        IO.busy(false); IO.toast("已添加 " + metas.length + " 个附件");
        App.refresh();
        return;
      }
      c = await DB.get("contests", id);
      if (!c) return;
      if (a === "edit") return editForm(c, false);
      if (a === "citeref") return Papers.refCenter(c.paperIds || [], "竞赛「" + c.name + "」参考文献");
      if (a === "unlinkall") {
        const ok = await UI.confirm("取消这条竞赛下的全部文献关联？（文献本身不会被删除）");
        if (!ok) return;
        c.paperIds = []; await save(c); App.refresh(); return;
      }
      if (a === "addnode") {
        UI.form({
          title: "添加关键节点",
          fields: [{ k: "name", label: "节点名称", ph: "如 提交作品、初赛答辩" }, { k: "date", label: "日期", type: "date", value: IO.today() }],
          onSubmit: async (v) => {
            if (!v.name.trim()) return false;
            c = await DB.get("contests", id);
            c.nodes = (c.nodes || []).concat([{ id: IO.uid(), name: v.name, date: v.date, done: false }]);
            await save(c); App.refresh(); return true;
          },
        });
        return;
      }
      if (a === "addaward") {
        UI.form({
          title: "添加获奖记录",
          fields: [
            { k: "title", label: "奖项名称", ph: "如 全国一等奖" },
            { k: "rank", label: "等级 / 名次", ph: "如 一等奖 / 第 3 名" },
            { k: "date", label: "获奖日期", type: "date", value: IO.today() },
            { k: "note", label: "备注", type: "textarea", rows: 2 },
          ],
          onSubmit: async (v) => {
            if (!v.title.trim()) return false;
            c = await DB.get("contests", id);
            c.awards = (c.awards || []).concat([{ id: IO.uid(), title: v.title, rank: v.rank, date: v.date, note: v.note, files: [] }]);
            await save(c); App.refresh(); return true;
          },
        });
        return;
      }
      if (a === "addround") {
        UI.form({
          title: "添加赛程轮次",
          fields: [
            { k: "name", label: "轮次名称", ph: "如 报名 / 初赛 / 复赛 / 决赛 / 答辩" },
            { k: "date", label: "日期（可留空）", type: "date", value: IO.today() },
          ],
          onSubmit: async (v) => {
            if (!v.name.trim()) return false;
            c = await DB.get("contests", id);
            c.rounds = roundsOf(c).concat([{ id: IO.uid(), name: v.name.trim(), date: v.date || "", done: false }]);
            syncProgress(c);
            await save(c);
            App.refresh();
            return true;
          },
        });
        return;
      }
      if (a === "defrounds") {
        c = await DB.get("contests", id);
        c.rounds = defaultRounds();
        await save(c);
        App.refresh();
        return;
      }
      if (a === "del") {
        const ok = await UI.confirm("删除「" + c.name + "」？赛程轮次、节点、作品和获奖记录会一起删除。", { danger: true, ok: "删除" });
        if (!ok) return;
        const ids = (c.works || []).map((f) => f.id);
        (c.awards || []).forEach((x) => (x.files || []).forEach((f) => ids.push(f.id)));
        await DB.delWithFiles("contests", id, ids);
        IO.toast("已删除");
        App.go("contests");
        return;
      }
    }));
  }

  // ---------- 赛程提醒（v1.5.0）----------
  // 临近 24 小时内要开打的轮次：打开应用时提醒一次。
  // 提醒过就在轮次上打 alerted 时间戳（改日期会清零重来），避免每次启动都弹同一条。
  async function checkAlerts() {
    const all = await DB.all("contests");
    const due = [];
    for (const c of all) {
      if (c.stage === "done") continue;
      let changed = false;
      for (const r of roundsOf(c)) {
        if (!r.date || r.done || r.alerted) continue;
        const d = IO.diffDays(IO.today(), r.date);
        if (d === 0 || d === 1) { due.push({ c: c, r: r, d: d }); r.alerted = Date.now(); changed = true; }
      }
      if (changed) await save(c);
    }
    if (!due.length) return 0;
    UI.modal({
      title: "赛程提醒",
      body: '<div class="muted" style="margin-bottom:8px">以下轮次 24 小时内就要开始：</div>' +
        due.map((x) => '<div style="padding:8px 0;border-top:1px solid var(--line2)">' +
          '<div style="font-size:13.5px;font-weight:600">' + IO.esc(x.c.name || "未命名竞赛") + " · " + IO.esc(x.r.name || "轮次") + "</div>" +
          '<div class="tiny" style="margin-top:3px">' + IO.esc(IO.fmtMD(x.r.date)) + (x.d === 0 ? "（就是今天）" : "（明天）") + "</div></div>").join(""),
      actions: [
        { label: "去查看", cls: "pri", fn: () => { App.go("contests", { id: due[0].c.id }); return true; } },
        { label: "知道了", cls: "ghost", fn: () => true },
      ],
    });
    return due.length;
  }

  return {
    title: () => (App.arg && App.arg.id ? "竞赛详情" : "竞赛记录"),
    render, mount, blank, save, editForm, cardHTML,
    roundsOf, roundStat, progressOf, defaultRounds, checkAlerts,
  };
})();
