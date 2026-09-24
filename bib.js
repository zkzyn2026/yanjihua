/* 文献元数据：BibTeX / RIS 解析、五种引用格式生成、DOI 联网补全
 * 引用格式：GB/T 7714-2015 顺序编码制、GB/T 7714-2015 著者-出版年制、APA 7th、MLA 9th、IEEE */
"use strict";

const BIB = (function () {
  const STYLES = [
    { v: "gb", l: "GB/T 7714" },
    { v: "gbay", l: "国标·著者出版年制" },
    { v: "apa", l: "APA 7th" },
    { v: "mla", l: "MLA 9th" },
    { v: "ieee", l: "IEEE" },
  ];
  const TYPE_CODE = {
    article: "J", book: "M", conf: "C", thesis: "D", other: "",
  };
  const TYPE_LABEL = {
    article: "期刊论文", book: "专著", conf: "会议论文", thesis: "学位论文", other: "其他",
  };

  function isCJK(s) { return /[\u4e00-\u9fa5\u3400-\u4dbf]/.test(String(s || "")); }

  function splitAuthors(s) {
    // 只清首尾的分隔类标点与空白；【不能】连 "." 一起削 ——
    // 英文缩写名 "Smith, John A." 末尾那个点是名字的一部分，削了就变成 "John A"。
    const trimName = (x) => String(x)
      .replace(/^[,，、;；\s]+|[,，、;；\s]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (Array.isArray(s)) return s.map(trimName).filter(Boolean);
    s = String(s || "").trim();
    if (!s) return [];
    if (/\s+and\s+/i.test(s)) return s.split(/\s+and\s+/i).map(trimName).filter(Boolean);
    const cjk = isCJK(s);
    // 英文 "A & B" / "A, B & C"：按 & 切，逗号是 "姓, 名" 的一部分不能切
    if (s.indexOf("&") >= 0) return s.split(/\s*&\s*/).map(trimName).filter(Boolean);
    if (s.indexOf(";") >= 0) return s.split(";").map(trimName).filter(Boolean);
    if (/[，、]/.test(s)) return s.split(/[，、]/).map(trimName).filter(Boolean);
    // 中文里偶用半角逗号分隔多人（"张三, 李四"），按半角逗号切
    if (cjk && s.indexOf(",") >= 0) return s.split(",").map(trimName).filter(Boolean);
    return [trimName(s)];
  }

  function initials(g) {
    return String(g || "").split(/[\s.\-·]+/).filter(Boolean).map((x) => x[0].toUpperCase()).join(" ");
  }
  function initialsDots(g) {
    return String(g || "").split(/[\s.\-·]+/).filter(Boolean).map((x) => x[0].toUpperCase() + ".").join(" ");
  }
  function splitName(a) {
    const s = String(a || "").trim();
    const i = s.indexOf(",");
    if (i >= 0) return { fam: s.slice(0, i).trim(), giv: s.slice(i + 1).trim() };
    const parts = s.split(/\s+/);
    if (parts.length < 2) return { fam: s, giv: "" };
    return { fam: parts.pop(), giv: parts.join(" ") };
  }
  // GB/T 7714：姓全大写 + 名首字母
  function gbName(a) {
    const s = String(a || "").trim();
    if (!s) return "";
    if (isCJK(s)) return s;
    const n = splitName(s);
    return (n.fam.toUpperCase() + " " + initials(n.giv)).trim();
  }
  // APA：Smith, J. A.
  function apaName(a) {
    const s = String(a || "").trim();
    if (!s) return "";
    if (isCJK(s)) return s;
    const n = splitName(s);
    return n.giv ? n.fam + ", " + initialsDots(n.giv) : n.fam;
  }
  // MLA：Smith, John
  function mlaName(a) {
    const s = String(a || "").trim();
    if (!s) return "";
    if (isCJK(s)) return s;
    const n = splitName(s);
    return n.giv ? n.fam + ", " + n.giv : n.fam;
  }
  function mlaGiven(a) {
    const s = String(a || "").trim();
    if (!s) return "";
    if (isCJK(s)) return s;
    const n = splitName(s);
    return n.giv ? n.giv + " " + n.fam : n.fam;
  }
  // IEEE：名缩写在前、姓在后（J. A. Smith）
  function ieeeName(a) {
    const s = String(a || "").trim();
    if (!s) return "";
    if (isCJK(s)) return s;
    const n = splitName(s);
    return n.giv ? initialsDots(n.giv) + " " + n.fam : n.fam;
  }

  function authorsGB(arr) {
    if (!arr.length) return "佚名";
    const cjk = isCJK(arr[0]);
    const l = arr.slice(0, 3).map(gbName);
    if (arr.length > 3) l.push(cjk ? "等" : "et al.");
    return l.join(", ");
  }
  function authorsAPA(arr) {
    if (!arr.length) return "Anonymous";
    const n = arr.map(apaName);
    if (n.length === 1) return n[0];
    if (n.length <= 8) return n.slice(0, -1).join(", ") + ", & " + n[n.length - 1];
    return n.slice(0, 6).join(", ") + ", ... " + n[n.length - 1];
  }
  function authorsMLA(arr) {
    if (!arr.length) return "";
    if (arr.length === 1) return mlaName(arr[0]);
    if (arr.length === 2) return mlaName(arr[0]) + " and " + mlaGiven(arr[1]);
    return mlaName(arr[0]) + " et al.";
  }
  // IEEE 作者：全列用 " and " 连接最后一位，超过 6 人只留第一作者 + et al.；无作者返回空串
  function authorsIEEE(arr) {
    if (!arr.length) return "";
    const l = arr.slice(0, 6).map(ieeeName);
    if (arr.length > 6) return l[0] + " et al.";
    if (l.length === 1) return l[0];
    return l.slice(0, -1).join(", ") + " and " + l[l.length - 1];
  }

  function norm(p) {
    p = p || {};
    return {
      title: String(p.title || "未命名文献").trim(),
      authors: splitAuthors(p.authors),
      journal: String(p.journal || "").trim(),
      year: String(p.year || "").trim(),
      volume: String(p.volume || "").trim(),
      issue: String(p.issue || p.number || "").trim(),
      pages: String(p.pages || "").trim(),
      doi: String(p.doi || "").trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""),
      publisher: String(p.publisher || "").trim(),
      type: p.type || "article",
    };
  }

  function dot(t) { return /[.。!?？！]$/.test(t) ? t : t + "."; }

  function gb(p) {
    const n = norm(p);
    const code = TYPE_CODE[n.type] || "J";
    let s = authorsGB(n.authors) + ". " + n.title + "[" + code + "]";
    const j = n.journal || n.publisher;
    if (j) {
      s += ". " + j;
      if (n.year) {
        s += ", " + n.year;
        if (n.volume) s += ", " + n.volume + (n.issue ? "(" + n.issue + ")" : "");
        if (n.pages) s += ": " + n.pages;
      }
    } else if (n.year) {
      s += ". " + n.year;
    }
    s += ".";
    if (n.doi) s += " DOI:" + n.doi + ".";
    return s;
  }

  function apa(p) {
    const n = norm(p);
    let s = authorsAPA(n.authors) + " (" + (n.year || "n.d.") + "). " + dot(n.title);
    // 容器来源：专著 / 学位论文没有 journal，用 publisher 顶替，否则会丢出版社
    const src = n.journal || n.publisher;
    const tail = [];
    if (src) tail.push(src);
    if (n.volume) tail.push(n.volume + (n.issue ? "(" + n.issue + ")" : ""));
    if (n.pages) tail.push(n.pages);
    if (tail.length) s += " " + tail.join(", ");
    // 结尾句号交给 dot() 判重：标题行已补过句号，无条件再补会出现 ".."
    s = dot(s);
    if (n.doi) s += " https://doi.org/" + n.doi;
    return s;
  }

  function mla(p) {
    const n = norm(p);
    let s = authorsMLA(n.authors) + '. "' + dot(n.title).replace(/\.$/, "") + '."';
    // 容器来源：专著 / 学位论文没有 journal，用 publisher 顶替
    const src = n.journal || n.publisher;
    const tail = [];
    if (src) tail.push(src);
    if (n.volume) tail.push("vol. " + n.volume);
    if (n.issue) tail.push("no. " + n.issue);
    if (n.year) tail.push(n.year);
    if (n.pages) tail.push("pp. " + n.pages);
    // 尾段整体跟在闭合引号后面用空格隔开，不能让 "," 或 "vol." 直接贴上引号
    if (tail.length) s += " " + tail.join(", ");
    s = dot(s);
    if (n.doi) s += " doi:" + n.doi + ".";
    return s;
  }

  // GB/T 7714 著者-出版年制：年份前置是核心特征，其余复用顺序编码制的约定
  function gbay(p) {
    const n = norm(p);
    const code = TYPE_CODE[n.type] || "J";
    let s = authorsGB(n.authors) + ". ";
    if (n.year) s += n.year + ". ";
    s += n.title + "[" + code + "]";
    const j = n.journal || n.publisher;
    if (j) {
      s += ". " + j;
      if (n.volume) s += ", " + n.volume + (n.issue ? "(" + n.issue + ")" : "");
      if (n.pages) s += ": " + n.pages;
    }
    s += ".";
    if (n.doi) s += " DOI:" + n.doi + ".";
    return s;
  }

  function ieee(p) {
    const n = norm(p);
    let s = authorsIEEE(n.authors);
    s += s ? ', "' : '"';
    // 容器来源：专著 / 学位论文没有 journal，用 publisher 顶替
    const src = n.journal || n.publisher;
    const tail = [];
    if (src) tail.push(src);
    if (n.volume) tail.push("vol. " + n.volume);
    if (n.issue) tail.push("no. " + n.issue);
    // IEEE 惯例：跨页用 pp.，单页用 p.
    if (n.pages) tail.push((n.pages.indexOf("-") >= 0 ? "pp. " : "p. ") + n.pages);
    if (n.year) tail.push(n.year);
    // 句末标点收在引号内：有后段用逗号，无后段直接句号（避免引号后紧跟逗号 / 悬空句点）
    s += n.title + (tail.length ? ',"' : '."');
    if (!tail.length) {
      if (n.doi) s += " doi: " + n.doi;
      return s;
    }
    s += " " + tail.join(", ");
    s = dot(s);
    if (n.doi) s += " doi: " + n.doi + ".";
    return s;
  }

  function cite(p, style) {
    if (style === "apa") return apa(p);
    if (style === "mla") return mla(p);
    if (style === "ieee") return ieee(p);
    if (style === "gbay") return gbay(p);
    return gb(p);
  }

  // 顺序编码制的参考文献表：[1] xxx
  function refList(list, style) {
    return list.map((p, i) => "[" + (i + 1) + "] " + cite(p, style)).join("\n");
  }

  // ---- BibTeX ----
  function stripLatex(s) {
    return String(s == null ? "" : s)
      .replace(/\\&/g, "&").replace(/\\%/g, "%").replace(/\\\$/g, "$").replace(/\\_/g, "_")
      .replace(/\\[a-zA-Z]+\s*\{([^{}]*)\}/g, "$1")
      .replace(/\\['`^"~=.]\s*\{?([a-zA-Z])\}?/g, "$1")
      .replace(/[{}]/g, "")
      .replace(/\\\\/g, " ")
      .replace(/--+/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  function bibEntries(text) {
    const out = [];
    let i = 0;
    while (i < text.length) {
      const at = text.indexOf("@", i);
      if (at < 0) break;
      let j = at + 1;
      while (j < text.length && /[a-zA-Z]/.test(text[j])) j++;
      const type = text.slice(at + 1, j).toLowerCase();
      let k = j;
      while (k < text.length && /\s/.test(text[k])) k++;
      if (text[k] !== "{") { i = at + 1; continue; }
      let depth = 0, end = -1;
      for (let p2 = k; p2 < text.length; p2++) {
        const c = text[p2];
        if (c === "{") depth++;
        else if (c === "}") { depth--; if (depth === 0) { end = p2; break; } }
      }
      if (end < 0) { i = at + 1; continue; }
      let body = text.slice(k + 1, end);
      const comma = body.indexOf(",");
      if (comma >= 0) body = body.slice(comma + 1);
      out.push({ type, body });
      i = end + 1;
    }
    return out;
  }

  function bibFields(body) {
    const f = {};
    let i = 0;
    while (i < body.length) {
      while (i < body.length && /[\s,]/.test(body[i])) i++;
      let j = i;
      while (j < body.length && /[a-zA-Z0-9_\-]/.test(body[j])) j++;
      if (j === i) { i++; continue; }
      const name = body.slice(i, j).toLowerCase();
      let k = j;
      while (k < body.length && /\s/.test(body[k])) k++;
      if (body[k] !== "=") { i = j; continue; }
      k++;
      while (k < body.length && /\s/.test(body[k])) k++;
      let val = "";
      if (body[k] === "{") {
        let depth = 0, p2 = k;
        for (; p2 < body.length; p2++) {
          const c = body[p2];
          if (c === "{") depth++;
          else if (c === "}") { depth--; if (depth === 0) break; }
        }
        val = body.slice(k + 1, p2); i = p2 + 1;
      } else if (body[k] === '"') {
        let p2 = k + 1;
        while (p2 < body.length && body[p2] !== '"') { if (body[p2] === "\\") p2++; p2++; }
        val = body.slice(k + 1, p2); i = p2 + 1;
      } else {
        let p2 = k;
        while (p2 < body.length && body[p2] !== ",") p2++;
        val = body.slice(k, p2); i = p2;
      }
      if (!(name in f)) f[name] = val;
    }
    return f;
  }

  function blankPaper() {
    return {
      title: "", authors: [], journal: "", year: "", volume: "", issue: "", pages: "",
      doi: "", url: "", publisher: "", type: "article", tags: [],
      status: "todo", progress: 0, summary: "", notes: [], files: [],
    };
  }

  function bibToPaper(e) {
    const f = bibFields(e.body);
    const pick = function () {
      for (let i = 0; i < arguments.length; i++) {
        const v = f[arguments[i]];
        if (v != null && String(v).trim()) return stripLatex(v);
      }
      return "";
    };
    let type = "article";
    if (e.type === "book" || e.type === "mvbook") type = "book";
    else if (e.type === "inproceedings" || e.type === "conference" || e.type === "incollection") type = "conf";
    else if (e.type === "phdthesis" || e.type === "masterthesis") type = "thesis";
    const p = blankPaper();
    p.title = pick("title", "t1") || "(无题名)";
    p.authors = splitAuthors(stripLatex(pick("author")));
    p.journal = pick("journal", "journaltitle", "booktitle", "school", "institution");
    p.year = pick("year");
    p.volume = pick("volume");
    p.issue = pick("number", "issue");
    p.pages = pick("pages");
    p.doi = pick("doi");
    p.url = pick("url");
    p.publisher = pick("publisher", "school", "institution");
    p.type = type;
    return p;
  }

  function parseBib(text) { return bibEntries(String(text || "")).map(bibToPaper); }

  // ---- RIS ----
  const RIS_TYPE = { JOUR: "article", BOOK: "book", CONF: "conf", CPAPER: "conf", THES: "thesis", CHAP: "conf", ELEC: "other", GEN: "other" };

  function parseRis(text) {
    const lines = String(text || "").split(/\r?\n/);
    const list = [];
    let cur = null;
    for (const raw of lines) {
      const m = raw.match(/^([A-Z][A-Z0-9])\s{0,2}-\s?(.*)$/);
      if (!m) continue;
      const tag = m[1], val = m[2].trim();
      if (tag === "TY") {
        cur = { type: "article", authors: [], tags: [] };
        list.push(cur);
        const t = RIS_TYPE[val.toUpperCase()];
        if (t) cur.type = t;
        continue;
      }
      if (tag === "ER") { cur = null; continue; }
      if (!cur) continue;
      switch (tag) {
        case "AU": case "A1": case "A2": case "A3": cur.authors.push(val); break;
        case "TI": case "T1": case "ST": if (!cur.title) cur.title = val; break;
        case "JO": case "JF": case "JA": case "T2": if (!cur.journal) cur.journal = val; break;
        case "PY": case "Y1": case "DA": if (!cur.year) cur.year = (val.match(/\d{4}/) || [""])[0]; break;
        case "VL": cur.volume = val; break;
        case "IS": cur.issue = val; break;
        case "SP": cur.sp = val; break;
        case "EP": cur.ep = val; break;
        case "DO": cur.doi = val; break;
        case "UR": cur.url = val; break;
        case "PB": cur.publisher = val; break;
        case "KW": cur.tags.push(val); break;
        case "AB": case "N2": cur.summary = val; break;
        default: break;
      }
    }
    return list.map((c) => {
      const p = blankPaper();
      p.title = c.title || "(无题名)";
      p.authors = c.authors || [];
      p.journal = c.journal || "";
      p.year = c.year || "";
      p.volume = c.volume || "";
      p.issue = c.issue || "";
      p.pages = c.sp ? c.sp + (c.ep && c.ep !== c.sp ? "-" + c.ep : "") : "";
      p.doi = c.doi || "";
      p.url = c.url || "";
      p.publisher = c.publisher || "";
      p.tags = c.tags || [];
      p.summary = c.summary || "";
      p.type = c.type || "other";
      return p;
    });
  }

  // ---- DOI 联网补全（唯一会发网络请求的地方，需用户手动点） ----
  async function fetchDoi(doi) {
    const clean = String(doi || "").trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
    if (!clean) throw new Error("请先填写 DOI");
    const r = await fetch("https://api.crossref.org/works/" + encodeURIComponent(clean), {
      headers: { Accept: "application/json" },
    });
    if (!r.ok) throw new Error("DOI 查询失败（HTTP " + r.status + "）");
    const j = await r.json();
    const m = j.message || {};
    const p = blankPaper();
    p.title = (m.title && m.title[0]) || "(无题名)";
    p.authors = (m.author || []).map((a) => [a.given, a.family].filter(Boolean).join(" ").trim()).filter(Boolean);
    p.journal = (m["container-title"] && m["container-title"][0]) || "";
    const y = m.issued && m.issued["date-parts"] && m.issued["date-parts"][0];
    if (y && y[0]) p.year = String(y[0]);
    p.volume = m.volume || "";
    p.issue = m.issue || "";
    p.pages = m.page || "";
    p.doi = m.DOI || clean;
    p.publisher = m.publisher || "";
    p.url = m.URL || "";
    const t = (m.type || "").toLowerCase();
    if (t.indexOf("book") >= 0) p.type = "book";
    else if (t.indexOf("proceeding") >= 0 || t.indexOf("paper-conference") >= 0) p.type = "conf";
    else if (t.indexOf("dissertation") >= 0) p.type = "thesis";
    return p;
  }

  // 导出 BibTeX（引用中心用）
  function toBib(p) {
    const n = norm(p);
    const key = (n.authors[0] || "ref").replace(/[^A-Za-z0-9\u4e00-\u9fa5]/g, "") + (n.year || "") +
      (n.title || "").replace(/[^A-Za-z0-9\u4e00-\u9fa5]/g, "").slice(0, 8);
    const tmap = { article: "article", book: "book", conf: "inproceedings", thesis: "phdthesis", other: "misc" };
    let s = "@" + (tmap[n.type] || "misc") + "{" + (key || IO.uid()) + ",\n";
    s += "  title = {" + n.title + "},\n";
    if (n.authors.length) s += "  author = {" + n.authors.join(" and ") + "},\n";
    if (n.journal) s += "  " + (n.type === "book" ? "publisher" : (n.type === "conf" ? "booktitle" : "journal")) + " = {" + n.journal + "},\n";
    if (n.year) s += "  year = {" + n.year + "},\n";
    if (n.volume) s += "  volume = {" + n.volume + "},\n";
    if (n.issue) s += "  number = {" + n.issue + "},\n";
    if (n.pages) s += "  pages = {" + n.pages + "},\n";
    if (n.doi) s += "  doi = {" + n.doi + "},\n";
    s += "}\n";
    return s;
  }

  // ---- 纯文本参考文献解析（中文 GB/T 7714 与英文 APA/MLA/顺序编码制）----
  // 见下方 parseCitation / stripMeta 定义；导出在文件末尾统一返回。
  // 尽力而为的启发式解析：粘进来的文本格式千差万别，能抽多少抽多少；
  // 解析后会在导入预览里逐条展示，用户可取消或导入后再逐条编辑补正。
  function stripMeta(s) {
    s = String(s || "");
    const doiM = s.match(/\b(?:DOI:?\s*|doi:?\s*|https?:\/\/(dx\.)?doi\.org\/)\s*([^\s,.;)\]}]+)/i);
    if (doiM) s = s.replace(doiM[0], " ");
    const yM = s.match(/\b(19|20)\d{2}\b/);
    if (yM) s = s.replace(yM[0], " ");
    const viM = s.match(/[,，\s]\s*(\d{1,3})\s*[（(]\s*(\d{1,3})\s*[）)]/);
    if (viM) s = s.replace(viM[0], " ");
    let m;
    while ((m = s.match(/\bvol\.?\s*(\d+)/i))) s = s.replace(m[0], " ");
    while ((m = s.match(/\bno\.?\s*(\d+)/i))) s = s.replace(m[0], " ");
    const pgM = s.match(/(?:[:：]|pp?\.?\s|,|，)\s*(\d{1,4})\s*[‑–—-]\s*(\d{1,4})/);
    if (pgM) s = s.replace(pgM[0], " ");
    return s;
  }  // 去掉条目开头的编号前缀：[1] / [1). / 1. / 1) / 1、
  function stripNum(t) {
    return t
      .replace(/^\s*\[\d{1,3}\]\s*/, "")
      .replace(/^\s*\[?\d{1,3}\][\.、)]\s?/, "")
      .replace(/^\s*\d{1,3}[\.、)]\s/, "")
      .trim();
  }
  function cleanTitle(t) {
    return String(t || "")
      .replace(/^[\[\]【】（）()"'‘’“”\s.,，、:：]+/, "")
      .replace(/[\[\]【】（）()"'‘’“”\s.,，、:：]+$/, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  // 来源字段清洗：已在 stripMeta 中剔除卷期页 DOI，这里再清残留标点/重逗号/地名前缀
  function cleanSource(s) {
    s = stripMeta(s);
    s = s.replace(/[\[\]【】（）()]/g, " ")
      .replace(/^[.,，、:：\s]+/, "")
      .replace(/[.,，、:：\s]+$/, "")
      .replace(/^[一-龥]{2,6}\s*[:：]\s*/, "")
      .replace(/\s*[,，]\s*[,，]\s*/g, ", ")
      .replace(/\s+/g, " ")
      .trim();
    return s;
  }

  function parseCitation(text) {
    const raw = String(text || "").replace(/\u00a0/g, " ").replace(/[‒–—]/g, "-").trim();
    if (!raw) return [];
    const lines = raw.split(/\r?\n/);
    // 1) 拆条目：按 [n] / n. 编号优先；无编号则每行一条，上一行以句号结尾且本行像新条目时断开
    const entries = [];
    let buf = [];
    const isNumbered = (ln) =>
      /^\s*\[\d{1,3}\]\s/.test(ln) ||
      /^\s*\[?\d{1,3}\][\.、)]\s/.test(ln) ||
      /^\s*\d{1,3}[\.、)]\s/.test(ln);
    for (const ln of lines) {
      const t = ln.trim();
      if (!t) { if (buf.length) { entries.push(buf.join(" ")); buf = []; } continue; }
      if (isNumbered(t)) {
        if (buf.length) entries.push(buf.join(" "));
        buf = [stripNum(t)];
      } else if (!buf.length) {
        buf = [t];
      } else {
        const prev = buf[buf.length - 1];
        const endsTerm = /[.。)\]」"']$/.test(prev);
        const looksNew = /^[A-Z0-9一-龥(（]/.test(t) && !/^(and|et al|pp?\.?|vol\.?|no\.?|doi|https?)/i.test(t);
        if (endsTerm && looksNew) { entries.push(buf.join(" ")); buf = [t]; }
        else buf.push(t);
      }
    }
    if (buf.length) entries.push(buf.join(" "));

    const tmap = { J: "article", M: "book", C: "conf", D: "thesis", Z: "other" };
    const out = [];
    for (let e of entries) {
      e = e.trim();
      if (!e) continue;
      const p = blankPaper();
      const yearM = e.match(/\b((?:19|20)\d{2})\b/);
      if (yearM) p.year = yearM[1];
      // 文献类型标记 [J][M][C][D][Z]：定位标题边界后再移除
      const tm = e.match(/[\[【（(]([JMCZD])[\]】）)]/i);
      if (tm) p.type = tmap[(tm[1] || "J").toUpperCase()] || "article";

      let authors = "", title = "", source = "";
      if (tm) {
        const idx = e.indexOf(tm[0]);
        const pre = e.slice(0, idx);
        const post = e.slice(idx + tm[0].length);
        const segs = pre.split(/\.\s+|\s*。\s*/).map((x) => x.trim()).filter(Boolean);
        if (segs.length >= 2) { title = segs[segs.length - 1]; authors = segs.slice(0, -1).join(", "); }
        else if (segs.length === 1) { title = segs[0]; }
        source = cleanSource(post);
      } else {
        // 无标记：英文 APA / 顺序编码英文 / 部分中文——优先用 (YYYY) 或独立年份定位作者块
        const yB = e.match(/[(（]\s*(?:19|20)\d{2}\s*[)）]/) ||
          e.match(/(?:^|[,\s])\s*(?:19|20)\d{2}\s*(?:[.,)\s]|$)/);
        let left = "", rest = e;
        if (yB) {
          left = e.slice(0, yB.index).replace(/[()（）\s]+$/g, "").trim();
          rest = e.slice(yB.index + yB[0].length).replace(/^[).。\s]+/, "").trim();
        }
        const m2 = rest.match(/^(.*?)[.。]\s+(.*)$/s);
        if (m2) { title = m2[1]; rest = m2[2]; }
        else { title = rest; rest = ""; }
        authors = left;
        source = cleanSource(rest);
      }
      p.authors = splitAuthors(cleanTitle(authors));
      p.title = cleanTitle(title) || "(无题名)";
      const j = source;
      if (p.type === "book") p.publisher = j; else p.journal = j;
      // 标题/作者/来源全空（多半是页码或年份误切）的条目丢弃
      if (p.title === "(无题名)" && !p.authors.length && !j) continue;
      out.push(p);
    }
    return out;
  }

  // ============================================================
  // 从 PDF 正文里猜元数据（v1.5.0）
  // ------------------------------------------------------------
  // 大量 PDF 的 info 字典是空的（国内期刊、扫描转文本、自己导出的尤其常见），
  // 导入后就只剩文件名，引用出来是「佚名.原文[J].2026」。
  // 这里用第一页正文做启发式识别：标题 / 作者 / 年份 / 期刊 / DOI / 卷期页 / 类型。
  // 纯本地不联网；识别不出就返回空串，由调用方决定要不要覆盖已有字段。
  // ============================================================
  const META_JUNK = /^(?:abstract|摘要|keywords?|key\s*words|index\s*terms|introduction|contents?|目\s*录|图形摘要|graphical\s*abstract)$/i;
  const META_AFFIL = /(universit|college|institut|laborator|department|dept\.|school|academy|research\s*center|centre\s*for|大学|学院|研究所|实验室|学校|医院|公司|科技有限公司)/i;
  const META_JOURNAL = /(journal|transactions|proceedings|letters|review|magazine|conference|symposium|workshop|annals|nature|science|ieee|acm|elsevier|springer|arxiv|plos|biorxiv|medrxiv|学报|杂志|期刊|会议|评论|快报|通讯|进展)/i;

  function metaLines(text) {
    return String(text || "")
      .replace(/\f/g, "\n")
      .split(/\r?\n/)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter((s) => s.length >= 2);
  }

  // 页眉页脚 / 收稿信息 / 邮箱 / 网址这类行不可能是标题作者期刊
  function junkLine(s) {
    if (!s) return true;
    if (/^\d{1,4}$/.test(s)) return true;
    if (/^(www\.|https?:\/\/|doi\s*[:：]|©|copyright)/i.test(s)) return true;
    if (/@/.test(s)) return true;
    if (/^(received|accepted|published|submitted|revised|available online|all rights)/i.test(s)) return true;
    if (/^(收稿日期|修回日期|基金项目|作者简介|通讯作者|中图分类号|文献标识码|文章编号|引用格式|doi)/i.test(s)) return true;
    if (META_JUNK.test(s)) return true;
    return false;
  }

  // 期刊页眉 / 页脚那一行：带卷期页码或年份，绝不能当标题或作者
  function vipLine(s) {
    return /\b(?:vol|volume|no|number|issue|pp|pages)\.?\s*\d/i.test(s) ||
      /\b\d{1,3}\s*[（(]\s*\d{1,3}\s*[）)]/.test(s) ||
      /^\s*(?:19|20)\d{2}\s*[年/-]/.test(s);
  }

  // 一行像不像作者行：中文姓名靠分隔符 / 空格成组出现；英文靠 "J. Smith" / "Smith, John"
  // 注意别把中文标题误判成作者 —— 所以中文必须有分隔符或空格分组才认
  function authorish(s) {
    if (!s || vipLine(s)) return false;
    const cjk = (s.match(/[一-龥]{2,4}/g) || []);
    const latin = (s.match(/\b[A-Z][a-z]{1,15}\b/g) || []);
    if (/[一-龥]/.test(s)) {
      if (/[,，、;；]/.test(s) && cjk.length >= 2 && cjk.length <= 10) return true;
      const groups = s.split(/\s+/).filter((x) => /^[一-龥]{2,4}$/.test(x));
      if (groups.length >= 2 && groups.length <= 10) return true;
      return false;
    }
    // Springer / Nature 一类排版用「·」分隔作者（Walaa N. Ismail · Nariman Adel Hussein），
    // 不认这个符号整行作者会全丢
    if (latin.length >= 2 && /[,，;；·•]|\band\b|\s&\s/.test(s)) return true;
    if (/\b[A-Z]\.\s?[A-Z]?\.?\s?[A-Z][a-z]+/.test(s)) return true;
    return false;
  }

  // 一行像不像「标题式短语」：多数单词首字母大写
  // （"Multi-view Spatiotemporal Traffic Prediction Using" 通过；
  //  "change at every timestamp. Analyzing..." 这种散文句通不过）
  function titleCaseish(s) {
    const ws = String(s || "").split(/\s+/).filter((w) => w.replace(/[^A-Za-z]/g, "").length >= 2);
    if (ws.length < 2) return false;
    const up = ws.filter((w) => /^[A-Z]/.test(w.replace(/^[^A-Za-z]+/, ""))).length;
    return up / ws.length >= 0.6;
  }

  // 返回 { t: 标题, i: 所在行号 } —— 作者要从标题下一行开始找，行号必须带出来
  function guessTitle(lines) {
    const head = lines.slice(0, 14);
    let best = "", bestIdx = -1, bestScore = 0;
    for (let i = 0; i < head.length; i++) {
      const s = head[i];
      if (junkLine(s) || META_AFFIL.test(s)) continue;
      const len = s.length;
      if (len < 8 || len > 220) continue;
      let score = Math.min(len, 120) / 12;
      if (i <= 3) score += 4;
      if (/[.。]$/.test(s)) score -= 3;
      if (/[,，;；]$/.test(s)) score -= 3;                    // 句子没写完：多半是正文被断行
      if ((s.match(/[,，]/g) || []).length >= 2) score -= 2;  // 逗号多 = 散文，不是标题
      // 期刊 / 会议名那行（页眉）几乎不可能是标题，重罚
      if (META_JOURNAL.test(s)) score -= 5;
      if (vipLine(s)) score -= 4;
      if (authorish(s)) score -= 3;
      if (/^(a|an|the|on|toward|towards|deep|learning|using|基于|面向)\b/i.test(s)) score += 1;
      // 标题后面一两行之内通常就跟着作者行 —— 很强的信号（期刊页眉不会跟着作者行）
      if (authorish(head[i + 1] || "") || authorish(head[i + 2] || "")) score += 5;
      if (titleCaseish(s)) score += 2;
      if (score > bestScore) { bestScore = score; best = s; bestIdx = i; }
    }
    if (!best) return { t: "", i: -1 };
    // 标题换行续行：只有下一行确实像「接着写」才拼接，否则会把「期刊页眉 + 标题」
    // 或「标题 + 作者」粘成一条。续行除了英文小写开头，还可能是「词首大写」的短语
    // （例：Multi-view Spatiotemporal Traffic Prediction Using / Evolutionary-Optimized RNN-GCN Networks）
    const nxt = head[bestIdx + 1];
    if (nxt && best.length <= 70 && !/[.。!?？！:：]$/.test(best) &&
        !authorish(nxt) && !META_AFFIL.test(nxt) && !META_JOURNAL.test(nxt) &&
        !/^(abstract|摘要)/i.test(nxt) && nxt.length <= 120) {
      const cont = isCJK(best)
        ? /^[一-龥]/.test(nxt)
        : (/^[a-z(（]/.test(nxt) || (titleCaseish(nxt) && !/[.!?。]$/.test(nxt)));
      if (cont) best = best + (isCJK(best) ? "" : " ") + nxt;
    }
    return { t: cleanTitle(best), i: bestIdx };
  }

  function parseAuthorLine(s) {
    let t = String(s)
      .replace(/[①-⑳]/g, " ")
      .replace(/[*†‡§¶※]/g, " ")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\bet al\.?/gi, " ")
      .replace(/\d+/g, " ")                 // 上标序号：张三1, 李四2
      .replace(/\s+and\s+/gi, ",")
      .replace(/\s*&\s*/g, ",")
      .replace(/[;；、]/g, ",")
      .replace(/[·•]/g, ",")          // 「·」分隔的作者（英文期刊常见）
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[,，\s]+|[,，\s]+$/g, "");
    if (!t) return [];
    const cjk = isCJK(t);
    let parts = cjk ? t.split(/[,，]/) : t.split(",");
    parts = parts.map((x) => x.trim()).filter(Boolean);
    // 中文常见「张三1 李四2 王五3」：去掉上标数字后靠空格分组，这里再切一次
    if (cjk) {
      parts = parts.reduce((acc, x) => {
        if (/\s/.test(x)) {
          const gs = x.split(/\s+/).filter((y) => /^[一-龥]{2,4}$/.test(y));
          if (gs.length >= 2) return acc.concat(gs);
        }
        acc.push(x);
        return acc;
      }, []);
    }
    // "Smith, John A., Jones, Mary B." 这种成对出现的「姓, 名」要合并成人名，
    // 否则一个作者会被拆成两个人
    if (!cjk && parts.length >= 4 && parts.length % 2 === 0) {
      const paired = [];
      let ok = true;
      for (let i = 0; i < parts.length; i += 2) {
        const a = parts[i], b = parts[i + 1];
        if (!/^[A-Z][A-Za-z'’\-]+$/.test(a) || !/^[A-Z]/.test(b)) { ok = false; break; }
        paired.push(a + ", " + b);
      }
      if (ok) parts = paired;
    }
    return parts
      .map((x) => x.replace(/^[,，、;；\s]+|[,，、;；\s]+$/g, "").trim())
      .filter((x) => x.length >= 2 && x.length <= 40);
  }

  function guessAuthors(lines, from) {
    const start = Math.max(0, Number(from) || 0);
    const end = Math.min(lines.length, start + 6);
    for (let i = start; i < end; i++) {
      const s = lines[i];
      if (!s) continue;
      if (/^(abstract|摘要|introduction|1\.\s)/i.test(s) || junkLine(s)) break;
      if (META_AFFIL.test(s) || vipLine(s) || META_JOURNAL.test(s)) continue;
      if (s.length > 220) continue;
      if (authorish(s)) return parseAuthorLine(s);
    }
    return [];
  }

  function guessYear(lines) {
    const cur = new Date().getFullYear();
    const near = [], all = [];
    lines.slice(0, 40).forEach((s) => {
      const ms = s.match(/\b((?:19|20)\d{2})\b/g) || [];
      if (!ms.length) return;
      if (/(received|accepted|published|©|copyright|收稿|录用|网络首发)/i.test(s)) near.push.apply(near, ms);
      all.push.apply(all, ms);
    });
    const pick = (arr) => {
      const ys = arr.map(Number).filter((y) => y >= 1950 && y <= cur + 1).sort((a, b) => a - b);
      return ys.length ? String(ys[0]) : "";
    };
    return pick(near) || pick(all);
  }

  // 期刊名清洗：去掉卷期页、月份年份这些附属信息，只留刊名本身
  function cleanJournal(s) {
    return String(s || "")
      // 栏目标签常和刊名粘在一起没有空格（"RESEARCHInternational Journal of ..."），
      // 只在后面紧跟大写字母时才剥，避免误伤 "Research Policy" 这类真刊名
      .replace(/^(?:research|review|original\s*(?:article|paper)|article|letter|short\s*communication|case\s*report|technical\s*note|brief\s*communication|perspective|comment|editorial|note)(?=[A-Z])/i, "")
      .replace(/\b(?:vol|volume|no|number|issue|pp|pages)\.?\s*[\d\s,()‑-]*/ig, " ")
      .replace(/\s+\d{1,3}\s*[（(]\s*(?:19|20)\d{2}\s*[）)].*$/, "")
      .replace(/\s+\d{1,4}\s*[-–—]\s*\d{1,4}\s*$/, "")
      .replace(/[,，]\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(?:19|20)\d{2}\s*$/i, "")
      .replace(/[,，]\s*(?:19|20)\d{2}\s*年?.*$/, "")
      .replace(/\s*(?:19|20)\d{2}\s*年.*$/, "")
      .replace(/\s*第\s*\d+\s*卷.*$/, "")
      .replace(/\s*第\s*\d+\s*期.*$/, "")
      .replace(/[.,，、:：\s]+$/, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function guessJournal(lines, title, authors) {
    const end = Math.min(lines.length, 24);
    for (let i = 0; i < end; i++) {
      const s = lines[i];
      if (!s || s === title) continue;
      if (junkLine(s) || META_AFFIL.test(s)) continue;
      if (authors && authors.some((a) => a && s.indexOf(a) >= 0)) continue;
      const q = s.match(/《([^》]{2,40})》/);
      if (q) return q[1];
      const arx = s.match(/arXiv\s*:\s*([\d.]+v?\d*)/i);
      if (arx) return "arXiv:" + arx[1];
      if (META_JOURNAL.test(s) && s.length <= 90) return cleanJournal(s);
      if (/[一-龥]/.test(s) && /(学报|杂志|期刊|会议|论坛|评论|进展)$/.test(s) && s.length <= 60) return cleanJournal(s);
    }
    return "";
  }

  function guessDoi(text) {
    const m = String(text || "").match(/10\.\d{4,9}\/[^\s"'<>\\)\]】」]+/);
    return m ? m[0].replace(/[.,;:]+$/, "") : "";
  }

  function guessVIP(text) {
    const t = String(text || "").slice(0, 4000);
    const out = { volume: "", issue: "", pages: "" };
    let m = t.match(/\bVol\.?\s*(\d{1,3})\b/i);
    if (m) out.volume = m[1];
    // Springer 一类页眉：「International Journal ... (2026) 19:130」→ 卷 19。
    // 冒号后那串是文章号不是页码，不猜，免得填错。
    if (!out.volume) { m = t.match(/\((?:19|20)\d{2}\)\s*(\d{1,3})\s*:\s*\d{1,4}\b/); if (m) out.volume = m[1]; }
    m = t.match(/\b(?:No|Issue)\.?\s*(\d{1,3})\b/i);
    if (m) out.issue = m[1];
    if (!out.issue) { m = t.match(/\b\d{1,3}\((\d{1,3})\)/); if (m) out.issue = m[1]; }
    m = t.match(/\bpp?\.?\s*(\d{1,4})\s*[-–—]\s*(\d{1,4})/i);
    if (m) out.pages = m[1] + "-" + m[2];
    return out;
  }

  function guessType(text) {
    const t = String(text || "").slice(0, 3000);
    if (/(学位论文|硕士论文|博士论文|dissertation|\bthesis\b)/i.test(t)) return "thesis";
    if (/(proceedings|conference|会议论文|symposium)/i.test(t)) return "conf";
    if (/(press|出版社)/i.test(t)) return "book";
    return "article";
  }

  // text：PDF 抽取出的正文（页间用 \f 分隔，取第一页）；fileName：用来兜底标题
  function extractMeta(text, fileName) {
    const raw = String(text || "");
    const page1 = raw.split("\f")[0] || raw;
    const lines = metaLines(page1).filter((s) => !junkLine(s));
    // 摘要之后就是正文了，而正文里的长句子很容易在打分里赢过真正的标题
    // （实测 Springer 排版就出现过「标题被摘要里的一句话抢走」）。
    // 所以标题 / 作者 / 期刊只在「摘要之前」这几行里找。
    let cut = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^abstract\b/i.test(lines[i]) || /^摘\s*要/.test(lines[i]) ||
          /^a\s?b\s?s\s?t\s?r\s?a\s?c\s?t\b/i.test(lines[i])) { cut = i; break; }
    }
    const headLines = cut >= 2 ? lines.slice(0, cut) : lines.slice(0, 14);
    const g = guessTitle(headLines);
    const title = g.t;
    // 作者从标题下一行开始找：期刊页眉行里那些大写词很容易被误认成作者
    const authors = guessAuthors(headLines, g.i >= 0 ? g.i + 1 : 0);
    const year = guessYear(headLines) || guessYear(lines);
    let journal = guessJournal(headLines, title, authors);
    if (journal && title && journal === title) journal = "";
    const vip = guessVIP(page1);
    const out = {
      title: title, authors: authors, year: year, journal: journal,
      doi: guessDoi(raw), type: guessType(page1),
      volume: vip.volume, issue: vip.issue, pages: vip.pages,
    };
    if (!out.title) {
      const f = String(fileName || "").replace(/\.[A-Za-z0-9]{1,6}$/, "").replace(/[_+]/g, " ").trim();
      const seg = f.split(/\s+[-–—]\s+/);
      out.title = cleanTitle(seg.length > 1 ? seg[seg.length - 1] : f);
    }
    return out;
  }

  return {
    STYLES, TYPE_LABEL, TYPE_CODE, isCJK, splitAuthors, cite, refList,
    parseBib, parseRis, fetchDoi, toBib, blankPaper, norm, parseCitation,
    extractMeta,
  };
})();
