/* 项目 / 课题模块：进度、成就、结构化会议记录、总结、关联文献并一键引用 */
"use strict";

const Projects = (function () {
  const Q = { f: "all" };

  function blank() {
    return {
      id: IO.uid(), name: "", type: "课题", source: "", role: "",
      start: IO.today(), deadline: "", status: "doing", progress: 0,
      achievements: [], meetings: [], paperIds: [], summary: "",
      createdAt: Date.now(), updatedAt: Date.now(),
    };
  }
  async function save(p) { p.updatedAt = Date.now(); await DB.put("projects", p); return p; }

  function cardHTML(p) {
    const d = p.deadline ? IO.diffDays(IO.today(), p.deadline) : null;
    const cls = p.status === "done" ? "ok" : (d === null ? "" : (d < 0 ? "dg" : (d <= 14 ? "warn" : "")));
    return '<div class="card tap" data-pj="' + IO.esc(p.id) + '">' +
      '<div class="ch"><h3>' + IO.esc(p.name || "未命名课题") + "</h3>" +
      '<span class="chip pj">' + IO.esc(CLabel(CONST.projStatus, p.status)) + "</span></div>" +
      '<div class="tiny" style="margin-bottom:6px">' + IO.esc(p.type || "课题") +
      (p.role ? " · " + IO.esc(p.role) : "") +
      (((p.paperIds || []).length) ? " · 关联文献 " + p.paperIds.length + " 篇" : "") + "</div>" +
      '<div class="bar"><i class="pj" style="width:' + (p.progress || 0) + '%"></i></div>' +
      '<div class="tiny" style="margin-top:7px">' +
      (d === null ? '<span class="chip">未设截止日期</span>'
        : '<span class="chip ' + cls + '">' + (p.status === "done" ? "已结题" : (d < 0 ? "逾期 " + (-d) + " 天" : (d === 0 ? "今天截止" : "还有 " + d + " 天"))) + "</span>") +
      '<span class="chip">会议 ' + ((p.meetings || []).length) + " 次</span>" +
      '<span class="chip">成就 ' + ((p.achievements || []).length) + " 项</span>" +
      "</div></div>";
  }

  async function listHTML() {
    const all = await DB.all("projects");
    const arr = all.filter((p) => {
      if (Q.f === "doing") return p.status === "doing";
      if (Q.f === "done") return p.status === "done";
      return true;
    }).sort((a, b) => {
      if (a.status === "done" && b.status !== "done") return 1;
      if (b.status === "done" && a.status !== "done") return -1;
      return (a.deadline || "9999-12-31").localeCompare(b.deadline || "9999-12-31");
    });
    let h = '<div class="seg" id="jfilter">' +
      [{ v: "all", l: "全部" }, { v: "doing", l: "进行中" }, { v: "done", l: "已结题" }]
        .map((s) => '<button data-jf="' + s.v + '" class="' + (Q.f === s.v ? "on" : "") + '">' + s.l + "</button>").join("") +
      "</div>";
    h += '<button class="btn pri wide" id="jadd" style="margin-bottom:10px">＋ 新建课题 / 项目</button>';
    h += '<div id="jlist">' + (arr.length ? arr.map(cardHTML).join("") :
      '<div class="empty">还没有课题或项目<br>导师给的课题、自己申的项目都能记</div>') + "</div>";
    return h;
  }

  function kv(k, v) {
    return '<div class="kv"><div class="k">' + IO.esc(k) + '</div><div class="v">' + (v ? IO.esc(v) : '<span class="muted">未填</span>') + "</div></div>";
  }

  async function detailHTML(id) {
    const p = await DB.get("projects", id);
    if (!p) return '<div class="empty">课题不存在或已被删除</div>';
    const papers = [];
    for (const pid of (p.paperIds || [])) { const x = await DB.get("papers", pid); if (x) papers.push(x); }

    let h = '<div class="card">' +
      '<div style="font-size:16px;font-weight:600;line-height:1.5">' + IO.esc(p.name || "未命名课题") + "</div>" +
      '<div class="chips" style="margin-top:8px">' +
      '<span class="chip pj">' + IO.esc(p.type || "课题") + "</span>" +
      '<span class="chip">' + IO.esc(CLabel(CONST.projStatus, p.status)) + "</span>" +
      (p.deadline ? '<span class="chip">截止 ' + IO.esc(IO.fmtMD(p.deadline)) + "</span>" : "") +
      "</div>" +
      '<div class="bar" style="margin-top:10px"><i class="pj" style="width:' + (p.progress || 0) + '%"></i></div>' +
      '<div class="tiny" style="margin-top:6px">进度 ' + (p.progress || 0) + "%</div></div>";

    h += '<div class="sec"><h2>状态</h2></div><div class="card">' +
      '<div class="seg" id="jstatus">' + CONST.projStatus.map((s) =>
        '<button data-set="status" data-val="' + s.v + '" class="' + (p.status === s.v ? "on" : "") + '">' + s.l + "</button>").join("") + "</div>" +
      '<div style="display:flex;align-items:center;gap:10px;margin-top:4px">' +
      '<span class="muted" style="flex:none">进度</span>' +
      '<input type="range" min="0" max="100" step="5" value="' + (p.progress || 0) + '" data-set="progress" style="flex:1;padding:0">' +
      '<b id="jpg" style="flex:none;width:44px;text-align:right">' + (p.progress || 0) + "%</b></div></div>";

    h += '<div class="sec"><h2>基本信息</h2><button class="more" data-act="edit">编辑</button></div>';
    h += '<div class="card">' + kv("类型", p.type) + kv("来源 / 资助", p.source) + kv("我的角色", p.role) +
      kv("开始日期", p.start ? IO.fmtMD(p.start) : "") + kv("截止日期", p.deadline ? IO.fmtMD(p.deadline) : "") + "</div>";

    const ach = p.achievements || [];
    h += '<div class="sec"><h2>成就</h2><button class="more" data-act="addach">＋ 添加</button></div>';
    h += '<div class="card">' + (ach.length ? ach.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).map((a, i) =>
      '<div style="padding:10px 0' + (i ? ";border-top:1px solid var(--line2)" : "") + '">' +
      '<div style="display:flex;align-items:center;gap:8px"><b style="flex:1;font-size:14.5px;font-weight:600">' + IO.esc(a.title) + "</b>" +
      '<button class="x" data-delach="' + IO.esc(a.id) + '">删除</button></div>' +
      (a.date ? '<div class="tiny" style="margin-top:2px">' + IO.esc(IO.fmtMD(a.date)) + "</div>" : "") +
      (a.detail ? '<div class="tiny" style="margin-top:5px;white-space:pre-wrap">' + IO.esc(a.detail) + "</div>" : "") +
      "</div>").join("") : '<div class="empty" style="padding:20px 0">还没有成就，比如「论文被录用」「中期检查通过」</div>') + "</div>";

    const ms = (p.meetings || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    h += '<div class="sec"><h2>会议记录 <span style="font-weight:400">' + ms.length + " 次</span></h2>" +
      '<button class="more" data-act="addmeet">＋ 添加</button></div>';
    h += ms.length ? ms.map(meetHTML).join("") : '<div class="empty" style="padding:20px 0">还没有会议记录</div>';

    h += '<div class="sec"><h2>关联文献 <span style="font-weight:400">' + papers.length + " 篇</span></h2>" +
      '<button class="more" data-act="importpapers">导入 PDF</button>' +
      '<button class="more" data-act="linkpapers">管理</button></div>';
    h += '<div class="card">' + (papers.length
      ? papers.map((x) => '<div class="item" style="padding:8px 0"><div class="ib"><div class="t1">' + IO.esc(x.title) + "</div>" +
        '<div class="t2">' + IO.esc(Papers.oneLine(x)) + "</div></div>" +
        '<button class="btn sm ghost" data-go="papers" data-arg="' + IO.esc(x.id) + '">查看</button></div>').join("") +
        '<div class="btnrow" style="margin-top:10px">' +
        '<button class="btn pri" data-act="citeref">生成参考文献表</button>' +
        '<button class="btn ghost" data-act="unlinkall">全部取消关联</button></div>'
      : '<div class="empty" style="padding:20px 0">还没关联文献<br>把读过的文献挂到课题上，写论文时就能一键引用</div>' +
        '<div class="btnrow" style="margin-top:10px">' +
        '<button class="btn pri" data-act="importpapers">导入 PDF 文献</button>' +
        '<button class="btn ghost" data-act="linkpapers">从文献库选择</button></div>') + "</div>";

    h += '<div class="sec"><h2>总结</h2></div><div class="card">' +
      '<textarea data-set="summary" rows="5" placeholder="这个课题做完了什么、还差什么、下一步…">' + IO.esc(p.summary || "") + "</textarea>" +
      '<div class="tiny" style="margin-top:6px">点空白处自动保存</div></div>';

    h += '<div class="btnrow" style="margin-top:18px"><button class="btn dg" data-act="del">删除这个课题</button></div>';
    return h;
  }

  function meetHTML(m) {
    const todos = m.todos || [];
    const doneN = todos.filter((t) => t.done).length;
    return '<div class="card" data-meet="' + IO.esc(m.id) + '">' +
      '<div class="ch"><h3>' + IO.esc(m.date ? IO.fmtMD(m.date) : "未填日期") + " 会议" +
      (m.topics ? ' <span class="sub">' + IO.esc(m.topics) + "</span>" : "") + "</h3>" +
      '<button class="x" data-delmeet="' + IO.esc(m.id) + '">删除</button></div>' +
      (m.attendees ? '<div class="kv"><div class="k">参会人</div><div class="v">' + IO.esc(m.attendees) + "</div></div>" : "") +
      (m.points ? '<div class="kv"><div class="k">讨论要点</div><div class="v" style="white-space:pre-wrap">' + IO.esc(m.points) + "</div></div>" : "") +
      (m.decisions ? '<div class="kv"><div class="k">决议</div><div class="v" style="white-space:pre-wrap">' + IO.esc(m.decisions) + "</div></div>" : "") +
      (m.note ? '<div class="kv"><div class="k">备注</div><div class="v" style="white-space:pre-wrap">' + IO.esc(m.note) + "</div></div>" : "") +
      '<div style="margin-top:8px"><div class="tiny" style="margin-bottom:4px">待办事项 ' + doneN + "/" + todos.length + "</div>" +
      todos.map((t) => '<div class="item" style="padding:6px 0">' +
        '<button class="tick' + (t.done ? " on" : "") + '" data-toggletodo="' + IO.esc(t.id) + '" data-meetid="' + IO.esc(m.id) + '"></button>' +
        '<div class="ib"><div class="t1" style="' + (t.done ? "color:var(--ink3);text-decoration:line-through" : "") + '">' + IO.esc(t.text) + "</div></div>" +
        '<button class="x" data-deltodo="' + IO.esc(t.id) + '" data-meetid="' + IO.esc(m.id) + '">删除</button></div>').join("") +
      '<button class="btn sm ghost" data-addtodo="' + IO.esc(m.id) + '" style="margin-top:6px">＋ 待办</button></div>' +
      "</div>";
  }

  function editForm(p, isNew) {
    UI.form({
      title: isNew ? "新建课题 / 项目" : "编辑课题",
      fields: [
        { k: "name", label: "名称", value: p.name, ph: "如 基于图神经网络的推荐算法研究" },
        { k: "type", label: "类型", type: "select", value: p.type || "课题", opts: CONST.projType },
        { k: "source", label: "来源 / 资助", value: p.source, ph: "如 国家自然科学基金 No.xxxx" },
        { k: "role", label: "我的角色", value: p.role, ph: "如 主要负责人 / 参与者" },
        { k: "start", label: "开始日期", type: "date", value: p.start },
        { k: "deadline", label: "截止日期", type: "date", value: p.deadline },
      ],
      onSubmit: async (v) => {
        if (!v.name.trim()) { IO.toast("名称不能为空"); return false; }
        const cur = isNew ? blank() : (await DB.get("projects", p.id));
        if (!cur) { IO.toast("记录已不存在"); return true; }
        Object.assign(cur, v);
        await save(cur);
        IO.toast(isNew ? "已创建" : "已保存");
        if (isNew) App.go("projects", { id: cur.id }); else App.refresh();
        return true;
      },
    });
  }

  async function linkPapers(p) {
    const all = await DB.all("papers");
    all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const sel = new Set(p.paperIds || []);
    // 弹窗非阻塞：勾选发生在用户点击时，刷新必须推迟到弹窗退出之后；
    // 用 once 保证「完成 / ✕ / 点遮罩」多条退出路径只刷新一次，避免重复渲染导致事件重复绑定。
    let refreshed = false;
    const refreshOnce = () => { if (refreshed) return; refreshed = true; App.refresh(); };
    UI.modal({
      title: "关联文献",
      body: all.length ? '<div style="margin:-4px -6px">' + all.map((x) =>
        '<button class="item" style="width:100%;text-align:left" data-pid="' + IO.esc(x.id) + '">' +
        '<span class="tick' + (sel.has(x.id) ? " on" : "") + '"></span>' +
        '<div class="ib"><div class="t1">' + IO.esc(x.title) + "</div>" +
        '<div class="t2">' + IO.esc(Papers.oneLine(x)) + "</div></div></button>").join("") + "</div>"
        : '<div class="empty">还没有文献，先去「文献」页添加</div>',
      actions: [{ label: "完成", cls: "pri", fn: () => { refreshOnce(); return true; } }],
      onClose: refreshOnce,
      mount: (card) => {
        card.querySelectorAll("[data-pid]").forEach((b) => {
          b.addEventListener("click", async () => {
            const id = b.getAttribute("data-pid");
            const cur = await DB.get("projects", p.id);
            const s = new Set(cur.paperIds || []);
            if (s.has(id)) s.delete(id); else s.add(id);
            b.querySelector(".tick").classList.toggle("on", s.has(id));
            cur.paperIds = Array.from(s);
            await save(cur);
          });
        });
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
    root.querySelectorAll("#jfilter [data-jf]").forEach((b) => {
      b.addEventListener("click", () => {
        Q.f = b.getAttribute("data-jf");
        root.querySelectorAll("#jfilter [data-jf]").forEach((x) => x.classList.toggle("on", x === b));
        App.refresh();
      });
    });
    root.querySelector("#jadd").addEventListener("click", () => editForm(blank(), true));
    root.querySelectorAll("[data-pj]").forEach((c) => {
      c.addEventListener("click", () => App.go("projects", { id: c.getAttribute("data-pj") }));
    });
  }

  async function mountDetail(root, id) {
    let p = await DB.get("projects", id);
    if (!p) return;
    root.querySelectorAll("#jstatus [data-set]").forEach((b) => {
      b.addEventListener("click", async () => {
        p = await DB.get("projects", id);
        p.status = b.getAttribute("data-val");
        if (p.status === "done") p.progress = 100;
        await save(p); App.refresh();
      });
    });
    const rg = root.querySelector('[data-set="progress"]');
    if (rg) {
      rg.addEventListener("change", async () => {
        p = await DB.get("projects", id);
        p.progress = IO.clamp(rg.value, 0, 100);
        await save(p); App.refresh();
      });
      rg.addEventListener("input", () => { const v = root.querySelector("#jpg"); if (v) v.textContent = rg.value + "%"; });
    }
    const sm = root.querySelector('[data-set="summary"]');
    if (sm) sm.addEventListener("change", async () => {
      p = await DB.get("projects", id);
      p.summary = sm.value; await save(p); IO.toast("总结已保存");
    });

    root.querySelectorAll("[data-delach]").forEach((b) => b.addEventListener("click", async () => {
      p = await DB.get("projects", id);
      p.achievements = (p.achievements || []).filter((x) => x.id !== b.getAttribute("data-delach"));
      await save(p); App.refresh();
    }));
    root.querySelectorAll("[data-delmeet]").forEach((b) => b.addEventListener("click", async () => {
      const ok = await UI.confirm("删除这次会议记录？", { danger: true, ok: "删除" });
      if (!ok) return;
      p = await DB.get("projects", id);
      p.meetings = (p.meetings || []).filter((x) => x.id !== b.getAttribute("data-delmeet"));
      await save(p); App.refresh();
    }));
    root.querySelectorAll("[data-toggletodo]").forEach((b) => b.addEventListener("click", async () => {
      p = await DB.get("projects", id);
      const m = (p.meetings || []).find((x) => x.id === b.getAttribute("data-meetid"));
      if (!m) return;
      const t = (m.todos || []).find((x) => x.id === b.getAttribute("data-toggletodo"));
      if (t) { t.done = !t.done; await save(p); App.refresh(); }
    }));
    root.querySelectorAll("[data-deltodo]").forEach((b) => b.addEventListener("click", async () => {
      p = await DB.get("projects", id);
      const m = (p.meetings || []).find((x) => x.id === b.getAttribute("data-meetid"));
      if (!m) return;
      m.todos = (m.todos || []).filter((x) => x.id !== b.getAttribute("data-deltodo"));
      await save(p); App.refresh();
    }));
    root.querySelectorAll("[data-addtodo]").forEach((b) => b.addEventListener("click", () => {
      const mid = b.getAttribute("data-addtodo");
      UI.form({
        title: "添加待办事项",
        fields: [{ k: "text", label: "待办内容", ph: "如 下周三前把实验数据发给导师" }],
        onSubmit: async (v) => {
          if (!v.text.trim()) return false;
          p = await DB.get("projects", id);
          const m = (p.meetings || []).find((x) => x.id === mid);
          if (m) { m.todos = (m.todos || []).concat([{ id: IO.uid(), text: v.text, done: false }]); await save(p); }
          App.refresh(); return true;
        },
      });
    }));

    root.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => {
      const a = b.getAttribute("data-act");
      // 【手势纪律】导入 PDF 内部会调 UI.pickFile，必须排在下面那个 await DB.get 之前，
      // 否则 pickFile 落在 await 之后，手机浏览器会「点了没反应」且不报错。
      // 导入 PDF 复用 Papers 的入库函数：建文献条目 + 挂到本课题 + 刷新都在它内部完成
      if (a === "importpapers") { await Papers.importPdfDialog({ link: "projects", id: id }); return; }
      p = await DB.get("projects", id);
      if (!p) return;
      if (a === "edit") return editForm(p, false);
      // linkPapers 内部会打开非阻塞弹窗，刷新由弹窗退出时的 onClose 负责，这里不能抢跑
      if (a === "linkpapers") { await linkPapers(p); return; }
      if (a === "citeref") return Papers.refCenter(p.paperIds || [], "课题「" + p.name + "」参考文献");
      if (a === "unlinkall") {
        const ok = await UI.confirm("取消这个课题下的全部文献关联？（文献本身不会被删除）");
        if (!ok) return;
        p.paperIds = []; await save(p); App.refresh(); return;
      }
      if (a === "addach") {
        UI.form({
          title: "添加成就",
          fields: [
            { k: "title", label: "成就名称", ph: "如 论文被 SCI 录用" },
            { k: "date", label: "日期", type: "date", value: IO.today() },
            { k: "detail", label: "详情", type: "textarea", rows: 3 },
          ],
          onSubmit: async (v) => {
            if (!v.title.trim()) return false;
            p = await DB.get("projects", id);
            p.achievements = (p.achievements || []).concat([{ id: IO.uid(), title: v.title, date: v.date, detail: v.detail }]);
            await save(p); App.refresh(); return true;
          },
        });
        return;
      }
      if (a === "addmeet") {
        UI.form({
          title: "添加会议记录",
          fields: [
            { k: "date", label: "会议日期", type: "date", value: IO.today() },
            { k: "attendees", label: "参会人", ph: "如 张凯、李导师、王师兄" },
            { k: "topics", label: "议题", ph: "本次会议主题" },
            { k: "points", label: "讨论要点", type: "textarea", rows: 3 },
            { k: "decisions", label: "决议", type: "textarea", rows: 2 },
            { k: "note", label: "备注", type: "textarea", rows: 2 },
          ],
          onSubmit: async (v) => {
            p = await DB.get("projects", id);
            p.meetings = (p.meetings || []).concat([{
              id: IO.uid(), date: v.date, attendees: v.attendees, topics: v.topics,
              points: v.points, decisions: v.decisions, note: v.note, todos: [],
            }]);
            await save(p); App.refresh(); return true;
          },
        });
        return;
      }
      if (a === "del") {
        const ok = await UI.confirm("删除「" + p.name + "」？成就、会议记录和总结会一起删除（文献不会被删）。", { danger: true, ok: "删除" });
        if (!ok) return;
        await DB.del("projects", id);
        IO.toast("已删除");
        App.go("projects");
        return;
      }
    }));
  }

  return { title: () => (App.arg && App.arg.id ? "课题详情" : "项目 / 课题"), render, mount, blank, save, editForm, cardHTML };
})();
