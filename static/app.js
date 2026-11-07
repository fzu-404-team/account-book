"use strict";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const money = (cents) => (cents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
const monthText = (month) => {
  const [year, value] = month.split("-");
  return `${year}年${Number(value)}月`;
};
const filterForm = $("#filter-form");
const recordForm = $("#record-form");
const monthlyForm = $("#monthly-form");
const palette = ["#789363", "#bccd9b", "#d9bc8e", "#9bb9ac", "#c9977f", "#c5c69b", "#a4a7bb", "#d9dcca"];
const symbols = { "餐饮": "食", "交通": "行", "购物": "购", "居住": "居", "娱乐": "乐", "医疗": "医", "学习": "学", "工资": "薪", "奖金": "奖", "兼职": "兼", "理财": "财", "红包": "礼" };
const MONTHLY_DEFAULT_MONTHS = 6;
const MONTHLY_MAX_MONTHS = 60;
const state = { data: null, page: 1, pageSize: 8, editId: null, deleteId: null, filters: {}, requestId: 0, monthlyRequestId: 0, saving: false };
let toastTimer;
let monthlyTimer;

function notify(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 3500);
}

function setError(selector, message = "") {
  const element = $(selector);
  element.textContent = message;
  element.hidden = !message;
}

async function api(path, method = "GET", body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error("无法连接本地服务，请确认 Python 程序仍在运行。");
  }
  let data;
  try { data = await response.json(); } catch { throw new Error("服务返回异常，请刷新页面后重试。"); }
  if (!response.ok) throw new Error(data.error || "操作失败，请稍后重试。");
  return data;
}

function formFilters() {
  return Object.fromEntries([...new FormData(filterForm)].filter(([, value]) => value !== ""));
}

function fillCategories(select, kind = "", withAll = false) {
  const previous = select.value;
  select.replaceChildren();
  if (withAll) select.add(new Option("全部类别", ""));
  const categories = state.data?.categories || {};
  const names = kind ? (categories[kind] || []) : Object.values(categories).flat();
  names.forEach((name) => select.add(new Option(name, name)));
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
}

async function refresh(filters = state.filters, resetPage = false) {
  const requestId = ++state.requestId;
  const data = await api(`/api/records?${new URLSearchParams(filters)}`);
  if (requestId !== state.requestId) return;
  state.data = data;
  state.filters = { ...filters };
  if (resetPage) state.page = 1;
  $("#load-error").hidden = true;
  setError("#filter-error");
  $$(".add-record").forEach((button) => { button.disabled = false; });
  fillCategories(filterForm.elements.category, filterForm.elements.kind.value, true);
  render();
}

function render() {
  const { summary, expense_categories: categories } = state.data;
  $("#income-total").textContent = money(summary.income_cents);
  $("#expense-total").textContent = money(summary.expense_cents);
  $("#balance-total").textContent = money(summary.balance_cents);
  $("#summary-count").textContent = `${summary.count} 笔记录`;
  $("#record-count").textContent = summary.count;
  $("#scope-label").textContent = Object.keys(state.filters).length ? `当前筛选 · ${summary.count} 笔` : "全部记录";
  $("#chart-total").textContent = `¥${money(summary.expense_cents)}`;
  $("#chart-category-count").textContent = `${categories.length} 个类别`;
  $("#chart-empty").hidden = categories.length > 0;
  $("#chart-legend").replaceChildren();
  let angle = 0;
  const stops = categories.map((item, index) => {
    const percentage = item.amount_cents / summary.expense_cents * 100;
    const color = palette[index % palette.length];
    const start = angle;
    angle += percentage;
    const row = document.createElement("div");
    row.className = "legend-row";
    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.background = color;
    row.append(dot, textElement("span", "legend-name", item.category), textElement("span", "legend-value", `¥${money(item.amount_cents)}`), textElement("span", "legend-percent", `${percentage.toFixed(1)}%`));
    $("#chart-legend").append(row);
    return `${color} ${start}% ${angle}%`;
  });
  $("#donut").style.background = stops.length ? `conic-gradient(${stops.join(",")})` : "#edf1e5";
  $("#donut").setAttribute("aria-label", categories.length ? `支出构成：${categories.map((item) => `${item.category} ${money(item.amount_cents)} 元`).join("，")}` : "暂无支出数据");
  renderTable();
}

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  // 备注等用户输入仅通过 textContent 渲染，避免作为 HTML 执行。
  element.textContent = text;
  return element;
}

function actionButton(action, record) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `icon-button ${action}-action`;
  button.setAttribute("aria-label", `${action === "edit" ? "编辑" : "删除"} ${record.date} ${record.category} ${money(record.amount_cents)} 元`);
  button.title = action === "edit" ? "编辑记录" : "删除记录";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("icon");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", action === "edit" ? "#i-edit" : "#i-trash");
  svg.append(use);
  button.append(svg);
  button.addEventListener("click", () => action === "edit" ? openRecord(record) : openDelete(record));
  return button;
}

function renderTable() {
  const records = state.data.records;
  const pages = Math.max(1, Math.ceil(records.length / state.pageSize));
  state.page = Math.min(state.page, pages);
  const offset = (state.page - 1) * state.pageSize;
  const body = $("#records-body");
  body.replaceChildren();
  records.slice(offset, offset + state.pageSize).forEach((record) => {
    const row = document.createElement("tr");
    const categoryCell = document.createElement("td");
    const category = document.createElement("div");
    category.className = "category-cell";
    const categoryLabel = document.createElement("span");
    categoryLabel.append(textElement("strong", "", record.category), textElement("small", "", record.kind === "income" ? "收入" : "支出"));
    category.append(textElement("span", `category-symbol ${record.kind}`, symbols[record.category] || "记"), categoryLabel);
    categoryCell.append(category);
    const note = document.createElement("td");
    const noteText = textElement("div", "record-note", record.note || "—");
    noteText.title = record.note;
    note.append(noteText);
    const actions = document.createElement("td");
    const actionGroup = document.createElement("div");
    actionGroup.className = "row-actions";
    actionGroup.append(actionButton("edit", record), actionButton("delete", record));
    actions.append(actionGroup);
    row.append(categoryCell, note, textElement("td", "record-date", record.date.replaceAll("-", "/")), textElement("td", `record-amount ${record.kind}`, `${record.kind === "income" ? "+" : "−"}${money(record.amount_cents)}`), actions);
    body.append(row);
  });
  const empty = records.length === 0;
  const initial = state.data.total_count === 0;
  $("#empty-state").hidden = !empty;
  $("#empty-title").textContent = initial ? "从第一笔开始，让生活有数" : "没有找到符合条件的记录";
  $("#empty-description").textContent = initial ? "一顿午餐、一杯咖啡，或一份收入，都值得记下来。" : "试试调整日期、类别或金额，或者重置筛选。";
  $("#empty-add").hidden = !initial;
  $("#page-info").textContent = empty ? "共 0 笔记录" : `第 ${offset + 1}–${Math.min(offset + state.pageSize, records.length)} 笔，共 ${records.length} 笔`;
  $("#page-number").textContent = `${state.page} / ${pages}`;
  $("#previous-page").disabled = state.page <= 1;
  $("#next-page").disabled = state.page >= pages;
}

function recentMonthRange(count) {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  const start = new Date(end.getFullYear(), end.getMonth() - (count - 1), 1);
  return [monthKey(start), monthKey(end)];
}

function monthSpan(start, end) {
  const [startYear, startMonth] = start.split("-").map(Number);
  const [endYear, endMonth] = end.split("-").map(Number);
  return (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
}

function monthSequence(start, end) {
  const [startYear, startMonth] = start.split("-").map(Number);
  const [endYear, endMonth] = end.split("-").map(Number);
  const months = [];
  let year = startYear;
  let month = startMonth;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

function monthlyRange() {
  return { start: monthlyForm.elements.start.value, end: monthlyForm.elements.end.value };
}

function monthlyRangeError({ start, end }) {
  if (!start || !end) return "请选择开始月份和结束月份";
  if (start > end) return "开始月份不能晚于结束月份";
  if (monthSpan(start, end) > MONTHLY_MAX_MONTHS) return `最多查看 ${MONTHLY_MAX_MONTHS} 个月，请缩小范围`;
  return "";
}

function setMonthlyView(view) {
  $("#monthly-loading").hidden = view !== "loading";
  $("#monthly-error").hidden = view !== "error";
  $("#monthly-chart-area").hidden = view !== "chart";
  $("#monthly-empty").hidden = view !== "empty";
  $("#monthly-content").setAttribute("aria-busy", view === "loading" ? "true" : "false");
}

function showMonthlyError(message, retryable) {
  $("#monthly-error-text").textContent = message;
  $("#monthly-retry").hidden = !retryable;
  setMonthlyView("error");
}

async function loadMonthly({ announceValidation = true } = {}) {
  const range = monthlyRange();
  const rangeError = monthlyRangeError(range);
  if (rangeError) {
    if (announceValidation) showMonthlyError(rangeError, false);
    return;
  }
  const requestId = ++state.monthlyRequestId;
  setMonthlyView("loading");
  try {
    const data = await api(`/api/statistics/monthly?${new URLSearchParams(range)}`);
    if (requestId !== state.monthlyRequestId) return;
    renderMonthly(data, range);
  } catch (error) {
    if (requestId !== state.monthlyRequestId) return;
    showMonthlyError(`月度统计加载失败：${error.message}`, true);
  }
}

function normalizeMonthly(data, range) {
  if (!data || !Array.isArray(data.months)) throw new Error("月度统计数据格式不正确，请刷新后重试。");
  const safeCents = (value) => Number.isInteger(value) && value >= 0 ? value : 0;
  const rows = new Map();
  data.months.forEach((item) => {
    if (item && typeof item.month === "string") {
      rows.set(item.month, { income_cents: safeCents(item.income_cents), expense_cents: safeCents(item.expense_cents) });
    }
  });
  return monthSequence(range.start, range.end).map((month) => {
    const row = rows.get(month) || { income_cents: 0, expense_cents: 0 };
    return { month, income_cents: row.income_cents, expense_cents: row.expense_cents, balance_cents: row.income_cents - row.expense_cents };
  });
}

function monthlyNiceMax(values) {
  const max = Math.max(100, ...values);
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const factor of [1, 2, 5, 10]) {
    const candidate = factor * magnitude;
    if (candidate >= max) return candidate;
  }
  return max;
}

function axisMoney(cents) {
  const yuan = cents / 100;
  if (yuan >= 1e8) return `¥${(yuan / 1e8).toFixed(1).replace(/\.0$/, "")}亿`;
  if (yuan >= 1e6) return `¥${(yuan / 1e4).toFixed(1).replace(/\.0$/, "")}万`;
  return `¥${yuan.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

function renderMonthly(data, range) {
  let months;
  try {
    months = normalizeMonthly(data, range);
  } catch (error) {
    showMonthlyError(error.message, true);
    return;
  }
  const rangeNote = `${monthText(range.start)} 至 ${monthText(range.end)} · 共 ${months.length} 个月`;
  $("#monthly-range-note").textContent = rangeNote;
  if (months.every((item) => item.income_cents === 0 && item.expense_cents === 0)) {
    $("#monthly-empty-text").textContent = `所选范围（${monthText(range.start)}至${monthText(range.end)}）还没有收支记录，换一个范围或先记一笔。`;
    setMonthlyView("empty");
    return;
  }
  renderMonthlyChart(months);
  renderMonthlyTable(months);
  setMonthlyView("chart");
  updateMonthlyScrollHint();
}

function updateMonthlyScrollHint() {
  const scroll = $("#monthly-chart").parentElement;
  $("#monthly-scroll-hint").hidden = scroll.scrollWidth <= scroll.clientWidth + 1;
}

function renderMonthlyChart(months) {
  const chart = $("#monthly-chart");
  const max = monthlyNiceMax(months.flatMap((item) => [item.income_cents, item.expense_cents]));
  const ticks = [1, .75, .5, .25, 0].map((ratio) => Math.round(max * ratio));
  chart.replaceChildren();
  chart.style.setProperty("--monthly-count", months.length);
  chart.setAttribute("aria-label", `月度收支对比图：${monthText(months[0].month)} 至 ${monthText(months[months.length - 1].month)}，共 ${months.length} 个月；收入为绿色实心柱，支出为橙色斜纹柱，每月金额见下方明细表。`);

  const axis = document.createElement("div");
  axis.className = "monthly-axis";
  axis.setAttribute("aria-hidden", "true");
  ticks.forEach((tick) => axis.append(textElement("span", "", axisMoney(tick))));

  const plot = document.createElement("div");
  plot.className = "monthly-plot";
  plot.setAttribute("aria-hidden", "true");
  const groups = document.createElement("div");
  groups.className = "monthly-groups";
  months.forEach((item, index) => {
    const group = document.createElement("div");
    group.className = "monthly-group";
    const bars = document.createElement("div");
    bars.className = "monthly-bars";
    [["income", item.income_cents], ["expense", item.expense_cents]].forEach(([kind, value]) => {
      const bar = document.createElement("span");
      bar.className = `monthly-bar ${kind}`;
      bar.style.height = `${value / max * 100}%`;
      bar.title = `${monthText(item.month)} ${kind === "income" ? "收入" : "支出"} ¥${money(value)}`;
      bars.append(bar);
    });
    const previousYear = index === 0 ? "" : months[index - 1].month.slice(0, 4);
    const year = item.month.slice(0, 4);
    const label = document.createElement("span");
    label.className = "monthly-label";
    label.append(textElement("span", "monthly-label-year", year === previousYear ? "" : year), textElement("span", "monthly-label-month", `${Number(item.month.slice(5))}月`));
    group.append(bars, label);
    groups.append(group);
  });
  plot.append(groups);
  chart.append(axis, plot);
}

function renderMonthlyTable(months) {
  const body = $("#monthly-table-body");
  body.replaceChildren();
  const totals = { income_cents: 0, expense_cents: 0, balance_cents: 0 };
  months.forEach((item) => {
    const row = document.createElement("tr");
    const monthCell = document.createElement("th");
    monthCell.setAttribute("scope", "row");
    monthCell.append(document.createTextNode(monthText(item.month)));
    if (item.income_cents === 0 && item.expense_cents === 0) monthCell.append(textElement("span", "monthly-no-record", "无记录"));
    row.append(
      monthCell,
      textElement("td", "numeric", money(item.income_cents)),
      textElement("td", "numeric", money(item.expense_cents)),
      textElement("td", `numeric${item.balance_cents < 0 ? " negative" : ""}`, money(item.balance_cents)),
    );
    body.append(row);
    totals.income_cents += item.income_cents;
    totals.expense_cents += item.expense_cents;
    totals.balance_cents += item.balance_cents;
  });
  $("#monthly-total-income").textContent = money(totals.income_cents);
  $("#monthly-total-expense").textContent = money(totals.expense_cents);
  $("#monthly-total-balance").textContent = money(totals.balance_cents);
}

function setKind(kind) {
  recordForm.elements.kind.value = kind;
  $$("[data-kind]").forEach((button) => {
    const selected = button.dataset.kind === kind;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", selected);
  });
  fillCategories(recordForm.elements.category, kind);
}

function openRecord(record = null) {
  if (!state.data) return;
  recordForm.reset();
  state.editId = record?.id || null;
  setError("#record-error");
  $("#record-dialog-title").textContent = record ? "编辑记录" : "记一笔";
  setKind(record?.kind || "expense");
  recordForm.elements.date.value = record?.date || localDate();
  if (record) {
    recordForm.elements.amount.value = (record.amount_cents / 100).toFixed(2);
    recordForm.elements.category.value = record.category;
    recordForm.elements.note.value = record.note;
  }
  $("#record-dialog").showModal();
  recordForm.elements.amount.focus();
}

function openDelete(record) {
  state.deleteId = record.id;
  $("#delete-description").textContent = `${record.date} · ${record.category} · ${record.kind === "income" ? "收入" : "支出"} ¥${money(record.amount_cents)}${record.note ? ` · ${record.note}` : ""}`;
  setError("#delete-error");
  $("#delete-dialog").showModal();
}

function showLoadError(error) {
  $("#load-error span").textContent = error.message;
  $("#load-error").hidden = false;
  if (!state.data) {
    $("#empty-title").textContent = "暂时无法读取账本";
    $("#empty-description").textContent = "请检查本地服务是否启动，然后点击上方重试。";
  }
}

async function submitFilters() {
  try { await refresh(formFilters(), true); }
  catch (error) { setError("#filter-error", error.message); }
}

$("#today-label").textContent = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
$$(".add-record").forEach((button) => button.addEventListener("click", () => openRecord()));
$$(".close-dialog").forEach((button) => button.addEventListener("click", () => { if (!state.saving) button.closest("dialog").close(); }));
$$("dialog").forEach((dialog) => dialog.addEventListener("cancel", (event) => { if (state.saving) event.preventDefault(); }));
$$("[data-kind]").forEach((button) => button.addEventListener("click", () => setKind(button.dataset.kind)));
$("#help-button").addEventListener("click", () => $("#help-dialog").showModal());
$("#previous-page").addEventListener("click", () => { state.page--; renderTable(); });
$("#next-page").addEventListener("click", () => { state.page++; renderTable(); });
$("#refresh-button").addEventListener("click", () => { refresh().catch(showLoadError); loadMonthly(); });
$("#retry-button").addEventListener("click", () => { refresh().catch(showLoadError); loadMonthly(); });
filterForm.addEventListener("submit", (event) => { event.preventDefault(); submitFilters(); });
filterForm.elements.kind.addEventListener("change", () => { filterForm.elements.category.value = ""; fillCategories(filterForm.elements.category, filterForm.elements.kind.value, true); });
for (const name of ["start", "end"]) filterForm.elements[name].addEventListener("change", () => $$("[data-period]").forEach((button) => { button.classList.remove("selected"); button.setAttribute("aria-pressed", "false"); }));

$("#reset-filters").addEventListener("click", () => {
  filterForm.reset();
  fillCategories(filterForm.elements.category, "", true);
  $$("[data-period]").forEach((button) => { const selected = button.dataset.period === "all"; button.classList.toggle("selected", selected); button.setAttribute("aria-pressed", selected); });
  submitFilters();
});

$$("[data-period]").forEach((button) => button.addEventListener("click", () => {
  const now = new Date();
  let start = "";
  if (button.dataset.period === "month") start = localDate(new Date(now.getFullYear(), now.getMonth(), 1));
  if (button.dataset.period === "week") {
    const monday = new Date(now);
    monday.setDate(now.getDate() - (now.getDay() + 6) % 7);
    start = localDate(monday);
  }
  filterForm.elements.start.value = start;
  filterForm.elements.end.value = start ? localDate(now) : "";
  $$("[data-period]").forEach((item) => { const selected = item === button; item.classList.toggle("selected", selected); item.setAttribute("aria-pressed", selected); });
  if (filterForm.reportValidity()) submitFilters();
}));

recordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.saving) return;
  state.saving = true;
  const button = $("#save-record");
  button.disabled = true;
  button.textContent = "保存中…";
  setError("#record-error");
  try {
    const editing = Boolean(state.editId);
    await api(editing ? `/api/records/${state.editId}` : "/api/records", editing ? "PUT" : "POST", Object.fromEntries(new FormData(recordForm)));
    $("#record-dialog").close();
    loadMonthly();
    try {
      await refresh(state.filters, true);
      notify(editing ? "记录已更新" : Object.keys(state.filters).length ? "记录已保存，列表仍按当前条件筛选" : "已记下这一笔");
    } catch (error) { showLoadError(error); notify("记录已保存，但列表刷新失败，请重试刷新"); }
  } catch (error) { setError("#record-error", error.message); }
  finally { state.saving = false; button.disabled = false; button.textContent = "保存记录"; }
});

$("#confirm-delete").addEventListener("click", async () => {
  if (state.saving) return;
  state.saving = true;
  $("#confirm-delete").disabled = true;
  setError("#delete-error");
  try {
    await api(`/api/records/${state.deleteId}`, "DELETE");
    $("#delete-dialog").close();
    loadMonthly();
    try { await refresh(); notify("记录已删除"); }
    catch (error) { showLoadError(error); notify("记录已删除，但列表刷新失败，请重试刷新"); }
  } catch (error) { setError("#delete-error", error.message); }
  finally { state.saving = false; $("#confirm-delete").disabled = false; }
});

$$(".nav-link").forEach((link) => link.addEventListener("click", () => { $$(".nav-link").forEach((item) => item.classList.toggle("active", item === link)); }));

const [initialMonthlyStart, initialMonthlyEnd] = recentMonthRange(MONTHLY_DEFAULT_MONTHS);
monthlyForm.elements.start.value = initialMonthlyStart;
monthlyForm.elements.end.value = initialMonthlyEnd;
monthlyForm.addEventListener("submit", (event) => { event.preventDefault(); clearTimeout(monthlyTimer); loadMonthly(); });
for (const name of ["start", "end"]) {
  monthlyForm.elements[name].addEventListener("change", () => {
    clearTimeout(monthlyTimer);
    monthlyTimer = setTimeout(() => loadMonthly({ announceValidation: false }), 250);
  });
}
$("#monthly-retry").addEventListener("click", () => loadMonthly());
window.addEventListener("resize", updateMonthlyScrollHint);

refresh().catch(showLoadError);
loadMonthly();
