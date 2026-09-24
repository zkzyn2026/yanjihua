/* ============================================================
 * 研计划 —— 署名配置（改名字只改这一个文件）
 * ------------------------------------------------------------
 * 同时需要同步的两处：index.html 的 <title>/<meta author>、
 * manifest.webmanifest 的 name / short_name。
 * ============================================================ */
window.SITE = {
  appName: "研计划",
  owner: "张凯",
  signature: "研究生专属的本地计划本",
  contact: "19712573797@163.com",
  since: 2026,
  appVersion: "1.5.1",
};

/* 全局枚举：改这里的文字，四个模块跟着变 */
window.CONST = {
  paperStatus: [
    { v: "todo", l: "待读" },
    { v: "reading", l: "在读" },
    { v: "done", l: "已读" },
    { v: "deep", l: "精读" },
  ],
  paperType: [
    { v: "article", l: "期刊论文" },
    { v: "book", l: "专著" },
    { v: "conf", l: "会议论文" },
    { v: "thesis", l: "学位论文" },
    { v: "other", l: "其他" },
  ],
  contestStage: [
    { v: "prep", l: "准备中" },
    { v: "signup", l: "已报名" },
    { v: "prelim", l: "初赛" },
    { v: "semi", l: "复赛" },
    { v: "final", l: "决赛" },
    { v: "done", l: "已结束" },
  ],
  projStatus: [
    { v: "todo", l: "未开始" },
    { v: "doing", l: "进行中" },
    { v: "pause", l: "暂停" },
    { v: "done", l: "已结题" },
  ],
  projType: [
    { v: "课题", l: "课题" },
    { v: "项目", l: "项目" },
  ],
  // 考试类型：覆盖英语 / 计算机等级 / 软考 / 职业资格 / 升学。
  // 标签带「类别·」前缀，一个下拉里也能一眼找到；选 other 时用备注名补充说明。
  examType: [
    { v: "CET4", l: "英语 · 四级 CET4" },
    { v: "CET6", l: "英语 · 六级 CET6" },
    { v: "IELTS", l: "英语 · 雅思 IELTS" },
    { v: "TOEFL", l: "英语 · 托福 TOEFL" },
    { v: "GRE", l: "英语 · GRE" },
    { v: "PETS", l: "英语 · 全国英语等级 PETS" },
    { v: "BEC", l: "英语 · 商务英语 BEC" },
    { v: "CATTI", l: "英语 · 翻译资格 CATTI" },
    { v: "KYEN", l: "英语 · 考研英语" },
    { v: "CSE2", l: "计算机 · 二级" },
    { v: "CSE3", l: "计算机 · 三级" },
    { v: "CSE4", l: "计算机 · 四级" },
    { v: "RK1", l: "计算机 · 软考初级" },
    { v: "RK2", l: "计算机 · 软考中级" },
    { v: "RK3", l: "计算机 · 软考高级" },
    { v: "TEACH", l: "职业 · 教师资格证" },
    { v: "LAW", l: "职业 · 法律职业资格（法考）" },
    { v: "CPA", l: "职业 · 注册会计师 CPA" },
    { v: "ACC1", l: "职业 · 会计初级" },
    { v: "ACC2", l: "职业 · 会计中级" },
    { v: "ACC3", l: "职业 · 会计高级" },
    { v: "ECON", l: "职业 · 经济师" },
    { v: "BUILDER", l: "职业 · 建造师" },
    { v: "FIRE", l: "职业 · 注册消防工程师" },
    { v: "DOCTOR", l: "职业 · 执业医师资格" },
    { v: "PHARM", l: "职业 · 执业药师" },
    { v: "BANK", l: "职业 · 银行业从业" },
    { v: "SEC", l: "职业 · 证券从业" },
    { v: "PTH", l: "职业 · 普通话水平测试" },
    { v: "PMP", l: "职业 · PMP 项目管理" },
    { v: "CIVIL", l: "升学 · 公务员 / 事业单位" },
    { v: "KAOYAN", l: "升学 · 研究生入学考试" },
    { v: "BOSSHI", l: "升学 · 博士入学考试" },
    { v: "other", l: "其他 · 用备注名填写" },
  ],
};

function CLabel(list, v) {
  for (const it of list) if (it.v === v) return it.l;
  return v || "";
}
