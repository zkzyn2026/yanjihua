/* 今日看板 + 打卡（多指标通用模型）
 * 打卡记录存在 checkins 表，主键 = 类型__日期，天然按天隔离。
 *
 * 数据模型（v1.4.0）：
 *   类型 meta.ckTypes → { id, name, unit, color, flags:{import,rec}, metrics:[{k,name,unit}], builtin, examId, archived }
 *   记录 checkins     → { id, type, date, value, vals:{指标k:数字}, note, files, paperIds, ts }
 *   value 永远是「主指标」（metrics[0]）的镜像，连续天数 / 热力图等都按它算，改指标不会让历史失效。
 */
"use strict";

const Home = (function () {

  // ---- 可编辑打卡类型（多指标）----
  // metrics：这个打卡要记几个数字。文献=时长+篇数，英语=时长+背词+真题。
  // 指标可增删改，历史记录里被删掉的指标值会在保存时清掉，主指标始终指向 metrics[0]。
  // 删除任意类型只清该类型的打卡数字与附件——文献库（papers 表）完全独立，绝不受影响。
  const DEFAULT_CK_TYPES = [
    {
      id: "lit", name: "文献阅读", unit: "分钟", color: "lit", builtin: true,
      flags: { import: true },
      metrics: [{ k: "min", name: "时长", unit: "分钟" }, { k: "cnt", name: "篇数", unit: "篇" }],
    },
    {
      id: "eng", name: "英语学习", unit: "分钟", color: "en", builtin: true,
      flags: { rec: true },
      metrics: [
        { k: "min", name: "时长", unit: "分钟" },
        { k: "word", name: "背词", unit: "个" },
        { k: "set", name: "真题", unit: "套" },
      ],
    },
  ];

  // 内置类型缺省指标：老库升级上来时用它补齐，避免老用户只看到孤零零一个「数值」
  const BUILTIN_METRICS = {
    lit: DEFAULT_CK_TYPES[0].metrics,
    eng: DEFAULT_CK_TYPES[1].metrics,
  };

  async function ckTypes() {
    let list = await DB.metaGet("ckTypes", null);
    if (!list || !Array.isArray(list) || !list.length) {
      list = DEFAULT_CK_TYPES.map((x) => JSON.parse(JSON.stringify(x)));
      await DB.metaSet("ckTypes", list);
      return list;
    }
    // 老格式类型（v1.3.0 只有单值）自动补一个主指标，保证 vals / value 有地方落
    let dirty = false;
    list = list.map((t) => {
      if (!t.metrics || !t.metrics.length) {
        t.metrics = (t.builtin && BUILTIN_METRICS[t.id])
          ? JSON.parse(JSON.stringify(BUILTIN_METRICS[t.id]))
          : [{ k: "min", name: "数值", unit: t.unit || "" }];
        dirty = true;
      }
      if (!t.flags) { t.flags = {}; dirty = true; }
      return t;
    });
    if (dirty) await DB.metaSet("ckTypes", list);
    return list;
  }
  async function saveCkTypes(list) { await DB.metaSet("ckTypes", list); }

  // 主指标 = metrics[0]：value 与它互为镜像
  function metricsOf(t) {
    return (t && t.metrics && t.metrics.length) ? t.metrics : [{ k: "min", name: "数值", unit: (t && t.unit) || "" }];
  }
  function mainKey(t) { return metricsOf(t)[0].k; }

  // 类型配色：内置类型映射到主题色变量（lit / en），用户新增的类型没有预设色就退回主文字色
  function ckColor(t) { return (t && t.color) ? "var(--" + t.color + ")" : "var(--ink)"; }

  // 活跃类型 = 没被归档的（考试考完后它的专属打卡会归档，不再要求每天打卡）
  async function activeTypes() { return (await ckTypes()).filter((t) => !t.archived); }

  // ---------- 旧数据迁移（v1.2.x 单值 → v1.3.0 通用 → v1.4.0 多指标） ----------
  // 1) v1.2.x：{ kind:"lit", minutes:45, words, sets } → { type:"lit", value:45 }
  // 2) v1.3.0：{ type:"lit", value:45 }               → { type:"lit", value:45, vals:{min:45} }
  // 不迁移的话，按 type / value / vals 聚合的地方（连续天数 / 热力图 / 累计）会漏掉老记录，
  // 老用户升级后数据会一夜清零 —— 这是截图验收时抓到过的真 bug（e2e 全新库测不出来）。
  // 幂等：跑完之后库里不再有「有 kind 没 type」或「没 vals」的记录，下次启动自然跳过。
  async function migrateCheckins() {
    const types = await ckTypes();
    const mk = {};
    types.forEach((t) => { mk[t.id] = mainKey(t); });
    const all = await DB.all("checkins");
    for (const c of all) {
      let dirty = false;
      if (c.kind && !c.type) {
        c.type = c.kind;
        c.value = Number(c.minutes || c.count || c.words || c.sets) || 0;
        delete c.kind; delete c.minutes; delete c.count; delete c.words; delete c.sets;
        dirty = true;
      }
      if (!c.vals || typeof c.vals !== "object") {
        const k = mk[c.type] || "min";
        c.vals = {};
        if (Number(c.value)) c.vals[k] = Number(c.value) || 0;
        dirty = true;
      }
      if (dirty) await DB.put("checkins", c);
    }
  }

  async function getCheckin(typeId, date) {
    const d = date || IO.today();
    const id = typeId + "__" + d;
    const got = await DB.get("checkins", id);
    const base = { id, type: typeId, date: d, value: 0, vals: {}, note: "", files: [], paperIds: [], ts: 0 };
    if (got) {
      base.value = Number(got.value) || 0;
      base.vals = (got.vals && typeof got.vals === "object") ? Object.assign({}, got.vals) : {};
      // 兼容单值老记录：把 value 落到主指标上，卡片才有东西显示
      if (!Object.keys(base.vals).length && base.value) {
        const t = (await ckTypes()).find((x) => x.id === typeId);
        base.vals[mainKey(t)] = base.value;
      }
      base.note = got.note || "";
      base.files = got.files || [];
      base.paperIds = got.paperIds || [];
      base.ts = got.ts || 0;
    }
    return base;
  }

  // patch 支持：vals（多指标）/ value（主指标，写回 vals）/ note / files / paperIds
  async function saveCheckin(typeId, patch) {
    const types = await ckTypes();
    const t = types.find((x) => x.id === typeId);
    const mk = mainKey(t);
    const keys = metricsOf(t).map((m) => m.k);
    const c = await getCheckin(typeId, IO.today());
    if (patch.vals) {
      for (const k in patch.vals) if (keys.indexOf(k) >= 0 || k === mk) c.vals[k] = Number(patch.vals[k]) || 0;
    }
    if ("value" in patch) c.vals[mk] = Number(patch.value) || 0;
    if ("note" in patch) c.note = patch.note;
    if ("files" in patch) c.files = patch.files;
    if ("paperIds" in patch) c.paperIds = patch.paperIds;
    // 指标被删掉后，记录里残留的旧键值一并清掉，避免越积越多
    Object.keys(c.vals).forEach((k) => { if (keys.indexOf(k) < 0) delete c.vals[k]; });
    c.value = Number(c.vals[mk]) || 0;
    c.ts = Date.now();
    await DB.put("checkins", c);
    return c;
  }

  function hasValue(c) {
    if ((c.paperIds && c.paperIds.length) || (c.files && c.files.length)) return true;
    if (Number(c.value) || 0) return true;
    if (c.vals) for (const k in c.vals) if (Number(c.vals[k]) || 0) return true;
    return false;
  }

  async function streak(typeId) {
    const all = await DB.all("checkins");
    const set = new Set(all.filter((c) => c.type === typeId && hasValue(c)).map((c) => c.date));
    let d = IO.today(), n = 0;
    if (!set.has(d)) d = IO.addDays(d, -1);   // 今天还没打不算断，从昨天往前数
    while (set.has(d)) { n++; d = IO.addDays(d, -1); }
    return n;
  }

  // 某类型的累计：按指标分别累加，外加打卡次数与天数
  function totalsOf(typeId, pool) {
    const mine = (pool || []).filter((x) => x.type === typeId);
    const vals = {}, days = new Set();
    let n = 0;
    mine.forEach((c) => {
      if (!hasValue(c)) return;
      n++; days.add(c.date);
      const v = (c.vals && typeof c.vals === "object") ? c.vals : {};
      for (const k in v) vals[k] = (vals[k] || 0) + (Number(v[k]) || 0);
    });
    return { vals, n, days: days.size, total: mine.length };
  }

  // 累计文案：「620 分钟 · 30 篇」，只列有数的指标
  function totalText(t, sum) {
    const bits = metricsOf(t).map((m) => {
      const v = Number((sum.vals || {})[m.k]) || 0;
      return v || m.k === mainKey(t) ? v + (m.unit || "") : "";
    }).filter(Boolean);
    return bits.length ? bits.join(" · ") : "0";
  }

  // ---------- 打卡卡片（通用：每个类型一张，按类型列表循环渲染） ----------
  async function ckCard(type, pool) {
    const c = await getCheckin(type.id);
    const flags = type.flags || {};
    const ms = metricsOf(type);
    const ids = c.paperIds || [];
    const papers = [];
    for (const id of ids) { const p = await DB.get("papers", id); if (p) papers.push(p); }
    const all = pool || await DB.all("checkins");
    const sum = totalsOf(type.id, all);
    const nf = (c.files || []).length;
    let h = '<div class="ckin ' + (type.color || "") + '" data-ckcard="' + IO.esc(type.id) + '">' +
      '<div class="row1"><b>' + IO.esc(type.name) + " · 今日打卡</b>" +
      (hasValue(c) ? '<span class="done-badge">✓ 已打卡</span>' : '<span class="chip">未打卡</span>') + "</div>";
    // 一个指标一个格子：格子数跟着指标数走，卡片结构固定（标题 / 格子 / 累计 / 按钮 / 提示），
    // 不同打卡之间的缩进与留白完全一致，不会因为指标多少而错位。
    h += '<div class="nums">' + ms.map((m) =>
      '<div class="n"><span>今日' + IO.esc(m.name) + (m.unit ? "（" + IO.esc(m.unit) + "）" : "") + "</span>" +
      '<input type="number" inputmode="numeric" min="0" data-ckm="' + IO.esc(m.k) + '" value="' +
      ((c.vals || {})[m.k] || "") + '" placeholder="0"></div>').join("") + "</div>";
    h += '<div class="cksum">累计 ' + IO.esc(totalText(type, sum)) +
      '<span class="ckdays">打卡 ' + sum.n + " 天</span></div>";
    const btns = [];
    if (flags.import) {
      btns.push('<button class="btn ghost" data-ckimport="' + IO.esc(type.id) + '">导入今日文献</button>');
      btns.push('<button class="btn ghost" data-ckpick="' + IO.esc(type.id) + '">从文献库勾选</button>');
    }
    if (flags.rec) {
      btns.push('<button class="btn ghost" data-cknote="' + IO.esc(type.id) + '">学习备注</button>');
      btns.push('<button class="btn ghost" data-ckrec="' + IO.esc(type.id) + '">学习记录' + (nf ? "（" + nf + "）" : "") + "</button>");
    }
    btns.push('<button class="btn pri" data-cksave="' + IO.esc(type.id) + '">保存打卡</button>');
    h += '<div class="btnrow ckbtns">' + btns.join("") + "</div>";
    // 底部提示区：所有卡片都留这一行（没有内容时也占位），高度才不会一张张跳
    const tip = papers.length
      ? "今天读了：" + papers.map((p) => '<span class="chip lit">' + IO.esc(p.title) + "</span>").join(" ")
      : (flags.import ? "还没关联今天读过的文献，可以先打卡再「导入今日文献」" : "");
    h += '<div class="cktip">' + (tip || "") + "</div>";
    if (c.note) h += '<div class="cktip">今日：' + IO.esc(c.note) + "</div>";
    if (nf) h += '<div class="cktip">今日附件 ' + nf + " 个</div>";
    // 【必须闭合】这张卡的 </div> 漏掉的话，浏览器会把后面所有卡片嵌套进第一张卡里：
    // 表现为卡片缩进不一致、且保存时 card.querySelectorAll("[data-ckm]") 会读到别的卡的输入框
    // （后面的值覆盖前面的，打卡数字串台）。踩过一次，别再删。
    return h + "</div>";
  }

  function bindCheckin(root) {
    root.querySelectorAll("[data-cksave]").forEach((b) => {
      b.addEventListener("click", async () => {
        const typeId = b.getAttribute("data-cksave");
        const card = b.closest("[data-ckcard]");
        const vals = {};
        (card ? card.querySelectorAll("[data-ckm]") : []).forEach((inp) => {
          vals[inp.getAttribute("data-ckm")] = Number(inp.value) || 0;
        });
        await saveCheckin(typeId, { vals });
        IO.toast("打卡已保存");
        // 先刷新再开记录页：UI.modal 非阻塞，紧跟其后的 App.refresh() 会抢跑，
        // 这里 refresh 已经 await 完成，弹窗才打开，顺序不会打架。
        await App.refresh();
        // 记录页只给「勾了附件」的类型开（默认英语学习）。
        // 判断依据是该类型的 flags.rec，不能读 card 上的 data-ckrec ——
        // 那个属性在卡片内部的按钮上，不在卡片 div 本身，读了恒为 null（记录页永不弹出）。
        const ty = (await ckTypes()).find((x) => x.id === typeId);
        if (ty && ty.flags && ty.flags.rec) recordDialog(typeId);
      });
    });
    root.querySelectorAll("[data-ckimport]").forEach((b) => {
      // 内部会打开非阻塞弹窗，刷新由弹窗退出时的 onClose 负责，这里不能抢跑
      b.addEventListener("click", async () => { await importTodayPapers(b.getAttribute("data-ckimport")); });
    });
    root.querySelectorAll("[data-ckrec]").forEach((b) => {
      b.addEventListener("click", async () => { await recordDialog(b.getAttribute("data-ckrec")); });
    });
    root.querySelectorAll("[data-ckpick]").forEach((b) => {
      // pickTodayPapers 内部会打开非阻塞弹窗，刷新由弹窗退出时的 onClose 负责，这里不能抢跑
      b.addEventListener("click", async () => { await pickTodayPapers(b.getAttribute("data-ckpick")); });
    });
    root.querySelectorAll("[data-cknote]").forEach((b) => {
      b.addEventListener("click", async () => {
        const typeId = b.getAttribute("data-cknote");
        const c = await getCheckin(typeId);
        UI.form({
          title: "今天学了什么",
          fields: [{ k: "note", label: "学习内容备注", type: "textarea", value: c.note || "", rows: 3, ph: "如：精听 BBC 一篇、背了 List 3" }],
          onSubmit: async (v) => { await saveCheckin(typeId, { note: v.note }); return true; },
        });
      });
    });
  }

  // ---------- 考试专属打卡类型 ----------
  // 备考中的考试会在今日页自动拥有一张打卡卡（「六级备考」这种），考完自动归档并出备考总结。
  // 类型 id 形如 ex_<考试id>，用 examId 反查；删除考试时连类型带记录一起清掉。
  function examTypeId(examId) { return "ex_" + examId; }

  async function ensureExamType(e) {
    if (!e || !e.id) return;
    const list = await ckTypes();
    const id = examTypeId(e.id);
    const name = examCkName(e);
    const cur = list.find((x) => x.id === id);
    if (cur) {
      // 改名 / 从已考完改回备考中：同步名字并取消归档
      cur.name = name;
      cur.examId = e.id;
      cur.archived = false;
      await saveCkTypes(list);
      return cur;
    }
    const t = {
      id, name, unit: "分钟", color: "en", builtin: false, examId: e.id, archived: false,
      flags: { rec: true },
      metrics: [{ k: "min", name: "时长", unit: "分钟" }],
    };
    list.push(t);
    await saveCkTypes(list);
    return t;
  }

  function examCkName(e) {
    const base = CLabel(CONST.examType, e && e.type) || "考试";
    return (e && e.name ? e.name : base) + "备考";
  }

  // 考完：把专属打卡类型归档（不再要求每天打卡），返回备考总结写进考试条目
  async function archiveExamType(e) {
    if (!e || !e.id) return null;
    const list = await ckTypes();
    const id = examTypeId(e.id);
    const t = list.find((x) => x.id === id);
    const sum = await examSummary(e.id);
    if (t) { t.archived = true; await saveCkTypes(list); }
    return sum;
  }

  async function removeExamType(examId) {
    const list = await ckTypes();
    const id = examTypeId(examId);
    const next = list.filter((t) => t.id !== id);
    if (next.length !== list.length) await saveCkTypes(next);
    const all = await DB.all("checkins");
    for (const c of all.filter((c) => c.type === id)) {
      for (const f of (c.files || [])) await UI.attach.del(f.id);
      await DB.del("checkins", c.id);
    }
  }

  // 备考总结：从该考试的打卡记录里统计天数 / 次数 / 各指标累计 / 起止日期
  async function examSummary(examId) {
    const list = await ckTypes();
    const t = list.find((x) => x.examId === examId);
    if (!t) return null;
    const all = await DB.all("checkins");
    const mine = all.filter((c) => c.type === t.id && hasValue(c))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const vals = {};
    metricsOf(t).forEach((m) => { vals[m.k] = 0; });
    mine.forEach((c) => {
      const v = (c.vals && typeof c.vals === "object") ? c.vals : {};
      metricsOf(t).forEach((m) => { vals[m.k] += Number(v[m.k]) || 0; });
    });
    return {
      n: mine.length,
      days: new Set(mine.map((c) => c.date)).size,
      vals,
      from: mine.length ? mine[0].date : "",
      to: mine.length ? mine[mine.length - 1].date : "",
    };
  }

  // ---------- 管理打卡（独立页面） ----------
  // 改动先落在 DRAFT 上，点「保存」才写库。删除类型在保存时才真正清打卡记录，
  // 避免误点一下历史就没了。离开页面（切 tab / 返回）时 DRAFT 丢弃。
  let DRAFT = null;

  function cktCard(t) {
    const ms = metricsOf(t);
    return '<div class="card ckt-card" data-ckt-card data-id="' + IO.esc(t.id) + '">' +
      '<div class="ckt-top">' +
      '<input data-ckt="name" value="' + IO.esc(t.name) + '" placeholder="类型名称" aria-label="类型名称">' +
      '<input data-ckt="unit" value="' + IO.esc(t.unit || "") + '" placeholder="主单位" aria-label="主单位">' +
      '<button class="x" data-ckt-del="' + IO.esc(t.id) + '">删除</button></div>' +
      '<div class="ckt-metrics">' +
      '<span class="tiny">指标</span>' +
      ms.map((m) => '<span class="chip">' + IO.esc(m.name) + (m.unit ? "（" + IO.esc(m.unit) + "）" : "") + "</span>").join(" ") +
      '<button class="btn sm ghost mini" data-ckt-metrics="' + IO.esc(t.id) + '">编辑指标</button></div>' +
      '<div class="ckt-flags">' +
      '<label><input type="checkbox" data-ckt="import" ' + ((t.flags && t.flags.import) ? "checked" : "") + "> 可导入文献</label>" +
      '<label><input type="checkbox" data-ckt="rec" ' + ((t.flags && t.flags.rec) ? "checked" : "") + "> 可传附件</label>" +
      "</div></div>";
  }

  async function ckSetRender() {
    // 考试专属的打卡类型（「六级备考」这种）由考试条目自己管，不放在这个页面上编辑，
    // 否则用户改一下别的东西就可能把考试关联打卡改坏。
    if (!DRAFT) {
      DRAFT = JSON.parse(JSON.stringify((await ckTypes()).filter((t) => !t.examId)));
    }
    let h = '<div class="card"><div class="muted" style="line-height:1.75;font-size:13px">' +
      "指标就是这张打卡卡上要填的几个数字：文献阅读默认「时长 + 篇数」，英语学习默认「时长 + 背词 + 真题」。<br>" +
      "第一个指标是主指标，打卡热力图和连续天数都按它算。改完记得点下面的「保存」。</div></div>";
    h += DRAFT.map(cktCard).join("");
    h += '<button class="btn ghost wide" id="ckt-add" style="margin-top:8px">＋ 新增打卡类型</button>';
    h += '<button class="btn pri wide" id="ckt-save" style="margin-top:10px">保存</button>';
    h += '<div class="tiny" style="margin-top:8px">删除某个类型会同时清掉它的打卡记录与附件，' +
      "已导入的文献不受影响。</div>";
    return h;
  }

  function ckSetMount() {
    const root = document.getElementById("view");
    const readDraft = () => {
      DRAFT.forEach((t) => {
        const card = root.querySelector('[data-ckt-card][data-id="' + t.id + '"]');
        if (!card) return;
        const nm = card.querySelector('[data-ckt="name"]');
        const un = card.querySelector('[data-ckt="unit"]');
        const im = card.querySelector('[data-ckt="import"]');
        const rc = card.querySelector('[data-ckt="rec"]');
        if (nm) t.name = (nm.value || "").trim();
        if (un) t.unit = (un.value || "").trim();
        t.flags = { import: !!(im && im.checked), rec: !!(rc && rc.checked) };
      });
    };
    root.querySelectorAll("[data-ckt-metrics]").forEach((b) => {
      b.addEventListener("click", () => {
        readDraft();
        const id = b.getAttribute("data-ckt-metrics");
        metricDialog(id);
      });
    });
    root.querySelectorAll("[data-ckt-del]").forEach((b) => {
      b.addEventListener("click", async () => {
        readDraft();
        const id = b.getAttribute("data-ckt-del");
        const t = DRAFT.find((x) => x.id === id);
        const ok = await UI.confirm(
          "删除「" + (t ? t.name : "该类型") + "」？保存后该类型的打卡记录与附件会一并清除，已导入的文献不受影响。",
          { danger: true, ok: "删除" });
        if (!ok) return;
        DRAFT = DRAFT.filter((x) => x.id !== id);
        App.refresh();
      });
    });
    const add = root.querySelector("#ckt-add");
    if (add) add.addEventListener("click", () => {
      readDraft();
      DRAFT.push({
        id: "ck_" + Date.now().toString(36), name: "", unit: "", color: "", builtin: false,
        flags: {}, metrics: [{ k: "min", name: "时长", unit: "分钟" }],
      });
      App.refresh();
    });
    const save = root.querySelector("#ckt-save");
    if (save) save.addEventListener("click", async () => {
      readDraft();
      const list = DRAFT.filter((t) => t.name);
      if (!list.length) { IO.toast("至少保留一个打卡类型"); return; }
      const before = await ckTypes();
      // 考试专属类型不在这个页面上，必须原样带回去再存，否则保存一次就把它们抹掉了
      const examTs = before.filter((t) => t.examId);
      const gone = before.filter((t) => !list.some((x) => x.id === t.id));
      await saveCkTypes(list.concat(examTs));
      // 保存时才真正清被删类型的历史记录（含附件二进制）
      for (const t of gone) {
        const all = await DB.all("checkins");
        for (const c of all.filter((c) => c.type === t.id)) {
          for (const f of (c.files || [])) await UI.attach.del(f.id);
          await DB.del("checkins", c.id);
        }
      }
      DRAFT = null;
      IO.toast("打卡类型已保存" + (gone.length ? "，已清除 " + gone.length + " 个类型" : ""));
      App.go("home");
    });
  }

  // 指标编辑子弹窗：增删改某一个类型的指标，改完写回 DRAFT（页面上点保存才落库）
  function metricDialog(typeId) {
    const t = (DRAFT || []).find((x) => x.id === typeId);
    if (!t) return;
    const ms = metricsOf(t);
    const row = (m, i) =>
      '<div class="ckm-row" data-ckm-row data-i="' + i + '">' +
      '<input data-ckm="name" value="' + IO.esc(m.name) + '" placeholder="指标名，如 背词">' +
      '<input data-ckm="unit" value="' + IO.esc(m.unit || "") + '" placeholder="单位" style="width:70px">' +
      '<button class="x" data-ckm-del="' + i + '">删除</button></div>';
    let cardRef = null;
    const paint = () => {
      const box = cardRef && cardRef.querySelector("#ckm-list");
      if (!box) return;
      box.innerHTML = metricsOf(t).map(row).join("");
      box.querySelectorAll("[data-ckm-del]").forEach((b) => {
        b.addEventListener("click", () => {
          const i = Number(b.getAttribute("data-ckm-del"));
          t.metrics = t.metrics.filter((_, x) => x !== i);
          paint();
        });
      });
    };
    UI.modal({
      title: (t.name || "类型") + " · 指标",
      body: '<div class="muted" style="font-size:13px;margin-bottom:8px">' +
        "第一个指标是主指标：打卡热力图、连续天数、统计页累计都按它算。</div>" +
        '<div id="ckm-list">' + ms.map(row).join("") + "</div>" +
        '<button class="btn ghost wide sm" id="ckm-add" style="margin-top:8px">＋ 新增指标</button>',
      actions: [{
        label: "确定", cls: "pri", fn: () => {
          const list = [];
          (cardRef ? cardRef.querySelectorAll("[data-ckm-row]") : []).forEach((r) => {
            const name = (r.querySelector('[data-ckm="name"]').value || "").trim();
            if (!name) return;
            list.push({ k: (t.metrics && t.metrics[Number(r.getAttribute("data-i"))] || {}).k || ("m" + list.length),
              name, unit: (r.querySelector('[data-ckm="unit"]').value || "").trim() });
          });
          if (!list.length) { IO.toast("至少保留一个指标"); return false; }
          t.metrics = list;
          t.unit = list[0].unit || t.unit;
          App.refresh();
          return true;
        },
      }],
      mount: (card) => {
        cardRef = card;
        paint();
        const add = card.querySelector("#ckm-add");
        if (add) add.addEventListener("click", () => {
          t.metrics = metricsOf(t).concat([{ k: "m" + Date.now().toString(36), name: "", unit: "" }]);
          paint();
        });
      },
    });
  }

  // 旧入口保留：首页按钮与别处调用都走独立页面
  function typeManager() { App.go("ckset"); }

  async function pickTodayPapers(typeId) {
    const c = await getCheckin(typeId);
    const all = await DB.all("papers");
    all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const sel = new Set(c.paperIds || []);
    const body = all.length
      ? '<div style="margin:-4px -6px">' + all.map((p) =>
        '<button class="item" style="width:100%;text-align:left" data-pid="' + p.id + '">' +
        '<span class="tick' + (sel.has(p.id) ? " on" : "") + '"></span>' +
        '<div class="ib"><div class="t1">' + IO.esc(p.title) + "</div>" +
        '<div class="t2">' + IO.esc(CLabel(CONST.paperStatus, p.status)) + " · " + IO.esc((p.authors || []).slice(0, 2).join("、") || "未填作者") + "</div></div></button>"
      ).join("") + "</div>"
      : '<div class="empty">还没有文献，先去「文献」页添加</div>';
    // 弹窗非阻塞：勾选发生在用户点击时，刷新必须推迟到弹窗退出之后；
    // 用 once 保证「完成 / ✕ / 点遮罩」多条退出路径只刷新一次，避免重复渲染导致事件重复绑定。
    let refreshed = false;
    const refreshOnce = () => { if (refreshed) return; refreshed = true; App.refresh(); };
    UI.modal({
      title: "今天读了哪些文献",
      body,
      actions: [{ label: "完成", cls: "pri", fn: () => { refreshOnce(); return true; } }],
      onClose: refreshOnce,
      mount: (card) => {
        card.querySelectorAll("[data-pid]").forEach((b) => {
          b.addEventListener("click", async () => {
            const id = b.getAttribute("data-pid");
            const cur = await getCheckin(typeId);
            const s = new Set(cur.paperIds || []);
            if (s.has(id)) s.delete(id); else s.add(id);
            b.querySelector(".tick").classList.toggle("on", s.has(id));
            await saveCheckin(typeId, { paperIds: Array.from(s) });
          });
        });
      },
    });
  }

  // ---------- 打卡后导入今天读的文献（顺序反转：先打卡，再导入） ----------
  // 复用 papers.js 的 PDF 入库流程，link 指向 checkins 表今天的记录，
  // importPdfFile 入库成功后会自动 linkPaper，把新文献写进本次打卡的 paperIds。
  async function importTodayPapers(typeId) {
    // 【手势纪律】UI.pickFile 必须在用户点击的同步栈里调用，前面不能有任何 await，
    // 否则手机上点了没反应。所以顺序反过来了：先选文件 → 再建今天的打卡记录 → 再入库。
    const files = await UI.pickFile("application/pdf,.pdf", true);
    if (!files || !files.length) return;
    // linkPaper 是 DB.get + 改 + put，记录不存在会静默失败，所以入库前先确保今天的记录已落地
    const c = await saveCheckin(typeId, {});
    await Papers.importPdfPicked(files, { link: "checkins", id: c.id });
  }

  // ---------- 打卡记录页 ----------
  function ckFilesHTML(files) {
    const list = files || [];
    if (!list.length) return '<div class="empty" style="padding:18px 0">还没有附件</div>';
    return list.map((f) => {
      const ext = (f.name || "").split(".").pop().toUpperCase().slice(0, 4) || "文件";
      return '<div class="file"><div class="fi">' + IO.esc(ext) + "</div>" +
        '<div class="fb"><div class="fn">' + IO.esc(f.name) + '</div><div class="fs">' + IO.kb(f.size || 0) + "</div></div>" +
        '<button class="btn sm ghost" data-openf="' + IO.esc(f.id) + '">打开</button>' +
        '<button class="x" data-delf="' + IO.esc(f.id) + '">删除</button></div>';
    }).join("");
  }

  // 重画记录页里的附件列表并重新绑定（打开 / 删除）
  async function bindCkFiles(card, typeId) {
    const box = card.querySelector("#ckfiles");
    if (!box) return;
    const c = await getCheckin(typeId);
    box.innerHTML = ckFilesHTML(c.files);
    box.querySelectorAll("[data-openf]").forEach((b) => {
      b.addEventListener("click", () => UI.attach.open(b.getAttribute("data-openf")));
    });
    box.querySelectorAll("[data-delf]").forEach((b) => {
      b.addEventListener("click", async () => {
        const fid = b.getAttribute("data-delf");
        const cur = await getCheckin(typeId);
        cur.files = (cur.files || []).filter((f) => f.id !== fid);
        await saveCheckin(typeId, { files: cur.files });
        await UI.attach.del(fid);
        await bindCkFiles(card, typeId);
      });
    });
  }

  // 上传附件挂到今天这条打卡上（图片 / doc / docx / pdf 等）
  async function addCheckinFiles(card, typeId) {
    const files = await UI.pickFile("image/*,.doc,.docx,.pdf,.txt", true);
    if (!files || !files.length) return;
    IO.busy(true, "上传中…");
    try {
      const metas = await UI.attach.add(files, true);
      const c = await getCheckin(typeId);
      c.files = (c.files || []).concat(metas);
      await saveCheckin(typeId, { files: c.files });
      IO.toast("已上传 " + metas.length + " 个附件");
      if (card) await bindCkFiles(card, typeId);
    } catch (e) {
      IO.toast("上传失败：" + (e && e.message ? e.message : e));
    } finally {
      IO.busy(false);
    }
  }

  // 打卡后弹出的记录页：可以传附件，也可以直接关掉什么都不传
  async function recordDialog(typeId) {
    const types = await ckTypes();
    const t = types.find((x) => x.id === typeId) || { name: "学习" };
    const c = await getCheckin(typeId);
    let cardRef = null;
    // 弹窗非阻塞：退出路径有「关闭 / ✕ / 点遮罩」三条，用 once 保证只刷新一次
    let refreshed = false;
    const refreshOnce = () => { if (refreshed) return; refreshed = true; App.refresh(); };
    UI.modal({
      title: "今日" + t.name + "记录",
      body: '<div class="muted" style="font-size:13px;line-height:1.7;margin-bottom:8px">' +
        "可以上传今天的学习材料：笔记截图、真题 PDF、doc 文档等。<br>不传也行，直接点「关闭」。</div>" +
        '<div id="ckfiles">' + ckFilesHTML(c.files) + "</div>",
      actions: [
        {
          label: "上传附件", cls: "pri", fn: async () => {
            await addCheckinFiles(cardRef, typeId);
            return false;   // 返回 false：传完不关弹窗，还能接着传或打开看
          },
        },
        { label: "关闭", cls: "ghost", fn: () => true },
      ],
      onClose: refreshOnce,
      mount: (card) => { cardRef = card; bindCkFiles(card, typeId); },
    });
  }

  // ---------- 重置打卡记录与连续天数 ----------
  // 只删 checkins 里该 type 的记录（连同这些记录自带的附件），
  // 文献、笔记、总结、竞赛、课题一概不动；连续天数由 checkins 推算，记录清了自然归零。
  async function resetCheckins(typeId) {
    const types = await ckTypes();
    const t = types.find((x) => x.id === typeId);
    const label = t ? t.name : "该类型";
    const okd = await UI.confirm(
      "只清除" + label + "的打卡记录与连续天数，你的文献、笔记、总结不会被删除。确定要重置吗？",
      { danger: true, ok: "重置", title: "重置" + label + "打卡" });
    if (!okd) return;
    const all = await DB.all("checkins");
    const mine = all.filter((c) => c.type === typeId);
    for (const c of mine) {
      for (const f of (c.files || [])) await UI.attach.del(f.id);
      await DB.del("checkins", c.id);
    }
    IO.toast(label + "打卡记录已重置");
    App.refresh();
  }

  // ---------- 倒计时 ----------
  async function countdown() {
    const t = IO.today();
    const out = [];
    const exams = await DB.all("exams");
    exams.forEach((e) => {
      if (!e.date || e.state === "done") return;
      out.push({ kind: "考试", name: CLabel(CONST.examType, e.type) + "：" + (e.name || CLabel(CONST.examType, e.type)), date: e.date, go: "exams" });
    });
    const cts = await DB.all("contests");
    cts.forEach((c) => {
      if (c.stage === "done") return;
      (c.nodes || []).forEach((n) => {
        if (!n.date || n.done) return;
        out.push({ kind: "竞赛", name: (c.name || "竞赛") + " · " + n.name, date: n.date, go: "contests", arg: c.id });
      });
      if (c.deadline) out.push({ kind: "竞赛", name: (c.name || "竞赛") + " · 截止", date: c.deadline, go: "contests", arg: c.id });
    });
    const pjs = await DB.all("projects");
    pjs.forEach((p) => {
      if (p.status === "done") return;
      if (p.deadline) out.push({ kind: "课题", name: (p.name || "课题") + " · 截止", date: p.deadline, go: "projects", arg: p.id });
    });
    out.forEach((x) => { x.days = IO.diffDays(t, x.date); });
    out.sort((a, b) => a.days - b.days);
    return out.filter((x) => x.days <= 45);
  }

  function cdHTML(list) {
    if (!list.length) return '<div class="empty">近期没有待办节点，去竞赛 / 课题 / 考试里加个截止日期吧</div>';
    return list.map((x) => {
      const over = x.days < 0;
      const cls = over ? "dg" : (x.days <= 7 ? "warn" : "");
      const txt = over ? "已逾期 " + (-x.days) + " 天" : (x.days === 0 ? "就是今天" : "还有 " + x.days + " 天");
      return '<div class="item" style="padding:10px 0">' +
        '<span class="chip ' + cls + '">' + IO.esc(x.kind) + "</span>" +
        '<div class="ib"><div class="t1">' + IO.esc(x.name) + "</div>" +
        '<div class="t2">' + IO.fmtMD(x.date) + " · " + txt + "</div></div>" +
        '<button class="btn sm ghost" data-go="' + x.go + '"' + (x.arg ? ' data-arg="' + IO.esc(x.arg) + '"' : "") + ">查看</button>" +
        "</div>";
    }).join("");
  }

  // ---------- 看板 ----------
  async function renderHome() {
    const t = IO.today();
    const types = await activeTypes();
    const [papers, contests, projects, cd, uname, vocab, pool] = await Promise.all([
      DB.all("papers"), DB.all("contests"), DB.all("projects"),
      countdown(), DB.metaGet("username", ""), DB.all("vocab"), DB.all("checkins"),
    ]);
    // 每个类型一张卡片：卡片与「今天有没有打卡」都按类型列表循环，
    // 新增 / 删除 / 改名后首页自动跟着变，不用再改这里。
    const cards = [];
    let doneN = 0;
    for (const ty of types) {
      if (hasValue(await getCheckin(ty.id))) doneN++;
      cards.push(await ckCard(ty, pool));
    }
    const streaks = {};
    for (const ty of types) streaks[ty.id] = await streak(ty.id);

    const reading = papers.filter((p) => p.status === "reading");
    const runC = contests.filter((c) => c.stage && c.stage !== "done" && c.stage !== "prep");
    const runP = projects.filter((p) => p.status === "doing");
    const noN = vocab.filter((v) => !v.mastered).length;

    const hello = (uname && String(uname).trim()) ? String(uname).trim() : "同学";
    let h = "";
    h += '<div class="card"><div style="display:flex;align-items:center;gap:10px">' +
      '<div><div style="font-size:17px;font-weight:600">' + IO.esc(hello) + "，你好</div>" +
      '<div class="muted" style="margin-top:2px">' + IO.fmtFull(t) + "</div></div>" +
      '<div style="margin-left:auto;text-align:right"><div style="font-size:20px;font-weight:600">' +
      doneN + "/" + types.length + "</div>" +
      '<div class="muted">今日打卡</div></div></div></div>';

    h += cards.join("");
    // 管理入口：独立页面（有自己的标题和返回按钮），类型可增删改
    h += '<button class="btn ghost wide sm" data-go="ckset" style="margin-top:8px">管理打卡类型</button>';

    h += '<div class="sec"><h2>连续打卡</h2></div>';
    h += '<div class="stats">' + types.map((ty) =>
      '<div class="stat"><b style="color:' + ckColor(ty) + '">' + streaks[ty.id] + "</b><span>" +
      IO.esc(ty.name) + "连续天数</span></div>").join("") + "</div>";

    h += '<div class="sec"><h2>倒计时 / 近期节点</h2></div>';
    h += '<div class="card">' + cdHTML(cd) + "</div>";

    h += '<div class="sec"><h2>快捷入口</h2></div>';
    const quick = [];
    quick.push('<div class="card"><div class="ch"><h3>生词本 <span class="sub">未掌握 ' + noN + " · 已掌握 " + (vocab.length - noN) + "</span></h3>" +
      '<button class="btn sm ghost" id="vocab-open">进入</button></div>' +
      '<div class="tiny">' + (vocab.length ? "点「进入」查看全部、勾选已掌握、编辑或删除" : "还没有生词，点「进入」添加第一条") + "</div></div>");
    if (reading.length) quick.push('<div class="card"><div class="ch"><h3>在读文献 <span class="sub">' + reading.length + " 篇</span></h3>" +
      '<button class="btn sm ghost" data-go="papers">进入</button></div>' +
      reading.slice(0, 3).map((p) => '<div class="item" style="padding:8px 0"><div class="ib"><div class="t1">' + IO.esc(p.title) + "</div>" +
        '<div class="t2">进度 ' + (p.progress || 0) + "%</div></div>" +
        '<button class="btn sm ghost" data-go="papers" data-arg="' + IO.esc(p.id) + '">查看</button></div>').join("") +
      "</div>");
    if (runC.length) quick.push('<div class="card"><div class="ch"><h3>进行中竞赛 <span class="sub">' + runC.length + " 项</span></h3>" +
      '<button class="btn sm ghost" data-go="contests">进入</button></div>' +
      runC.slice(0, 3).map((c) => '<div class="item" style="padding:8px 0"><div class="ib"><div class="t1">' + IO.esc(c.name) + "</div>" +
        '<div class="t2">' + IO.esc(CLabel(CONST.contestStage, c.stage)) + "</div></div>" +
        '<button class="btn sm ghost" data-go="contests" data-arg="' + IO.esc(c.id) + '">查看</button></div>').join("") +
      "</div>");
    if (runP.length) quick.push('<div class="card"><div class="ch"><h3>进行中课题 <span class="sub">' + runP.length + " 项</span></h3>" +
      '<button class="btn sm ghost" data-go="projects">进入</button></div>' +
      runP.slice(0, 3).map((p) => '<div class="item" style="padding:8px 0"><div class="ib"><div class="t1">' + IO.esc(p.name) + "</div>" +
        '<div class="t2">进度 ' + (p.progress || 0) + "%</div></div>" +
        '<button class="btn sm ghost" data-go="projects" data-arg="' + IO.esc(p.id) + '">查看</button></div>').join("") +
      "</div>");
    h += quick.length ? quick.join("") : '<div class="empty">还没有正在进行的事项</div>';

    return h;
  }

  return {
    title: "研计划",
    render: renderHome,
    mount: () => {
      const root = document.getElementById("view");
      bindCheckin(root);
      const vo = root.querySelector("#vocab-open");
      if (vo) vo.addEventListener("click", () => { if (window.Exams) Exams.openVocab(); });
    },
    // 独立页面：管理打卡类型
    ckSet: { title: "管理打卡", render: ckSetRender, mount: ckSetMount },
    ckCard, ckTypes, activeTypes, ckColor, metricsOf, mainKey, typeManager, bindCheckin, migrateCheckins,
    getCheckin, saveCheckin, hasValue, streak, totalsOf, totalText, countdown,
    importTodayPapers, recordDialog, resetCheckins,
    examTypeId, ensureExamType, archiveExamType, removeExamType, examSummary, examCkName,
  };
})();
