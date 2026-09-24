/* 通用 UI 组件：弹窗、表单、确认、选择器、文件选择、复制、附件存取 */
"use strict";

const UI = (function () {
  function $(id) { return document.getElementById(id); }

  // ---------- 弹窗 ----------
  // UI.modal 是非阻塞的：调用后立刻返回，弹窗里的操作要到用户点击时才发生。
  // 所以「打开弹窗 → 紧接着刷新」必然抢跑。需要刷新的调用方请传 onClose，
  // 由弹窗真正退出（点按钮 / ✕ / 点遮罩）时统一触发一次。
  let onCloseHook = null;
  function close() {
    const m = $("modal");
    const hook = onCloseHook;
    onCloseHook = null;
    m.hidden = true;
    $("modal-card").innerHTML = "";
    if (hook) { try { hook(); } catch (e) { console.error(e); } }
  }

  function modal(o) {
    const m = $("modal"), c = $("modal-card");
    const acts = o.actions || [];
    onCloseHook = o.onClose || null;
    let h = '<div class="m-head"><b>' + IO.esc(o.title || "") + "</b>" +
      (o.noClose ? "" : '<button class="m-x" data-act="close">✕</button>') + "</div>";
    h += '<div class="m-body">' + (o.body || "") + "</div>";
    if (acts.length) {
      h += '<div class="m-foot">' + acts.map((a, i) =>
        '<button class="btn ' + (a.cls || "") + '" data-mi="' + i + '">' + IO.esc(a.label) + "</button>"
      ).join("") + "</div>";
    }
    c.innerHTML = h;
    m.hidden = false;
    c.querySelectorAll("[data-mi]").forEach((b) => {
      b.addEventListener("click", async () => {
        const a = acts[+b.getAttribute("data-mi")];
        let r;
        try { r = a.fn ? await a.fn() : undefined; }
        catch (e) { IO.toast("操作失败：" + (e && e.message ? e.message : e)); return; }
        if (r !== false) close();
      });
    });
    const x = c.querySelector('[data-act="close"]');
    if (x) x.addEventListener("click", close);
    m.onclick = (e) => { if (e.target === m && !o.noClose) close(); };
    if (o.mount) o.mount(c);
    return c;
  }

  function confirm(msg, o) {
    o = o || {};
    return new Promise((res) => {
      modal({
        title: o.title || "确认",
        body: '<div style="font-size:14px;line-height:1.7">' + IO.esc(msg) + "</div>",
        actions: [
          { label: "取消", cls: "ghost", fn: () => { res(false); } },
          { label: o.ok || "确定", cls: o.danger ? "dg" : "pri", fn: () => { res(true); } },
        ],
      });
    });
  }

  // ---------- 表单 ----------
  function fieldHTML(f) {
    const v = f.value == null ? "" : f.value;
    const ph = f.ph ? ' placeholder="' + IO.esc(f.ph) + '"' : "";
    let inner = "";
    if (f.type === "textarea") {
      inner = '<textarea data-fk="' + IO.esc(f.k) + '" rows="' + (f.rows || 3) + '"' + ph + ">" + IO.esc(v) + "</textarea>";
    } else if (f.type === "select") {
      inner = '<select data-fk="' + IO.esc(f.k) + '">' + (f.opts || []).map((op) =>
        '<option value="' + IO.esc(op.v) + '"' + (String(op.v) === String(v) ? " selected" : "") + ">" + IO.esc(op.l) + "</option>"
      ).join("") + "</select>";
    } else if (f.type === "check") {
      return '<label class="swrow" style="display:flex;align-items:center;gap:8px;padding:8px 0">' +
        '<input type="checkbox" data-fk="' + IO.esc(f.k) + '" style="width:20px;height:20px"' + (v ? " checked" : "") + ">" +
        "<span>" + IO.esc(f.label) + "</span></label>";
    } else {
      inner = '<input type="' + (f.type || "text") + '" data-fk="' + IO.esc(f.k) + '" value="' + IO.esc(v) + '"' + ph + ">";
    }
    return '<label class="fld"><span>' + IO.esc(f.label) + "</span>" + inner +
      (f.hint ? '<div class="hint">' + IO.esc(f.hint) + "</div>" : "") + "</label>";
  }

  function readForm(root, fields) {
    const out = {};
    fields.forEach((f) => {
      const el = root.querySelector('[data-fk="' + f.k + '"]');
      if (!el) return;
      if (f.type === "check") out[f.k] = !!el.checked;
      else if (f.type === "number") out[f.k] = el.value === "" ? 0 : Number(el.value);
      else out[f.k] = String(el.value || "").trim();
    });
    return out;
  }

  // fields: [{k,label,type,value,ph,hint,opts,rows}]
  function form(o) {
    const body = '<div class="form">' + o.fields.map(fieldHTML).join("") +
      (o.note ? '<div class="muted" style="margin-top:2px">' + IO.esc(o.note) + "</div>" : "") + "</div>";
    modal({
      title: o.title,
      body,
      actions: [
        { label: "取消", cls: "ghost", fn: () => true },
        {
          label: o.submit || "保存", cls: "pri", fn: async () => {
            const vals = readForm($("modal-card"), o.fields);
            const r = await o.onSubmit(vals);
            return r === false ? false : true;
          },
        },
      ],
      mount: o.mount,
    });
  }

  // 选择器：items [{v,l,sub}]
  function choose(o) {
    const body = o.items.length
      ? '<div style="margin:-4px -6px">' + o.items.map((it) =>
        '<button class="item" style="width:100%;text-align:left" data-cv="' + IO.esc(it.v) + '">' +
        '<div class="ib"><div class="t1">' + IO.esc(it.l) + "</div>" +
        (it.sub ? '<div class="t2">' + IO.esc(it.sub) + "</div>" : "") + "</div></button>"
      ).join("") + "</div>"
      : '<div class="empty">暂无可选项</div>';
    modal({
      title: o.title,
      body,
      actions: [{ label: "关闭", cls: "ghost", fn: () => true }],
      mount: (c) => {
        c.querySelectorAll("[data-cv]").forEach((b) => {
          b.addEventListener("click", () => {
            const v = b.getAttribute("data-cv");
            close();
            o.onPick && o.onPick(v);
          });
        });
      },
    });
  }

  // ---------- 文件选择 ----------
  // 移动端 Safari / Chrome 要求 input.click() 发生在用户点击的「同步调用栈」里：
  // 只要前面有一个 await（哪怕是一个立即 resolve 的 Promise），浏览器就认为这次调用
  // 不再带用户手势 —— 结果是文件选择器不弹出、不报错、完全静默（用户看到「点了没反应」）。
  // 所以这里刻意【不写成 async】，函数体内也【不能出现 await】，
  // append → .click() 必须在同一个同步 tick 内跑完。
  const PICK_CANCEL_GUARD = 1200;    // 点击后这么久内的 focus / visibilitychange 一律忽略
  const PICK_WAKE_SETTLE = 1500;     // 回到前台后再等这么久才判「取消」：
                                     // 真机上 change 事件经常比 focus / visibilitychange 晚到一拍
                                     // （用户在文件 App 里挑完文件 → 页面回前台 → 浏览器才把选中的文件交给页面），
                                     // 立刻判取消会把「选好了文件」误杀成「用户取消」。
                                     // 取 1.5s：网盘 / 大文件回传时 change 可能迟到 1s 以上，
                                     // 再长用户就该察觉了，1.5s 是「盖得住抖动又几乎无感」的平衡点。
  const PICK_HARD_TIMEOUT = 600000;  // 兜底超时 10 分钟：用户可能锁屏、切 App、再从网盘里翻找文件，
                                     // 五分钟都很容易被打满。判定「取消」主要靠回前台后那 PICK_WAKE_SETTLE，
                                     // 这里只是防止 Promise 永久悬挂的最后兜底，宁松勿紧。

  function pickFile(accept, multiple) {
    return new Promise((resolve) => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = accept || "";
      inp.multiple = !!multiple;
      // 绝不能用 display:none / hidden：iOS Safari 上不可见的 input 可能压根不弹窗。
      // 这里保留在文档流里，只用 1px + 透明 + 不吃事件的方式「看不见」。
      inp.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1";
      let settled = false;
      let timer = 0;
      let wakeTimer = 0;
      const t0 = Date.now();

      function clearWake() {
        if (wakeTimer) { clearTimeout(wakeTimer); wakeTimer = 0; }
      }
      function cleanup() {
        if (timer) { clearTimeout(timer); timer = 0; }
        clearWake();
        window.removeEventListener("focus", onWake);
        window.removeEventListener("pageshow", onWake);
        document.removeEventListener("visibilitychange", onWake);
        try { inp.remove(); } catch (e) { /* 已被移除则忽略 */ }
      }
      function finish(files) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(files || []);
      }
      // 用户取消时 change 不触发，Promise 会永久悬挂，后面整条流程全卡住 —— 必须兜底。
      // 手机上选文件会切到系统文件 App，回来时触发 focus / visibilitychange，时序很微妙，
      // 所以采用「change 事件优先 + 延迟判定 + 宽松超时兜底」：确实已经过去一会儿、页面也回到前台、
      // 但【不立刻】判取消，而是起一个 PICK_WAKE_SETTLE 的短延时，延时到了还没收到 change 才算取消。
      // （真机上 change 可能晚于 focus 到达，立刻判定会把「选好了文件」误杀成「取消」——
      //   表现跟「点了没反应」一模一样，所以这一步不能有半点抢跑。）
      function onWake() {
        if (settled) return;
        if (Date.now() - t0 < PICK_CANCEL_GUARD) return;
        // —— 无论此刻是前台还是后台，都要先把上一轮上膛的判定撤掉 ——
        // 页面【回到后台】说明用户还在文件 App 里挑，此刻绝不能判取消。
        // 若把 clearWake 放在 hidden 判断之后：用户回前台晃一下（切应用 / 下拉通知栏 / 亮屏）
        // 已经上膛，再切回文件 App 时 hidden 分支直接 return，那颗定时器会照跑并走火，
        // 把用户随后选好的文件静默丢掉 —— 症状跟「点了没反应」一模一样。
        clearWake();
        if (document.visibilityState === "hidden") return;
        // 每次 wake 都先清掉上一个待判定定时器再重新计时：
        // 否则连续多次 focus 会把最早那次的判定窗口顶到前面来，又变成抢跑。
        wakeTimer = setTimeout(() => finish([]), PICK_WAKE_SETTLE);
      }
      inp.addEventListener("change", () => {
        finish(Array.prototype.slice.call(inp.files || []));
      });
      document.body.appendChild(inp);
      // —— 从这里开始的每一步都必须是同步的，中间不能出现任何 await ——
      try {
        inp.click();
      } catch (e) {
        // 老旧 WebView 可能直接拒绝 click()，这时必须给一句看得见的反馈，绝不能静默
        finish([]);
        IO.toast("没能打开文件选择器，请再点一次");
        return;
      }
      // 已经失去用户激活：即使 click() 没抛错，浏览器多半也会拦截。提示用户再点一次。
      if (navigator.userActivation && navigator.userActivation.isActive === false) {
        IO.toast("没弹出文件选择器，请再点一次");
      }
      window.addEventListener("focus", onWake);
      // iOS Safari 的文件选择器是「应用内模态」：页面既不切后台也不触发 focus，
      // 只靠上面两个监听的话，用户在 iOS 上取消选择要硬等到超时才 resolve。
      // pageshow 在 iOS 回前台时必触发，补上它当第三个唤醒源。
      window.addEventListener("pageshow", onWake);
      document.addEventListener("visibilitychange", onWake);
      timer = setTimeout(() => finish([]), PICK_HARD_TIMEOUT);
    });
  }

  // ---------- 附件 ----------
  const attach = {
    // -> [{id,name,mime,size}]
    async add(files, onImageCompress) {
      const out = [];
      for (const f of files) {
        let blob = f, mime = f.type || "application/octet-stream", size = f.size, w = 0, h = 0;
        if (onImageCompress && /^image\//.test(mime)) {
          const r = await IO.compressImage(f);
          blob = r.blob; mime = r.mime; size = blob.size; w = r.w; h = r.h;
        }
        const id = IO.uid();
        await DB.put("files", { id, name: f.name, mime, size, w, h, blob, ts: Date.now() });
        out.push({ id, name: f.name, mime, size });
      }
      return out;
    },
    async open(id) {
      const f = await DB.get("files", id);
      if (!f) { IO.toast("附件已丢失，可能备份时未包含"); return; }
      const url = URL.createObjectURL(f.blob);
      const a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noopener"; a.download = f.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    },
    async del(id) { return DB.del("files", id); },
  };

  // ---------- 复制（全局委托，动态插入的按钮也能用） ----------
  document.addEventListener("click", (e) => {
    const b = e.target.closest ? e.target.closest("[data-copy]") : null;
    if (!b) return;
    e.stopPropagation();
    const t = b.getAttribute("data-copy") || "";
    IO.copyText(t).then((ok) => IO.toast(ok ? "已复制到剪贴板" : "复制失败，请长按文本手动复制"));
  });

  return { $, modal, close, confirm, form, choose, pickFile, attach, fieldHTML, readForm };
})();
