/* 工具层：日期、文本、文件、zip 打包解包、Toast
 * zip 用 STORE（不压缩）模式自己写字节，避免引入第三方库 */
"use strict";

const IO = (function () {
  const p2 = (n) => String(n).padStart(2, "0");

  function ymd(d) { return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); }
  function today() { return ymd(new Date()); }
  function parse(s) { return new Date(s + "T00:00:00"); }
  const WD = ["日", "一", "二", "三", "四", "五", "六"];
  function dow(s) { return parse(s).getDay(); }
  function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
  // b - a，单位天
  function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
  function fmtMD(s) { const d = parse(s); return (d.getMonth() + 1) + "月" + d.getDate() + "日"; }
  function fmtFull(s) {
    const d = parse(s);
    return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 星期" + WD[dow(s)];
  }
  function fmtTime(ts) {
    const d = new Date(ts);
    return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + " " + p2(d.getHours()) + ":" + p2(d.getMinutes());
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function kb(n) { return n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB"; }
  function clamp(n, a, b) { n = Number(n) || 0; return Math.max(a, Math.min(b, n)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }
  function safeName(n) {
    return String(n || "file").replace(/[\\/:*?"<>|\r\n\t]/g, "_").slice(0, 90) || "file";
  }
  function nl2br(s) { return esc(s).replace(/\n/g, "<br>"); }

  function monthCells(y, m) {
    const first = new Date(y, m, 1);
    const start = new Date(y, m, 1 - first.getDay());
    const out = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      out.push(ymd(d));
    }
    return out;
  }

  async function compressImage(file, max = 1600, q = 0.82) {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(bmp, 0, 0, w, h);
      if (bmp.close) bmp.close();
      const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", q));
      return { blob, w, h, mime: "image/jpeg" };
    } catch (e) {
      return { blob: file, w: 0, h: 0, mime: file.type || "image/jpeg" };
    }
  }

  function readText(file) { return file.text(); }

  // ---- CRC32 ----
  const CRC_T = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // files: [{name, data: Uint8Array|ArrayBuffer}]
  function makeZip(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const dTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
    const dDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
    const locals = [], centrals = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
      const crc = crc32(data), size = data.length;
      const lh = new Uint8Array(30 + name.length), lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x800, true);
      lv.setUint16(8, 0, true); lv.setUint16(10, dTime, true); lv.setUint16(12, dDate, true);
      lv.setUint32(14, crc, true); lv.setUint32(18, size, true); lv.setUint32(22, size, true);
      lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
      lh.set(name, 30);
      locals.push(lh, data);
      const ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x800, true); cv.setUint16(10, 0, true);
      cv.setUint16(12, dTime, true); cv.setUint16(14, dDate, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, size, true); cv.setUint32(24, size, true);
      cv.setUint16(28, name.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      ch.set(name, 46);
      centrals.push(ch);
      offset += lh.length + size;
    }
    const centralSize = centrals.reduce((a, b) => a + b.length, 0);
    const eo = new Uint8Array(22), ev = new DataView(eo.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
    return new Blob([...locals, ...centrals, eo], { type: "application/zip" });
  }

  // -> [{name, u8}]
  async function unzip(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const dv = new DataView(buf.buffer);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("不是有效的备份压缩包");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const out = [];
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("备份包目录损坏");
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const cmtLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtra = dv.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + lNameLen + lExtra;
      const raw = buf.subarray(dataStart, dataStart + compSize);
      let u8 = raw;
      if (method === 8) {
        const ds = new DecompressionStream("deflate-raw");
        const stream = new Blob([raw]).stream().pipeThrough(ds);
        u8 = new Uint8Array(await new Response(stream).arrayBuffer());
      } else if (method !== 0) {
        throw new Error("备份包含不支持的压缩方式");
      }
      out.push({ name, u8 });
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return out;
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* 退回到 execCommand */ }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }
  function busy(on, text) {
    const el = document.getElementById("busy");
    if (on) document.getElementById("busy-text").textContent = text || "处理中";
    el.hidden = !on;
  }

  return { ymd, today, parse, addDays, diffDays, dow, fmtMD, fmtFull, fmtTime, monthCells,
           uid, kb, clamp, esc, nl2br, safeName, compressImage, readText,
           makeZip, unzip, download, copyText, toast, busy, WD };
})();
