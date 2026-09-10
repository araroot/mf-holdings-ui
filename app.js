const state = {
  meta: null,
  currentStock: null,
  currentHoldingsPayload: null,
  currentFundPayload: null,
  holdingsRows: [],
  holdingsSort: { key: null, dir: "asc" },
  fundRows: [],
  fundSort: { key: "net_value_cr", dir: "desc" },
};

const collator = new Intl.Collator("en-IN", { numeric: true, sensitivity: "base" });
const actionLabels = {
  new_buy: "New Buy",
  add: "Add",
  trim_sell: "Trim/Sell",
  exit: "Exit",
  hold: "Hold",
  unknown: "Unknown",
};

const els = {
  stockSearch: document.querySelector("#stockSearch"),
  suggestions: document.querySelector("#suggestions"),
  activeOnly: document.querySelector("#activeOnly"),
  stockName: document.querySelector("#stockName"),
  asOf: document.querySelector("#asOf"),
  emptyMessage: document.querySelector("#emptyMessage"),
  holdingsContent: document.querySelector("#holdingsContent"),
  summaryTable: document.querySelector("#summaryTable"),
  holdingsTable: document.querySelector("#holdingsTable"),
  fundFilter: document.querySelector("#fundFilter"),
  fundName: document.querySelector("#fundName"),
  fundAsOf: document.querySelector("#fundAsOf"),
  fundEmptyMessage: document.querySelector("#fundEmptyMessage"),
  fundContent: document.querySelector("#fundContent"),
  fundSummaryTable: document.querySelector("#fundSummaryTable"),
  fundIntro: document.querySelector("#fundIntro"),
  fundTradesTable: document.querySelector("#fundTradesTable"),
  fundTradeFilter: document.querySelector("#fundTradeFilter"),
  backToHoldings: document.querySelector("#backToHoldings"),
  sourceFiles: document.querySelector("#sourceFiles"),
};

init();

async function init() {
  state.meta = await api("/api/meta");
  renderSources();
  bindEvents();
  const first = await api("/api/search?q=");
  if (first.length) {
    await selectStock(first[0]);
  }
}

function bindEvents() {
  els.stockSearch.addEventListener("input", debounce(showSuggestions, 140));
  els.stockSearch.addEventListener("focus", showSuggestions);
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".stock-search")) {
      els.suggestions.hidden = true;
    }
  });

  els.activeOnly.addEventListener("change", async () => {
    if (state.currentStock) {
      await selectStock(state.currentStock);
    }
  });

  els.fundFilter.addEventListener("input", () => filterTable(els.holdingsTable, els.fundFilter.value));
  els.fundTradeFilter.addEventListener("input", () => filterTable(els.fundTradesTable, els.fundTradeFilter.value));
  els.backToHoldings.addEventListener("click", () => switchTab("holdings"));

  document.querySelectorAll("[data-download]").forEach((button) => {
    button.addEventListener("click", () => downloadCsv(button.dataset.download));
  });
}

async function showSuggestions() {
  const q = els.stockSearch.value.trim();
  const results = await api(`/api/search?q=${encodeURIComponent(q)}`);
  els.suggestions.innerHTML = results
    .map(
      (item) => `
        <button class="suggestion" type="button" data-symbol="${escapeAttr(item.symbol)}">
          <strong>${escapeHtml(item.instrument_name)}</strong>
          <span>${escapeHtml(item.symbol)} · ${formatNumber(item.fund_count)} funds</span>
        </button>`
    )
    .join("");
  els.suggestions.hidden = results.length === 0;
  els.suggestions.querySelectorAll(".suggestion").forEach((button, idx) => {
    button.addEventListener("click", () => selectStock(results[idx]));
  });
}

async function selectStock(stock) {
  state.currentStock = stock;
  els.stockSearch.value = stock.label || `${stock.instrument_name} (${stock.symbol})`;
  els.suggestions.hidden = true;
  els.stockName.textContent = stock.instrument_name || stock.symbol;
  els.asOf.textContent = "Loading...";

  const payload = await api(`/api/holdings?stock=${encodeURIComponent(stock.symbol)}&active=${activeFlag()}`);
  if (!payload.found) {
    els.asOf.textContent = "";
    els.holdingsContent.hidden = true;
    els.emptyMessage.hidden = false;
    state.holdingsRows = [];
    state.currentHoldingsPayload = null;
    return;
  }

  state.holdingsRows = payload.rows;
  state.currentHoldingsPayload = payload;
  els.emptyMessage.hidden = true;
  els.holdingsContent.hidden = false;
  els.stockName.textContent = `${payload.stock.name}.`;
  els.asOf.textContent = `(As on ${payload.months[0].label})`;
  renderSummary(payload);
  renderHoldings(payload);
}

function renderSummary(payload) {
  const monthHeads = payload.months.map((month) => `<th>${escapeHtml(month.label)}</th>`).join("");
  const monthCells = payload.months
    .map((month) => {
      const cell = payload.summary.months[String(month.month)] || { shares: 0, marker: "" };
      return `<td class="num">${formatNumber(cell.shares)}${marker(cell.marker)}</td>`;
    })
    .join("");
  els.summaryTable.innerHTML = `
    <thead>
      <tr>
        <th rowspan="2">Sector</th>
        <th rowspan="2">No. of Funds</th>
        <th colspan="${payload.months.length}">No. of Shares</th>
      </tr>
      <tr>${monthHeads}</tr>
    </thead>
    <tbody>
      <tr>
        <td>${escapeHtml(payload.summary.sector)}</td>
        <td class="center">${formatNumber(payload.summary.funds)}</td>
        ${monthCells}
      </tr>
    </tbody>`;
}

function renderHoldings(payload) {
  const months = payload.months;
  const topHeader = months
    .map((month, idx) => {
      if (idx === 0) {
        return `<th colspan="3">${escapeHtml(month.label)}</th>`;
      }
      return `<th>${escapeHtml(month.label)}</th>`;
    })
    .join("");
  const subHeader = months
    .map((month, idx) => {
      if (idx === 0) {
        return `
          ${sortableHeader("holdings", "aum_cr", "AUM (in ₹ cr)")}
          ${sortableHeader("holdings", "holding_pct", "% of AUM")}
          ${sortableHeader("holdings", `shares:${month.month}`, "No. of Shares")}`;
      }
      return sortableHeader("holdings", `shares:${month.month}`, "No. of Shares");
    })
    .join("");

  const rows = sortedRows(payload.rows, state.holdingsSort, holdingsSortValue);
  const body = rows
    .map((row) => {
      const monthCells = months
        .map((month, idx) => {
      const cell = row.months[String(month.month)] || { shares: null, marker: "" };
          if (idx === 0) {
            return `
              <td class="num">${row.aum_cr == null ? "-" : formatDecimal(row.aum_cr, 1)}</td>
              <td class="num">${row.holding_pct == null ? "-" : formatDecimal(row.holding_pct, 2)}</td>
              <td class="num">${formatMaybeNumber(cell.shares)}${marker(cell.marker)}</td>`;
          }
          return `<td class="num">${formatMaybeNumber(cell.shares)}${marker(cell.marker)}</td>`;
        })
        .join("");
      return `
        <tr>
          <td class="fund-name">
            <a href="#" data-fund-code="${escapeAttr(row.scheme_code)}" data-fund-name="${escapeAttr(row.fund_name)}">
              ${escapeHtml(row.fund_name)}
            </a>
          </td>
          <td class="fund-family">
            <a href="#" data-fund-code="${escapeAttr(row.scheme_code)}" data-fund-name="${escapeAttr(row.fund_name)}">
              ${escapeHtml(row.fund_family || "Unavailable")}
            </a>
          </td>
          ${monthCells}
        </tr>`;
    })
    .join("");

  els.holdingsTable.innerHTML = `
    <thead>
      <tr>
        ${sortableHeader("holdings", "fund_name", "Fund Name", 'rowspan="2"')}
        ${sortableHeader("holdings", "fund_family", "Fund Manager / Family", 'rowspan="2"')}
        ${topHeader}
      </tr>
      <tr>${subHeader}</tr>
    </thead>
    <tbody>${body}</tbody>`;
  els.holdingsTable.querySelectorAll(".sortable[data-sort]").forEach((header) => {
    header.addEventListener("click", () => sortHoldings(payload, header.dataset.sort));
  });
  els.holdingsTable.querySelectorAll("[data-fund-code]").forEach((link) => {
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      await selectFund(link.dataset.fundCode, link.dataset.fundName);
    });
  });
  filterTable(els.holdingsTable, els.fundFilter.value);
}

async function selectFund(schemeCode, fundName) {
  els.fundName.textContent = fundName || "Loading...";
  els.fundAsOf.textContent = "Loading...";
  switchTab("fund");
  const payload = await api(
    `/api/fund?scheme_code=${encodeURIComponent(schemeCode || "")}&fund_name=${encodeURIComponent(fundName || "")}&active=${activeFlag()}`
  );
  if (!payload.found) {
    els.fundAsOf.textContent = "";
    els.fundContent.hidden = true;
    els.fundEmptyMessage.hidden = false;
    state.fundRows = [];
    state.currentFundPayload = null;
    return;
  }
  state.fundRows = payload.rows;
  state.currentFundPayload = payload;
  els.fundEmptyMessage.hidden = true;
  els.fundContent.hidden = false;
  els.fundName.textContent = payload.fund.name;
  els.fundAsOf.textContent = `(As on ${payload.latest})`;
  els.fundIntro.textContent =
    `${payload.fund.name} trades compare ${payload.latest} with ${payload.previous}, with four-month share history shown at right.`;
  renderFundSummary(payload);
  renderFundTrades(payload);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderFundSummary(payload) {
  els.fundSummaryTable.innerHTML = `
    <thead>
      <tr>
        <th>Fund Family</th>
        <th>AUM (in ₹ cr)</th>
        <th>No. of Stocks</th>
        <th>Holding Value (₹ cr)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${escapeHtml(payload.fund.family || "Unavailable")}</td>
        <td class="num">${payload.fund.latest_aum_cr == null ? "-" : formatDecimal(payload.fund.latest_aum_cr, 1)}</td>
        <td class="num">${formatNumber(payload.fund.latest_holdings)}</td>
        <td class="num">${formatDecimal(payload.fund.latest_value_cr, 2)}</td>
      </tr>
    </tbody>`;
}

function renderFundTrades(payload) {
  const months = payload.months;
  const monthHeaders = months
    .map((month) => sortableHeader("fund", `shares:${month.month}`, `${month.label} Shares`))
    .join("");
  const rows = sortedRows(payload.rows, state.fundSort, fundSortValue);
  els.fundTradesTable.innerHTML = `
    <thead>
      <tr>
        ${sortableHeader("fund", "stock", "Stock Name")}
        ${sortableHeader("fund", "symbol", "Symbol")}
        ${sortableHeader("fund", "action", "Action")}
        ${sortableHeader("fund", "net_shares", "Net Shares")}
        ${sortableHeader("fund", "net_value_cr", "Approx. Trade Value (₹ cr)")}
        ${sortableHeader("fund", "corp_action_factor", "Adj.")}
        ${sortableHeader("fund", "latest_value_cr", "Holding Value (₹ cr)")}
        ${sortableHeader("fund", "latest_holding_pct", "% of AUM")}
        ${monthHeaders}
      </tr>
    </thead>
    <tbody>
      ${rows
        .map((row) => {
          const monthCells = months
            .map((month) => {
              const cell = row.months[String(month.month)] || { shares: null, marker: "" };
              return `<td class="num">${formatMaybeNumber(cell.shares)}${marker(cell.marker)}</td>`;
            })
            .join("");
          return `
            <tr>
              <td><a href="#" data-stock="${escapeAttr(row.symbol)}">${escapeHtml(row.stock)}</a></td>
              <td>${escapeHtml(row.symbol)}</td>
              <td>${actionBadge(row.action)}</td>
              <td class="num">${formatMaybeNumber(row.net_shares)}</td>
              <td class="num">${formatMaybeDecimal(row.net_value_cr, 2)}</td>
              <td class="center">${adjustmentLabel(row)}</td>
              <td class="num">${formatMaybeDecimal(row.latest_value_cr, 2)}</td>
              <td class="num">${row.latest_holding_pct == null ? "-" : formatDecimal(row.latest_holding_pct, 2)}</td>
              ${monthCells}
            </tr>`;
        })
        .join("")}
    </tbody>`;
  els.fundTradesTable.querySelectorAll(".sortable[data-sort]").forEach((header) => {
    header.addEventListener("click", () => sortFundTrades(payload, header.dataset.sort));
  });
  els.fundTradesTable.querySelectorAll("[data-stock]").forEach((link) => {
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      await selectStock({ symbol: link.dataset.stock, instrument_name: link.textContent, label: link.textContent });
      switchTab("holdings");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
  filterTable(els.fundTradesTable, els.fundTradeFilter.value);
}

function sortHoldings(payload, key) {
  state.holdingsSort = nextSort(state.holdingsSort, key);
  state.holdingsRows = sortedRows(payload.rows, state.holdingsSort, holdingsSortValue);
  renderHoldings(payload);
}

function sortFundTrades(payload, key) {
  state.fundSort = nextSort(state.fundSort, key);
  state.fundRows = sortedRows(payload.rows, state.fundSort, fundSortValue);
  renderFundTrades(payload);
}

function nextSort(current, key) {
  if (current.key === key) {
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: isTextSort(key) ? "asc" : "desc" };
}

function sortableHeader(table, key, label, attrs = "") {
  const sort = table === "fund" ? state.fundSort : state.holdingsSort;
  const arrow = sort.key === key ? (sort.dir === "asc" ? "▲" : "▼") : "";
  return `<th ${attrs} class="sortable" data-sort="${escapeAttr(key)}" aria-sort="${sortAria(sort, key)}">
    ${escapeHtml(label)} <span class="sort-indicator">${arrow}</span>
  </th>`;
}

function sortAria(sort, key) {
  if (sort.key !== key) return "none";
  return sort.dir === "asc" ? "ascending" : "descending";
}

function sortedRows(rows, sort, valueFn) {
  if (!sort.key) return rows;
  return [...rows].sort((left, right) => compareSortValues(valueFn(left, sort.key), valueFn(right, sort.key), sort.dir));
}

function compareSortValues(left, right, dir) {
  const leftMissing = left == null || left === "" || Number.isNaN(left);
  const rightMissing = right == null || right === "" || Number.isNaN(right);
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;

  const direction = dir === "asc" ? 1 : -1;
  if (typeof left === "number" && typeof right === "number") {
    return (left - right) * direction;
  }
  return collator.compare(String(left), String(right)) * direction;
}

function holdingsSortValue(row, key) {
  if (key === "fund_name") return row.fund_name;
  if (key === "fund_family") return `${row.fund_family || ""} ${row.fund_name || ""}`;
  if (key === "aum_cr") return numericValue(row.aum_cr);
  if (key === "holding_pct") return numericValue(row.holding_pct);
  if (key.startsWith("shares:")) return monthNumericValue(row, key, "shares");
  return "";
}

function fundSortValue(row, key) {
  if (key === "stock") return row.stock;
  if (key === "symbol") return row.symbol;
  if (key === "action") return actionText(row.action);
  if (key === "net_shares") return absNumericValue(row.net_shares);
  if (key === "net_value_cr") return absNumericValue(row.net_value_cr);
  if (key === "corp_action_factor") return numericValue(row.corp_action_factor);
  if (key === "latest_value_cr") return numericValue(row.latest_value_cr);
  if (key === "latest_holding_pct") return numericValue(row.latest_holding_pct);
  if (key.startsWith("shares:")) return monthNumericValue(row, key, "shares");
  return "";
}

function monthNumericValue(row, key, field) {
  const month = key.split(":")[1];
  const value = row.months?.[month]?.[field];
  return numericValue(value);
}

function numericValue(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isNaN(number) ? null : number;
}

function absNumericValue(value) {
  const number = numericValue(value);
  return number == null ? null : Math.abs(number);
}

function isTextSort(key) {
  return ["fund_name", "fund_family", "stock", "symbol", "action"].includes(key);
}

function actionText(action) {
  return actionLabels[action] || action || "";
}

function switchTab(name) {
  document.querySelectorAll(".panel").forEach((panel) => {
    const active = panel.id === name;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

function filterTable(table, query) {
  const q = query.trim().toLowerCase();
  table.querySelectorAll("tbody tr").forEach((row) => {
    row.classList.toggle("hidden-row", q && !row.textContent.toLowerCase().includes(q));
  });
}

function downloadCsv(kind) {
  let table = els.holdingsTable;
  let filename = "mf_holdings.csv";
  if (kind === "fund") {
    table = els.fundTradesTable;
    filename = "mf_fund_trades.csv";
  }
  const rows = [...table.querySelectorAll("tr")].map((tr) =>
    [...tr.children].map((cell) => `"${cell.textContent.replaceAll('"', '""').trim()}"`).join(",")
  );
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function renderSources() {
  els.sourceFiles.innerHTML = state.meta.months
    .map(
      (month) =>
        `<span class="source-pill">${escapeHtml(month.label)}${month.is_partial ? " partial" : ""} · ${escapeHtml(month.file)} · ${formatNumber(month.schemes)} schemes</span>`
    )
    .join("");
}

function activeFlag() {
  return els.activeOnly.checked ? "1" : "0";
}

async function api(path) {
  if (window.STATIC_DATA_BASE) {
    return staticApi(path);
  }
  const res = await fetch(path);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  const payload = await res.json();
  if (payload.error) {
    throw new Error(payload.error);
  }
  return payload;
}

async function staticApi(path) {
  const url = new URL(path, window.location.href);
  const dataBase = window.STATIC_DATA_BASE.replace(/\/$/, "");
  if (url.pathname === "/api/meta") {
    return fetchJson(`${dataBase}/meta.json`);
  }
  if (url.pathname === "/api/search") {
    const all = await fetchJson(`${dataBase}/search.json`);
    const q = (url.searchParams.get("q") || "").trim().toUpperCase();
    if (!q) return all.slice(0, 30);
    const terms = q.split(/\s+/);
    return all
      .filter((item) => terms.every((term) => `${item.symbol} ${item.instrument_name}`.toUpperCase().includes(term)))
      .slice(0, 30);
  }
  if (url.pathname === "/api/holdings") {
    const stock = (url.searchParams.get("stock") || "").toUpperCase().replace(/^NSE:/, "");
    return fetchJson(`${dataBase}/holdings/${encodeURIComponent(stock)}.json`);
  }
  if (url.pathname === "/api/fund") {
    const code = url.searchParams.get("scheme_code") || "";
    return fetchJson(`${dataBase}/funds/${encodeURIComponent(code)}.json`);
  }
  throw new Error(`Unknown static endpoint: ${url.pathname}`);
}

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`Static data not found: ${path}`);
  }
  return res.json();
}

function marker(value) {
  if (value === "new_entry") return '<span class="up" title="New entry" aria-label="New entry">▲</span>';
  if (value === "up") return '<span class="up">▲</span>';
  if (value === "down") return '<span class="down">▼</span>';
  return "";
}

function actionBadge(action) {
  return `<span class="badge badge-${escapeAttr(action)}">${escapeHtml(actionText(action))}</span>`;
}

function adjustmentLabel(row) {
  const factor = Number(row.corp_action_factor || 1);
  if (Math.abs(factor - 1) < 0.001) return "";
  return `${formatDecimal(factor, factor % 1 === 0 ? 0 : 2)}x`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatMaybeNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return formatNumber(value);
}

function formatDecimal(value, digits) {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value || 0));
}

function formatMaybeDecimal(value, digits) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return formatDecimal(value, digits);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function debounce(fn, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}
