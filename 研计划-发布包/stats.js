/* 统计：连续打卡天数、近 30 天双行热力图、四模块进度总览 */
"use strict";

const Stats = (function () {

  function lvl(min) {
    if (!min) return 0;
    if (min < 30) return 1;
    if (min < 60) return 2;
    return 3;
  }

  // 一行 = 一个打卡类型（类型可增删改，所以行数跟着类型走，不再写死文献 / 英语两行）
  // 格子深浅按当天该类型的数值算，单位取自类型定义（分钟 / 个 / 套…）写在 title 里
  function heatRow(type, map, cls) {
    const t = IO.today();
    const u = IO.esc(type.unit || "");
    // 归档 = 这场考试已考完，专属打卡不再继续，但历史记录仍然要看得见
    const tag = type.archived ? ' <span class="chip">已归档</span>' : "";
    let h = '<div class="heatrow"><div class="lb"><span>' + IO.esc(type.name) + tag + "</span>" +
      '<span style="color:var(--ink3)">近 30 天，颜色越深数值越大</span></div>' +
      '<div class="heat' + (cls ? " " + cls : "") + '">';
    for (let i = 29; i >= 0; i--) {
      const d = IO.addDays(t, -i);
      const v = map[d] || 0;
      h += '<i class="' + (v ? "l" + lvl(v) : "") + (i === 0 ? " td" : "") +
        '" title="' + d + " · " + v + u + '"></i>';
    }
    h += "</div></div>";
    return h;
  }

  async function render() {
    const [papers, contests, projects, exams, vocab, cks] = await Promise.all([
      DB.all("papers"), DB.all("contests"), DB.all("projects"),
      DB.all("exams"), DB.all("vocab"), DB.all("checkins"),
    ]);
    // 按类型分组统计：类型列表来自 meta.ckTypes，删掉的类型其历史记录不再计入。
    // allTypes 含已归档（考试考完后的专属打卡）—— 热力图和累计要保留它们的历史；
    // types 只含活跃类型 —— 连续天数和重置按钮对已归档的没有意义。
    const allTypes = await Home.ckTypes();
    const types = allTypes.filter((t) => !t.archived);
    const maps = {}, totals = {}, dset = {}, streaks = {};
    allTypes.forEach((t) => { maps[t.id] = {}; totals[t.id] = 0; dset[t.id] = new Set(); });
    cks.forEach((c) => {
      if (!maps[c.type]) return;
      const v = Number(c.value) || 0;
      maps[c.type][c.date] = (maps[c.type][c.date] || 0) + v;
      totals[c.type] += v;
      if (Home.hasValue(c)) dset[c.type].add(c.date);
    });
    for (const t of types) streaks[t.id] = await Home.streak(t.id);

    const readN = papers.filter((p) => p.status === "done" || p.status === "deep").length;
    const deepN = papers.filter((p) => p.status === "deep").length;
    const runC = contests.filter((c) => c.stage !== "done").length;
    const awards = contests.reduce((a, c) => a + ((c.awards || []).length), 0);
    const runP = projects.filter((p) => p.status === "doing");
    const avgP = runP.length ? Math.round(runP.reduce((a, p) => a + (Number(p.progress) || 0), 0) / runP.length) : 0;
    const meetN = projects.reduce((a, p) => a + ((p.meetings || []).length), 0);
    const noteN = papers.reduce((a, p) => a + ((p.notes || []).length), 0);

    let h = '<div class="stats">' + types.map((t) =>
      '<div class="stat"><b style="color:' + Home.ckColor(t) + '">' + streaks[t.id] + "</b><span>" +
      IO.esc(t.name) + "连续打卡（天）</span></div>").join("") + "</div>";

    // 重置入口：每个类型一个，弹窗里会二次确认，且只清该类型的 checkins
    h += '<div class="btnrow" style="margin-top:10px">' + types.map((t) =>
      '<button class="btn ghost sm" id="rst-' + IO.esc(t.id) + '" data-rst="' + IO.esc(t.id) + '">重置' +
      IO.esc(t.name) + "打卡</button>").join("") + "</div>" +
      '<div class="tiny" style="margin-top:6px">重置只清除打卡记录与连续天数，' +
      "文献、笔记、总结、竞赛、课题都不会被删除。</div>";

    h += '<div class="sec"><h2>打卡热力图</h2></div><div class="card">' +
      allTypes.map((t) => heatRow(t, maps[t.id], t.color === "en" ? "e" : "")).join("") +
      '<div class="tiny" style="margin-top:4px">带边框的是今天；「已归档」是考完的考试留下的备考打卡</div></div>';

    // 累计：按主指标（metrics[0]）算，单位跟着主指标走
    h += '<div class="sec"><h2>累计</h2></div><div class="stats">' +
      allTypes.map((t) => {
        const m = Home.metricsOf(t)[0];
        return '<div class="stat"><b>' + dset[t.id].size + '</b><span>' + IO.esc(t.name) + "打卡天数</span></div>" +
          '<div class="stat"><b>' + totals[t.id] + "</b><span>" + IO.esc(t.name) + "（" +
          IO.esc(m.unit || "数值") + "）</span></div>";
      }).join("") +
      '<div class="stat"><b>' + noteN + '</b><span>文献笔记（条）</span></div>' +
      "</div>";

    h += '<div class="sec"><h2>文献</h2></div><div class="card">' +
      '<div class="kv"><div class="k">总数</div><div class="v">' + papers.length + " 篇</div></div>" +
      '<div class="kv"><div class="k">已读 / 精读</div><div class="v">' + readN + " / " + deepN + " 篇</div></div>" +
      '<div class="kv"><div class="k">在读</div><div class="v">' + papers.filter((p) => p.status === "reading").length + " 篇</div></div>" +
      "</div>";

    h += '<div class="sec"><h2>竞赛</h2></div><div class="card">' +
      '<div class="kv"><div class="k">进行中</div><div class="v">' + runC + " 项</div></div>" +
      '<div class="kv"><div class="k">已结束</div><div class="v">' + contests.filter((c) => c.stage === "done").length + " 项</div></div>" +
      '<div class="kv"><div class="k">获奖</div><div class="v">' + awards + " 项</div></div>" +
      "</div>";

    h += '<div class="sec"><h2>课题 / 项目</h2></div><div class="card">' +
      '<div class="kv"><div class="k">进行中</div><div class="v">' + runP.length + " 项</div></div>" +
      '<div class="kv"><div class="k">平均进度</div><div class="v">' + avgP + "%</div></div>" +
      '<div class="kv"><div class="k">已结题</div><div class="v">' + projects.filter((p) => p.status === "done").length + " 项</div></div>" +
      '<div class="kv"><div class="k">会议记录</div><div class="v">' + meetN + " 次</div></div>" +
      "</div>";

    const examPlan = exams.filter((e) => e.state !== "done").length;
    const examDone = exams.length - examPlan;
    h += '<div class="sec"><h2>考试</h2></div><div class="card">' +
      '<div class="kv"><div class="k">备考中</div><div class="v">' + examPlan + " 个</div></div>" +
      '<div class="kv"><div class="k">已考完</div><div class="v">' + examDone + " 个</div></div>" +
      '<div class="kv"><div class="k">成绩记录</div><div class="v">' + exams.reduce((a, e) => a + ((e.scores || []).length), 0) + " 次</div></div>" +
      '<div class="kv"><div class="k">证书 / 成绩单</div><div class="v">' + exams.reduce((a, e) => a + ((e.certs || []).length), 0) + " 个</div></div>" +
      '<div class="kv"><div class="k">生词本</div><div class="v">' + vocab.length + " 词（已掌握 " + vocab.filter((v) => v.mastered).length + "）</div></div>" +
      "</div>";

    h += '<div class="tiny" style="margin-top:14px;text-align:center;line-height:1.7">' +
      "以上数据全部来自本机数据库，未上传任何服务器</div>";
    return h;
  }

  function mount() {
    const root = document.getElementById("view");
    // 类型可增删改，重置按钮按 data-rst 动态绑定，不再写死 lit / eng 两个 id
    root.querySelectorAll("[data-rst]").forEach((b) => {
      b.addEventListener("click", () => Home.resetCheckins(b.getAttribute("data-rst")));
    });
  }

  return { title: "统计", render, mount, heatRow, lvl };
})();
