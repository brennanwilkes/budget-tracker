const LS = {
  entryDate: "budget.ui.entryDate.v1",
  pendingTx: "budget.pending.transactions.v1",
  pendingWedding: "budget.pending.wedding.v1",
};

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});


function todayIsoLocal() {
  const n = new Date();
  const y = n.getFullYear();
  const m = String(n.getMonth() + 1).padStart(2, "0");
  const d = String(n.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dateFromIso(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function isoFromDateUTC(dt) {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysBetweenInclusive(aUTC, bUTC) {
  const ms = bUTC.getTime() - aUTC.getTime();
  const days = Math.floor(ms / 86400000);
  return days + 1;
}

function maxDate(aUTC, bUTC) {
  return aUTC.getTime() >= bUTC.getTime() ? aUTC : bUTC;
}
function minDate(aUTC, bUTC) {
  return aUTC.getTime() <= bUTC.getTime() ? aUTC : bUTC;
}

function monthBoundsUTC(asOfUTC) {
  const y = asOfUTC.getUTCFullYear();
  const m = asOfUTC.getUTCMonth();
  return {
    start: new Date(Date.UTC(y, m, 1)),
    end: new Date(Date.UTC(y, m + 1, 0)),
  };
}

function quarterBoundsUTC(asOfUTC) {
  const y = asOfUTC.getUTCFullYear();
  const qm = Math.floor(asOfUTC.getUTCMonth() / 3) * 3;
  return {
    start: new Date(Date.UTC(y, qm, 1)),
    end: new Date(Date.UTC(y, qm + 3, 0)),
  };
}

function yearBoundsUTC(asOfUTC) {
  const y = asOfUTC.getUTCFullYear();
  return {
    start: new Date(Date.UTC(y, 0, 1)),
    end: new Date(Date.UTC(y, 12, 0)),
  };
}

function loadLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function saveLS(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sumBy(arr, fn) {
  let s = 0;
  for (const x of arr) s += fn(x);
  return s;
}

function sortByDateThenId(a, b) {
  if (a.date < b.date) return -1;
  if (a.date > b.date) return 1;
  return String(a.id || "").localeCompare(String(b.id || ""));
}

function addYearsUTC(dateUTC, years) {
  return new Date(Date.UTC(dateUTC.getUTCFullYear() + years, dateUTC.getUTCMonth(), dateUTC.getUTCDate()));
}

function computePayIntervalDays(anchorDates) {
  if (!Array.isArray(anchorDates) || anchorDates.length < 2) return 14;
  const a = dateFromIso(anchorDates[0]);
  const b = dateFromIso(anchorDates[1]);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function generatePaydaysUTC(startUTC, endUTC, anchorIso, intervalDays) {
  const anchor = dateFromIso(anchorIso);
  const stepMs = intervalDays * 86400000;

  let d = new Date(anchor.getTime());
  while (d.getTime() > startUTC.getTime()) d = new Date(d.getTime() - stepMs);
  while (d.getTime() < startUTC.getTime()) d = new Date(d.getTime() + stepMs);

  const out = [];
  while (d.getTime() <= endUTC.getTime()) {
    out.push(new Date(d.getTime()));
    d = new Date(d.getTime() + stepMs);
  }
  return out;
}

function buildBonusDates(paydaysUTC, rule) {
  if (rule !== "last_december_payday") return new Set();
  const byYear = new Map();
  for (const dUTC of paydaysUTC) {
    if (dUTC.getUTCMonth() !== 11) continue; // Dec
    const y = dUTC.getUTCFullYear();
    const iso = isoFromDateUTC(dUTC);
    const cur = byYear.get(y);
    if (!cur || iso > cur) byYear.set(y, iso);
  }
  return new Set([...byYear.values()]);
}

function getPayAmountForDate(config, iso, bonusDates) {
  const p = config?.paycheque || {};
  const overrides = p.overrides || {};
  if (Object.prototype.hasOwnProperty.call(overrides, iso)) return safeNum(overrides[iso]);

  const bonusAmount = safeNum(p?.bonus?.amount ?? 0);
  if (bonusAmount > 0 && bonusDates?.has(iso)) return bonusAmount;

  return safeNum(p.defaultAmount ?? 0);
}

function sumSpentInRange(tx, startUTC, endUTC) {
  let s = 0;
  for (const t of tx) {
    if (!t?.date) continue;
    const d = dateFromIso(t.date);
    if (d.getTime() >= startUTC.getTime() && d.getTime() <= endUTC.getTime()) {
      s += safeNum(t.amount);
    }
  }
  return s;
}

function plannedSpendingBetweenUTC(monthlyTotal, startUTC, endUTC) {
  if (endUTC.getTime() < startUTC.getTime()) return 0;

  // count whole months intersecting [start, end], no daily proration
  const start = new Date(Date.UTC(startUTC.getUTCFullYear(), startUTC.getUTCMonth(), 1));
  const end = new Date(Date.UTC(endUTC.getUTCFullYear(), endUTC.getUTCMonth(), 1));

  let months = 0;
  let cur = new Date(start.getTime());
  while (cur.getTime() < end.getTime()) {
    months += 1;
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }
  return monthlyTotal * months;
}

// Remaining budgets never prorate; only colors do pace checks.
function computeRemainingAndClass(budgetFull, periodStartUTC, periodEndUTC, asOfUTC, spentToDate) {
  if (asOfUTC.getTime() < periodStartUTC.getTime()) {
    return { remaining: budgetFull, cls: "" };
  }

  const remaining = budgetFull - spentToDate;

  let cls = "";
  if (remaining < -0.005) cls = "cell-over";
  else {
    const endForElapsed = minDate(asOfUTC, periodEndUTC);
    const elapsedDays = daysBetweenInclusive(periodStartUTC, endForElapsed);
    const totalDays = daysBetweenInclusive(periodStartUTC, periodEndUTC);
    const elapsedFrac = totalDays > 0 ? (elapsedDays / totalDays) : 0;

    if (elapsedDays >= 14) {
      const paceBudget = budgetFull * elapsedFrac;
      if (spentToDate > paceBudget + 0.005) cls = "cell-warn";
    }
  }

  return { remaining, cls };
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function categoryYearlyBudget(cat) {
  // If yearlyOverride is present, use it; otherwise derive from monthly
  const y = safeNum(cat.yearlyOverride);
  if (y > 0) return y;
  return safeNum(cat.monthly) * 12;
}

function categoryMonthlyBudget(cat, yearOnlySet) {
  const k = norm(cat.key);
  const n = norm(cat.name);
  if (yearOnlySet.has(k) || yearOnlySet.has(n)) return 0;
  return safeNum(cat.monthly);
}

async function main() {
  const [config, budget, txCommitted, weddingCommitted] = await Promise.all([
    fetch("./data/config.json").then(r => r.json()),
    fetch("./data/budget.json").then(r => r.json()),
    fetch("./data/transactions.json").then(r => r.json()),
    fetch("./data/wedding.json").then(r => r.json()),
  ]);

  const realTodayIso = todayIsoLocal();
  const globalStartUTC = dateFromIso(config.startDate);
  const targetYears = safeNum(config.targetYears || 2);
  const targetEndUTC = addYearsUTC(globalStartUTC, targetYears);
  const targetEndIso = isoFromDateUTC(targetEndUTC);

  // Entry date = UI as-of date
  const storedEntry = localStorage.getItem(LS.entryDate);
  $("entryDate").value = realTodayIso;

  function getAsOfUTC() {
    const iso = $("entryDate").value || realTodayIso;
    return dateFromIso(iso);
  }

  $("entryDate").addEventListener("change", () => {
    localStorage.setItem(LS.entryDate, $("entryDate").value);
    renderAll();
  });

  // Pending
  let pendingTx = loadLS(LS.pendingTx, []);
  let pendingWedding = loadLS(LS.pendingWedding, { bankBalanceUpdates: [], weddingExpenses: [] });

  const committedTxIds = new Set((txCommitted || []).map(t => t.id));
  pendingTx = (pendingTx || []).filter(t => t?.id && !committedTxIds.has(t.id));

  const committedWBIds = new Set((weddingCommitted?.bankBalanceUpdates || []).map(x => x.id));
  const committedWEIds = new Set((weddingCommitted?.weddingExpenses || []).map(x => x.id));
  pendingWedding.bankBalanceUpdates = (pendingWedding.bankBalanceUpdates || []).filter(x => x?.id && !committedWBIds.has(x.id));
  pendingWedding.weddingExpenses = (pendingWedding.weddingExpenses || []).filter(x => x?.id && !committedWEIds.has(x.id));

  saveLS(LS.pendingTx, pendingTx);
  saveLS(LS.pendingWedding, pendingWedding);

  const categories = budget.categories || [];
  const shownRaw = categories.filter(c => c.showInUI);

  // Yearly-only: Travel + Gift + Emergency
  const yearOnly = new Set(["travel", "gift", "emergency"]);

  // Order: Groceries, Lunch+Delivery, Dinner, Liquor, rest monthly, yearly-only
  const primaryOrder = new Map([
    ["groceries", 0],
    ["lunchdelivery", 1],
    ["dinner", 2],
    ["liquor", 3],
  ]);
  const yearlyOrder = new Map([
    ["travel", 0],
    ["gift", 1],
    ["emergency", 2],
  ]);

  const shown = shownRaw
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const ak = norm(a.c.key);
      const an = norm(a.c.name);
      const bk = norm(b.c.key);
      const bn = norm(b.c.name);

      const aYear = yearOnly.has(ak) || yearOnly.has(an);
      const bYear = yearOnly.has(bk) || yearOnly.has(bn);

      const aPrim = primaryOrder.has(ak) ? primaryOrder.get(ak) : (primaryOrder.has(an) ? primaryOrder.get(an) : null);
      const bPrim = primaryOrder.has(bk) ? primaryOrder.get(bk) : (primaryOrder.has(bn) ? primaryOrder.get(bn) : null);

      const aGroup = aYear ? 2 : (aPrim !== null ? 0 : 1);
      const bGroup = bYear ? 2 : (bPrim !== null ? 0 : 1);
      if (aGroup !== bGroup) return aGroup - bGroup;

      if (aGroup === 0) return aPrim - bPrim;
      if (aGroup === 2) {
        const ao = yearlyOrder.has(ak) ? yearlyOrder.get(ak) : (yearlyOrder.has(an) ? yearlyOrder.get(an) : 99);
        const bo = yearlyOrder.has(bk) ? yearlyOrder.get(bk) : (yearlyOrder.has(bn) ? yearlyOrder.get(bn) : 99);
        return ao - bo;
      }
      return a.i - b.i;
    })
    .map(x => x.c);

  // Planned spend per month for wedding math:
  // include monthly budgets for all categories, and distribute yearlyOverride across months.
  const monthlyTotalSpendPlan =
    sumBy(categories, c => safeNum(c.monthly)) +
    sumBy(categories, c => {
      const y = safeNum(c.yearlyOverride);
      return y > 0 ? (y / 12) : 0;
    });

  // Pay model (no stored paycheques)
  const intervalDays = computePayIntervalDays(config.paycheque.anchorDates);
  const anchorIso = config.paycheque.anchorDates[0];

  const allPaydaysWindow = generatePaydaysUTC(globalStartUTC, targetEndUTC, anchorIso, intervalDays);
  const bonusRule = config?.paycheque?.bonus?.rule || "last_december_payday";
  const bonusDates = buildBonusDates(allPaydaysWindow, bonusRule);

  function sumPayBetween(startUTC, endUTC) {
    const days = generatePaydaysUTC(startUTC, endUTC, anchorIso, intervalDays);
    return sumBy(days, dUTC => getPayAmountForDate(config, isoFromDateUTC(dUTC), bonusDates));
  }

  // Target computed from pay schedule + planned spending
  const targetPay = sumPayBetween(globalStartUTC, targetEndUTC);
  const targetPlannedSpend = plannedSpendingBetweenUTC(monthlyTotalSpendPlan, globalStartUTC, targetEndUTC);
  const weddingTarget = targetPay - targetPlannedSpend;

  $("subLine").textContent = `Target ${targetEndIso} • ${fmt.format(weddingTarget)}`;

  function updatePendingUI() {
    const tx = loadLS(LS.pendingTx, []);
    const wed = loadLS(LS.pendingWedding, { bankBalanceUpdates: [], weddingExpenses: [] });

    const count =
      (tx?.length || 0) +
      (wed?.bankBalanceUpdates?.length || 0) +
      (wed?.weddingExpenses?.length || 0);

    $("pendingCount").textContent = String(count);
    $("commitBtn").disabled = count === 0;
  }

  function renderTable(asOfUTC) {
    const m = monthBoundsUTC(asOfUTC);
    const q = quarterBoundsUTC(asOfUTC);
    const y = yearBoundsUTC(asOfUTC);

    const allTx = [...(txCommitted || []), ...(loadLS(LS.pendingTx, []) || [])].sort(sortByDateThenId);

    const tbody = $("budgetBody");
    tbody.innerHTML = "";

    let totals = { mRem: 0, qRem: 0, yRem: 0, mHas: false, qHas: false };

    for (const c of shown) {
      const k = norm(c.key);
      const isYearOnly = yearOnly.has(k) || yearOnly.has(norm(c.name));

      const monthly = categoryMonthlyBudget(c, yearOnly);
      const quarterly = monthly * 3;
      const yearly = categoryYearlyBudget(c);

      const catTx = allTx.filter(t => t.category === c.key);

      const mSpent = sumSpentInRange(catTx, maxDate(m.start, globalStartUTC), minDate(asOfUTC, m.end));
      const qSpent = sumSpentInRange(catTx, maxDate(q.start, globalStartUTC), minDate(asOfUTC, q.end));
      const ySpent = sumSpentInRange(catTx, maxDate(y.start, globalStartUTC), minDate(asOfUTC, y.end));

      const beforeStart = asOfUTC.getTime() < globalStartUTC.getTime();

      const mp = beforeStart ? { remaining: monthly, cls: "" } : computeRemainingAndClass(monthly, m.start, m.end, asOfUTC, mSpent);
      const qp = beforeStart ? { remaining: quarterly, cls: "" } : computeRemainingAndClass(quarterly, q.start, q.end, asOfUTC, qSpent);
      const yp = beforeStart ? { remaining: yearly, cls: "" } : computeRemainingAndClass(yearly, y.start, y.end, asOfUTC, ySpent);

      if (!isYearOnly) {
        totals.mRem += mp.remaining;
        totals.qRem += qp.remaining;
        totals.mHas = true;
        totals.qHas = true;
      }
      totals.yRem += yp.remaining;

      const row = document.createElement("tr");
      row.innerHTML = `
        <td data-label="Category">${c.name}</td>
        <td data-label="Remaining (Month)" class="num ${!isYearOnly ? mp.cls : ""}">${!isYearOnly ? fmt.format(mp.remaining) : "—"}</td>
        <td data-label="Remaining (Quarter)" class="num ${!isYearOnly ? qp.cls : ""}">${!isYearOnly ? fmt.format(qp.remaining) : "—"}</td>
        <td data-label="Remaining (Year)" class="num ${yp.cls}">${fmt.format(yp.remaining)}</td>
        <td data-label="Add spend" class="num">
          <div class="addCell">
            <input data-cat="${c.key}" class="amtInput" type="number" step="0.01" inputmode="decimal" placeholder="0.00" />
            <button class="mini saveBtn" data-cat="${c.key}">Save</button>
          </div>
        </td>
      `;
      tbody.appendChild(row);
    }

    const foot = $("budgetFoot");
    foot.innerHTML = `
      <tr>
        <td data-label="Category"><b>Totals</b></td>
        <td data-label="Remaining (Month)" class="num"><b>${totals.mHas ? fmt.format(totals.mRem) : "—"}</b></td>
        <td data-label="Remaining (Quarter)" class="num"><b>${totals.qHas ? fmt.format(totals.qRem) : "—"}</b></td>
        <td data-label="Remaining (Year)" class="num"><b>${fmt.format(totals.yRem)}</b></td>
        <td data-label="Add spend"></td>
      </tr>
    `;

    for (const btn of document.querySelectorAll(".saveBtn")) {
      btn.addEventListener("click", () => {
        const cat = btn.getAttribute("data-cat");
        const inp = btn.closest(".addCell")?.querySelector(".amtInput");
        if (!inp) return;

        const amt = safeNum(inp.value);
        if (amt <= 0) return;

        const d = $("entryDate").value || realTodayIso;
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

        const txPending = loadLS(LS.pendingTx, []);
        txPending.push({ id, date: d, category: cat, amount: amt });
        saveLS(LS.pendingTx, txPending);

        inp.value = "";
        updatePendingUI();
        renderAll();
      });
    }
  }

  function renderWedding(asOfUTC) {
    const pending = loadLS(LS.pendingWedding, { bankBalanceUpdates: [], weddingExpenses: [] });
    const allWedding = {
      bankBalanceUpdates: [...(weddingCommitted.bankBalanceUpdates || []), ...(pending.bankBalanceUpdates || [])].sort(sortByDateThenId),
      weddingExpenses: [...(weddingCommitted.weddingExpenses || []), ...(pending.weddingExpenses || [])].sort(sortByDateThenId),
    };

    const weddingSpent = sumBy(allWedding.weddingExpenses, e => safeNum(e.amount));

    const payToDate = sumPayBetween(globalStartUTC, asOfUTC);
    const plannedToDate = plannedSpendingBetweenUTC(monthlyTotalSpendPlan, globalStartUTC, asOfUTC);

    // "Should be" can go slightly negative in the first days before first pay.
    // For ASSUMED mode (no bank balance entered yet), clamp it to 0 so day-1 looks clean.
    const expectedFundToDateRaw = payToDate - plannedToDate;
    const expectedFundToDateAssumed = Math.max(0, expectedFundToDateRaw);

    let bankBalance = 0;
    let isAssumed = false;

    const bb = allWedding.bankBalanceUpdates
      .filter(x => x?.date && dateFromIso(x.date).getTime() <= asOfUTC.getTime())
      .sort(sortByDateThenId);

    if (bb.length) {
      bankBalance = safeNum(bb[bb.length - 1].balance);
    } else {
      bankBalance = expectedFundToDateAssumed - weddingSpent;
      isAssumed = true;
    }

    const fundNow = bankBalance + weddingSpent;

    const tomorrowUTC = new Date(asOfUTC.getTime() + 86400000);
    const futurePay = sumPayBetween(maxDate(tomorrowUTC, globalStartUTC), targetEndUTC);
    const plannedFuture = plannedSpendingBetweenUTC(monthlyTotalSpendPlan, maxDate(tomorrowUTC, globalStartUTC), targetEndUTC);

    const projectedFinal = fundNow + futurePay - plannedFuture;

    const box = $("weddingBox");
    box.classList.remove("cell-good", "cell-warn", "cell-over");

    let label = "On track";
    if (projectedFinal >= weddingTarget) box.classList.add("cell-good");
    else if (projectedFinal >= weddingTarget * 0.90) { box.classList.add("cell-warn"); label = "Tight"; }
    else { box.classList.add("cell-over"); label = "Behind"; }

    $("weddingTitle").textContent = `Projected • ${label}`;
    $("weddingBig").textContent = fmt.format(projectedFinal);

    const delta = projectedFinal - weddingTarget;
    const deltaStr = `${delta >= 0 ? "+" : "-"}${fmt.format(Math.abs(delta))}`;

    $("weddingDetails").textContent =
      [
        `Target: ${fmt.format(weddingTarget)} (${targetEndIso})`,
        `Now: ${fmt.format(fundNow)}${isAssumed ? " (assumed)" : ""}`,
        `Delta: ${deltaStr}`,
      ].join("\n");
  }

  $("bankBalanceBtn").addEventListener("click", () => {
    const v = safeNum($("bankBalanceInput").value);
    if (!Number.isFinite(v)) return;

    const d = $("entryDate").value || realTodayIso;
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const wed = loadLS(LS.pendingWedding, { bankBalanceUpdates: [], weddingExpenses: [] });
    wed.bankBalanceUpdates = wed.bankBalanceUpdates || [];
    wed.bankBalanceUpdates.push({ id, date: d, balance: v });
    saveLS(LS.pendingWedding, wed);

    $("bankBalanceInput").value = "";
    updatePendingUI();
    renderAll();
  });

  $("weddingExpenseBtn").addEventListener("click", () => {
    const v = safeNum($("weddingExpenseInput").value);
    if (v <= 0) return;

    const d = $("entryDate").value || realTodayIso;
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const wed = loadLS(LS.pendingWedding, { bankBalanceUpdates: [], weddingExpenses: [] });
    wed.weddingExpenses = wed.weddingExpenses || [];
    wed.weddingExpenses.push({ id, date: d, amount: v });
    saveLS(LS.pendingWedding, wed);

    $("weddingExpenseInput").value = "";
    updatePendingUI();
    renderAll();
  });

  $("clearBtn").addEventListener("click", () => {
    localStorage.removeItem(LS.pendingTx);
    localStorage.removeItem(LS.pendingWedding);
    updatePendingUI();
    renderAll();
    window.location.reload();
  });

  function buildPayload() {
    const tx = loadLS(LS.pendingTx, []);
    const wed = loadLS(LS.pendingWedding, { bankBalanceUpdates: [], weddingExpenses: [] });

    return {
      version: 1,
      createdAt: new Date().toISOString(),
      marker: "BUDGET_COMMIT_PAYLOAD_V1",
      transactions: tx,
      wedding: {
        bankBalanceUpdates: wed.bankBalanceUpdates || [],
        weddingExpenses: wed.weddingExpenses || [],
      },
    };
  }

  $("commitBtn").addEventListener("click", async () => {
    const payload = buildPayload();
    const count =
      (payload.transactions?.length || 0) +
      (payload.wedding?.bankBalanceUpdates?.length || 0) +
      (payload.wedding?.weddingExpenses?.length || 0);

    if (count === 0) return;

    const ownerRepo = config.github.repo;
    const title = `budget-commit ${todayIsoLocal()}`;
    const body =
`AUTOGENERATED - DO NOT EDIT

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`
`;

    let url = `https://github.com/${ownerRepo}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    if (url.length > 8000) {
      await navigator.clipboard.writeText(body);
      url = `https://github.com/${ownerRepo}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent("Payload copied to clipboard. Paste it here and submit.")}`;
      alert("Payload copied to clipboard. Paste it into the issue body.");
    }
    window.open(url, "_blank", "noopener,noreferrer");
  });

  function renderAll() {
    const asOfUTC = getAsOfUTC();
    renderTable(asOfUTC);
    renderWedding(asOfUTC);
    updatePendingUI();
  }

  updatePendingUI();
  renderAll();
}

main().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<pre style="color:#fff;padding:16px">Error: ${String(e)}</pre>`;
});
