 "use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

const money = (v) =>
  new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(Number(v || 0));

const dateText = (v) => {
  if (!v) return "";
  return new Date(`${v}T00:00:00`).toLocaleDateString("he-IL");
};

const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const monthKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const monthLabel = (m) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("he-IL", {
    month: "long",
    year: "numeric",
  });
};

const shiftMonth = (m, n) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y, mo - 1 + n, 1);
  return monthKey(d);
};

const monthsBetween = (from, to) => {
  const [fy, fm] = String(from).slice(0, 7).split("-").map(Number);
  const [ty, tm] = String(to).slice(0, 7).split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
};

const normalizeDateMonth = (v) => {
  if (!v) return "";
  return String(v).slice(0, 7);
};

const monthlyRate = (annualRate) =>
  Number(annualRate || 0) / 100 / 12;

const annuityPayment = (principal, annualRate, nMonths) => {
  const p = Math.max(0, Number(principal || 0));
  const n = Math.max(1, Math.round(Number(nMonths || 1)));
  const r = monthlyRate(annualRate);

  if (p <= 0) return 0;
  if (Math.abs(r) < 1e-12) return p / n;

  return (p * r) / (1 - Math.pow(1 + r, -n));
};

const monthsRemaining = (endDate, month) => {
  if (!endDate) return 360;
  const endMonth = normalizeDateMonth(endDate);
  return Math.max(1, monthsBetween(month, endMonth) + 1);
};

const calculateMonthlyPayment = (principal, annualRate, nMonths) => {
  const p = Math.max(0, Number(principal || 0));
  const n = Math.max(1, Math.round(Number(nMonths || 1)));
  const r = monthlyRate(annualRate);
  if (p <= 0) return 0;
  if (Math.abs(r) < 1e-12) return p / n;
  return (p * r) / (1 - Math.pow(1 + r, -n));
};

const calculateFutureBalance = (principal, annualRate, payment, months) => {
  let balance = Math.max(0, Number(principal || 0));
  const rate = monthlyRate(annualRate);
  const pmt = Math.max(0, Number(payment || 0));
  for (let i = 0; i < Math.max(0, Math.round(Number(months || 0))) && balance > 0.01; i++) {
    const interest = balance * rate;
    const actualPayment = Math.min(pmt, balance + interest);
    balance = Math.max(0, balance - Math.max(0, actualPayment - interest));
  }
  return balance;
};

const toMoneyNumber = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const cleaned = String(v).replace(/[₪,\s]/g, "").replace(/[^0-9.\-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

const commitmentPayment = (c) => {
  const value = c?.current_payment ?? c?.monthly_payment ?? c?.monthlyPayment ?? c?.payment_amount ?? c?.payment;
  return Math.max(0, toMoneyNumber(value));
};

const commitmentBalance = (c) => {
  const value = c?.current_balance ?? c?.remaining_balance ?? c?.balance ?? c?.outstanding_balance;
  return Math.max(0, toMoneyNumber(value));
};

const commitmentTypeValue = (c) => {
  // Prefer fields that are specifically intended to describe the commitment type.
  // Generic fields such as `type`/`category` are intentionally not used because they can
  // describe something else in an existing Supabase row.
  const explicit = [c?.commitment_type, c?.housing_type, c?.loan_type, c?.commitment_kind]
    .find((v) => v !== null && v !== undefined && String(v).trim() !== "");
  if (explicit) {
    const v = String(explicit).toLowerCase().trim();
    if (/mortgage|משכנת|mort/.test(v)) return "mortgage";
    if (/loan|הלווא|אשראי|personal.?loan|consumer|bank.?loan/.test(v)) return "loan";
    if (/other|אחר|commitment|התחייב/.test(v)) return "other";
  }

  const name = String(c?.name || "").toLowerCase();
  if (/הלווא|loan|אשראי|personal.?loan|consumer|רכב|שיפוץ|אישית/.test(name)) return "loan";
  if (/משכנת|mortgage|מסלול/.test(name)) return "mortgage";

  // Do NOT classify a row as mortgage merely because it has a rate/indexation field.
  // Loans can have the same financial fields. When the schema does not contain an
  // explicit type, use the name as the strongest signal and keep the fallback as
  // "loan" so an otherwise valid loan is never silently counted as a mortgage.
  const formula = String(c?.rate_formula || "").toLowerCase();
  const rateType = String(c?.rate_type || "").toLowerCase();
  const indexation = String(c?.indexation || "").toLowerCase();
  const mortgageSignals = `${formula} ${rateType} ${indexation}`;
  if (/משכנת|mortgage|מסלול|צמוד.?מדד|קבועה.?צמוד|קבועה.?לא.?צמוד|פריים.?משכנת/.test(mortgageSignals)) return "mortgage";

  return "loan";
};
const commitmentTypeLabel = (c) => ({ mortgage: "משכנתא", loan: "הלוואה", other: "התחייבות נוספת" }[commitmentTypeValue(c)] || "התחייבות נוספת");

// נתוני דיור שהוזנו ידנית מתוך המסמכים שסופקו.
// המקור הוא מסמך המשכנתאות של בנק הפועלים מיום 03/10/2026
// וצילום מסך של שתי ההלוואות מיום 01/10/2026.
// אין כאן השלמה של נתונים שלא הופיעו במקורות.
const MANUAL_HOUSING_COMMITMENTS = [
  // משכנתאות – 10 קבוצות/הלוואות כפי שמופיעות בסיכום הבנק.
  // current_balance = יתרה משוערת: קרן + הצמדות/ריבית שנצברו, ללא עמלת פירעון מוקדם.
  {
    id: "mortgage-61-11-425920-551",
    name: "מסלול 61/11/425920/551",
    loan_number: "61/11/425920/551",
    commitment_type: "mortgage",
    current_balance: 402596.68,
    liquidation_balance: 401499.78,
    current_payment: 2008.82,
    interest_rate: 3.98,
    rate_formula: "F + 0.60%",
    rate_type: "משתנה",
    indexation: "לא צמוד",
    end_date: "2055-01-10",
    next_rate_change: "2028-01-10",
    rate_change_months: 18,
    as_of_date: "2026-10-03",
  },
  {
    id: "mortgage-62-00-300948-148",
    name: "מסלול 62/00/300948/148",
    loan_number: "62/00/300948/148",
    commitment_type: "mortgage",
    current_balance: 1703.38,
    liquidation_balance: 1408.36,
    current_payment: 847.24,
    interest_rate: 0.816,
    rate_type: "קבועה",
    indexation: "מדד המחירים לצרכן",
    end_date: "2026-11-10",
    as_of_date: "2026-10-03",
  },
  {
    id: "mortgage-62-00-415488-443",
    name: "מסלול 62/00/415488/443",
    loan_number: "62/00/415488/443",
    commitment_type: "mortgage",
    current_balance: 188683.58,
    liquidation_balance: 172535.68,
    current_payment: 836.00,
    interest_rate: 2.91,
    rate_type: "קבועה",
    indexation: "מדד המחירים לצרכן",
    end_date: "2053-08-10",
    as_of_date: "2026-10-03",
  },
  {
    id: "mortgage-62-10-300948-246",
    name: "מסלול 62/10/300948/246",
    loan_number: "62/10/300948/246",
    commitment_type: "mortgage",
    current_balance: 152382.80,
    liquidation_balance: 151988.05,
    current_payment: 960.49,
    interest_rate: 3.95,
    rate_formula: "P - 0.80%",
    rate_type: "משתנה",
    indexation: "לא צמוד",
    end_date: "2045-12-10",
    next_rate_change: "2026-10-10",
    rate_change_months: 1,
    as_of_date: "2026-10-03",
  },
  {
    id: "mortgage-62-10-415488-244",
    name: "מסלול 62/10/415488/244",
    loan_number: "62/10/415488/244",
    commitment_type: "mortgage",
    current_balance: 172378.60,
    liquidation_balance: 171898.23,
    current_payment: 918.92,
    interest_rate: 4.25,
    rate_formula: "P - 0.50%",
    rate_type: "משתנה",
    indexation: "לא צמוד",
    end_date: "2053-08-10",
    next_rate_change: "2026-10-10",
    rate_change_months: 1,
    as_of_date: "2026-10-03",
  },
  {
    id: "mortgage-62-10-425920-650",
    name: "מסלול 62/10/425920/650",
    loan_number: "62/10/425920/650",
    commitment_type: "mortgage",
    current_balance: 195263.26,
    liquidation_balance: 194744.65,
    current_payment: 993.37,
    interest_rate: 4.05,
    rate_formula: "P - 0.70%",
    rate_type: "משתנה",
    indexation: "לא צמוד",
    end_date: "2054-10-10",
    next_rate_change: "2026-10-10",
    rate_change_months: 1,
    as_of_date: "2026-10-03",
    tracks: [
      { component: "201", original_amount: 135000, end_date: "2054-10-10", next_rate_change: "2026-10-10", interest_rate: 4.05 },
      { component: "202", original_amount: 65000, end_date: "2055-04-10", next_rate_change: "2026-10-10", interest_rate: 4.05 },
    ],
  },
  {
    id: "mortgage-62-42-425920-445",
    name: "מסלול 62/42/425920/445",
    loan_number: "62/42/425920/445",
    commitment_type: "mortgage",
    current_balance: 346424.55,
    liquidation_balance: 345370.91,
    current_payment: 2949.63,
    interest_rate: 4.65,
    rate_type: "קבועה",
    indexation: "לא צמוד",
    end_date: "2039-09-10",
    as_of_date: "2026-10-03",
    tracks: [
      { component: "201", original_amount: 303500, end_date: "2039-09-10", interest_rate: 4.65 },
      { component: "202", original_amount: 78500, end_date: "2039-10-10", interest_rate: 4.60 },
    ],
  },
  {
    id: "mortgage-62-59-415488-519",
    name: "מסלול 62/59/415488/519",
    loan_number: "62/59/415488/519",
    commitment_type: "mortgage",
    current_balance: 176867.94,
    liquidation_balance: 176276.81,
    current_payment: 1004.46,
    interest_rate: 5.10,
    rate_formula: "F + 1.33%",
    rate_type: "משתנה",
    indexation: "לא צמוד",
    end_date: "2053-08-10",
    next_rate_change: "2028-08-10",
    rate_change_months: 60,
    as_of_date: "2026-10-03",
  },
  {
    id: "mortgage-62-79-300948-321",
    name: "מסלול 62/79/300948/321",
    loan_number: "62/79/300948/321",
    commitment_type: "mortgage",
    current_balance: 180897.80,
    liquidation_balance: 149255.35,
    current_payment: 1113.80,
    interest_rate: 4.00,
    rate_formula: "V + 2.00%",
    rate_type: "משתנה",
    indexation: "מדד המחירים לצרכן",
    end_date: "2045-12-10",
    next_rate_change: "2030-12-10",
    rate_change_months: 60,
    as_of_date: "2026-10-03",
  },
  {
    id: "mortgage-63-02-425920-744",
    name: "מסלול 63/02/425920/744",
    loan_number: "63/02/425920/744",
    commitment_type: "mortgage",
    current_balance: 107022.89,
    liquidation_balance: 103417.34,
    current_payment: 500.91,
    interest_rate: 3.65,
    rate_formula: "H + 1.65%",
    rate_type: "משתנה",
    indexation: "מדד המחירים לצרכן",
    end_date: "2055-04-10",
    next_rate_change: "2028-04-10",
    rate_change_months: 36,
    as_of_date: "2026-10-03",
    tracks: [
      { component: "201", original_amount: 35650, end_date: "2055-04-10", next_rate_change: "2028-04-10", interest_rate: 3.65 },
      { component: "202", original_amount: 70000, end_date: "2055-09-10", next_rate_change: "2028-09-10", interest_rate: 3.78 },
    ],
  },

  // הלוואות – נתונים שנקלטו ידנית מצילום המסך.
  {
    id: "loan-manual-01",
    name: "הלוואה 1 – 40,000 ₪",
    loan_number: "loan-01",
    commitment_type: "loan",
    original_amount: 40000,
    current_balance: 24000,
    current_payment: 1000,
    end_date: "2028-09-02",
    interest_rate: 0,
    indexation: "לא צמוד",
    as_of_date: "2026-10-01",
  },
  {
    id: "loan-manual-02",
    name: "הלוואה 2 – 133,000 ₪",
    loan_number: "loan-02",
    commitment_type: "loan",
    original_amount: 133000,
    current_balance: 128384.24,
    current_payment: 1886.62,
    end_date: "2033-05-10",
    interest_rate: 5.75,
    indexation: "לא צמוד",
    as_of_date: "2026-10-01",
  },
];
const commitmentTypePlural = (type) => ({ mortgage: "משכנתאות", loan: "הלוואות", other: "התחייבויות נוספות" }[type] || "התחייבויות");
const scenarioNumber = (v) => v === "" || v == null || !Number.isFinite(toMoneyNumber(v)) ? null : toMoneyNumber(v);

function forecastCommitment(c, startMonth, months, scenario = {}) {
  const n = Math.min(Math.max(Number(months || 1), 1), 360);
  const startBalance = Math.max(0, commitmentBalance(c));
  const currentPayment = Math.max(0, commitmentPayment(c));
  const currentRateRaw = Number(c.interest_rate);
  const currentRate = Number.isFinite(currentRateRaw) ? currentRateRaw : null;
  const endMonth = normalizeDateMonth(c.end_date);
  const changeMonth = normalizeDateMonth(c.next_rate_change);
  const scenarioRate = scenarioNumber(scenario.rate);
  const paymentOverride = scenarioNumber(scenario.payment);
  const rows = [];
  let balance = startBalance;
  let balanceKnown = true;
  let activeRate = currentRate;

  for (let i = 0; i < n; i++) {
    const month = shiftMonth(startMonth, i);
    if ((endMonth && month > endMonth) || balance <= 0.01) {
      rows.push({ month, payment: 0, balance: 0, paymentKnown: true, balanceKnown: true, reason: "סיום התחייבות" });
      balance = 0;
      balanceKnown = true;
      continue;
    }
    // The current month represents the payment that is actually in force today.
    // A rate-change date that falls inside the current month becomes a forecast
    // change point, but must not erase the current payment from the graph.
    const changeExpected = Boolean(changeMonth && month > startMonth && month >= changeMonth);
    if (changeExpected && scenarioRate !== null) activeRate = scenarioRate;

    let payment = null;
    let paymentKnown = true;
    let thisBalanceKnown = balanceKnown;
    let reason = "";

    if (changeExpected && scenarioRate === null && paymentOverride === null) {
      paymentKnown = false;
      thisBalanceKnown = false;
      balanceKnown = false;
      reason = "צפוי שינוי ריבית; הריבית העתידית אינה ידועה";
    } else if (changeExpected && scenarioRate !== null) {
      payment = calculateMonthlyPayment(balance, activeRate, monthsRemaining(endMonth, month));
      reason = "שינוי ריבית לפי תרחיש";
    } else if (changeExpected && paymentOverride !== null) {
      payment = paymentOverride;
      reason = "תרחיש תשלום חודשי";
      if (activeRate === null || !balanceKnown) thisBalanceKnown = false;
    } else if (currentPayment > 0) {
      payment = currentPayment;
    } else if (activeRate !== null && endMonth) {
      payment = calculateMonthlyPayment(balance, activeRate, monthsRemaining(endMonth, month));
      reason = "חושב לפי יתרה, ריבית ותקופה שנותרה";
    } else {
      paymentKnown = false;
      thisBalanceKnown = false;
      reason = "אין מספיק נתונים לחישוב ההחזר";
    }

    if (thisBalanceKnown && payment !== null && activeRate !== null) {
      const interest = balance * monthlyRate(activeRate);
      const actualPayment = Math.min(Math.max(0, payment), balance + interest);
      balance = Math.max(0, balance - Math.max(0, actualPayment - interest));
      if (endMonth && month === endMonth) balance = 0;
    } else if (thisBalanceKnown && payment === null) {
      thisBalanceKnown = false;
      balanceKnown = false;
    }

    rows.push({ month, payment, balance: thisBalanceKnown ? balance : null, paymentKnown, balanceKnown: thisBalanceKnown, reason, rate: activeRate });
  }
  return { commitment: c, type: commitmentTypeValue(c), rows };
}

function calculateHousingForecast(commitments, startMonth, months, scenarios = {}) {
  const n = Math.min(Math.max(Number(months || 1), 1), 360);
  const perCommitment = (commitments || []).map((c) => forecastCommitment(c, startMonth, n, scenarios?.[c.id] || {}));
  const byMonth = Array.from({ length: n }, (_, i) => {
    const month = shiftMonth(startMonth, i);
    const rows = perCommitment.map((x) => x.rows[i]);
    const paymentKnown = rows.every((r) => r?.paymentKnown !== false);
    const balanceKnown = rows.every((r) => r?.balanceKnown !== false);
    return {
      month,
      payment: paymentKnown ? rows.reduce((s, r) => s + Number(r?.payment || 0), 0) : null,
      balance: balanceKnown ? rows.reduce((s, r) => s + Number(r?.balance || 0), 0) : null,
      paymentKnown,
      balanceKnown,
      commitments: rows.map((r, idx) => ({
        id: perCommitment[idx].commitment.id,
        name: perCommitment[idx].commitment.name,
        type: perCommitment[idx].type,
        payment: r?.payment ?? null,
        balance: r?.balance ?? null,
        paymentKnown: r?.paymentKnown !== false,
        balanceKnown: r?.balanceKnown !== false,
        reason: r?.reason || "",
      })),
    };
  });
  return { perCommitment, byMonth };
}

const compareCommitmentEndDate = (a, b) => {
  const da = normalizeDateMonth(a?.end_date);
  const db = normalizeDateMonth(b?.end_date);
  if (da && db) return da.localeCompare(db);
  if (da) return -1;
  if (db) return 1;
  return String(a?.name || "").localeCompare(String(b?.name || ""), "he");
};

const sortCommitmentsByEndDate = (rows) => [...(rows || [])].sort(compareCommitmentEndDate);

const calculateCurrentHousingState = (commitments) => {
  const rows = commitments || [];
  const mortgages = sortCommitmentsByEndDate(rows.filter((c) => commitmentTypeValue(c) === "mortgage"));
  const loans = sortCommitmentsByEndDate(rows.filter((c) => commitmentTypeValue(c) === "loan"));
  const sumPayment = (list) => list.reduce((s, c) => s + commitmentPayment(c), 0);
  const sumBalance = (list) => list.reduce((s, c) => s + commitmentBalance(c), 0);
  const other = sortCommitmentsByEndDate(rows.filter((c) => commitmentTypeValue(c) === "other"));
  return {
    mortgages,
    loans,
    other,
    mortgagePayment: sumPayment(mortgages),
    loanPayment: sumPayment(loans),
    otherPayment: sumPayment(other),
    totalPayment: sumPayment(rows),
    mortgageBalance: sumBalance(mortgages),
    loanBalance: sumBalance(loans),
    otherBalance: sumBalance(other),
    totalBalance: sumBalance(rows),
  };
};

function findPaymentChangePoints(forecast) {
  const rows = forecast?.byMonth || [];
  const perCommitment = forecast?.perCommitment || [];
  if (!rows.length) return [];

  const firstMonth = rows[0].month;
  const lastMonth = rows[rows.length - 1].month;
  const today = new Date();
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const eventMap = new Map();
  const addEvent = (event) => {
    if (!event?.month) return;
    const key = event.date || `${event.month}-01`;
    const existing = eventMap.get(key);
    eventMap.set(key, {
      ...(existing || {}),
      ...event,
      commitments: [...new Map([...(existing?.commitments || []), ...(event.commitments || [])].map((x) => [x.id, x])).values()],
    });
  };

  perCommitment.forEach((item) => {
    const c = item.commitment || {};
    const commitmentRows = item.rows || [];
    const rateChangeRaw = c.next_rate_change;
    const rateChangeMonth = normalizeDateMonth(rateChangeRaw);
    const rateChangeDate = rateChangeRaw ? String(rateChangeRaw).slice(0, 10) : "";
    if (rateChangeMonth && rateChangeMonth >= firstMonth && rateChangeMonth <= lastMonth) {
      const eventDateObj = rateChangeDate ? new Date(`${rateChangeDate}T00:00:00`) : new Date(`${rateChangeMonth}-01T00:00:00`);
      if (eventDateObj > todayDate) {
        const idx = rows.findIndex((r) => r.month === rateChangeMonth);
        const beforeRow = idx > 0 ? rows[idx - 1] : rows[0];
        const currentRow = idx >= 0 ? rows[idx] : rows[0];
        const commitmentRow = idx >= 0 ? commitmentRows[idx] : commitmentRows[0];
        addEvent({
          month: rateChangeMonth,
          date: rateChangeDate || `${rateChangeMonth}-01`,
          beforePayment: beforeRow?.paymentKnown ? Number(beforeRow.payment || 0) : Number(rows[0]?.payment || 0),
          afterPayment: null,
          delta: null,
          knownAfter: false,
          commitments: [{
            id: c.id,
            name: c.name,
            type: item.type,
            payment: commitmentRow?.payment ?? null,
            paymentKnown: false,
            reason: "מועד שינוי ריבית; הריבית העתידית אינה ידועה",
          }],
          reason: "מועד שינוי ריבית; הריבית העתידית אינה ידועה",
        });
      }
    }

    const endMonth = normalizeDateMonth(c.end_date);
    if (endMonth) {
      const stopMonth = shiftMonth(endMonth, 1);
      if (stopMonth >= firstMonth && stopMonth <= lastMonth) {
        const idx = rows.findIndex((r) => r.month === stopMonth);
        if (idx > 0) {
          const before = rows[idx - 1];
          const cur = rows[idx];
          addEvent({
            month: stopMonth,
            date: `${stopMonth}-01`,
            beforePayment: before?.paymentKnown ? Number(before.payment || 0) : null,
            afterPayment: cur?.paymentKnown ? Number(cur.payment || 0) : 0,
            delta: before?.paymentKnown && cur?.paymentKnown ? Number(cur.payment || 0) - Number(before.payment || 0) : null,
            knownAfter: cur?.paymentKnown === true,
            commitments: [{
              id: c.id,
              name: c.name,
              type: item.type,
              payment: cur?.payment ?? 0,
              paymentKnown: cur?.paymentKnown !== false,
              reason: "התחייבות הסתיימה",
            }],
            reason: "התחייבות הסתיימה",
          });
        }
      }
    }
  });

  // Calculated payment changes that are not explained by a stored event date.
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    if (prev.paymentKnown && cur.paymentKnown && Math.abs(Number(cur.payment || 0) - Number(prev.payment || 0)) >= 1) {
      const changedCommitments = perCommitment.map((item) => {
        const before = item.rows?.[i - 1];
        const current = item.rows?.[i];
        if (!before || !current) return null;
        if (!before.paymentKnown || !current.paymentKnown) return null;
        if (Math.abs(Number(current.payment || 0) - Number(before.payment || 0)) < 1) return null;
        return {
          id: item.commitment.id,
          name: item.commitment.name,
          type: item.type,
          payment: current.payment,
          paymentKnown: true,
          reason: current.reason || "שינוי בתשלום",
        };
      }).filter(Boolean);
      addEvent({
        month: cur.month,
        date: `${cur.month}-01`,
        beforePayment: Number(prev.payment || 0),
        afterPayment: Number(cur.payment || 0),
        delta: Number(cur.payment || 0) - Number(prev.payment || 0),
        knownAfter: true,
        commitments: changedCommitments,
        reason: changedCommitments.map((x) => x.reason).filter(Boolean).join(" · ") || "שינוי בתשלום",
      });
    }
  }

  return [...eventMap.values()]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((point, index) => ({ ...point, id: `${point.date}-${index}` }));
}

const buildHousingForecast = (commitments, startMonth, months, scenarios) =>
  calculateHousingForecast(commitments, startMonth, months, scenarios);

const emptyTx = () => ({
  description: "",
  category_id: "",
  expense_type: "variable",
  planned_amount: "",
  actual_amount: "",
  person_user_id: "",
  transaction_date: todayKey(),
  note: "",
  payment_method: "",
  merchant: "",
  credit_card_last4: "",
  credit_card_provider: "",
});

const emptyRecurring = () => ({
  name: "",
  category_id: "",
  planned_amount: "",
  day_of_month: "1",
  payment_method: "",
  merchant: "",
  person_user_id: "",
  note: "",
});

export default function BudgetApp() {
  const [user, setUser] = useState(null);
  const [household, setHousehold] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [categories, setCategories] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [month, setMonth] = useState(monthKey());
  const [tab, setTab] = useState("dashboard");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [modal, setModal] = useState(null);
  const [editingTx, setEditingTx] = useState(null);
  const [editingRecurring, setEditingRecurring] = useState(null);
  const [txForm, setTxForm] = useState(emptyTx());
  const [recForm, setRecForm] = useState(emptyRecurring());

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [confirm, setConfirm] = useState(null);

  const [expenseFilters, setExpenseFilters] = useState({
    fromDate: "",
    toDate: "",
    minAmount: "",
    maxAmount: "",
    paymentMethod: "",
    description: "",
    cardLast4: "",
  });
  const [expenseSort, setExpenseSort] = useState({ key: "date", direction: "desc" });

  const [creditImportRows, setCreditImportRows] = useState([]);
  const [creditImportFile, setCreditImportFile] = useState("");
  const [creditImportProvider, setCreditImportProvider] = useState("");
  const [creditImportError, setCreditImportError] = useState("");
  const [creditImportLoading, setCreditImportLoading] = useState(false);
  const [creditImportResult, setCreditImportResult] = useState(null);

  const [housingCommitments, setHousingCommitments] = useState([]);
  const [housingError, setHousingError] = useState("");
  const [forecastMonths, setForecastMonths] = useState(360);
  const [forecastStart, setForecastStart] = useState(monthKey());
  const [housingScenarios, setHousingScenarios] = useState({});
  const [selectedHousingLoan, setSelectedHousingLoan] = useState("");

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setUser(data.session?.user || null);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      setUser(s?.user || null);
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (user) refresh();
    else {
      setHousehold(null);
      setProfiles([]);
      setCategories([]);
      setTransactions([]);
      setRecurring([]);
      setHousingCommitments([]);
      setHousingError("");
    }
  }, [user, month]);

  async function refresh() {
    if (!user) return;
    setLoading(true);
    try {
      const h = await supabase.rpc("get_my_household");
      if (h.error) throw h.error;
      const hr = h.data?.[0];
      if (!hr) {
        setHousehold(null);
        return;
      }
      const householdId = hr.household_id;
      setHousehold({ id: householdId, name: hr.household_name });

      const [m, c, t, r, housing] = await Promise.all([
        supabase.rpc("get_my_household_members"),
        supabase.from("categories").select("*").eq("household_id", householdId).order("name"),
        supabase
          .from("transactions")
          .select("*")
          .eq("household_id", householdId)
          .gte("transaction_date", `${month}-01`)
          .lt("transaction_date", `${shiftMonth(month, 1)}-01`)
          .order("transaction_date", { ascending: false })
          .order("created_at", { ascending: false }),
        supabase
          .from("recurring_expenses")
          .select("*")
          .eq("household_id", householdId)
          .eq("is_active", true)
          .order("day_of_month")
          .order("name"),
      ]);

      if (m.error) console.error(m.error);
      if (c.error) console.error(c.error);
      if (t.error) console.error(t.error);
      if (r.error) console.error(r.error);

      // בשלב זה נתוני הדיור נטענים מהסט הקבוע שהוזן ידנית מתוך
      // מסמך המשכנתאות וצילום מסך ההלוואות. שאר האפליקציה ממשיכה
      // להיטען כרגיל מ-Supabase.
      setHousingCommitments(MANUAL_HOUSING_COMMITMENTS);
      setHousingError("");

      const members = m.data || [];
      setProfiles(
        members.map((x) => ({
          id: x.user_id,
          display_name: x.display_name || "ללא שם",
          role: x.role,
        }))
      );
      setCategories(c.data || []);

      // הכנסות קבועות: אם קיימת הכנסה קבועה בחודש קודם ואין עדיין
      // מופע בחודש הנבחר, יוצרים מופע חדש עם הסכום המצופה.
      // הסכום בפועל נשאר ריק עד שמעדכנים אותו.
      const syncedIncome = await syncFixedIncomeTransactions(
        householdId,
        t.data || []
      );

      setTransactions(syncedIncome);
      setRecurring(r.data || []);
    } catch (e) {
      console.error(e);
      setError(e.message || "שגיאה בטעינת הנתונים");
    } finally {
      setLoading(false);
    }
  }

  async function syncFixedIncomeTransactions(householdId, currentRows) {
    const rows = [...(currentRows || [])];
    const monthStart = `${month}-01`;
    const nextMonthStart = `${shiftMonth(month, 1)}-01`;

    const { data: historical, error } = await supabase
      .from("transactions")
      .select("*")
      .eq("household_id", householdId)
      .eq("kind", "income")
      .eq("expense_type", "fixed")
      .lt("transaction_date", nextMonthStart)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) throw error;

    // מזהה הכנסה קבועה לפי המקור + מי שמקבל אותה + קטגוריה.
    const keyOf = (t) =>
      [
        String(t.description || "").trim().toLowerCase(),
        String(t.person_user_id || ""),
        String(t.category_id || ""),
      ].join("|");

    const currentFixed = rows.filter(
      (t) => t.kind === "income" && t.expense_type === "fixed"
    );
    const currentKeys = new Set(currentFixed.map(keyOf));

    // משתמשים רק במופע האחרון של כל הכנסה קבועה שהייתה לפני/בחודש הנוכחי.
    const templates = [];
    const seen = new Set();
    for (const t of historical || []) {
      const key = keyOf(t);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (String(t.transaction_date || "").slice(0, 7) !== month) {
        templates.push(t);
      }
    }

    for (const template of templates) {
      const key = keyOf(template);
      if (currentKeys.has(key)) continue;

      const sourceDate = new Date(`${template.transaction_date}T00:00:00`);
      const wantedDay = Number.isNaN(sourceDate.getTime())
        ? 1
        : sourceDate.getDate();
      const [y, mo] = month.split("-").map(Number);
      const lastDay = new Date(y, mo, 0).getDate();
      const day = Math.min(Math.max(wantedDay, 1), lastDay);
      const transactionDate = `${month}-${String(day).padStart(2, "0")}`;

      const row = {
        household_id: householdId,
        created_by: user?.id || null,
        kind: "income",
        description: template.description,
        category_id: template.category_id || null,
        transaction_date: transactionDate,
        planned_amount: Number(
          template.planned_amount ?? template.actual_amount ?? 0
        ),
        completed: false,
        actual_amount: null,
        expense_type: "fixed",
        person_user_id: template.person_user_id || null,
        note: template.note || "הכנסה קבועה",
        payment_method: template.payment_method || null,
        merchant: template.merchant || null,
        credit_card_last4: null,
        credit_card_provider: null,
      };

      const { data: inserted, error: insertError } = await supabase
        .from("transactions")
        .insert(row)
        .select("*")
        .single();

      if (insertError) throw insertError;
      rows.push(inserted);
      currentKeys.add(key);
    }

    return rows.sort((a, b) =>
      String(b.transaction_date || "").localeCompare(
        String(a.transaction_date || "")
      )
    );
  }

  async function signIn(e) {
    e.preventDefault();
    setLoginError("");
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) setLoginError("ההתחברות נכשלה. בדקי את האימייל והסיסמה.");
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  function openTx(tx = null, kind = "expense") {
    setError("");
    setEditingTx(tx);
    if (tx) {
      setTxForm({
        description: tx.description || "",
        category_id: tx.category_id || "",
        expense_type: tx.expense_type || "variable",
        planned_amount: tx.planned_amount ?? "",
        actual_amount: tx.actual_amount ?? "",
        person_user_id: tx.person_user_id || "",
        transaction_date: tx.transaction_date || todayKey(),
        note: tx.note || "",
        payment_method: tx.payment_method || "",
        merchant: tx.merchant || "",
        credit_card_last4: tx.credit_card_last4 || "",
        credit_card_provider: tx.credit_card_provider || "",
        kind,
      });
    } else {
      setTxForm({ ...emptyTx(), kind });
    }
    setModal(kind === "income" ? "income" : "transaction");
  }

  function closeModal() {
    setModal(null);
    setEditingTx(null);
    setEditingRecurring(null);
    setError("");
  }

  async function saveTx(e) {
    e.preventDefault();
    if (saving || !household) return;
    setError("");
    const f = txForm;
    const kind = modal === "income" ? "income" : "expense";
    const description = String(f.description || "").trim();
    const actual = f.actual_amount === "" ? null : Number(f.actual_amount);
    const isFixed = f.expense_type === "fixed";
    const planned = isFixed ? Number(f.planned_amount) : actual;

    if (!description) return setError("יש להזין תיאור.");
    if (!f.transaction_date) return setError("יש לבחור תאריך.");
    if (isFixed && (!Number.isFinite(planned) || planned < 0))
      return setError(kind === "income" ? "יש להזין סכום מצופה תקין." : "יש להזין סכום מתוכנן תקין.");
    if (actual !== null && (!Number.isFinite(actual) || actual < 0))
      return setError("יש להזין סכום בפועל תקין.");
    if (kind === "income" && !isFixed && (actual === null || !Number.isFinite(actual) || actual < 0))
      return setError("בהכנסה משתנה יש להזין סכום בפועל.");

    const row = {
      household_id: household.id,
      created_by: user?.id || null,
      kind,
      description,
      category_id: f.category_id || null,
      transaction_date: f.transaction_date,
      planned_amount: isFixed ? planned : actual,
      completed: actual !== null,
      actual_amount: actual,
      expense_type: kind === "expense" || isFixed ? f.expense_type : null,
      person_user_id: f.person_user_id || null,
      note: String(f.note || "").trim() || null,
      payment_method: f.payment_method || null,
      merchant: String(f.merchant || "").trim() || null,
      credit_card_last4: String(f.credit_card_last4 || "").replace(/\D/g, "").slice(-4) || null,
      credit_card_provider: f.payment_method === "credit_card" ? (f.credit_card_provider || null) : null,
    };

    setSaving(true);
    try {
      const q = editingTx
        ? supabase.from("transactions").update(row).eq("id", editingTx.id).eq("household_id", household.id)
        : supabase.from("transactions").insert(row);
      const result = await q.select("*").single();
      if (result.error) throw result.error;
      closeModal();
      await refresh();
    } catch (e) {
      console.error(e);
      setError(e.message || "לא הצלחתי לשמור.");
    } finally {
      setSaving(false);
    }
  }

  function openRecurring(item = null) {
    setError("");
    setEditingRecurring(item);
    setRecForm(
      item
        ? {
            name: item.name || "",
            category_id: item.category_id || "",
            planned_amount: item.planned_amount ?? "",
            day_of_month: item.day_of_month ?? "1",
            payment_method: item.payment_method || "",
            merchant: item.merchant || "",
            person_user_id: item.person_user_id || "",
            note: item.note || "",
          }
        : emptyRecurring()
    );
    setModal("recurring");
  }

  async function saveRecurring(e) {
    e.preventDefault();
    if (saving || !household) return;
    setError("");
    const f = recForm;
    const planned = Number(f.planned_amount);
    const day = Number(f.day_of_month);
    if (!String(f.name || "").trim()) return setError("יש להזין שם הוצאה.");
    if (!Number.isFinite(planned) || planned < 0) return setError("יש להזין סכום מתוכנן תקין.");
    if (!Number.isInteger(day) || day < 1 || day > 31) return setError("יום בחודש חייב להיות בין 1 ל־31.");

    const row = {
      household_id: household.id,
      name: String(f.name).trim(),
      category_id: f.category_id || null,
      planned_amount: planned,
      day_of_month: day,
      person_user_id: f.person_user_id || null,
      is_active: true,
      note: String(f.note || "").trim() || null,
      payment_method: f.payment_method || null,
      merchant: String(f.merchant || "").trim() || null,
    };

    setSaving(true);
    try {
      const q = editingRecurring
        ? supabase.from("recurring_expenses").update(row).eq("id", editingRecurring.id).eq("household_id", household.id)
        : supabase.from("recurring_expenses").insert(row);
      const result = await q.select("*").single();
      if (result.error) throw result.error;
      closeModal();
      await refresh();
    } catch (e) {
      console.error(e);
      setError(e.message || "לא הצלחתי לשמור את ההוצאה הקבועה.");
    } finally {
      setSaving(false);
    }
  }

  async function chargeRecurring(item) {
    if (saving || !household) return;
    const actualText = window.prompt(
      `סכום בפועל עבור ${item.name}\nמתוכנן: ${money(item.planned_amount)}`,
      String(item.planned_amount ?? "")
    );
    if (actualText === null) return;
    const actual = Number(actualText);
    if (!Number.isFinite(actual) || actual < 0) {
      alert("יש להזין סכום תקין.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const { data: existing, error: findError } = await supabase
        .from("transactions")
        .select("*")
        .eq("recurring_expense_id", item.id)
        .eq("recurring_month", month)
        .maybeSingle();
      if (findError) throw findError;

      const row = {
        household_id: household.id,
        created_by: user?.id || null,
        kind: "expense",
        description: item.name,
        category_id: item.category_id || null,
        transaction_date: `${month}-${String(Math.min(Number(item.day_of_month) || 1, 28)).padStart(2, "0")}`,
        planned_amount: Number(item.planned_amount || 0),
        completed: true,
        actual_amount: actual,
        expense_type: "fixed",
        person_user_id: item.person_user_id || null,
        note: item.note || null,
        payment_method: item.payment_method || null,
        merchant: item.merchant || null,
        recurring_expense_id: item.id,
        recurring_month: month,
      };

      const result = existing
        ? await supabase.from("transactions").update(row).eq("id", existing.id).select("*").single()
        : await supabase.from("transactions").insert(row).select("*").single();

      if (result.error) throw result.error;
      await refresh();
    } catch (e) {
      console.error(e);
      setError(e.message || "לא הצלחתי לסמן כחויב.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTx(tx) {
    setConfirm(null);
    setSaving(true);
    try {
      const { error } = await supabase.from("transactions").delete().eq("id", tx.id).eq("household_id", household.id);
      if (error) throw error;
      await refresh();
    } catch (e) {
      setError(e.message || "המחיקה נכשלה.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecurring(item) {
    setConfirm(null);
    setSaving(true);
    try {
      const { error } = await supabase.from("recurring_expenses").delete().eq("id", item.id).eq("household_id", household.id);
      if (error) throw error;
      await refresh();
    } catch (e) {
      setError(e.message || "המחיקה נכשלה.");
    } finally {
      setSaving(false);
    }
  }

  async function addCategory() {
    const name = String(newCategory || "").trim();
    if (!name || !household) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("categories").insert({
        household_id: household.id,
        name,
      });
      if (error) throw error;
      setNewCategory("");
      await refresh();
    } catch (e) {
      setError(e.message || "לא הצלחתי להוסיף קטגוריה.");
    } finally {
      setSaving(false);
    }
  }

  async function prepareCreditImport(file) {
    if (!file || !household) return;
    setCreditImportError("");
    setCreditImportResult(null);
    setCreditImportLoading(true);
    setCreditImportFile(file.name || "");
    try {
      const buffer = await file.arrayBuffer();
      let text;
      const utf8 = new TextDecoder("utf-8").decode(buffer);
      text = utf8.includes("�") ? new TextDecoder("windows-1255").decode(buffer) : utf8;
      text = text.replace(/^\uFEFF/, "");

      const parsed = parseCreditCsv(text, file.name || "");
      if (!parsed.rows.length) throw new Error("לא מצאתי עסקאות בקובץ. בדקי שזה קובץ CSV של חברת האשראי.");

      const { data: existing, error: existingError } = await supabase
        .from("transactions")
        .select("transaction_date,description,actual_amount,payment_method,credit_card_provider,credit_card_last4,merchant")
        .eq("household_id", household.id);
      if (existingError) throw existingError;

      const existingKeys = new Set((existing || []).map(creditDuplicateKey));
      const seen = new Set();
      const rows = parsed.rows.map((row, index) => {
        const suggestedCategory = guessCategoryId(row.description, categories);
        const key = creditDuplicateKey({
          transaction_date: row.date,
          description: row.description,
          actual_amount: row.amount,
          payment_method: "credit_card",
          credit_card_provider: row.provider,
          credit_card_last4: row.last4,
          merchant: row.merchant,
        });
        const duplicate = existingKeys.has(key) || seen.has(key);
        seen.add(key);
        return {
          ...row,
          id: `import-${index}-${Date.now()}`,
          selected: !duplicate && !row.ignored,
          duplicate,
          category_id: suggestedCategory,
          category_manual: false,
          status: row.ignored ? "ignored" : duplicate ? "duplicate" : "ready",
        };
      });

      setCreditImportProvider(parsed.provider);
      setCreditImportRows(rows);
    } catch (e) {
      console.error(e);
      setCreditImportRows([]);
      setCreditImportError(e.message || "לא הצלחתי לקרוא את הקובץ.");
    } finally {
      setCreditImportLoading(false);
    }
  }

  async function importSelectedCreditRows() {
    const selected = creditImportRows.filter((r) => r.selected && !r.ignored && !r.duplicate);
    if (!selected.length || !household) return;
    setCreditImportLoading(true);
    setCreditImportError("");
    setCreditImportResult(null);
    try {
      const rows = selected.map((r) => ({
        household_id: household.id,
        created_by: user?.id || null,
        kind: "expense",
        description: r.description,
        category_id: r.category_id || null,
        transaction_date: r.date,
        planned_amount: r.amount,
        completed: true,
        actual_amount: r.amount,
        expense_type: r.recurring ? "fixed" : "variable",
        person_user_id: null,
        note: r.recurring ? "יובא מכרטיס אשראי · עסקה חוזרת זוהתה" : "יובא מכרטיס אשראי",
        payment_method: "credit_card",
        merchant: r.merchant || r.description,
        credit_card_last4: r.last4 || null,
        credit_card_provider: r.provider || creditImportProvider || null,
      }));
      const { error } = await supabase.from("transactions").insert(rows);
      if (error) throw error;
      setCreditImportResult({ imported: rows.length, skipped: creditImportRows.length - rows.length });
      setCreditImportRows((prev) => prev.map((r) => r.selected && !r.ignored && !r.duplicate ? { ...r, selected: false, status: "imported" } : r));
      await refresh();
    } catch (e) {
      console.error(e);
      setCreditImportError(e.message || "הייבוא נכשל.");
    } finally {
      setCreditImportLoading(false);
    }
  }

  const categoryMap = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c.name])),
    [categories]
  );
  const memberMap = useMemo(
    () => Object.fromEntries(profiles.map((p) => [p.id, p.display_name])),
    [profiles]
  );

  const expenseTx = useMemo(
    () => transactions.filter((t) => t.kind === "expense" && t.actual_amount !== null),
    [transactions]
  );
  const incomeTx = useMemo(
    () => transactions.filter((t) => t.kind === "income"),
    [transactions]
  );

  const actualIncome = incomeTx.reduce((s, t) => s + Number(t.actual_amount || 0), 0);
  const actualExpenses = expenseTx.reduce((s, t) => s + Number(t.actual_amount || 0), 0);
  const fixedActual = expenseTx
    .filter((t) => t.expense_type === "fixed")
    .reduce((s, t) => s + Number(t.actual_amount || 0), 0);
  const variableActual = expenseTx
    .filter((t) => t.expense_type === "variable")
    .reduce((s, t) => s + Number(t.actual_amount || 0), 0);

  const chargedRecurringIds = new Set(
    expenseTx.filter((t) => t.recurring_expense_id && t.recurring_month === month).map((t) => t.recurring_expense_id)
  );
  const pendingRecurring = recurring.filter((r) => !chargedRecurringIds.has(r.id));
  const plannedFixed = recurring.reduce((s, r) => s + Number(r.planned_amount || 0), 0);
  const pendingPlanned = pendingRecurring.reduce((s, r) => s + Number(r.planned_amount || 0), 0);

  const housingState = useMemo(
    () => calculateCurrentHousingState(housingCommitments),
    [housingCommitments]
  );

  const housingForecast = useMemo(
    () => calculateHousingForecast(
      housingCommitments,
      forecastStart || monthKey(),
      forecastMonths,
      housingScenarios
    ),
    [housingCommitments, forecastStart, forecastMonths, housingScenarios]
  );

  const housingChangePoints = useMemo(
    () => findPaymentChangePoints(housingForecast),
    [housingForecast]
  );

  const typeChart = [
    { label: "קבועות", value: fixedActual },
    { label: "משתנות", value: variableActual },
  ];

  const categoryChart = useMemo(() => {
    const map = {};
    expenseTx.forEach((t) => {
      const name = categoryMap[t.category_id] || "ללא קטגוריה";
      map[name] = (map[name] || 0) + Number(t.actual_amount || 0);
    });
    return Object.entries(map)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [expenseTx, categoryMap]);

  if (!user) {
    return (
      <main className="login-page" dir="rtl">
        <form className="login-card" onSubmit={signIn}>
          <div className="logo-circle">₪</div>
          <h1>התקציב המשפחתי</h1>
          <p className="muted">כניסה לחשבון המשפחתי</p>
          <label>אימייל<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>סיסמה<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {loginError && <div className="error">{loginError}</div>}
          <button className="primary wide">כניסה</button>
        </form>
      </main>
    );
  }

  if (loading && !household) {
    return <main className="loading-page" dir="rtl">טוען...</main>;
  }

  return (
    <main className="app" dir="rtl">
      <header className="topbar">
        <div>
          <div className="eyebrow">התקציב המשפחתי</div>
          <h1>{household?.name || "התקציב שלי"}</h1>
        </div>
        <div className="top-actions">
          <span className="user-name">{memberMap[user.id] || "משתמשת"}</span>
          <button className="ghost" onClick={signOut}>יציאה</button>
        </div>
      </header>

      <section className="monthbar">
        <button className="month-arrow" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <strong>{monthLabel(month)}</strong>
        <button className="month-arrow" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
      </section>

      <nav className="tabs">
        {[
          ["dashboard", "סיכום"],
          ["expenses", "הוצאות"],
          ["fixed", "הוצאות קבועות"],
          ["income", "הכנסות"],
          ["credit-import", "יבוא אשראי"],
          ["housing", "🏠 דיור והתחייבויות"],
          ["categories", "קטגוריות"],
        ].map(([id, label]) => (
          <button key={id} className={tab === id ? "tab active" : "tab"} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {error && <div className="global-error">{error}</div>}

      {tab === "dashboard" && (
        <>
          <div className="page-title">
            <div><h2>סיכום חודשי</h2><p>{monthLabel(month)}</p></div>
            <button className="primary" onClick={() => openTx()}>＋ הוצאה</button>
          </div>

          <section className="cards">
            <Stat title="הכנסות בפועל" value={money(actualIncome)} tone="positive" />
            <Stat title="הוצאות בפועל" value={money(actualExpenses)} tone="negative" />
            <Stat title="יתרה" value={money(actualIncome - actualExpenses)} tone={actualIncome - actualExpenses >= 0 ? "positive" : "negative"} />
            <Stat title="קבועות מתוכננות" value={money(plannedFixed)} subtitle={`${pendingRecurring.length} ממתינות לחיוב`} />
          </section>

          <div className="housing-dashboard-card">
            <div>
              <div className="eyebrow">משכנתאות והתחייבויות</div>
              <h2>תחזית התשלום החודשי</h2>
              <p>
                עכשיו: {money(housingState.totalPayment)} · יתרת חוב: {money(housingState.totalBalance)}
              </p>
            </div>

            <div className="housing-dashboard-stats">
              <div>
                <span>יתרה</span>
                <strong>{money(housingState.totalBalance)}</strong>
              </div>
              <div>
                <span>סוף התחזית</span>
                <strong>{money(housingForecast.byMonth[housingForecast.byMonth.length - 1]?.payment || 0)}</strong>
              </div>
            </div>

            <button className="primary" onClick={() => setTab("housing")}>
              לתחזית המלאה
            </button>
          </div>

          <div className="two-columns">
            <Panel title="קבועות מול משתנות">
              <Bars data={typeChart} />
            </Panel>
            <Panel title="הוצאות לפי קטגוריה">
              {categoryChart.length ? <Bars data={categoryChart} /> : <Empty text="אין עדיין הוצאות בפועל בחודש הזה." />}
            </Panel>
          </div>

          <div className="two-columns">
            <Panel title="הוצאות קבועות ממתינות לחיוב">
              {pendingRecurring.length ? (
                <div className="fixed-list">
                  {pendingRecurring.slice(0, 6).map((r) => (
                    <div className="fixed-item" key={r.id}>
                      <div>
                        <strong>{r.name}</strong>
                        <small>יום {r.day_of_month} · {money(r.planned_amount)}</small>
                      </div>
                      <button className="small primary" onClick={() => chargeRecurring(r)}>סימון כחויבה</button>
                    </div>
                  ))}
                </div>
              ) : <Empty text="כל ההוצאות הקבועות סומנו כחויבות." />}
            </Panel>

            <Panel title="תנועות אחרונות">
              {transactions.slice(0, 7).map((t) => (
                <div className="recent-row" key={t.id}>
                  <div><strong>{t.description}</strong><small>{dateText(t.transaction_date)} · {categoryMap[t.category_id] || "ללא קטגוריה"}</small></div>
                  <strong className={t.kind === "income" ? "positive" : "negative"}>{t.kind === "income" ? "+" : "-"}{money(t.actual_amount)}</strong>
                </div>
              ))}
              {!transactions.length && <Empty text="אין תנועות בחודש הזה." />}
            </Panel>
          </div>
        </>
      )}

      {tab === "expenses" && (
        <ExpensesView
          transactions={expenseTx}
          categoryMap={categoryMap}
          onOpen={(tx) => openTx(tx, "expense")}
          filters={expenseFilters}
          setFilters={setExpenseFilters}
          sort={expenseSort}
          setSort={setExpenseSort}
          onAdd={() => openTx()}
          onDelete={(t) => setConfirm({ type: "tx", item: t })}
        />
      )}

      {tab === "fixed" && (
        <section className="panel">
          <div className="panel-head"><div><h2>הוצאות קבועות</h2><p>מתוכנן ובפועל. חיוב בפועל נכנס להוצאות רק לאחר סימון כחויב.</p></div><button className="primary" onClick={() => openRecurring()}>＋ הוצאה קבועה</button></div>
          <div className="fixed-summary">
            <Stat title="מתוכנן" value={money(plannedFixed)} />
            <Stat title="בפועל" value={money(fixedActual)} tone="negative" />
            <Stat title="ממתין" value={money(pendingPlanned)} />
          </div>
          <div className="fixed-list large">
            {recurring.map((r) => {
              const charged = chargedRecurringIds.has(r.id);
              const actual = expenseTx.find((t) => t.recurring_expense_id === r.id && t.recurring_month === month)?.actual_amount;
              return (
                <div className="fixed-card" key={r.id}>
                  <div className="fixed-main">
                    <strong>{r.name}</strong>
                    <span>{categoryMap[r.category_id] || "ללא קטגוריה"} · יום {r.day_of_month}</span>
                  </div>
                  <div className="amounts"><span>מתוכנן <b>{money(r.planned_amount)}</b></span><span>בפועל <b>{charged ? money(actual) : "—"}</b></span></div>
                  <div className="row-actions">
                    {charged ? <span className="badge success">חויבה</span> : <button className="small primary" onClick={() => chargeRecurring(r)}>סימון כחויבה</button>}
                    <button className="icon" onClick={() => openRecurring(r)}>✎</button>
                    <button className="icon danger" onClick={() => setConfirm({ type: "recurring", item: r })}>×</button>
                  </div>
                </div>
              );
            })}
            {!recurring.length && <Empty text="עדיין לא הוגדרו הוצאות קבועות." />}
          </div>
        </section>
      )}

      {tab === "income" && (
        <section className="panel">
          <div className="panel-head"><div><h2>הכנסות</h2><p>הכנסות בפועל בחודש הנבחר</p></div><button className="primary" onClick={() => openTx(null, "income")}>＋ הכנסה</button></div>
          <TransactionTable transactions={incomeTx} categoryMap={categoryMap} memberMap={memberMap} onEdit={openTx} onDelete={(t) => setConfirm({ type: "tx", item: t })} />
        </section>
      )}

      {tab === "credit-import" && (
        <CreditImportView
          rows={creditImportRows}
          fileName={creditImportFile}
          provider={creditImportProvider}
          loading={creditImportLoading}
          error={creditImportError}
          result={creditImportResult}
          categories={categories}
          onFile={prepareCreditImport}
          onImport={importSelectedCreditRows}
          onRows={setCreditImportRows}
        />
      )}

      {tab === "housing" && (
        <HousingForecastView
          commitments={housingCommitments}
          error={housingError}
          state={housingState}
          forecast={housingForecast}
          changePoints={housingChangePoints}
          forecastMonths={forecastMonths}
          setForecastMonths={setForecastMonths}
          forecastStart={forecastStart}
          setForecastStart={setForecastStart}
          scenarios={housingScenarios}
          setScenarios={setHousingScenarios}
          selectedLoan={selectedHousingLoan}
          setSelectedLoan={setSelectedHousingLoan}
          onRefresh={refresh}
        />
      )}

      {tab === "categories" && (
        <section className="panel">
          <div className="panel-head"><div><h2>קטגוריות</h2><p>ניתן להוסיף קטגוריה חדשה.</p></div></div>
          <div className="category-add"><input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="שם קטגוריה חדשה" /><button className="primary" onClick={addCategory} disabled={saving}>הוספה</button></div>
          <div className="category-grid">{categories.map((c) => <div className="category-card" key={c.id}><strong>{c.name}</strong></div>)}</div>
        </section>
      )}

      {modal && (
        <Modal title={modal === "recurring" ? (editingRecurring ? "עריכת הוצאה קבועה" : "הוצאה קבועה חדשה") : editingTx ? "עריכת תנועה" : modal === "income" ? "הכנסה חדשה" : "הוצאה חדשה"} onClose={closeModal}>
          {modal === "recurring" ? (
            <form className="form" onSubmit={saveRecurring}>
              <label>שם ההוצאה<input value={recForm.name} onChange={(e) => setRecForm({ ...recForm, name: e.target.value })} /></label>
              <label>קטגוריה<select value={recForm.category_id} onChange={(e) => setRecForm({ ...recForm, category_id: e.target.value })}><option value="">ללא קטגוריה</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <div className="form-grid"><label>סכום מתוכנן<input type="number" min="0" step="0.01" value={recForm.planned_amount} onChange={(e) => setRecForm({ ...recForm, planned_amount: e.target.value })} /></label><label>יום בחודש<input type="number" min="1" max="31" value={recForm.day_of_month} onChange={(e) => setRecForm({ ...recForm, day_of_month: e.target.value })} /></label></div>
              <label>בית עסק<input value={recForm.merchant} onChange={(e) => setRecForm({ ...recForm, merchant: e.target.value })} /></label>
              <label>אמצעי תשלום<select value={recForm.payment_method} onChange={(e) => setRecForm({ ...recForm, payment_method: e.target.value })}><option value="">לא צוין</option><option value="credit_card">כרטיס אשראי</option><option value="bank">חשבון בנק</option><option value="direct_debit">הוראת קבע</option><option value="cash">מזומן</option><option value="bit">ביט</option><option value="paybox">פייבוקס</option><option value="other">אחר</option></select></label>
              <label>על שם מי<select value={recForm.person_user_id} onChange={(e) => setRecForm({ ...recForm, person_user_id: e.target.value })}><option value="">לא צוין</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label>
              <label>הערה<textarea rows="3" value={recForm.note} onChange={(e) => setRecForm({ ...recForm, note: e.target.value })} /></label>
              {error && <div className="error">{error}</div>}
              <div className="modal-actions"><button type="button" className="ghost" onClick={closeModal}>ביטול</button><button className="primary" disabled={saving}>{saving ? "שומר..." : "שמירה"}</button></div>
            </form>
          ) : (
            <form className="form" onSubmit={saveTx}>
              <label>{modal === "income" ? "מקור ההכנסה" : "תיאור"}<input value={txForm.description} onChange={(e) => setTxForm({ ...txForm, description: e.target.value })} /></label>
              {modal !== "income" && <label>סוג הוצאה<select value={txForm.expense_type} onChange={(e) => setTxForm({ ...txForm, expense_type: e.target.value })}><option value="variable">משתנה – בפועל בלבד</option><option value="fixed">קבועה – מתוכנן ובפועל</option></select></label>}
              {modal === "income" && <label className="fixed-toggle"><span className="fixed-toggle-row"><input type="checkbox" checked={txForm.expense_type === "fixed"} onChange={(e) => setTxForm({ ...txForm, expense_type: e.target.checked ? "fixed" : "variable", planned_amount: e.target.checked ? (txForm.planned_amount || txForm.actual_amount || "") : "" })} /><strong>הכנסה קבועה</strong></span><small className="muted">הכנסה קבועה תופיע אוטומטית גם בחודשים הבאים, עם סכום מצופה שניתן לעדכן.</small></label>}
              <label>קטגוריה<select value={txForm.category_id} onChange={(e) => setTxForm({ ...txForm, category_id: e.target.value })}><option value="">ללא קטגוריה</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              {txForm.expense_type === "fixed" && <label>{modal === "income" ? "סכום מצופה" : "סכום מתוכנן"}<input type="number" min="0" step="0.01" value={txForm.planned_amount} onChange={(e) => setTxForm({ ...txForm, planned_amount: e.target.value })} /></label>}
              <label>סכום בפועל<input type="number" min="0" step="0.01" value={txForm.actual_amount} onChange={(e) => setTxForm({ ...txForm, actual_amount: e.target.value })} placeholder={modal === "income" && txForm.expense_type === "fixed" ? "אפשר להשאיר ריק עד שההכנסה מתקבלת" : modal === "income" ? "" : "השאירי ריק אם טרם חויב"} /></label>
              <div className="form-grid"><label>תאריך<input type="date" value={txForm.transaction_date} onChange={(e) => setTxForm({ ...txForm, transaction_date: e.target.value })} /></label><label>על שם מי<select value={txForm.person_user_id} onChange={(e) => setTxForm({ ...txForm, person_user_id: e.target.value })}><option value="">לא צוין</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label></div>
              <div className="form-grid"><label>בית עסק<input value={txForm.merchant} onChange={(e) => setTxForm({ ...txForm, merchant: e.target.value })} /></label><label>4 ספרות אחרונות<input inputMode="numeric" maxLength="4" value={txForm.credit_card_last4} onChange={(e) => setTxForm({ ...txForm, credit_card_last4: e.target.value.replace(/\D/g, "").slice(-4) })} /></label></div>
              {txForm.payment_method === "credit_card" && <label>חברת אשראי<select value={txForm.credit_card_provider} onChange={(e) => setTxForm({ ...txForm, credit_card_provider: e.target.value })}><option value="">לא צוין</option><option value="isracard">ישראכרט</option><option value="cal">כאל</option><option value="max">MAX</option><option value="flycard">Fly Card</option><option value="other">אחר</option></select></label>}
              <label>אמצעי תשלום<select value={txForm.payment_method} onChange={(e) => setTxForm({ ...txForm, payment_method: e.target.value })}><option value="">לא צוין</option><option value="credit_card">כרטיס אשראי</option><option value="bank">חשבון בנק</option><option value="direct_debit">הוראת קבע</option><option value="cash">מזומן</option><option value="bit">ביט</option><option value="paybox">פייבוקס</option><option value="other">אחר</option></select></label>
              <label>הערה<textarea rows="3" value={txForm.note} onChange={(e) => setTxForm({ ...txForm, note: e.target.value })} /></label>
              {error && <div className="error">{error}</div>}
              <div className="modal-actions"><button type="button" className="ghost" onClick={closeModal}>ביטול</button><button className="primary" disabled={saving}>{saving ? "שומר..." : "שמירה"}</button></div>
            </form>
          )}
        </Modal>
      )}

      {confirm && (
        <Modal title="אישור מחיקה" onClose={() => setConfirm(null)}>
          <p>למחוק את <strong>{confirm.item.name || confirm.item.description}</strong>?</p>
          <div className="modal-actions"><button className="ghost" onClick={() => setConfirm(null)}>ביטול</button><button className="danger-button" onClick={() => confirm.type === "tx" ? deleteTx(confirm.item) : deleteRecurring(confirm.item)}>כן, למחוק</button></div>
        </Modal>
      )}

      <style jsx global>{`
        .housing-dashboard-card { background:#fff; border:1px solid #e4e8f0; border-radius:18px; padding:18px; margin-bottom:14px; display:grid; grid-template-columns:minmax(0,1fr) auto auto; align-items:center; gap:18px; box-shadow:0 6px 20px rgba(35,45,75,.05); }
        .housing-dashboard-stats { display:flex; gap:28px; }
        .housing-dashboard-stats span { display:block; font-size:12px; color:#72798b; margin-bottom:5px; }
        .housing-dashboard-stats strong { font-size:20px; }
        .housing-summary-main { display:grid; grid-template-columns:minmax(0,1.25fr) minmax(0,2fr); gap:10px; margin-bottom:16px; }
        .housing-subtabs { display:flex; gap:8px; overflow-x:auto; padding:4px; margin:0 0 14px; border:1px solid #e1e4ef; border-radius:14px; background:#f7f8fc; scrollbar-width:none; }
        .housing-subtabs::-webkit-scrollbar { display:none; }
        .housing-subtab { flex:0 0 auto; border:0; background:transparent; padding:11px 16px; border-radius:11px; font:inherit; font-weight:700; color:#697083; cursor:pointer; white-space:nowrap; }
        .housing-subtab.active { background:#fff; color:#4c58dc; box-shadow:0 2px 10px rgba(30,35,70,.08); }
        .housing-subtab span { font-size:11px; opacity:.7; margin-right:4px; }
        .housing-type-badge { display:inline-block; margin-right:7px; padding:3px 7px; border-radius:999px; background:#eef0ff; color:#4c58dc; font-size:10px; vertical-align:middle; }

        .housing-total-card { min-width:0; padding:22px; border-radius:18px; background:linear-gradient(135deg,#4c58dc,#6973db); color:#fff; box-shadow:0 10px 30px rgba(76,88,220,.16); }
        .housing-total-card span { display:block; opacity:.86; font-size:13px; margin-bottom:6px; }
        .housing-total-card strong { display:block; font-size:32px; line-height:1.1; }
        .housing-total-card small { display:block; margin-top:8px; opacity:.82; }
        .housing-two-cards { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
        .housing-mini-card { padding:15px; border:1px solid #e2e5ef; border-radius:15px; background:#fff; }
        .housing-mini-card span { display:block; color:#72798b; font-size:12px; margin-bottom:5px; }
        .housing-mini-card strong { font-size:22px; }
        .housing-section-card { margin-top:14px; padding:16px; border:1px solid #e2e5ef; border-radius:18px; background:#fff; }
        .housing-forecast-card { overflow:hidden; }
        .forecast-current-badge { min-width:118px; padding:8px 12px; border-radius:12px; background:#f2f3ff; text-align:center; }
        .forecast-current-badge span { display:block; color:#70778a; font-size:11px; }
        .forecast-current-badge strong { display:block; color:#4d59cf; font-size:18px; margin-top:2px; }
        .forecast-controls.compact { margin:0 0 10px; grid-template-columns:1fr 1fr; }
        .forecast-type-legend { display:flex; flex-wrap:wrap; gap:10px 18px; margin:8px 2px 12px; color:#626979; font-size:12px; }
        .legend-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-left:5px; background:#5662d8; }
        .legend-dot.loan { background:#6f9bd9; }
        .legend-dot.other { background:#70a68b; }

        .housing-section-head { display:flex; justify-content:space-between; align-items:flex-start; gap:14px; margin-bottom:14px; }
        .housing-section-head h3 { margin:0 0 4px; }
        .housing-section-head p { margin:0; color:#747b8d; font-size:13px; }
        .housing-legend { font-size:12px; color:#73798a; margin-top:8px; }
        .housing-chart-wrap { border:1px solid #e5e7f0; border-radius:18px; background:linear-gradient(180deg,#fbfcff 0%,#f7f8fc 100%); overflow:hidden; padding:8px 4px 4px; }
        .housing-chart { width:100%; height:270px; display:block; overflow:visible; }
        .housing-chart-grid { stroke:#e7e9f0; stroke-width:1; }
        .housing-chart-axis { stroke:#cfd3df; stroke-width:1; }
        .housing-chart-line { fill:none; stroke:#5662d8; stroke-width:4; stroke-linecap:round; stroke-linejoin:round; }
        .housing-chart-point { fill:#fff; stroke:#5662d8; stroke-width:3; cursor:pointer; }
        .housing-chart-unknown { stroke:#d58b25; stroke-width:2; stroke-dasharray:5 5; }
        .housing-chart-label { font-size:10px; fill:#747b8d; }
        .housing-chart-value { font-size:11px; fill:#3e4656; font-weight:700; }
        .housing-chart-tooltip { margin:0 0 8px; padding:11px 13px; border-radius:12px; background:#252b3a; color:#fff; font-size:13px; line-height:1.55; }
        .housing-chart-tooltip .muted { color:#d3d7e2; }
        .housing-changes { display:grid; gap:9px; margin-top:12px; }
        .housing-change-card { border:1px solid #e4e6ee; border-radius:14px; padding:13px; background:#fff; cursor:pointer; }
        .housing-change-card:hover, .housing-change-card.selected { border-color:#6973db; background:#f8f9ff; }
        .housing-change-top { display:flex; justify-content:space-between; gap:10px; align-items:flex-start; }
        .housing-change-date { font-weight:800; }
        .housing-change-delta { font-weight:800; }
        .housing-change-delta.down { color:#15803d; }
        .housing-change-delta.up { color:#b42318; }
        .housing-change-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin-top:10px; }
        .housing-change-grid div { padding:9px; border-radius:10px; background:#f7f8fb; }
        .housing-change-grid span { display:block; color:#777e90; font-size:11px; margin-bottom:3px; }
        .housing-change-grid strong { font-size:14px; }
        .housing-change-reason { margin-top:9px; color:#5f6676; font-size:12px; }
        .housing-change-commitments { margin-top:8px; display:flex; flex-wrap:wrap; gap:6px; }
        .housing-change-chip { padding:5px 8px; border-radius:999px; background:#eef0ff; color:#4a55bd; font-size:11px; }
        .housing-balance-grid { display:grid; grid-template-columns:1fr auto; gap:12px; align-items:end; }
        .housing-balance-select label { display:block; font-size:12px; color:#73798a; margin-bottom:6px; }
        .housing-balance-select select { width:100%; min-width:190px; }
        .housing-balance-cards { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:9px; }
        .housing-balance-card { padding:13px; border-radius:13px; background:#f7f8fb; }
        .housing-balance-card span { display:block; color:#73798a; font-size:12px; margin-bottom:5px; }
        .housing-balance-card strong { font-size:19px; }
        .housing-balance-card.unknown { background:#fff8ea; }
        .housing-forecast-note { padding:11px 13px; border-radius:12px; background:#f6f7f9; color:#626979; font-size:12px; line-height:1.6; margin-top:10px; }
        .housing-forecast-controls { display:grid; grid-template-columns:minmax(0,1fr) minmax(150px,220px); gap:10px; margin:12px 0; }
        .housing-forecast-controls label { display:grid; gap:5px; color:#73798a; font-size:12px; font-weight:700; }
        .housing-forecast-controls input, .housing-forecast-controls select { width:100%; min-width:0; }
        .housing-empty { padding:28px 14px; text-align:center; color:#777e90; border:1px dashed #dfe2ea; border-radius:14px; }
        .housing-commitment-list { display:grid; gap:8px; }
        .housing-commitment-card { border:1px solid #e6e8ef; border-radius:13px; padding:12px; }
        .housing-commitment-card-top { display:flex; justify-content:space-between; gap:10px; }
        .housing-commitment-card-meta { margin-top:5px; color:#73798a; font-size:12px; }
        .forecast-controls { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin:14px 0; }
        .forecast-controls label { display:flex; flex-direction:column; gap:6px; font-size:12px; }
        @media (max-width:900px) { .housing-dashboard-card { grid-template-columns:1fr; } .housing-summary-main { grid-template-columns:1fr; } .housing-balance-grid { grid-template-columns:1fr; } .housing-balance-cards { grid-template-columns:1fr 1fr; } }
        @media (max-width:560px) { .housing-two-cards,.housing-balance-cards,.housing-change-grid,.forecast-controls { grid-template-columns:1fr; } .housing-dashboard-stats { justify-content:space-between; } .housing-total-card strong { font-size:28px; } .housing-chart { height:220px; } .housing-section-card { padding:13px; } .housing-change-top { flex-direction:column; } .housing-mini-card { padding:13px; } .forecast-current-badge { align-self:stretch; } .forecast-controls.compact { grid-template-columns:1fr 1fr; } .housing-subtabs { margin-inline:-2px; } }

        .expense-filters {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 10px;
          padding: 14px;
          margin: 14px 0 18px;
          border-radius: 14px;
          background: rgba(0,0,0,.025);
        }
        .expense-filters label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
        .expense-filters input, .expense-filters select { width: 100%; box-sizing: border-box; }
        .filter-actions { display: flex; align-items: end; }
        .payment-summary { margin: 18px 0 22px; padding: 18px; border: 1px solid rgba(0,0,0,.08); border-radius: 16px; }
        .payment-summary-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
        .payment-summary-head h3 { margin: 0 0 4px; }
        .payment-summary-head p { margin: 0; }
        .payment-summary-head > strong { font-size: 20px; }
        .sort-head { border: 0; background: transparent; padding: 0; font: inherit; font-weight: 700; cursor: pointer; color: inherit; }
        .sort-head:hover { opacity: .7; }
        .clickable-row { cursor: pointer; }
        .clickable-row:hover { background: rgba(0,0,0,.035); }
        .fixed-toggle { padding: 12px 14px; border: 1px solid rgba(0,0,0,.10); border-radius: 12px; background: rgba(0,0,0,.02); }
        .fixed-toggle-row { display:flex; align-items:center; gap:9px; cursor:pointer; }
        .fixed-toggle-row input { width:18px; height:18px; }
        .fixed-toggle small { display:block; margin-top:5px; }
        .expense-table th, .expense-table td { text-align: right; }
        .expense-table th:nth-child(2), .expense-table td:nth-child(2) { text-align: left; }
        .expenses-table-wrap { width: 100%; overflow-x: auto; border: 1px solid rgba(0,0,0,.08); border-radius: 14px; background: #fff; }
        .expenses-data-table { width: 100%; min-width: 760px; border-collapse: separate; border-spacing: 0; table-layout: fixed; direction: rtl; }
        .expenses-data-table thead, .expenses-data-table tbody { display: table-row-group !important; }
        .expenses-data-table tr { display: table-row !important; }
        .expenses-data-table th, .expenses-data-table td { display: table-cell !important; box-sizing: border-box; padding: 13px 12px; vertical-align: middle; text-align: right; white-space: nowrap; }
        .expenses-data-table th { background: #f7f8fc; font-weight: 800; border-bottom: 1px solid rgba(0,0,0,.08); }
        .expenses-data-table td { border-bottom: 1px solid rgba(0,0,0,.06); }
        .expenses-data-table th:nth-child(1), .expenses-data-table td:nth-child(1) { width: 130px; }
        .expenses-data-table th:nth-child(2), .expenses-data-table td:nth-child(2) { width: 280px; white-space: normal; }
        .expenses-data-table th:nth-child(3), .expenses-data-table td:nth-child(3) { width: 130px; }
        .expenses-data-table th:nth-child(4), .expenses-data-table td:nth-child(4) { width: 160px; }
        .expenses-data-table th:nth-child(5), .expenses-data-table td:nth-child(5) { width: 150px; }
        .expenses-data-row { cursor: pointer; }
        .expenses-data-row:hover { background: rgba(76, 88, 220, .05); }
        .expenses-data-table td small { display: block; margin-top: 3px; opacity: .65; font-size: 12px; }
        .expense-column-head { display: flex; align-items: center; justify-content: flex-start; gap: 6px; }
        .expense-column-filter { position: relative; display: inline-block; vertical-align: middle; }
        .expense-filter-toggle { border: 0; background: transparent; cursor: pointer; font: inherit; font-size: 15px; line-height: 1; padding: 4px 6px; border-radius: 6px; color: inherit; opacity: .75; }
        .expense-filter-toggle:hover { background: rgba(0,0,0,.06); opacity: 1; }
        .expense-column-filter.active .expense-filter-toggle { opacity: 1; font-weight: 800; }
        .expense-filter-menu { position: absolute; z-index: 100; top: calc(100% + 6px); right: 0; min-width: 170px; max-width: 240px; max-height: 240px; overflow-y: auto; overflow-x: hidden; padding: 6px; border: 1px solid rgba(0,0,0,.12); border-radius: 10px; background: #fff; box-shadow: 0 8px 24px rgba(0,0,0,.16); }
        .expense-filter-menu button { display: block; width: 100%; border: 0; background: transparent; text-align: right; padding: 8px 10px; border-radius: 7px; cursor: pointer; font: inherit; white-space: nowrap; }
        .expense-filter-menu button:hover { background: #f1f3fa; }
        .credit-import-box { padding: 18px; border: 1px dashed rgba(0,0,0,.18); border-radius: 16px; margin-bottom: 16px; }
        .file-picker { display: inline-flex; align-items: center; gap: 10px; padding: 12px 16px; border-radius: 10px; background: #eef0ff; cursor: pointer; font-weight: 700; }
        .file-picker input { display: none; }
        .import-file-name { margin-top: 12px; }
        .import-loading { margin: 12px 0; padding: 12px; border-radius: 10px; background: #f3f5fb; }
        .success-box { margin: 12px 0; padding: 12px; border-radius: 10px; background: #eaf8ef; }
        .import-summary { display: flex; flex-wrap: wrap; gap: 18px; margin: 16px 0 10px; }
        .import-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
        .credit-import-table-wrap { overflow-x: auto; border: 1px solid rgba(0,0,0,.08); border-radius: 12px; }
        .credit-import-table { width: 100%; min-width: 900px; border-collapse: collapse; }
        .credit-import-table th, .credit-import-table td { padding: 10px; border-bottom: 1px solid rgba(0,0,0,.06); text-align: right; white-space: nowrap; }
        .credit-import-table th { background: #f7f8fc; }
        .credit-import-table select { min-width: 120px; }
        .duplicate-row { opacity: .55; background: #fff8f8; }
        .ignored-row { opacity: .45; }
        @media (max-width: 700px) {
          .expenses-data-table { min-width: 760px; }
          .import-actions { align-items: flex-start; flex-direction: column; }
        }
        @media (max-width: 520px) {
          .payment-summary-head { align-items: flex-start; flex-direction: column; }
          .expenses-data-table .expense-column-head { align-items: flex-start; }
        }
      `}</style>
    </main>
  );
}

function HousingForecastView({
  commitments,
  error,
  state,
  forecast,
  changePoints,
  forecastMonths,
  setForecastMonths,
  forecastStart,
  setForecastStart,
  scenarios,
  setScenarios,
  selectedLoan,
  setSelectedLoan,
  onRefresh,
}) {
  const [selectedChange, setSelectedChange] = useState(null);
  const [balanceTarget, setBalanceTarget] = useState("");
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [housingSubTab, setHousingSubTab] = useState("summary");
  const todayMonth = monthKey();

  const grouped = useMemo(() => ({
    mortgage: sortCommitmentsByEndDate((commitments || []).filter((c) => commitmentTypeValue(c) === "mortgage")),
    loan: sortCommitmentsByEndDate((commitments || []).filter((c) => commitmentTypeValue(c) === "loan")),
    other: sortCommitmentsByEndDate((commitments || []).filter((c) => commitmentTypeValue(c) === "other")),
  }), [commitments]);

  const targetOptions = useMemo(() => {
    const dates = new Set([todayMonth]);
    // Useful future checkpoints are generated only when they are within the
    // forecast horizon or before the latest known commitment end date. They are
    // display checkpoints, not new financial data.
    const latestKnownEnd = (commitments || [])
      .map((c) => normalizeDateMonth(c.end_date))
      .filter(Boolean)
      .sort()
      .at(-1) || "2050-12";
    ["2026-12", "2030-12", "2035-12", "2040-12", "2045-12", "2050-12"].forEach((m) => {
      if (m >= todayMonth && m <= latestKnownEnd) dates.add(m);
    });
    (commitments || []).forEach((c) => {
      if (c.end_date) dates.add(normalizeDateMonth(c.end_date));
      if (c.next_rate_change) dates.add(normalizeDateMonth(c.next_rate_change));
    });
    return [...dates].filter(Boolean).sort().filter((m) => monthsBetween(todayMonth, m) >= 0);
  }, [commitments, todayMonth]);

  useEffect(() => {
    if (!balanceTarget || !targetOptions.includes(balanceTarget)) setBalanceTarget(targetOptions[0] || todayMonth);
  }, [balanceTarget, targetOptions, todayMonth]);

  const balanceForecast = useMemo(() => {
    if (!balanceTarget) return null;
    const monthsToTarget = monthsBetween(forecastStart, balanceTarget);
    if (monthsToTarget < 0) return null;
    return calculateHousingForecast(commitments, forecastStart, Math.max(forecastMonths, monthsToTarget + 1), scenarios);
  }, [balanceTarget, commitments, forecastStart, forecastMonths, scenarios]);

  const balanceAtTarget = useMemo(() => {
    if (!balanceTarget || !balanceForecast) return null;
    const monthsToTarget = monthsBetween(forecastStart, balanceTarget);
    const row = balanceForecast.byMonth?.[monthsToTarget];
    if (!row) return null;
    const result = {};
    ["mortgage", "loan", "other"].forEach((type) => {
      const rows = row.commitments.filter((x) => x.type === type);
      const known = rows.every((x) => x.balanceKnown);
      result[type] = { known, value: known ? rows.reduce((sum, x) => sum + Number(x.balance || 0), 0) : null };
    });
    const allKnown = ["mortgage", "loan", "other"].every((type) => result[type].known);
    result.total = { known: allKnown, value: allKnown ? result.mortgage.value + result.loan.value + result.other.value : null };
    return result;
  }, [balanceTarget, balanceForecast, forecastStart]);

  const graph = useMemo(() => {
    const rows = forecast.byMonth || [];
    if (!rows.length) return { width: 900, height: 290, pad: { left: 58, right: 18, top: 28, bottom: 48 }, plotW: 824, plotH: 214, max: 1, min: 0, points: [] };

    // הגרף מציג רק שינויים שאפשר לדעת בוודאות מהנתונים הקיימים:
    // היום + סיום התחייבות, שאחריו התשלום החודשי שלה יורד לאפס.
    // שינוי ריבית עתידי ללא ריבית עתידית ידועה אינו מוריד את ההחזר לאפס
    // ואינו מוכנס לגרף המספרי. הוא נשאר ברשימת "השינויים הצפויים".
    const startMonth = todayMonth;
    const startDate = new Date(`${startMonth}-01T00:00:00`);
    const now = new Date();
    const todayPointDate = now.getFullYear() === Number(startMonth.slice(0, 4)) && now.getMonth() + 1 === Number(startMonth.slice(5, 7))
      ? now
      : startDate;

    const endCandidates = (commitments || [])
      .map((c) => normalizeDateMonth(c.end_date))
      .filter(Boolean)
      .sort();
    const latestEndMonth = endCandidates[endCandidates.length - 1] || shiftMonth(startMonth, forecastMonths - 1);
    const requestedEndMonth = shiftMonth(startMonth, Math.max(Number(forecastMonths || 1) - 1, 0));
    const graphEndMonth = latestEndMonth > requestedEndMonth ? latestEndMonth : requestedEndMonth;
    const endDate = new Date(`${graphEndMonth}-28T00:00:00`);
    endDate.setMonth(endDate.getMonth() + 1, 0);

    const points = [{
      month: startMonth,
      date: todayKey(todayPointDate),
      payment: Number(state.totalPayment || 0),
      graphType: "today",
      cp: null,
    }];

    // כל התחייבות יוצרת נקודת שינוי בחודש שאחרי תאריך הסיום שלה.
    // אם כמה התחייבויות מסתיימות באותו חודש, הן מאוחדות לנקודה אחת.
    const endEvents = new Map();
    (commitments || []).forEach((c) => {
      const endMonth = normalizeDateMonth(c.end_date);
      if (!endMonth || endMonth < startMonth) return;
      const changeMonth = shiftMonth(endMonth, 1);
      const changeDate = `${changeMonth}-01`;
      if (changeMonth > graphEndMonth) return;
      const existing = endEvents.get(changeDate) || {
        id: `graph-${changeDate}`,
        month: changeMonth,
        date: changeDate,
        beforePayment: null,
        afterPayment: null,
        delta: 0,
        knownAfter: true,
        commitments: [],
        reason: "התחייבות הסתיימה",
      };
      const payment = commitmentPayment(c);
      existing.beforePayment = Number(existing.beforePayment || 0) + payment;
      existing.afterPayment = null;
      existing.delta = Number(existing.delta || 0) - payment;
      existing.commitments.push({
        id: c.id,
        name: c.name,
        type: commitmentTypeValue(c),
        payment,
        paymentKnown: true,
        reason: "התחייבות הסתיימה",
      });
      endEvents.set(changeDate, existing);
    });

    // Build the actual step values from today's payment minus payments that
    // have already ended. This deliberately avoids treating an unknown future
    // rate as zero.
    const orderedEvents = [...endEvents.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    let runningPayment = Number(state.totalPayment || 0);
    orderedEvents.forEach((event) => {
      const endedPayment = event.commitments.reduce((sum, x) => sum + Number(x.payment || 0), 0);
      event.beforePayment = runningPayment;
      runningPayment = Math.max(0, runningPayment - endedPayment);
      event.afterPayment = runningPayment;
      event.delta = runningPayment - event.beforePayment;
      event.knownAfter = true;
      points.push({
        month: event.month,
        date: event.date,
        payment: runningPayment,
        graphType: "change",
        changePoint: event,
      });
    });

    const unique = [...new Map(points.map((p) => [p.date, p])).values()]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const knownValues = unique.map((p) => Number(p.payment)).filter(Number.isFinite);
    const max = Math.max(...knownValues, Number(state.totalPayment || 0), 1);
    const min = 0;
    const span = Math.max(max - min, 1);
    const width = 900, height = 290, pad = { left: 58, right: 18, top: 28, bottom: 48 };
    const plotW = width - pad.left - pad.right, plotH = height - pad.top - pad.bottom;
    const graphRight = width - pad.right;
    const totalMs = Math.max(endDate.getTime() - todayPointDate.getTime(), 1);
    const x = (date) => graphRight - ((new Date(`${date}T00:00:00`).getTime() - todayPointDate.getTime()) / totalMs) * plotW;
    const y = (v) => pad.top + ((max - Number(v)) / span) * plotH;

    return {
      width,
      height,
      pad,
      plotW,
      plotH,
      max,
      min,
      x,
      y,
      points: unique.map((point) => ({ ...point, x: x(point.date), y: y(point.payment), cp: point.changePoint || null })),
    };
  }, [commitments, forecast, state.totalPayment, todayMonth, forecastMonths]);

  const selectedTooltip = hoveredPoint || (selectedChange ? changePoints.find((x) => x.id === selectedChange) : null);
  const fmtDelta = (d) => d == null ? "לא ניתן לחישוב" : `${d > 0 ? "+" : ""}${money(d)}`;
  function updateScenario(id, key, value) {
    setScenarios((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [key]: value } }));
  }

  const renderCommitmentCards = (type) => {
    const list = sortCommitmentsByEndDate(grouped[type] || []);
    if (!list.length) return <div className="housing-empty">אין כרגע {commitmentTypePlural(type)} בנתונים הקיימים.</div>;
    return <div className="housing-commitment-list">{list.map((c) => (
      <div key={c.id} className="housing-commitment-card">
        <div className="housing-commitment-card-top"><div><strong>{c.name || "ללא שם"}</strong><span className="housing-type-badge">{commitmentTypeLabel(c)}</span></div><strong>{money(commitmentPayment(c))}</strong></div>
        <div className="housing-commitment-card-meta">יתרה {money(commitmentBalance(c))} · ריבית {c.interest_rate != null ? `${Number(c.interest_rate).toFixed(3)}%` : "לא ידועה"} · סיום {c.end_date ? dateText(c.end_date) : "לא ידוע"}</div>
      </div>
    ))}</div>;
  };

  const renderScenarioCards = (list) => <div className="loan-card-list">{sortCommitmentsByEndDate(list).map((loan) => {
    const scenario = scenarios[loan.id] || {};
    return <div key={loan.id} className={`loan-card ${selectedLoan === loan.id ? "selected" : ""}`} onClick={() => setSelectedLoan(loan.id)}>
      <div className="loan-card-top"><strong>{loan.name}</strong><strong>{money(loan.current_balance)}</strong></div>
      <div className="loan-card-meta">{commitmentTypeLabel(loan)} · תשלום נוכחי {money(loan.current_payment)} · שינוי ריבית {loan.next_rate_change ? dateText(loan.next_rate_change) : "לא מוגדר"}</div>
      {selectedLoan === loan.id && <div className="scenario-grid" style={{marginTop:12}} onClick={(e) => e.stopPropagation()}>
        <label>ריבית אחרי שינוי<input type="number" min="0" max="30" step="0.01" value={scenario.rate ?? ""} onChange={(e) => updateScenario(loan.id,"rate",e.target.value)} placeholder={loan.interest_rate != null ? String(loan.interest_rate) : "לדוגמה 4.25"} /></label>
        <label>או תשלום חודשי<input type="number" min="0" step="1" value={scenario.payment ?? ""} onChange={(e) => updateScenario(loan.id,"payment",e.target.value)} placeholder="אופציונלי" /></label>
      </div>}
    </div>;
  })}</div>;

  return (
    <section className="panel housing-panel">
      <div className="panel-head">
        <div><h2>🏠 דיור ומשכנתא</h2><p>מצב קיים, תחזית, שינויים עתידיים ויתרות לפי תאריך.</p></div>
        <button className="ghost" onClick={onRefresh}>רענון</button>
      </div>
      {error && <div className="error">{error}</div>}

      <section className="housing-summary-main">
        <div className="housing-total-card"><span>סה״כ החזר חודשי</span><strong>{money(state.totalPayment)}</strong><small>משכנתאות + הלוואות + התחייבויות נוספות</small></div>
        <div className="housing-two-cards">
          <div className="housing-mini-card"><span>משכנתאות · {grouped.mortgage.length}</span><strong>{money(state.mortgagePayment)}</strong></div>
          <div className="housing-mini-card"><span>הלוואות · {grouped.loan.length}</span><strong>{money(state.loanPayment)}</strong></div>
          <div className="housing-mini-card"><span>התחייבויות נוספות · {grouped.other.length}</span><strong>{money(grouped.other.reduce((s,c)=>s+commitmentPayment(c),0))}</strong></div>
        </div>
      </section>

      <nav className="housing-subtabs" aria-label="תתי עמודים בדיור ומשכנתא">
        {[['summary','סיכום'],['mortgage','משכנתאות'],['loan','הלוואות'],['other','התחייבויות נוספות']].map(([id,label]) => (
          <button key={id} className={housingSubTab === id ? 'housing-subtab active' : 'housing-subtab'} onClick={() => setHousingSubTab(id)}>{label}<span>{id==='summary' ? '' : ` ${grouped[id].length}`}</span></button>
        ))}
      </nav>

      {housingSubTab === 'mortgage' && <>
        <section className="housing-section-card"><div className="housing-section-head"><div><h3>🏠 משכנתאות</h3><p>כל מסלולי המשכנתא הקיימים במערכת.</p></div></div>{renderCommitmentCards('mortgage')}</section>
        <section className="housing-section-card"><div className="housing-section-head"><div><h3>📉 תחזית המשכנתאות</h3><p>התחזית מבוססת רק על הנתונים הקיימים.</p></div></div>{renderScenarioCards(grouped.mortgage)}</section>
      </>}

      {housingSubTab === 'loan' && <>
        <section className="housing-section-card"><div className="housing-section-head"><div><h3>💳 הלוואות</h3><p>הלוואות שאינן מסלולי משכנתא.</p></div></div>{renderCommitmentCards('loan')}</section>
        <section className="housing-section-card"><div className="housing-section-head"><div><h3>📉 תחזית ההלוואות</h3><p>התחזית מוצגת בנפרד מהמשכנתאות.</p></div></div>{renderScenarioCards(grouped.loan)}</section>
      </>}

      {housingSubTab === 'other' && <section className="housing-section-card"><div className="housing-section-head"><div><h3>📌 התחייבויות נוספות</h3><p>התחייבויות שאינן מסווגות כמשכנתא או הלוואה.</p></div></div>{renderCommitmentCards('other')}</section>}

      {housingSubTab === 'summary' && <>
        <section className="housing-section-card housing-forecast-card">
          <div className="housing-section-head">
            <div><h3>📉 החזר חודשי צפוי</h3><p>הזמן מתקדם מימין לשמאל · מוצגות רק נקודות שינוי משמעותיות</p></div>
            <div className="forecast-current-badge"><span>היום</span><strong>{money(state.totalPayment)}</strong></div>
          </div>
          <div className="forecast-controls compact housing-forecast-controls">
            <label>מתחיל מ־<input type="month" value={forecastStart} onChange={(e) => setForecastStart(e.target.value)} /></label>
            <label>טווח<select value={forecastMonths} onChange={(e) => setForecastMonths(Number(e.target.value))}><option value={24}>24 חודשים</option><option value={36}>3 שנים</option><option value={60}>5 שנים</option><option value={120}>10 שנים</option><option value={240}>20 שנים</option><option value={360}>30 שנים</option></select></label>
          </div>
          <div className="forecast-type-legend"><span><i className="legend-dot mortgage"></i>משכנתאות {money(state.mortgagePayment)}</span><span><i className="legend-dot loan"></i>הלוואות {money(state.loanPayment)}</span>{state.otherPayment > 0 && <span><i className="legend-dot other"></i>אחרות {money(state.otherPayment)}</span>}</div>
          {selectedTooltip && <div className="housing-chart-tooltip"><div><strong>{monthLabel(selectedTooltip.month)}</strong></div><div>לפני: <strong>{selectedTooltip.beforePayment == null ? "לא ידוע" : money(selectedTooltip.beforePayment)}</strong> · אחרי: <strong>{selectedTooltip.knownAfter ? money(selectedTooltip.afterPayment) : "לא ניתן לחישוב"}</strong> · שינוי: <strong>{fmtDelta(selectedTooltip.delta)}</strong></div>{selectedTooltip.commitments?.length > 0 && <div>התחייבות: <strong>{selectedTooltip.commitments.map((x) => x.name).join(" · ")}</strong></div>}<div className="muted">{selectedTooltip.reason || "סיבה לא ידועה"}</div></div>}
          <div className="housing-chart-wrap"><svg className="housing-chart" viewBox={`0 0 ${graph.width} ${graph.height}`} role="img" aria-label="גרף החזר חודשי צפוי">
            {[0, .25, .5, .75, 1].map((p) => { const yy = graph.pad.top + p * graph.plotH; const val = graph.max - p * (graph.max - graph.min); return <g key={p}><line className="housing-chart-grid" x1={graph.pad.left} x2={graph.width-graph.pad.right} y1={yy} y2={yy}/><text className="housing-chart-label" x={graph.pad.left-7} y={yy+4} textAnchor="end">{money(val)}</text></g>; })}
            <line className="housing-chart-axis" x1={graph.pad.left} x2={graph.width-graph.pad.right} y1={graph.height-graph.pad.bottom} y2={graph.height-graph.pad.bottom}/>
            {graph.points.length > 1 && graph.points.slice(0, -1).map((point, idx) => {
              const next = graph.points[idx + 1];
              const jump = Number(point.payment) !== Number(next.payment) || Boolean(next.cp);
              return <g key={`segment-${point.date}`}>
                <line className="housing-chart-line" x1={point.x} y1={point.y} x2={next.x} y2={point.y} />
                {jump && <line className="housing-chart-line" x1={next.x} y1={point.y} x2={next.x} y2={next.y} />}
              </g>;
            })}
            {graph.points.map((point, idx) => {
              const cp = point.cp;
              const isToday = idx === 0;
              const isUnknown = point.graphType === "unknown";
              return <g key={point.month}>
                {cp && <line className="housing-chart-unknown" x1={point.x} x2={point.x} y1={graph.pad.top} y2={graph.height-graph.pad.bottom}/>}
                <circle className={`housing-chart-point ${isToday ? "today" : "change"} ${isUnknown ? "unknown" : ""}`} cx={point.x} cy={point.y} r={isToday ? 7 : 6}
                  onMouseEnter={() => cp && setHoveredPoint(cp)} onMouseLeave={() => setHoveredPoint(null)}
                  onClick={() => cp && setSelectedChange(cp.id)} />
                <text className="housing-chart-value" x={point.x} y={point.y-12} textAnchor="middle">{isToday ? "היום" : dateText(point.date)}</text>
              </g>;
            })}
          </svg></div>
          <div className="housing-legend">כל נקודה בגרף מייצגת את היום או תאריך שבו ההחזר החודשי משתנה. הקו מתקדם מימין לשמאל; קו מקווקו מסמן שינוי שהסכום החדש שלו אינו ניתן לחישוב מהנתונים הקיימים.</div>
        </section>

        <section className="housing-section-card"><div className="housing-section-head"><div><h3>📅 השינויים הצפויים בהחזר</h3><p>רשימה כרונולוגית של נקודות שבהן התשלום משתנה או צפוי להשתנות.</p></div></div>{changePoints.length ? <div className="housing-changes">{changePoints.map((cp) => <div key={cp.id} className={`housing-change-card ${selectedChange === cp.id ? "selected" : ""}`} onClick={() => setSelectedChange(cp.id)}><div className="housing-change-top"><div className="housing-change-date">{dateText(`${cp.month}-01`)}</div><div className={`housing-change-delta ${cp.delta != null && cp.delta < 0 ? "down" : cp.delta > 0 ? "up" : ""}`}>{fmtDelta(cp.delta)}</div></div><div className="housing-change-grid"><div><span>לפני</span><strong>{cp.beforePayment == null ? "לא ידוע" : money(cp.beforePayment)}</strong></div><div><span>אחרי</span><strong>{cp.knownAfter ? money(cp.afterPayment) : "לא ניתן לחישוב"}</strong></div><div><span>סטטוס</span><strong>{cp.knownAfter ? "מחושב" : "צפוי שינוי"}</strong></div></div><div className="housing-change-reason">{cp.reason || "סיבה לא ידועה"}</div>{cp.commitments?.length > 0 && <div className="housing-change-commitments">{cp.commitments.map((x) => <span className="housing-change-chip" key={x.id}>{x.name}</span>)}</div>}</div>)}</div> : <div className="housing-empty">לא זוהו כרגע נקודות שינוי בטווח התחזית.</div>}</section>

        <section className="housing-section-card"><div className="housing-section-head"><div><h3>📊 יתרות לפי תאריך</h3><p>בחרי תאריך וקבלי יתרות עתידיות לפי סוג התחייבות.</p></div></div><div className="housing-balance-grid"><div className="housing-balance-select"><label>תאריך יעד</label><select value={balanceTarget} onChange={(e) => setBalanceTarget(e.target.value)}>{targetOptions.map((m) => <option key={m} value={m}>{dateText(`${m}-01`)}</option>)}</select></div></div>{balanceAtTarget && <div className="housing-balance-cards" style={{marginTop:12}}>{[['mortgage','יתרת משכנתאות צפויה'],['loan','יתרת הלוואות צפויה'],['other','יתרת התחייבויות נוספות'],['total','סה״כ חוב צפוי בתאריך']].map(([key,label]) => <div key={key} className={`housing-balance-card ${balanceAtTarget[key].known === false ? 'unknown' : ''}`}><span>{label}</span><strong>{balanceAtTarget[key].known ? money(balanceAtTarget[key].value) : 'לא ניתן לחישוב'}</strong></div>)}</div>}</section>
      </>}

      <div className="housing-forecast-note"><strong>חשוב:</strong> התחזית היא לתצוגה בלבד. היא אינה יוצרת טרנזקציות, הוצאות או הכנסות ואינה משנה את התקציב או נתונים ב-Supabase. כאשר נתון עתידי חסר, המערכת מציגה במפורש שלא ניתן לחשב את הסכום.</div>
    </section>
  );
}

function Stat({ title, value, subtitle, tone = "" }) {
  return <div className="stat"><span>{title}</span><strong className={tone}>{value}</strong>{subtitle && <small>{subtitle}</small>}</div>;
}

function Panel({ title, children }) {
  return <section className="panel"><div className="panel-head"><h2>{title}</h2></div>{children}</section>;
}

function Empty({ text }) {
  return <div className="empty">{text}</div>;
}

function Bars({ data }) {
  const max = Math.max(...data.map((x) => x.value), 1);
  return (
    <div className="chart-list">
      {data.map((x) => (
        <div className="chart-row" key={x.label}>
          <div className="chart-label">{x.label}</div>
          <div className="chart-track"><div className="chart-bar" style={{ width: `${(x.value / max) * 100}%` }} /></div>
          <strong>{money(x.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function paymentMethodLabel(tx) {
  const method = tx.payment_method || "other";
  if (method === "credit_card") {
    const provider = {
      isracard: "ישראכרט",
      cal: "כאל",
      max: "MAX",
      flycard: "Fly Card",
      other: "אשראי",
    }[tx.credit_card_provider] || "אשראי";
    return tx.credit_card_last4 ? `${provider} •••• ${tx.credit_card_last4}` : provider;
  }
  return {
    direct_debit: "הוראת קבע",
    standing_order: "הוראת קבע",
    horaat_kava: "הוראת קבע",
    bank: "חשבון בנק",
    cash: "מזומן",
    bit: "ביט",
    paybox: "פייבוקס",
    other: "אחר",
  }[method] || "לא צוין";
}

function paymentGroupKey(tx) {
  if (tx.payment_method === "credit_card") {
    const provider = tx.credit_card_provider || "other";
    const last4 = tx.credit_card_last4 || "";
    return `card:${provider}:${last4}`;
  }
  return `method:${tx.payment_method || "other"}`;
}

function paymentGroupLabel(tx) {
  return paymentMethodLabel(tx);
}

function ExpensesView({ transactions, categoryMap, onOpen, filters, setFilters, sort, setSort, onAdd, onDelete }) {
  const [openFilter, setOpenFilter] = useState(null);

  const options = useMemo(() => ({
    date: [...new Set(transactions.map((t) => t.transaction_date).filter(Boolean))].sort((a, b) => b.localeCompare(a)),
    description: [...new Set(transactions.map((t) => t.description || "ללא תיאור"))].sort((a, b) => a.localeCompare(b, "he")),
    amount: [...new Set(transactions.map((t) => Number(t.actual_amount || 0)))].sort((a, b) => a - b),
    payment: [...new Set(transactions.map((t) => t.payment_method || "other"))],
    card: [...new Set(transactions.map(cardLast4).filter(Boolean))].sort(),
  }), [transactions]);

  const filtered = useMemo(() => transactions.filter((t) => {
    const amount = Number(t.actual_amount || 0);
    const date = String(t.transaction_date || "");
    const description = t.description || "ללא תיאור";
    const payment = t.payment_method || "other";
    const card = cardLast4(t);
    if (filters.fromDate && date < filters.fromDate) return false;
    if (filters.toDate && date > filters.toDate) return false;
    if (filters.minAmount !== "" && amount < Number(filters.minAmount)) return false;
    if (filters.maxAmount !== "" && amount > Number(filters.maxAmount)) return false;
    if (filters.paymentMethod && payment !== filters.paymentMethod) return false;
    if (filters.description && description !== filters.description) return false;
    if (filters.cardLast4 && card !== filters.cardLast4) return false;
    return true;
  }), [transactions, filters]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      let av;
      let bv;
      if (sort.key === "description") {
        av = a.description || "";
        bv = b.description || "";
      } else if (sort.key === "amount") {
        av = Number(a.actual_amount || 0);
        bv = Number(b.actual_amount || 0);
      } else if (sort.key === "payment") {
        av = paymentMethodLabel(a);
        bv = paymentMethodLabel(b);
      } else if (sort.key === "card") {
        av = cardLast4(a);
        bv = cardLast4(b);
      } else {
        av = String(a.transaction_date || "");
        bv = String(b.transaction_date || "");
      }
      const cmp = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv), "he");
      return sort.direction === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [filtered, sort]);

  const paymentSummary = useMemo(() => {
    const map = new Map();
    filtered.forEach((t) => {
      const key = paymentGroupKey(t);
      const existing = map.get(key);
      if (existing) existing.value += Number(t.actual_amount || 0);
      else map.set(key, { label: paymentGroupLabel(t), value: Number(t.actual_amount || 0) });
    });
    return [...map.values()].sort((a, b) => b.value - a.value);
  }, [filtered]);

  const total = filtered.reduce((sum, t) => sum + Number(t.actual_amount || 0), 0);

  function toggleSort(key) {
    setSort((prev) => prev.key === key
      ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
      : { key, direction: key === "date" ? "desc" : "asc" });
  }

  function sortIcon(key) {
    if (sort.key !== key) return "↕";
    return sort.direction === "asc" ? "↑" : "↓";
  }

  function setFilter(key, value) {
    setFilters((prev) => {
      if (key === "date") return { ...prev, fromDate: value, toDate: value };
      if (key === "amount") return { ...prev, minAmount: value === "" ? "" : String(value), maxAmount: value === "" ? "" : String(value) };
      if (key === "payment") return { ...prev, paymentMethod: value };
      if (key === "cardLast4") return { ...prev, cardLast4: value };
      return { ...prev, [key]: value };
    });
    setOpenFilter(null);
  }

  function filterMenu(key, items, labelFor = (x) => x) {
    const active = key === "date" ? Boolean(filters.fromDate || filters.toDate) : key === "amount" ? Boolean(filters.minAmount || filters.maxAmount) : key === "payment" ? Boolean(filters.paymentMethod) : Boolean(filters[key]);
    return (
      <div className={`expense-column-filter ${active ? "active" : ""}`}>
        <button
          type="button"
          className="expense-filter-toggle"
          title="סינון עמודה"
          aria-label="סינון עמודה"
          onClick={(e) => { e.stopPropagation(); setOpenFilter(openFilter === key ? null : key); }}
        >⌄</button>
        {openFilter === key && (
          <div className="expense-filter-menu" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setFilter(key, "")}>הכל</button>
            {items.map((item) => (
              <button type="button" key={String(item)} onClick={() => setFilter(key, item)}>{labelFor(item)}</button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div><h2>הוצאות</h2><p>{filtered.length} הוצאות · סה״כ {money(total)}</p></div>
        <button className="primary" onClick={onAdd}>＋ הוצאה</button>
      </div>

      <div className="payment-summary">
        <div className="payment-summary-head"><div><h3>הוצאות לפי אמצעי תשלום וכרטיס</h3><p>כרטיסי אשראי מסוכמים לפי חברת האשראי ו־4 הספרות האחרונות</p></div><strong>{money(total)}</strong></div>
        {paymentSummary.length ? <Bars data={paymentSummary} /> : <Empty text="אין הוצאות שתואמות לסינון." />}
      </div>

      <div className="expenses-table-wrap">
        <table className="expenses-data-table">
          <thead>
            <tr>
              <th><div className="expense-column-head"><button className="sort-head" onClick={() => toggleSort("date")}>תאריך {sortIcon("date")}</button>{filterMenu("date", options.date, dateText)}</div></th>
              <th><div className="expense-column-head"><button className="sort-head" onClick={() => toggleSort("description")}>תיאור {sortIcon("description")}</button>{filterMenu("description", options.description)}</div></th>
              <th><div className="expense-column-head"><button className="sort-head" onClick={() => toggleSort("amount")}>סכום {sortIcon("amount")}</button>{filterMenu("amount", options.amount, money)}</div></th>
              <th><div className="expense-column-head"><button className="sort-head" onClick={() => toggleSort("payment")}>אופן תשלום {sortIcon("payment")}</button>{filterMenu("payment", options.payment, (x) => paymentMethodLabel({ payment_method: x }))}</div></th>
              <th><div className="expense-column-head"><button className="sort-head" onClick={() => toggleSort("card")}>4 ספרות אחרונות {sortIcon("card")}</button>{filterMenu("cardLast4", options.card, (x) => `•••• ${x}`)}</div></th>
              <th className="expense-actions-header">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.id} onClick={() => onOpen(t)} className="expenses-data-row" title="לחצי לפתיחת פרטי ההוצאה">
                <td>{dateText(t.transaction_date)}</td>
                <td><strong>{t.description || "ללא תיאור"}</strong>{t.merchant && <small>{t.merchant}</small>}</td>
                <td className="negative"><strong>{money(t.actual_amount)}</strong></td>
                <td>{paymentMethodLabel(t)}</td>
                <td>{cardLast4(t) ? `•••• ${cardLast4(t)}` : "—"}</td>
                <td className="expense-actions-cell">
                  <button className="icon danger" onClick={(e) => { e.stopPropagation(); onDelete(t); }} title="מחיקת הוצאה">×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!sorted.length && <Empty text="אין הוצאות שתואמות לסינון." />}
      </div>
    </section>
  );
}



function normalizeCsvHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/[\s_\-./()]+/g, "");
}

function detectCsvDelimiter(text) {
  const first = String(text || "").split(/\r?\n/).find((x) => x.trim()) || "";
  const count = (d) => first.split(d).length - 1;
  const counts = [",", ";", "\t"].map((d) => ({ d, n: count(d) }));
  return counts.sort((a, b) => b.n - a.n)[0]?.d || ",";
}

function parseCsvMatrix(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (quoted && next === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      row.push(cell.trim()); cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell.trim()); cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

function csvColumn(headers, aliases) {
  const normalized = headers.map(normalizeCsvHeader);
  for (const alias of aliases) {
    const wanted = normalizeCsvHeader(alias);
    const exact = normalized.indexOf(wanted);
    if (exact >= 0) return exact;
  }
  const partial = normalized.findIndex((h) => aliases.some((a) => h.includes(normalizeCsvHeader(a)) || normalizeCsvHeader(a).includes(h)));
  return partial >= 0 ? partial : -1;
}

function parseCreditAmount(value) {
  let s = String(value ?? "").trim();
  if (!s) return null;
  const negative = /^\s*\(.*\)\s*$/.test(s) || s.includes("-");
  s = s.replace(/[₪$€£]/g, "").replace(/\s/g, "").replace(/[()]/g, "");
  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (s.includes(",")) {
    const parts = s.split(",");
    s = parts.length === 2 && parts[1].length <= 2 ? parts[0] + "." + parts[1] : parts.join("");
  }
  const n = Number(s.replace(/[^0-9.\-]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) * (negative ? -1 : 1);
}

function parseCreditDate(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    return `${y}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return "";
}

function detectCreditProvider(fileName, headers, text) {
  const hay = `${fileName} ${headers.join(" ")} ${String(text).slice(0, 3000)}`.toLowerCase();
  if (hay.includes("ישראכרט") || hay.includes("isracard")) return "isracard";
  if (hay.includes("כאל") || hay.includes("cal") || hay.includes("cardcal")) return "cal";
  if (hay.includes("max")) return "max";
  return "other";
}

function providerLabel(value) {
  return { isracard: "ישראכרט", cal: "כאל", max: "MAX", other: "לא זוהה" }[value] || "לא זוהה";
}

function guessCategoryId(text, categories) {
  const s = String(text || "").toLowerCase();
  const rules = [
    [["שופרסל", "רמי לוי", "ויקטורי", "יינות ביתן", "מגה", "סופר", "market", "wolt market", "carrefour", "am:pm"], ["מזון", "סופר"]],
    [["דלק", "sonol", "paz", "dor alon", "delek", "fuel"], ["רכב", "דלק"]],
    [["מסעד", "restaurant", "cafe", "coffee", "פיצה", "סושי", "wolt", "תן ביס", "10bis"], ["מסעדות", "אוכל בחוץ"]],
    [["amazon", "aliexpress", "shein", "terminal x", "shopping"], ["קניות", "שונות"]],
    [["netflix", "spotify", "disney", "youtube", "apple.com", "google", "subscription"], ["מנויים", "בילויים"]],
    [["bezeq", "hot", "cellcom", "partner", "pelephone", "internet"], ["תקשורת", "חשבונות"]],
    [["pharmacy", "super-pharm", "סופר פארם", "רופא", "clinic", "medical"], ["בריאות", "בריאות ורפואה"]],
  ];
  for (const [keywords, names] of rules) {
    if (!keywords.some((k) => s.includes(k.toLowerCase()))) continue;
    const c = categories.find((x) => names.some((n) => String(x.name || "").toLowerCase().includes(n.toLowerCase())));
    if (c) return c.id;
  }
  return "";
}

function creditRowLooksIgnored(description, status) {
  const s = `${description || ""} ${status || ""}`.toLowerCase();
  return !description || /סה.?כ|total|סכום כולל|יתרה|balance|זיכוי עתידי|מסגרת|credit limit|תאריך הפקה|עמלות חודשיות/.test(s);
}

function creditRowLooksRecurring(description, status) {
  const s = `${description || ""} ${status || ""}`.toLowerCase();
  return /הוראת קבע|עסקה מתמשכת|מנוי|חודשי|recurring|subscription|standing order|direct debit/.test(s);
}

function creditDuplicateKey(row) {
  const date = String(row.transaction_date || row.date || "");
  const amount = Number(row.actual_amount ?? row.amount ?? 0).toFixed(2);
  const provider = String(row.credit_card_provider ?? row.provider ?? "").toLowerCase();
  const last4 = String(row.credit_card_last4 ?? row.last4 ?? "").slice(-4);
  const merchant = String(row.merchant || row.description || "").trim().toLowerCase().replace(/\s+/g, " ");
  return [date, amount, provider, last4, merchant].join("|");
}

function cardLast4(tx) {
  return tx.payment_method === "credit_card" && tx.credit_card_last4 ? String(tx.credit_card_last4).slice(-4) : "";
}

function parseCreditCsv(text, fileName) {
  const delimiter = detectCsvDelimiter(text);
  const matrix = parseCsvMatrix(text, delimiter);
  if (matrix.length < 2) return { provider: "other", rows: [] };
  const headers = matrix[0];
  const dateCol = csvColumn(headers, ["תאריך חיוב", "תאריך עסקה", "תאריך עסקה/חיוב", "תאריך", "transaction date", "purchase date", "date"]);
  const merchantCol = csvColumn(headers, ["שם בית העסק", "בית עסק", "שם העסק", "תיאור", "merchant", "description", "business name"]);
  const chargeCol = csvColumn(headers, ["סכום חיוב", "סכום לחיוב", "חיוב", "charge amount", "charged amount", "amount charged", "debit"]);
  const purchaseCol = csvColumn(headers, ["סכום עסקה", "סכום העסקה", "purchase amount", "transaction amount", "amount"]);
  const categoryCol = csvColumn(headers, ["קטגוריה", "category"]);
  const last4Col = csvColumn(headers, ["4 ספרות", "4 ספרות אחרונות", "מספר כרטיס", "כרטיס", "last 4", "last4", "card number"]);
  const providerCol = csvColumn(headers, ["חברת אשראי", "מנפיק", "issuer", "card provider", "provider"]);
  const statusCol = csvColumn(headers, ["סטטוס", "status", "סוג עסקה", "transaction type"]);
  const provider = detectCreditProvider(fileName, headers, text);
  const fileLast4 = String(fileName).match(/(?:^|[^0-9])(\d{4})(?:[^0-9]|$)/)?.[1] || "";

  const rows = matrix.slice(1).map((cells) => {
    const rawDate = dateCol >= 0 ? cells[dateCol] : "";
    const date = parseCreditDate(rawDate);
    const description = merchantCol >= 0 ? String(cells[merchantCol] || "").trim() : "";
    const charge = chargeCol >= 0 ? parseCreditAmount(cells[chargeCol]) : null;
    const purchase = purchaseCol >= 0 ? parseCreditAmount(cells[purchaseCol]) : null;
    const amount = charge !== null ? charge : purchase;
    const status = statusCol >= 0 ? String(cells[statusCol] || "").trim() : "";
    const last4 = (last4Col >= 0 ? String(cells[last4Col] || "") : "").replace(/\D/g, "").slice(-4) || fileLast4;
    const providerCell = providerCol >= 0 ? String(cells[providerCol] || "").toLowerCase() : "";
    const rowProvider = providerCell.includes("ישראכרט") || providerCell.includes("isracard") ? "isracard" : providerCell.includes("כאל") || providerCell.includes("cal") ? "cal" : providerCell.includes("max") ? "max" : provider;
    const ignored = creditRowLooksIgnored(description, status) || !date || amount === null || amount <= 0;
    return {
      date,
      description,
      merchant: description,
      amount: amount === null ? 0 : Math.abs(amount),
      provider: rowProvider,
      last4,
      sourceCategory: categoryCol >= 0 ? String(cells[categoryCol] || "").trim() : "",
      recurring: creditRowLooksRecurring(description, status),
      ignored,
    };
  }).filter((r) => r.description || r.date || r.amount);

  return { provider, rows };
}

function CreditImportView({ rows, fileName, provider, loading, error, result, categories, onFile, onImport, onRows }) {
  const ready = rows.filter((r) => r.selected && !r.duplicate && !r.ignored).length;
  const duplicates = rows.filter((r) => r.duplicate).length;
  const ignored = rows.filter((r) => r.ignored).length;

  function updateRow(id, patch) {
    onRows(rows.map((r) => r.id === id ? { ...r, ...patch } : r));
  }

  function toggleAll(checked) {
    onRows(rows.map((r) => ({ ...r, selected: checked && !r.duplicate && !r.ignored })));
  }

  return (
    <section className="panel credit-import-panel">
      <div className="panel-head">
        <div><h2>יבוא אשראי</h2><p>ייבוא עסקאות מישראכרט, כאל או MAX מתוך קובץ CSV</p></div>
      </div>

      <div className="credit-import-box">
        <label className="file-picker">בחירת קובץ CSV<input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} /></label>
        {fileName && <div className="import-file-name">קובץ: <strong>{fileName}</strong> · חברת אשראי: <strong>{providerLabel(provider)}</strong></div>}
        <p className="muted">המערכת משתמשת ב־<strong>סכום חיוב</strong> כאשר הוא קיים, מזהה כפילויות לפי תאריך + בית עסק + סכום + כרטיס, ומציעה קטגוריה אוטומטית.</p>
      </div>

      {loading && <div className="import-loading">קוראת את הקובץ / מייבאת נתונים…</div>}
      {error && <div className="error">{error}</div>}
      {result && <div className="success-box">יובאו בהצלחה {result.imported} עסקאות. דולגו {result.skipped} שורות שלא נבחרו או שכבר קיימות.</div>}

      {rows.length > 0 && (
        <>
          <div className="import-summary">
            <span>סה״כ שורות: <strong>{rows.length}</strong></span>
            <span>חדשות לבחירה: <strong>{ready}</strong></span>
            <span>כפילויות: <strong>{duplicates}</strong></span>
            <span>שורות שאינן עסקאות: <strong>{ignored}</strong></span>
          </div>
          <div className="import-actions">
            <label><input type="checkbox" checked={ready > 0 && ready === rows.filter((r) => !r.duplicate && !r.ignored).length} onChange={(e) => toggleAll(e.target.checked)} /> בחירת כל העסקאות החדשות</label>
            <button className="primary" disabled={!ready || loading} onClick={onImport}>ייבוא {ready} עסקאות</button>
          </div>
          <div className="credit-import-table-wrap">
            <table className="credit-import-table">
              <thead><tr><th>ייבוא</th><th>תאריך</th><th>בית עסק</th><th>סכום חיוב</th><th>כרטיס</th><th>קטגוריה</th><th>סימון</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.duplicate ? "duplicate-row" : r.ignored ? "ignored-row" : ""}>
                    <td><input type="checkbox" checked={Boolean(r.selected)} disabled={r.duplicate || r.ignored || loading} onChange={(e) => updateRow(r.id, { selected: e.target.checked })} /></td>
                    <td>{dateText(r.date)}</td>
                    <td><strong>{r.description || "—"}</strong></td>
                    <td>{money(r.amount)}</td>
                    <td>{r.last4 ? `•••• ${r.last4}` : "—"}</td>
                    <td><select value={r.category_id || ""} onChange={(e) => updateRow(r.id, { category_id: e.target.value, category_manual: true })}><option value="">ללא קטגוריה</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td>
                    <td>{r.duplicate ? "כפילות" : r.ignored ? "לא עסקה" : r.recurring ? "עסקה חוזרת" : "חדש"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function TransactionTable({ transactions, categoryMap, memberMap, onEdit, onDelete }) {
  return (
    <div className="table-wrap">
      <table className="transactions-table">
        <thead><tr><th>תאריך</th><th>תיאור</th><th>קטגוריה</th><th>סוג</th><th>מתוכנן</th><th>בפועל</th><th>מי</th><th></th></tr></thead>
        <tbody>
          {transactions.map((t) => {
            const income = t.kind === "income";
            return (
              <tr key={t.id}>
                <td>{dateText(t.transaction_date)}</td>
                <td><strong>{t.description}</strong>{t.merchant && <small className="table-sub">{t.merchant}</small>}{t.credit_card_last4 && <small className="table-sub">•••• {t.credit_card_last4}</small>}</td>
                <td>{categoryMap[t.category_id] || "ללא קטגוריה"}</td>
                <td><span className={`badge ${income ? "success" : t.expense_type === "fixed" ? "fixed" : "variable"}`}>{income ? "הכנסה" : t.expense_type === "fixed" ? "קבועה" : "משתנה"}</span></td>
                <td>{!income && t.expense_type === "fixed" ? money(t.planned_amount) : "—"}</td>
                <td className={income ? "positive" : "negative"}>{t.actual_amount === null ? "—" : money(t.actual_amount)}</td>
                <td>{memberMap[t.person_user_id] || "לא צוין"}</td>
                <td><div className="table-actions"><button className="icon" onClick={() => onEdit(t, income ? "income" : "expense")}>✎</button><button className="icon danger" onClick={() => onDelete(t)}>×</button></div></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!transactions.length && <Empty text="אין תנועות בחודש הזה." />}
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head"><h2>{title}</h2><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
