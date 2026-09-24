/* 数据层：IndexedDB 封装
 * 设计要点：附件二进制单独放 files 表，业务记录只存文件 id，
 * 这样列表页 getAll 不会把几十兆的 PDF 拉进内存。
 * 全部数据只存在本机浏览器里，没有任何网络请求。 */
"use strict";

const DB = (function () {
  const NAME = "yanjihua-db";
  // v1: papers / checkins / contests / projects / exams / vocab / files / meta
  // v2: + ft（文献全文索引，{id: paperId, text, pages, ts}）
  const VER = 2;
  const STORES = ["papers", "checkins", "contests", "projects", "exams", "vocab", "files", "meta", "ft"];
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const rq = indexedDB.open(NAME, VER);
      rq.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("papers")) db.createObjectStore("papers", { keyPath: "id" });
        if (!db.objectStoreNames.contains("checkins")) {
          const s = db.createObjectStore("checkins", { keyPath: "id" });
          s.createIndex("date", "date", { unique: false });
        }
        if (!db.objectStoreNames.contains("contests")) db.createObjectStore("contests", { keyPath: "id" });
        if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
        if (!db.objectStoreNames.contains("exams")) db.createObjectStore("exams", { keyPath: "id" });
        if (!db.objectStoreNames.contains("vocab")) {
          const s = db.createObjectStore("vocab", { keyPath: "id" });
          s.createIndex("word", "word", { unique: false });
        }
        if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "id" });
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "k" });
        // v2 新增：全文索引。大块文本单独一张表，列表页 getAll("papers") 不会把它拉进内存。
        // 升级只做「缺哪个建哪个」，绝不删/重建已有 store，老用户数据必须原样保留。
        if (!db.objectStoreNames.contains("ft")) db.createObjectStore("ft", { keyPath: "id" });
      };
      rq.onsuccess = (e) => { _db = e.target.result; res(_db); };
      rq.onerror = (e) => rej(e.target.error);
    });
  }

  function wrap(req) {
    return new Promise((res, rej) => {
      req.onsuccess = (e) => res(e.target.result);
      req.onerror = (e) => rej(e.target.error);
    });
  }

  // 事务级等待：必须同时监听 abort，否则事务被中止时 Promise 会永久挂起
  function wrapTx(tx) {
    return new Promise((res, rej) => {
      tx.oncomplete = () => res(true);
      tx.onabort = () => rej(tx.error || new Error("数据库事务被中止（可能是存储空间不足或数据无法序列化）"));
      tx.onerror = () => rej(tx.error || new Error("数据库事务出错"));
    });
  }

  function store(name, mode) {
    return open().then((db) => db.transaction(name, mode).objectStore(name));
  }

  const api = {
    stores: STORES,
    open,
    all: (s) => store(s, "readonly").then((st) => wrap(st.getAll())),
    get: (s, id) => store(s, "readonly").then((st) => wrap(st.get(id))),
    put: (s, v) => store(s, "readwrite").then((st) => wrap(st.put(v))),
    del: (s, id) => store(s, "readwrite").then((st) => wrap(st.delete(id))),

    // 游标逐条扫描：fn(rec) 返回 false 即提前终止。
    // 全文检索靠它做到「命中 50 条就停」，不用把整张 ft 表读进内存。
    each: async (s, fn) => {
      const db = await open();
      return new Promise((res, rej) => {
        const rq = db.transaction(s, "readonly").objectStore(s).openCursor();
        rq.onsuccess = (e) => {
          const cur = e.target.result;
          if (!cur) { res(true); return; }
          let go = true;
          try { go = fn(cur.value) !== false; } catch (err) { rej(err); return; }
          if (go) cur.continue(); else res(false);
        };
        rq.onerror = (e) => rej(e.target.error);
      });
    },

    bulkPut: async (s, arr) => {
      const db = await open();
      const tx = db.transaction(s, "readwrite");
      arr.forEach((v) => tx.objectStore(s).put(v));
      return wrapTx(tx);
    },

    // 一次性清空全部业务数据（保留 meta 里的设置？不，备份恢复时一起清）
    clearAll: async () => {
      const db = await open();
      const names = STORES.filter((n) => db.objectStoreNames.contains(n));
      const tx = db.transaction(names, "readwrite");
      names.forEach((n) => tx.objectStore(n).clear());
      return wrapTx(tx);
    },

    // 备份恢复：merge=true 时按 id 覆盖写，不清库
    // 返回 { filesRestored, filesMissing }：zip 里缺二进制的附件只能跳过，
    // 但必须把数量报出去，否则 papers.files 留着引用、files 表里没有记录 -> 死链接（点「打开」才发现）
    replaceAll: async (data, fileMap, merge) => {
      const db = await open();
      const names = STORES.filter((n) => db.objectStoreNames.contains(n));
      const tx = db.transaction(names, "readwrite");
      const S_ = names.reduce((o, n) => (o[n] = tx.objectStore(n), o), {});
      if (!merge) names.forEach((n) => S_[n].clear());
      let filesRestored = 0, filesMissing = 0;
      names.forEach((n) => {
        const list = data[n];
        if (!Array.isArray(list)) return;
        list.forEach((v) => {
          if (n === "files") {
            const u8 = fileMap && fileMap[v.id];
            if (!u8) { filesMissing++; return; }
            // 字段要与 ui.js attach.add 写入的形状对齐：w / h / ts 不能丢，
            // 非图片附件本身存的就是 0（见 io.js:61），缺值时同样按 0 / 当前时间兜底
            S_.files.put({
              id: v.id, name: v.name, mime: v.mime, size: v.size,
              w: Number(v.w) || 0, h: Number(v.h) || 0,
              ts: Number(v.ts) || Date.now(),
              blob: new Blob([u8], { type: v.mime || "" }),
            });
            filesRestored++;
          } else {
            S_[n].put(v);
          }
        });
      });
      await wrapTx(tx);
      return { filesRestored, filesMissing };
    },

    // 删除一条记录并连带删掉它引用的附件
    delWithFiles: async (storeName, id, fileIds) => {
      const db = await open();
      const tx = db.transaction([storeName, "files"], "readwrite");
      tx.objectStore(storeName).delete(id);
      (fileIds || []).forEach((fid) => tx.objectStore("files").delete(fid));
      return wrapTx(tx);
    },

    metaGet: async (k, dflt) => {
      const m = await api.get("meta", k);
      return m ? m.v : dflt;
    },
    metaSet: async (k, v) => api.put("meta", { k, v }),
  };

  return api;
})();
