/* 路由与启动：底部五个模块 + 备份迁移 + 关于 + 离线缓存 */
"use strict";

const VIEWS = {
  home: Home, papers: Papers, contests: Contests, projects: Projects, exams: Exams, stats: Stats,
  ckset: Home.ckSet,   // 「管理打卡」独立页面：不在底栏里，靠返回按钮回首页
};
// 底栏里的视图：判断「返回」该退详情页还是回首页，也决定返回按钮要不要显示
const TAB_VIEWS = ["home", "papers", "contests", "projects", "exams"];
// 旧版本 hash 别名：v1.3.0 及以前是 #/english，升级上来的人书签 / 会话记录要能落到考试页
const ALIAS = { english: "exams" };

// ---------- hash 路由：把「当前视图 + 详情页 id」写进 URL ----------
// 目的：手机上下拉刷新 / 杀后台重开之后，仍停在原来那一页（包括课题详情这种详情页）。
function hashOf(v, arg) {
  const id = arg && arg.id ? arg.id : "";
  return "#/" + v + (id ? "/" + encodeURIComponent(id) : "");
}
// 必须用 replaceState：pushState 会把浏览历史塞满，安卓返回键会变得很难用。
function syncHash(v, arg) {
  try { history.replaceState(null, "", hashOf(v, arg)); } catch (e) { /* file:// 下可能被拒，忽略即可 */ }
}
function hashPart(s) {
  try { return decodeURIComponent(s); } catch (e) { return s; }
}
function parseHash() {
  const parts = String(location.hash || "").replace(/^#/, "").split("/").filter(Boolean);
  const raw = parts.length ? hashPart(parts[0]) : "";
  const v = ALIAS[raw] || raw;
  if (!v || !VIEWS[v]) return { v: "home", id: "" };   // 空 / 非法一律回落首页
  return { v: v, id: parts.length > 1 ? hashPart(parts[1]) : "" };
}

// 版本号比较：按数字段逐段比（1.9.0 必须小于 1.10.0，字符串直接比会反过来）
function cmpVer(a, b) {
  const pa = String(a || "").split(".").map((x) => parseInt(x, 10) || 0);
  const pb = String(b || "").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// 线上版本号：读服务器上的 config.js（带查询参数，sw.js 对此类请求放行走网络）。
// 离线 / file:// 打开时会抛错，返回 null —— 调用方据此判断「查不到版本」。
async function liveVersion() {
  const r = await fetch("./config.js?nocache=" + Date.now(), { cache: "reload" });
  if (!r.ok) return null;
  const t = await r.text();
  const m = t.match(/appVersion:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

const App = {
  view: "home",
  arg: null,
  cmpVer, liveVersion,

  async go(v, arg) {
    this.view = v;
    this.arg = arg || null;
    syncHash(this.view, this.arg);
    await this.render(true);
  },
  async refresh() { await this.render(false); },

  // nav=true 表示「切到另一个页面 / 进入详情页」——整屏滚回顶部；
  // nav=false 表示「同页面内的交互完成后的刷新」——保留用户当前滚动位置，
  // 解决「每次交互都被弹回页面顶端」的问题（Issue 7）。
  async render(nav) {
    const V = VIEWS[this.view] || VIEWS.home;
    // 同页刷新前先记下滚动位置，重绘后还原（页面可能变长变短，不还原会错位）
    const keepY = nav ? 0 : (window.scrollY || 0);
    document.getElementById("tb-title").textContent = typeof V.title === "function" ? V.title() : V.title;
    const back = document.getElementById("tb-back");
    // 底栏页面只有进了详情页才显示返回；独立页面（统计 / 管理打卡）不占底栏，常驻显示
    back.hidden = !this.arg && TAB_VIEWS.indexOf(this.view) >= 0;
    const root = document.getElementById("view");
    root.innerHTML = '<div class="empty">加载中…</div>';
    let html;
    try {
      html = await V.render();
    } catch (e) {
      html = '<div class="empty">页面渲染出错：' + IO.esc(e && e.message ? e.message : e) + "</div>";
      console.error(e);
    }
    root.innerHTML = html;
    if (V.mount) {
      try { await V.mount(); } catch (e) { console.error(e); }
    }
    document.querySelectorAll("#tabbar button").forEach((b) => {
      b.classList.toggle("on", b.getAttribute("data-tab") === this.view);
    });
    if (nav) window.scrollTo(0, 0);
    else window.scrollTo(0, keepY);
  },

  // ---------- 备份 / 恢复 ----------
  async exportZip() {
    IO.busy(true, "正在打包…");
    try {
      const data = {};
      // ft（全文索引）是纯文本，和 papers 等表一样直进导出清单；
      // 少了它，恢复后文献还在但正文检索全空，且不报错——最难排查的那类问题。
      for (const s of ["papers", "checkins", "contests", "projects", "exams", "vocab", "meta", "ft"]) {
        data[s] = await DB.all(s);
      }
      const files = await DB.all("files");
      data.files = files.map((f) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, w: f.w, h: f.h, ts: f.ts }));
      const zipFiles = [];
      zipFiles.push({
        name: "yanjihua-data.json",
        data: new TextEncoder().encode(JSON.stringify({
          app: "研计划", owner: SITE.owner || "", version: 1,
          exportedAt: new Date().toISOString(), data,
        })),
      });
      for (const f of files) {
        const u8 = new Uint8Array(await f.blob.arrayBuffer());
        zipFiles.push({ name: "files/" + f.id + "__" + IO.safeName(f.name), data: u8 });
      }
      const blob = IO.makeZip(zipFiles);
      IO.download(blob, "研计划备份-" + IO.today() + ".zip");
      IO.toast("已导出备份，含 " + files.length + " 个附件");
    } catch (e) {
      IO.toast("导出失败：" + (e && e.message ? e.message : e));
    } finally {
      IO.busy(false);
    }
  },

  async importZip(file, merge) {
    IO.busy(true, "正在恢复…");
    try {
      const list = await IO.unzip(file);
      const ent = list.find((f) => f.name.indexOf("yanjihua-data.json") >= 0);
      if (!ent) throw new Error("压缩包里没有研计划的数据文件");
      const obj = JSON.parse(new TextDecoder().decode(ent.u8));
      const data = (obj && obj.data) || obj;
      const fileMap = {};
      list.forEach((f) => {
        if (f.name.indexOf("files/") !== 0) return;
        const base = f.name.slice(6);
        const id = base.split("__")[0];
        if (id) fileMap[id] = f.u8;
      });
      const st = await DB.replaceAll(data, fileMap, merge);
      // 旧版本（v1.2.x）备份里的打卡记录还是 kind/minutes 老格式，恢复完立刻迁移，
      // 否则恢复后连续天数 / 热力图 / 累计会把老记录漏掉
      try { await Home.migrateCheckins(); } catch (e) { /* 迁移失败不阻断恢复 */ }
      const n = ["papers", "contests", "projects", "exams", "vocab"]
        .reduce((a, k) => a + ((data[k] || []).length), 0);
      let msg = (merge ? "已合并导入 " : "已恢复 ") + n + " 条记录";
      // 附件二进制缺失的条目会被跳过，但引用还在 -> 明确告知，别让用户点了才发现
      if (st && st.filesMissing) msg += "，其中 " + st.filesMissing + " 个附件缺失";
      IO.toast(msg);
      App.go("home");
    } catch (e) {
      IO.toast("恢复失败：" + (e && e.message ? e.message : e));
    } finally {
      IO.busy(false);
    }
  },

  async backupDialog() {
    const [papers, contests, projects] = await Promise.all([DB.all("papers"), DB.all("contests"), DB.all("projects")]);
    const files = await DB.all("files");
    const size = files.reduce((a, f) => a + (f.size || 0), 0);
    UI.modal({
      title: "备份与恢复",
      body:
        '<div class="muted" style="line-height:1.8;margin-bottom:10px">' +
        "当前本机数据：文献 " + papers.length + " 篇 · 竞赛 " + contests.length + " 项 · 课题 " + projects.length +
        " 项 · 附件 " + files.length + " 个（" + IO.kb(size) + "）<br>" +
        "所有数据只存在这台设备的浏览器里。换手机、清缓存、换浏览器前，务必先导出备份。" +
        "</div>" +
        '<div class="btnrow"><button class="btn pri" id="bk-exp">导出备份（zip）</button>' +
        '<button class="btn ghost" id="bk-imp">从备份恢复</button></div>' +
        '<div class="btnrow" style="margin-top:8px"><button class="btn dg" id="bk-clear">清空本机全部数据</button></div>' +
        '<div class="tiny" style="margin-top:10px">恢复时 zip 会被完整解包：记录 + PDF / 图片附件一起还原。</div>',
      actions: [{ label: "关闭", cls: "ghost", fn: () => true }],
      mount: (card) => {
        card.querySelector("#bk-exp").addEventListener("click", () => { UI.close(); App.exportZip(); });
        card.querySelector("#bk-imp").addEventListener("click", async () => {
          const fs = await UI.pickFile(".zip", false);
          if (!fs.length) return;
          UI.close();
          UI.choose({
            title: "怎么恢复？",
            items: [
              { v: "replace", l: "覆盖恢复", sub: "清空当前数据，完全还原成备份里的样子（换机用这个）" },
              { v: "merge", l: "合并导入", sub: "保留当前数据，同 id 的覆盖，其余追加" },
            ],
            onPick: (v) => App.importZip(fs[0], v === "merge"),
          });
        });
        card.querySelector("#bk-clear").addEventListener("click", async () => {
          const ok = await UI.confirm("清空本机全部数据？文献、竞赛、课题、英语打卡和所有附件都会被删除，且无法恢复。建议先导出备份。",
            { danger: true, ok: "清空", title: "危险操作" });
          if (!ok) return;
          await DB.clearAll();
          UI.close();
          IO.toast("已清空");
          App.go("home");
        });
      },
    });
  },

  aboutDialog() {
    UI.modal({
      title: "关于",
      body: '<div class="about">' +
        '<div class="lg">研</div>' +
        '<div class="nm">' + IO.esc(SITE.appName) + "</div>" +
        '<div class="sg">' + IO.esc(SITE.signature) + "</div>" +
        '<button class="btn sm ghost" data-nick style="margin-top:10px">修改昵称</button>' +
        '<div class="muted" style="margin-top:14px;line-height:1.9">' +
        "作者：" + IO.esc(SITE.owner) + "<br>" +
        "联系：" + IO.esc(SITE.contact) + "<br>" +
        "版本：" + IO.esc(SITE.appVersion) + "<br>" +
        "本页地址：" + IO.esc(location.origin + location.pathname) +
        "</div>" +
        '<div class="tiny" style="margin-top:14px;line-height:1.8">' +
        "这是一个没有后台的本地应用：不注册、不登录、不上传。<br>" +
        "所有记录保存在本机浏览器的 IndexedDB 里，<br>换设备请用「备份与恢复」导出 zip 再导入。" +
        "</div>" +
        '<div class="tiny" style="margin-top:12px">© ' + IO.esc(SITE.since) + " " + IO.esc(SITE.owner) + "</div>" +
        "</div>",
      actions: [{ label: "知道了", cls: "pri", fn: () => true }],
      mount: (card) => {
        const nb = card.querySelector("[data-nick]");
        if (nb) nb.addEventListener("click", () => { UI.close(); App.nicknameDialog(false); });
      },
    });
  },

  // 首次进入询问昵称；也会在「关于」里复用（修改昵称）
  nicknameDialog(firstRun) {
    UI.form({
      title: firstRun ? "欢迎使用研计划" : "修改昵称",
      fields: [
        { k: "name", label: "你的昵称", ph: "如 小明 / 自己的名字" },
      ],
      note: firstRun
        ? "首次使用，给自己起个昵称吧，它会显示在首页问候语里。随时可在「关于」里修改。"
        : "它会显示在首页问候语里。",
      submit: firstRun ? "开始使用" : "保存",
      onSubmit: async (v) => {
        const n = (v.name || "").trim();
        if (!n) { IO.toast("昵称不能为空"); return false; }
        await DB.metaSet("username", n);
        IO.toast("已保存");
        App.refresh();
        return true;
      },
    });
  },

  async maybeAskNickname() {
    let un = "";
    try { un = await DB.metaGet("username", ""); } catch (e) { un = ""; }
    if (un && String(un).trim()) return;
    this.nicknameDialog(true);
  },

  // 检查更新：先比对线上版本号，已经是最新就【不刷新】（只提示一句）；
  // 只有真的有新版，才清缓存 + 重载页面。查不到版本（离线）时退回原来的强刷行为。
  async checkUpdate() {
    IO.busy(true, "检查更新…");
    let live = null;
    try { live = await liveVersion(); } catch (e) { live = null; }
    const cur = String(SITE.appVersion || "");
    if (live && cmpVer(live, cur) <= 0) {
      IO.busy(false);
      IO.toast("已是最新版本 " + cur);
      return;
    }
    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) { try { await reg.update(); } catch (e) { /* 忽略 */ } }
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (e) { /* 清不掉也照样重载，让浏览器自己取新文件 */ }
    IO.busy(false);
    IO.toast(live ? "发现新版本 " + live + "，正在更新…" : "连不上服务器，改为刷新本地缓存");
    setTimeout(() => location.reload(), 600);
  },
};

// ---------- 全局事件 ----------
document.addEventListener("click", (e) => {
  const g = e.target.closest ? e.target.closest("[data-go]") : null;
  if (g) {
    e.stopPropagation();
    const arg = g.getAttribute("data-arg");
    App.go(g.getAttribute("data-go"), arg ? { id: arg } : null);
    return;
  }
  const m = e.target.closest ? e.target.closest("#more-menu .mi") : null;
  if (m) {
    const a = m.getAttribute("data-mi");
    document.getElementById("more-menu").hidden = true;
    if (a === "stats") App.go("stats");
    else if (a === "backup") App.backupDialog();
    else if (a === "about") App.aboutDialog();
    else if (a === "update") App.checkUpdate();
  }
  // 站内 PDF 阅读：点「在线阅读」直接在本页打开，不跳系统 / 不下载
  const rf = e.target.closest ? e.target.closest("[data-readf]") : null;
  if (rf) {
    e.stopPropagation();
    const fid = rf.getAttribute("data-readf");
    // data-pid 带上了所属文献：阅读器据此把「读到第几页」回写成阅读进度
    if (fid) Papers.openPdfReader(fid, rf.getAttribute("data-pid") || "");
  }
});

document.getElementById("tb-more").addEventListener("click", (e) => {
  e.stopPropagation();
  const mm = document.getElementById("more-menu");
  mm.hidden = !mm.hidden;
});
document.addEventListener("click", () => { document.getElementById("more-menu").hidden = true; });
document.getElementById("tb-back").addEventListener("click", () => {
  // 独立页面（不在底栏里的，如「管理打卡」）返回 = 回首页；底栏页面的返回 = 退出详情页
  if (TAB_VIEWS.indexOf(App.view) < 0) App.go("home");
  else App.go(App.view, null);
});

document.querySelectorAll("#tabbar button").forEach((b) => {
  b.addEventListener("click", () => App.go(b.getAttribute("data-tab"), null));
});

// ---------- hash 路由回执 ----------
// 自己写的 hash（replaceState）不会触发 hashchange；这里只处理「hash 被外部改变」的情况
//（用户手改地址、浏览器恢复会话、部分 WebView 的返回行为）。
// 与当前视图一致就直接返回，避免出现「点返回没反应」或来回跳的死循环。
window.addEventListener("hashchange", () => {
  const t = parseHash();
  const curId = (App.arg && App.arg.id) || "";
  if (t.v === App.view && t.id === curId) return;
  App.go(t.v, t.id ? { id: t.id } : null);
});

// ---------- 启动 ----------
(function boot() {
  // 顶层 const 不会自动挂到 window，这里显式暴露，方便调试与自动化测试
  window.DB = DB; window.IO = IO; window.BIB = BIB; window.UI = UI; window.App = App;
  window.Home = Home; window.Papers = Papers; window.Contests = Contests;
  window.Projects = Projects; window.Exams = Exams; window.Stats = Stats;
  // 刷新 / 重开时按 hash 恢复：下拉刷新后停在原来那一页，而不是跳回首页
  const init = parseHash();
  // 先迁移旧格式打卡数据（kind/minutes → type/value），再渲染首页：
  // 渲染里的连续天数 / 累计全按新字段聚合，迁移晚于渲染就会闪一帧「数据归零」
  (async () => {
    try { await Home.migrateCheckins(); } catch (e) { /* 迁移失败不影响启动 */ }
    App.go(init.v, init.id ? { id: init.id } : null).then(async () => {
      window.__ready = true;
      try { await App.maybeAskNickname(); } catch (e) { /* 首启询问失败不影响启动 */ }
      // 赛程提醒：临近 24 小时的竞赛轮次，启动后弹一次（提醒过的不重复弹）
      try { await Contests.checkAlerts(); } catch (e) { /* 提醒失败不影响启动 */ }
    }).catch(() => { window.__ready = true; });
  })();
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => { /* 本地 file:// 打开时忽略 */ });
    });
  }
  // 供自动化测试与调试使用：__ready 只在首页真正渲染完成后才置 true（见上面的 then/catch）
})();
