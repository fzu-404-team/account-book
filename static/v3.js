"use strict";

/*
 * V3 原型布局的数据组件（仅 account-book-v3 副本）。
 * 依赖 app.js 中的 api、money、symbols、state、animateMoney；app.js 每次 render 后调用 window.v3Render。
 * 趋势图、热力图、环比、收入去向、Top 3 与最近记录都基于全部账目计算，不受筛选影响；汇总卡片仍跟随筛选。
 * 所有用户输入（备注、类别）只通过 textContent 渲染，不拼接 HTML。
 */
(() => {
  const SVG = "http://www.w3.org/2000/svg";
  const HEAT = ["#fbe6d6", "#f7c9a6", "#f3a46b", "#ef7d32", "#c2540f"];
  let timer;
  let requestId = 0;

  const pad = (n) => String(n).padStart(2, "0");
  const monthKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  const yuan = (cents) => `¥${money(cents)}`;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svg(tag, attrs, text) {
    const node = document.createElementNS(SVG, tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function change(current, previous) {
    return previous > 0 ? (current - previous) / previous : null;
  }

  // 环比徽标：goodWhenUp 决定上涨用“好”的颜色还是“提醒”的颜色。
  function badge(node, label, ratio, goodWhenUp) {
    if (ratio === null) {
      node.hidden = true;
      return;
    }
    const up = ratio >= 0;
    node.hidden = false;
    node.className = `v3-badge ${up === goodWhenUp ? "good" : "warn"}`;
    node.replaceChildren(
      el("span", "v3-badge-dot", up ? "↑" : "↓"),
      el("strong", "", `${up ? "+" : "−"}${Math.abs(ratio * 100).toFixed(1)}%`),
      document.createTextNode(` ${label}`),
    );
  }

  function summarize(records) {
    const months = {};
    for (const record of records) {
      const key = record.date.slice(0, 7);
      months[key] ??= { income: 0, expense: 0, days: {}, categories: {} };
      const month = months[key];
      month[record.kind] += record.amount_cents;
      if (record.kind === "expense") {
        const day = Number(record.date.slice(8, 10));
        month.days[day] = (month.days[day] || 0) + record.amount_cents;
        month.categories[record.category] = (month.categories[record.category] || 0) + record.amount_cents;
      }
    }
    return months;
  }

  function renderBadges(months, now) {
    const current = months[monthKey(now)] || { income: 0, expense: 0 };
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const previous = months[monthKey(prevDate)] || { income: 0, expense: 0 };
    badge(document.getElementById("v3-income-badge"), "本月较上月", change(current.income, previous.income), true);
    badge(document.getElementById("v3-expense-badge"), "本月较上月", change(current.expense, previous.expense), false);
    badge(document.getElementById("v3-balance-badge"), "本月结余较上月",
      change(current.income - current.expense, previous.income - previous.expense), true);
    return { current, previous, prevDate };
  }

  function renderHeat(month, now) {
    const box = document.getElementById("v3-heat");
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const offset = (new Date(now.getFullYear(), now.getMonth(), 1).getDay() + 6) % 7;
    const values = month?.days || {};
    const max = Math.max(0, ...Object.values(values));
    box.replaceChildren();
    for (let i = 0; i < offset; i += 1) box.append(el("span", "v3-cell blank"));
    for (let day = 1; day <= days; day += 1) {
      const cents = values[day] || 0;
      const cell = el("span", "v3-cell");
      if (day > now.getDate()) cell.classList.add("future");
      else if (cents > 0) cell.style.background = HEAT[Math.min(HEAT.length - 1, Math.floor((cents / max) * HEAT.length))];
      cell.style.animationDelay = `${0.3 + ((offset + day - 1) % 7) * 0.06}s`;
      cell.title = `${now.getMonth() + 1} 月 ${day} 日：${cents ? `支出 ${yuan(cents)}` : "无支出"}`;
      box.append(cell);
    }
    box.setAttribute("aria-label", `${now.getMonth() + 1} 月每日支出热力，颜色越深花得越多`);
    document.getElementById("v3-heat-caption").textContent = `${now.getMonth() + 1} 月每日支出热力`;
  }

  function renderTrend(months, now) {
    const chart = document.getElementById("v3-trend");
    const year = now.getFullYear();
    const values = Array.from({ length: 12 }, (_, i) => months[`${year}-${pad(i + 1)}`]?.expense || 0);
    const max = Math.max(...values, 1);
    const top = Math.ceil(max / 10000) * 10000 || 10000;
    const total = values.reduce((sum, value) => sum + value, 0);
    const elapsed = now.getMonth() + 1;
    chart.replaceChildren();
    const defs = svg("defs", {});
    const gradient = svg("linearGradient", { id: "v3-hot", x1: 0, y1: 0, x2: 0, y2: 1 });
    gradient.append(svg("stop", { offset: 0, "stop-color": "#ef7d32", "stop-opacity": 0.6 }),
      svg("stop", { offset: 1, "stop-color": "#ef7d32", "stop-opacity": 0.06 }));
    defs.append(gradient);
    chart.append(defs);
    [1, 0.5, 0].forEach((ratio) => {
      const y = 20 + (1 - ratio) * 180;
      chart.append(svg("line", { x1: 40, x2: 560, y1: y, y2: y, class: "v3-grid-line" }));
      chart.append(svg("text", { x: 0, y: y + 4, class: "v3-axis" }, ratio ? `${Math.round((top * ratio) / 100)}` : "0"));
    });
    values.forEach((value, i) => {
      const x = 46 + i * 43;
      const height = (value / top) * 180;
      const y = 200 - height;
      const current = i === now.getMonth();
      const bar = svg("rect", { x, y, width: 32, height: Math.max(height, value ? 2 : 0), rx: 6,
        class: current ? "v3-bar hot" : "v3-bar", style: `animation-delay:${0.3 + i * 0.05}s` });
      bar.append(svg("title", {}, `${i + 1} 月支出 ${yuan(value)}`));
      chart.append(bar);
      if (current && value) {
        chart.append(svg("rect", { x, y: y - 2, width: 32, height: 4, rx: 2, fill: "#ef7d32" }));
        const tag = svg("g", { class: "v3-bob" });
        tag.append(svg("rect", { x: x - 14, y: Math.max(y - 32, 0), width: 60, height: 22, rx: 11, fill: "#ef7d32" }),
          svg("text", { x: x + 16, y: Math.max(y - 32, 0) + 15, class: "v3-tag" }, money(value).replace(/\.\d+$/, "")));
        chart.append(tag);
      }
      chart.append(svg("text", { x: x + 16, y: 222, class: current ? "v3-month now" : "v3-month" }, `${i + 1}月`));
    });
    animateMoney(document.getElementById("v3-year-total"), total);
    document.getElementById("v3-trend-year").textContent = `${year} 年`;
    const yearBadge = document.getElementById("v3-year-badge");
    yearBadge.hidden = total === 0;
    yearBadge.className = "v3-badge neutral";
    yearBadge.textContent = `月均 ${yuan(Math.round(total / elapsed))}`;
  }

  function renderKeep(current) {
    const { income, expense } = current;
    const keep = document.getElementById("v3-keep");
    const out = document.getElementById("v3-split-out");
    const inn = document.getElementById("v3-split-in");
    const tip = document.getElementById("v3-split-tip");
    if (!income) {
      keep.textContent = "—";
      document.getElementById("v3-keep-note").textContent = expense ? "本月还没有收入记录" : "本月还没有收支记录";
      out.style.width = expense ? "100%" : "0";
      inn.style.width = "0";
      tip.hidden = !expense;
      tip.textContent = yuan(expense);
      tip.style.left = "50%";
      return;
    }
    const outRatio = Math.min(expense / income, 1);
    keep.textContent = expense > income ? "超支" : `${Math.round((1 - outRatio) * 100)}%`;
    keep.classList.toggle("over", expense > income);
    document.getElementById("v3-keep-note").textContent = expense > income
      ? `本月支出比收入多 ${yuan(expense - income)}`
      : "本月收入留下来的比例";
    out.style.width = `${outRatio * 100}%`;
    inn.style.width = `${(1 - outRatio) * 100}%`;
    tip.hidden = !expense;
    tip.textContent = yuan(expense);
    tip.style.left = `${Math.min(Math.max(outRatio * 50, 12), 88)}%`;
    document.getElementById("v3-split-out-label").textContent = `支出 ${Math.round(outRatio * 100)}%`;
    document.getElementById("v3-split-in-label").textContent = `结余 ${Math.round((1 - outRatio) * 100)}%`;
  }

  function renderReport(current, previous, now, prevDate) {
    const box = document.getElementById("v3-top3");
    const top = Object.entries(current.categories || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
    box.replaceChildren();
    if (!top.length) box.append(el("span", "v3-top3-empty", "本月暂无支出"));
    top.forEach(([name, cents]) => {
      const item = el("div", "v3-top3-item");
      item.append(el("span", "", name), el("strong", "", yuan(cents).replace(/\.00$/, "")));
      box.append(item);
    });
    const ratio = change(current.expense, previous.expense);
    document.getElementById("v3-glass-prev").textContent =
      `${prevDate.getMonth() + 1} 月报告\n支出 ${yuan(previous.expense)}`;
    document.getElementById("v3-glass-now").textContent =
      `${now.getMonth() + 1} 月报告\n支出 ${yuan(current.expense)}${ratio === null ? "" : `\n较上月 ${ratio >= 0 ? "+" : "−"}${Math.abs(ratio * 100).toFixed(0)}%`}`;
  }

  function dayLabel(dateText, now) {
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    const yesterday = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`;
    if (dateText === today) return "今天";
    if (dateText === yesterday) return "昨天";
    return `${Number(dateText.slice(5, 7))} 月 ${Number(dateText.slice(8, 10))} 日`;
  }

  function renderRecent(records, now) {
    const list = document.getElementById("v3-recent");
    list.replaceChildren();
    if (!records.length) {
      list.append(el("li", "v3-recent-empty", "还没有记录，点“记一笔”或试试一句话记账。"));
      return;
    }
    records.slice(0, 7).forEach((record, index) => {
      const item = el("li", "v3-recent-item");
      item.style.animationDelay = `${0.2 + index * 0.07}s`;
      const tile = el("span", `v3-tile ${record.kind}`, (typeof symbols !== "undefined" && symbols[record.category]) || "记");
      const text = el("div", "v3-recent-text");
      text.append(el("strong", "", record.category), el("span", "", record.note || "—"));
      const sign = record.kind === "income" ? "+" : "−";
      item.append(tile, text, el("span", "v3-recent-date", dayLabel(record.date, now)),
        el("span", `v3-recent-amount ${record.kind}`, `${sign}${yuan(record.amount_cents)}`));
      list.append(item);
    });
  }

  async function update() {
    const id = ++requestId;
    let data;
    try {
      data = await api("/api/records");
    } catch {
      return; // 主列表已有错误提示，这里不重复打扰
    }
    if (id !== requestId) return;
    const now = new Date();
    const months = summarize(data.records);
    const { current, previous, prevDate } = renderBadges(months, now);
    renderHeat(months[monthKey(now)], now);
    renderTrend(months, now);
    renderKeep(current);
    renderReport(current, previous, now, prevDate);
    renderRecent(data.records, now);
    const filtered = Object.keys(state.filters || {}).length > 0;
    document.getElementById("v3-scope").textContent = filtered ? "当前筛选" : "全部记录";
  }

  window.v3Render = () => {
    clearTimeout(timer);
    timer = setTimeout(update, 30);
  };

  document.querySelectorAll("[data-v3-action]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.v3Action === "export") {
      document.getElementById("export-csv").click();
      return;
    }
    const input = document.getElementById("quick-text");
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    input.focus({ preventScroll: true });
  }));

  // app.js 若已先完成首次渲染，这里补一次。
  if (state.data) window.v3Render();
})();
