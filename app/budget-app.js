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

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const monthKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const shiftMonth = (m, n) => {
  const [y, mo] = m.split("-").map(Number);
  return monthKey(new Date(y, mo - 1 + n, 1));
};

const dateText = (v) =>
  v
    ? new Date(`${v}T00:00:00`).toLocaleDateString("he-IL")
    : "";

const monthLabel = (m) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("he-IL", {
    month: "long",
    year: "numeric",
  });
};

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

function providerLabel(v) {
  return (
    {
      isracard: "ישראכרט",
      cal: "כאל",
      max: "MAX",
      flycard: "Fly Card",
      other: "אחר",
    }[v] || ""
  );
}

function paymentLabel(t) {
  if (t.payment_method === "credit_card") {
    const p = providerLabel(t.credit_card_provider);
    const card = t.credit_card_last4
      ? ` •••• ${t.credit_card_last4}`
      : "";
    return `כרטיס אשראי${p ? ` · ${p}` : ""}${card}`;
  }

  return (
    {
      bank: "חשבון בנק",
      direct_debit: "הוראת קבע",
      cash: "מזומן",
      bit: "ביט",
      paybox: "פייבוקס",
      other: "אחר",
    }[t.payment_method] || "לא צוין"
  );
}

function paymentKey(t) {
  if (t.payment_method === "credit_card") {
    return `card:${t.credit_card_provider || "other"}:${t.credit_card_last4 || ""}`;
  }
  return `method:${t.payment_method || "other"}`;
}

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

  useEffect(() => {
    let alive = true;

    supabase.auth.getSession().then(({ data }) => {
      if (alive) {
        setUser(data.session?.user || null);
        setLoading(false);
      }
    });

    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user || null);
    });

    return () => {
      alive = false;
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
    }
  }, [user, month]);

  async function refresh() {
    if (!user) return;

    setLoading(true);
    setError("");

    try {
      const h = await supabase.rpc("get_my_household");
      if (h.error) throw h.error;

      const hr = h.data?.[0];
      if (!hr) {
        setHousehold(null);
        return;
      }

      const householdId = hr.household_id;

      const [members, cats, tx, rec] = await Promise.all([
        supabase.rpc("get_my_household_members"),
        supabase
          .from("categories")
          .select("*")
          .eq("household_id", householdId)
          .order("name"),
        supabase
          .from("transactions")
          .select("*")
          .eq("household_id", householdId)
          .gte("transaction_date", `${month}-01`)
          .lt("transaction_date", `${shiftMonth(month, 1)}-01`)
          .order("transaction_date", { ascending: false })
          .order("created_at", { ascending: false })
          .range(0, 4999),
        supabase
          .from("recurring_expenses")
          .select("*")
          .eq("household_id", householdId)
          .eq("is_active", true)
          .order("day_of_month")
          .order("name"),
      ]);

      if (members.error) console.error(members.error);
      if (cats.error) console.error(cats.error);
      if (tx.error) console.error(tx.error);
      if (rec.error) console.error(rec.error);

      setHousehold({
        id: householdId,
        name: hr.household_name,
      });

      setProfiles(
        (members.data || []).map((x) => ({
          id: x.user_id,
          display_name: x.display_name || "ללא שם",
          role: x.role,
        }))
      );

      setCategories(cats.data || []);
      setTransactions(tx.data || []);
      setRecurring(rec.data || []);
    } catch (e) {
      console.error(e);
      setError(e.message || "שגיאה בטעינת הנתונים");
    } finally {
      setLoading(false);
    }
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

    const kind = modal === "income" ? "income" : "expense";
    const f = txForm;
    const description = String(f.description || "").trim();

    if (!description) return setError("יש להזין תיאור.");
    if (!f.transaction_date) return setError("יש לבחור תאריך.");

    const actual =
      f.actual_amount === "" || f.actual_amount === null
        ? null
        : Number(f.actual_amount);

    const planned =
      kind === "expense" && f.expense_type === "fixed"
        ? Number(f.planned_amount)
        : actual;

    if (kind === "expense" && f.expense_type === "fixed") {
      if (!Number.isFinite(planned) || planned < 0) {
        return setError("יש להזין סכום מתוכנן תקין.");
      }
    }

    if (actual !== null && (!Number.isFinite(actual) || actual < 0)) {
      return setError("יש להזין סכום בפועל תקין.");
    }

    if (kind === "income" && (actual === null || !Number.isFinite(actual) || actual < 0)) {
      return setError("יש להזין סכום תקין.");
    }

    const row = {
      household_id: household.id,
      created_by: user?.id || null,
      kind,
      description,
      category_id: f.category_id || null,
      transaction_date: f.transaction_date,
      planned_amount:
        kind === "expense" && f.expense_type === "fixed"
          ? planned
          : actual,
      completed: kind === "income" ? true : actual !== null,
      actual_amount: actual,
      expense_type: kind === "expense" ? f.expense_type : null,
      person_user_id: f.person_user_id || null,
      note: String(f.note || "").trim() || null,
      payment_method: f.payment_method || null,
      merchant: String(f.merchant || "").trim() || null,
      credit_card_last4:
        String(f.credit_card_last4 || "").replace(/\D/g, "").slice(-4) || null,
      credit_card_provider:
        f.payment_method === "credit_card"
          ? f.credit_card_provider || null
          : null,
    };

    setSaving(true);
    setError("");

    try {
      const q = editingTx
        ? supabase
            .from("transactions")
            .update(row)
            .eq("id", editingTx.id)
            .eq("household_id", household.id)
        : supabase.from("transactions").insert(row);

      const result = await q.select("*").single();
      if (result.error) throw result.error;

      const savedMonth = String(f.transaction_date).slice(0, 7);

      closeModal();

      if (savedMonth !== month) setMonth(savedMonth);
      else await refresh();
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

    const f = recForm;
    const planned = Number(f.planned_amount);
    const day = Number(f.day_of_month);

    if (!String(f.name || "").trim()) {
      return setError("יש להזין שם הוצאה.");
    }

    if (!Number.isFinite(planned) || planned < 0) {
      return setError("יש להזין סכום מתוכנן תקין.");
    }

    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return setError("יום בחודש חייב להיות בין 1 ל־31.");
    }

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
    setError("");

    try {
      const q = editingRecurring
        ? supabase
            .from("recurring_expenses")
            .update(row)
            .eq("id", editingRecurring.id)
            .eq("household_id", household.id)
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
        transaction_date: `${month}-${String(
          Math.min(Number(item.day_of_month) || 1, 28)
        ).padStart(2, "0")}`,
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
        ? await supabase
            .from("transactions")
            .update(row)
            .eq("id", existing.id)
            .select("*")
            .single()
        : await supabase
            .from("transactions")
            .insert(row)
            .select("*")
            .single();

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
      const { error } = await supabase
        .from("transactions")
        .delete()
        .eq("id", tx.id)
        .eq("household_id", household.id);

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
      const { error } = await supabase
        .from("recurring_expenses")
        .delete()
        .eq("id", item.id)
        .eq("household_id", household.id);

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

  const categoryMap = useMemo(
    () =>
      Object.fromEntries(
        categories.map((c) => [c.id, c.name])
      ),
    [categories]
  );

  const memberMap = useMemo(
    () =>
      Object.fromEntries(
        profiles.map((p) => [p.id, p.display_name])
      ),
    [profiles]
  );

  const expenseTx = useMemo(
    () =>
      transactions.filter(
        (t) => t.kind === "expense" && t.actual_amount !== null
      ),
    [transactions]
  );

  const incomeTx = useMemo(
    () => transactions.filter((t) => t.kind === "income"),
    [transactions]
  );

  const actualIncome = incomeTx.reduce(
    (s, t) => s + Number(t.actual_amount || 0),
    0
  );

  const actualExpenses = expenseTx.reduce(
    (s, t) => s + Number(t.actual_amount || 0),
    0
  );

  const fixedActual = expenseTx
    .filter((t) => t.expense_type === "fixed")
    .reduce((s, t) => s + Number(t.actual_amount || 0), 0);

  const variableActual = expenseTx
    .filter((t) => t.expense_type === "variable")
    .reduce((s, t) => s + Number(t.actual_amount || 0), 0);

  const chargedRecurringIds = new Set(
    expenseTx
      .filter(
        (t) =>
          t.recurring_expense_id &&
          t.recurring_month === month
      )
      .map((t) => t.recurring_expense_id)
  );

  const pendingRecurring = recurring.filter(
    (r) => !chargedRecurringIds.has(r.id)
  );

  const plannedFixed = recurring.reduce(
    (s, r) => s + Number(r.planned_amount || 0),
    0
  );

  const pendingPlanned = pendingRecurring.reduce(
    (s, r) => s + Number(r.planned_amount || 0),
    0
  );

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

          <label>
            אימייל
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label>
            סיסמה
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {loginError && <div className="error">{loginError}</div>}

          <button className="primary wide">כניסה</button>
        </form>
      </main>
    );
  }

  if (loading && !household) {
    return (
      <main className="loading-page" dir="rtl">
        טוען...
      </main>
    );
  }

  return (
    <main className="app" dir="rtl">
      <header className="topbar">
        <div>
          <div className="eyebrow">התקציב המשפחתי</div>
          <h1>{household?.name || "התקציב שלי"}</h1>
        </div>

        <div className="top-actions">
          <span className="user-name">
            {memberMap[user.id] || "משתמשת"}
          </span>

          <button className="ghost" onClick={signOut}>
            יציאה
          </button>
        </div>
      </header>

      <section className="monthbar">
        <button
          className="month-arrow"
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          ‹
        </button>

        <strong>{monthLabel(month)}</strong>

        <button
          className="month-arrow"
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          ›
        </button>
      </section>

      <nav className="tabs">
        {[
          ["dashboard", "סיכום"],
          ["expenses", "הוצאות"],
          ["fixed", "הוצאות קבועות"],
          ["income", "הכנסות"],
          ["categories", "קטגוריות"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "tab active" : "tab"}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {error && <div className="global-error">{error}</div>}

      {tab === "dashboard" && (
        <>
          <div className="page-title">
            <div>
              <h2>סיכום חודשי</h2>
              <p>{monthLabel(month)}</p>
            </div>

            <button className="primary" onClick={() => openTx()}>
              ＋ הוצאה
            </button>
          </div>

          <section className="cards">
            <Stat title="הכנסות בפועל" value={money(actualIncome)} tone="positive" />
            <Stat title="הוצאות בפועל" value={money(actualExpenses)} tone="negative" />
            <Stat
              title="יתרה"
              value={money(actualIncome - actualExpenses)}
              tone={actualIncome - actualExpenses >= 0 ? "positive" : "negative"}
            />
            <Stat
              title="קבועות מתוכננות"
              value={money(plannedFixed)}
              subtitle={`${pendingRecurring.length} ממתינות לחיוב`}
            />
          </section>

          <div className="two-columns">
            <Panel title="קבועות מול משתנות">
              <Bars
                data={[
                  { label: "קבועות", value: fixedActual },
                  { label: "משתנות", value: variableActual },
                ]}
              />
            </Panel>

            <Panel title="הוצאות לפי קטגוריה">
              {categoryChart.length ? (
                <Bars data={categoryChart} />
              ) : (
                <Empty text="אין עדיין הוצאות בפועל בחודש הזה." />
              )}
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
                        <small>
                          יום {r.day_of_month} · {money(r.planned_amount)}
                        </small>
                      </div>

                      <button
                        className="small primary"
                        onClick={() => chargeRecurring(r)}
                      >
                        סימון כחויבה
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty text="כל ההוצאות הקבועות סומנו כחויבות." />
              )}
            </Panel>

            <Panel title="תנועות אחרונות">
              {transactions.slice(0, 7).map((t) => (
                <div className="recent-row" key={t.id}>
                  <div>
                    <strong>{t.description}</strong>
                    <small>
                      {dateText(t.transaction_date)} ·{" "}
                      {categoryMap[t.category_id] || "ללא קטגוריה"}
                    </small>
                  </div>

                  <strong className={t.kind === "income" ? "positive" : "negative"}>
                    {t.kind === "income" ? "+" : "-"}
                    {money(t.actual_amount)}
                  </strong>
                </div>
              ))}

              {!transactions.length && (
                <Empty text="אין תנועות בחודש הזה." />
              )}
            </Panel>
          </div>
        </>
      )}

      {tab === "expenses" && (
        <ExpensesView
          transactions={expenseTx}
          onEdit={openTx}
          onAdd={() => openTx()}
        />
      )}

      {tab === "fixed" && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>הוצאות קבועות</h2>
              <p>
                מתוכנן ובפועל. חיוב בפועל נכנס להוצאות רק לאחר סימון כחויב.
              </p>
            </div>

            <button className="primary" onClick={() => openRecurring()}>
              ＋ הוצאה קבועה
            </button>
          </div>

          <div className="fixed-summary">
            <Stat title="מתוכנן" value={money(plannedFixed)} />
            <Stat title="בפועל" value={money(fixedActual)} tone="negative" />
            <Stat title="ממתין" value={money(pendingPlanned)} />
          </div>

          <div className="fixed-list large">
            {recurring.map((r) => {
              const charged = chargedRecurringIds.has(r.id);

              const actual = expenseTx.find(
                (t) =>
                  t.recurring_expense_id === r.id &&
                  t.recurring_month === month
              )?.actual_amount;

              return (
                <div className="fixed-card" key={r.id}>
                  <div className="fixed-main">
                    <strong>{r.name}</strong>
                    <span>
                      {categoryMap[r.category_id] || "ללא קטגוריה"} · יום{" "}
                      {r.day_of_month}
                    </span>
                  </div>

                  <div className="amounts">
                    <span>
                      מתוכנן <b>{money(r.planned_amount)}</b>
                    </span>

                    <span>
                      בפועל <b>{charged ? money(actual) : "—"}</b>
                    </span>
                  </div>

                  <div className="row-actions">
                    {charged ? (
                      <span className="badge success">חויבה</span>
                    ) : (
                      <button
                        className="small primary"
                        onClick={() => chargeRecurring(r)}
                      >
                        סימון כחויבה
                      </button>
                    )}

                    <button className="icon" onClick={() => openRecurring(r)}>
                      ✎
                    </button>

                    <button
                      className="icon danger"
                      onClick={() =>
                        setConfirm({
                          type: "recurring",
                          item: r,
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}

            {!recurring.length && (
              <Empty text="עדיין לא הוגדרו הוצאות קבועות." />
            )}
          </div>
        </section>
      )}

      {tab === "income" && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>הכנסות</h2>
              <p>הכנסות בפועל בחודש הנבחר</p>
            </div>

            <button
              className="primary"
              onClick={() => openTx(null, "income")}
            >
              ＋ הכנסה
            </button>
          </div>

          <TransactionTable
            transactions={incomeTx}
            categoryMap={categoryMap}
            memberMap={memberMap}
            onEdit={openTx}
            onDelete={(t) => setConfirm({ type: "tx", item: t })}
          />
        </section>
      )}

      {tab === "categories" && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>קטגוריות</h2>
              <p>ניתן להוסיף קטגוריה חדשה.</p>
            </div>
          </div>

          <div className="category-add">
            <input
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="שם קטגוריה חדשה"
            />

            <button
              className="primary"
              onClick={addCategory}
              disabled={saving}
            >
              הוספה
            </button>
          </div>

          <div className="category-grid">
            {categories.map((c) => (
              <div className="category-card" key={c.id}>
                <strong>{c.name}</strong>
              </div>
            ))}
          </div>
        </section>
      )}

      {modal && (
        <Modal
          title={
            modal === "recurring"
              ? editingRecurring
                ? "עריכת הוצאה קבועה"
                : "הוצאה קבועה חדשה"
              : editingTx
              ? "עריכת תנועה"
              : modal === "income"
              ? "הכנסה חדשה"
              : "הוצאה חדשה"
          }
          onClose={closeModal}
        >
          {modal === "recurring" ? (
            <form className="form" onSubmit={saveRecurring}>
              <label>
                שם ההוצאה
                <input
                  value={recForm.name}
                  onChange={(e) =>
                    setRecForm({
                      ...recForm,
                      name: e.target.value,
                    })
                  }
                />
              </label>

              <label>
                קטגוריה
                <select
                  value={recForm.category_id}
                  onChange={(e) =>
                    setRecForm({
                      ...recForm,
                      category_id: e.target.value,
                    })
                  }
                >
                  <option value="">ללא קטגוריה</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="form-grid">
                <label>
                  סכום מתוכנן
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={recForm.planned_amount}
                    onChange={(e) =>
                      setRecForm({
                        ...recForm,
                        planned_amount: e.target.value,
                      })
                    }
                  />
                </label>

                <label>
                  יום בחודש
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={recForm.day_of_month}
                    onChange={(e) =>
                      setRecForm({
                        ...recForm,
                        day_of_month: e.target.value,
                      })
                    }
                  />
                </label>
              </div>

              <label>
                בית עסק
                <input
                  value={recForm.merchant}
                  onChange={(e) =>
                    setRecForm({
                      ...recForm,
                      merchant: e.target.value,
                    })
                  }
                />
              </label>

              <label>
                אמצעי תשלום
                <select
                  value={recForm.payment_method}
                  onChange={(e) =>
                    setRecForm({
                      ...recForm,
                      payment_method: e.target.value,
                    })
                  }
                >
                  <option value="">לא צוין</option>
                  <option value="credit_card">כרטיס אשראי</option>
                  <option value="bank">חשבון בנק</option>
                  <option value="direct_debit">הוראת קבע</option>
                  <option value="cash">מזומן</option>
                  <option value="bit">ביט</option>
                  <option value="paybox">פייבוקס</option>
                  <option value="other">אחר</option>
                </select>
              </label>

              <label>
                על שם מי
                <select
                  value={recForm.person_user_id}
                  onChange={(e) =>
                    setRecForm({
                      ...recForm,
                      person_user_id: e.target.value,
                    })
                  }
                >
                  <option value="">לא צוין</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display_name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                הערה
                <textarea
                  rows="3"
                  value={recForm.note}
                  onChange={(e) =>
                    setRecForm({
                      ...recForm,
                      note: e.target.value,
                    })
                  }
                />
              </label>

              {error && <div className="error">{error}</div>}

              <div className="modal-actions">
                <button type="button" className="ghost" onClick={closeModal}>
                  ביטול
                </button>

                <button className="primary" disabled={saving}>
                  {saving ? "שומר..." : "שמירה"}
                </button>
              </div>
            </form>
          ) : (
            <form className="form" onSubmit={saveTx}>
              <label>
                {modal === "income" ? "מקור ההכנסה" : "תיאור"}
                <input
                  value={txForm.description}
                  onChange={(e) =>
                    setTxForm({
                      ...txForm,
                      description: e.target.value,
                    })
                  }
                />
              </label>

              {modal !== "income" && (
                <label>
                  סוג הוצאה
                  <select
                    value={txForm.expense_type}
                    onChange={(e) =>
                      setTxForm({
                        ...txForm,
                        expense_type: e.target.value,
                      })
                    }
                  >
                    <option value="variable">
                      משתנה – בפועל בלבד
                    </option>
                    <option value="fixed">
                      קבועה – מתוכנן ובפועל
                    </option>
                  </select>
                </label>
              )}

              <label>
                קטגוריה
                <select
                  value={txForm.category_id}
                  onChange={(e) =>
                    setTxForm({
                      ...txForm,
                      category_id: e.target.value,
                    })
                  }
                >
                  <option value="">ללא קטגוריה</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              {modal !== "income" &&
                txForm.expense_type === "fixed" && (
                  <label>
                    סכום מתוכנן
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={txForm.planned_amount}
                      onChange={(e) =>
                        setTxForm({
                          ...txForm,
                          planned_amount: e.target.value,
                        })
                      }
                    />
                  </label>
                )}

              <label>
                סכום בפועל
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={txForm.actual_amount}
                  onChange={(e) =>
                    setTxForm({
                      ...txForm,
                      actual_amount: e.target.value,
                    })
                  }
                  placeholder={
                    modal === "income"
                      ? ""
                      : "השאירי ריק אם טרם חויב"
                  }
                />
              </label>

              <div className="form-grid">
                <label>
                  תאריך
                  <input
                    type="date"
                    value={txForm.transaction_date}
                    onChange={(e) =>
                      setTxForm({
                        ...txForm,
                        transaction_date: e.target.value,
                      })
                    }
                  />
                </label>

                <label>
                  על שם מי
                  <select
                    value={txForm.person_user_id}
                    onChange={(e) =>
                      setTxForm({
                        ...txForm,
                        person_user_id: e.target.value,
                      })
                    }
                  >
                    <option value="">לא צוין</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.display_name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="form-grid">
                <label>
                  בית עסק
                  <input
                    value={txForm.merchant}
                    onChange={(e) =>
                      setTxForm({
                        ...txForm,
                        merchant: e.target.value,
                      })
                    }
                  />
                </label>

                <label>
                  4 ספרות אחרונות
                  <input
                    inputMode="numeric"
                    maxLength="4"
                    value={txForm.credit_card_last4}
                    onChange={(e) =>
                      setTxForm({
                        ...txForm,
                        credit_card_last4: e.target.value
                          .replace(/\D/g, "")
                          .slice(-4),
                      })
                    }
                  />
                </label>
              </div>

              <label>
                אמצעי תשלום
                <select
                  value={txForm.payment_method}
                  onChange={(e) =>
                    setTxForm({
                      ...txForm,
                      payment_method: e.target.value,
                    })
                  }
                >
                  <option value="">לא צוין</option>
                  <option value="credit_card">כרטיס אשראי</option>
                  <option value="bank">חשבון בנק</option>
                  <option value="direct_debit">הוראת קבע</option>
                  <option value="cash">מזומן</option>
                  <option value="bit">ביט</option>
                  <option value="paybox">פייבוקס</option>
                  <option value="other">אחר</option>
                </select>
              </label>

              {txForm.payment_method === "credit_card" && (
                <label>
                  חברת אשראי
                  <select
                    value={txForm.credit_card_provider}
                    onChange={(e) =>
                      setTxForm({
                        ...txForm,
                        credit_card_provider: e.target.value,
                      })
                    }
                  >
                    <option value="">לא צוין</option>
                    <option value="isracard">ישראכרט</option>
                    <option value="cal">כאל</option>
                    <option value="max">MAX</option>
                    <option value="flycard">Fly Card</option>
                    <option value="other">אחר</option>
                  </select>
                </label>
              )}

              <label>
                הערה
                <textarea
                  rows="3"
                  value={txForm.note}
                  onChange={(e) =>
                    setTxForm({
                      ...txForm,
                      note: e.target.value,
                    })
                  }
                />
              </label>

              {error && <div className="error">{error}</div>}

              <div className="modal-actions">
                <button type="button" className="ghost" onClick={closeModal}>
                  ביטול
                </button>

                <button className="primary" disabled={saving}>
                  {saving ? "שומר..." : "שמירה"}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}

      {confirm && (
        <Modal
          title="אישור מחיקה"
          onClose={() => setConfirm(null)}
        >
          <p>
            למחוק את{" "}
            <strong>
              {confirm.item.name || confirm.item.description}
            </strong>
            ?
          </p>

          <div className="modal-actions">
            <button
              className="ghost"
              onClick={() => setConfirm(null)}
            >
              ביטול
            </button>

            <button
              className="danger-button"
              onClick={() =>
                confirm.type === "tx"
                  ? deleteTx(confirm.item)
                  : deleteRecurring(confirm.item)
              }
            >
              כן, למחוק
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}

function ExpensesView({ transactions, onEdit, onAdd }) {
  const [filters, setFilters] = useState({
    fromDate: "",
    toDate: "",
    minAmount: "",
    maxAmount: "",
    paymentMethod: "",
    categoryId: "",
    search: "",
  });

  const [sort, setSort] = useState({
    key: "date",
    direction: "desc",
  });

  function toggleSort(key) {
    setSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "asc"
          ? "desc"
          : "asc",
    }));
  }

  function resetFilters() {
    setFilters({
      fromDate: "",
      toDate: "",
      minAmount: "",
      maxAmount: "",
      paymentMethod: "",
      categoryId: "",
      search: "",
    });
  }

  function paymentMethodName(tx) {
    if (tx.payment_method === "credit_card") {
      return "כרטיס אשראי";
    }

    return (
      {
        bank: "חשבון בנק",
        direct_debit: "הוראת קבע",
        cash: "מזומן",
        bit: "ביט",
        paybox: "פייבוקס",
        other: "אחר",
      }[tx.payment_method] || "לא צוין"
    );
  }

  const filtered = useMemo(() => {
    const rows = transactions.filter((t) => {
      const amount = Number(t.actual_amount || 0);
      const search = filters.search.trim().toLowerCase();

      if (
        filters.fromDate &&
        t.transaction_date < filters.fromDate
      ) {
        return false;
      }

      if (
        filters.toDate &&
        t.transaction_date > filters.toDate
      ) {
        return false;
      }

      if (
        filters.minAmount !== "" &&
        amount < Number(filters.minAmount)
      ) {
        return false;
      }

      if (
        filters.maxAmount !== "" &&
        amount > Number(filters.maxAmount)
      ) {
        return false;
      }

      if (filters.paymentMethod) {
        const actualMethod =
          t.payment_method || "other";

        if (
          filters.paymentMethod === "other"
            ? ![
                "credit_card",
                "bank",
                "direct_debit",
                "cash",
                "bit",
                "paybox",
              ].includes(actualMethod)
            : actualMethod !== filters.paymentMethod
        ) {
          return false;
        }
      }

      if (
        filters.categoryId &&
        t.category_id !== filters.categoryId
      ) {
        return false;
      }

      if (search) {
        const searchable = [
          t.description,
          t.merchant,
          t.note,
          t.credit_card_provider,
          t.credit_card_last4,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        if (!searchable.includes(search)) {
          return false;
        }
      }

      return true;
    });

    rows.sort((a, b) => {
      let av;
      let bv;

      switch (sort.key) {
        case "date":
          av = a.transaction_date || "";
          bv = b.transaction_date || "";
          break;

        case "amount":
          av = Number(a.actual_amount || 0);
          bv = Number(b.actual_amount || 0);
          break;

        case "description":
          av = String(a.description || "").toLowerCase();
          bv = String(b.description || "").toLowerCase();
          break;

        case "category":
          av = String(a.category_id || "").toLowerCase();
          bv = String(b.category_id || "").toLowerCase();
          break;

        case "payment":
          av = paymentMethodName(a);
          bv = paymentMethodName(b);
          break;

        default:
          av = a.transaction_date || "";
          bv = b.transaction_date || "";
      }

      if (av < bv) {
        return sort.direction === "asc" ? -1 : 1;
      }

      if (av > bv) {
        return sort.direction === "asc" ? 1 : -1;
      }

      return 0;
    });

    return rows;
  }, [transactions, filters, sort]);

  const total = filtered.reduce(
    (sum, t) => sum + Number(t.actual_amount || 0),
    0
  );

  const average = filtered.length
    ? total / filtered.length
    : 0;

  /*
   * הגרף החשוב:
   * כאן אנחנו מקבצים אך ורק לפי אופן תשלום.
   *
   * כלומר:
   * כל כרטיסי האשראי נכנסים יחד ל"כרטיס אשראי"
   * ולא מתפצלים לפי 4 ספרות או חברת אשראי.
   */
  const paymentSummary = useMemo(() => {
    const groups = {
      credit_card: {
        label: "כרטיס אשראי",
        value: 0,
      },
      bank: {
        label: "חשבון בנק",
        value: 0,
      },
      direct_debit: {
        label: "הוראת קבע",
        value: 0,
      },
      cash: {
        label: "מזומן",
        value: 0,
      },
      bit: {
        label: "ביט",
        value: 0,
      },
      paybox: {
        label: "פייבוקס",
        value: 0,
      },
      other: {
        label: "אחר / לא צוין",
        value: 0,
      },
    };

    filtered.forEach((t) => {
      const method = t.payment_method;

      if (method === "credit_card") {
        groups.credit_card.value += Number(
          t.actual_amount || 0
        );
      } else if (method === "bank") {
        groups.bank.value += Number(t.actual_amount || 0);
      } else if (method === "direct_debit") {
        groups.direct_debit.value += Number(
          t.actual_amount || 0
        );
      } else if (method === "cash") {
        groups.cash.value += Number(t.actual_amount || 0);
      } else if (method === "bit") {
        groups.bit.value += Number(t.actual_amount || 0);
      } else if (method === "paybox") {
        groups.paybox.value += Number(t.actual_amount || 0);
      } else {
        groups.other.value += Number(t.actual_amount || 0);
      }
    });

    return Object.values(groups)
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [filtered]);

  const maxPaymentValue = Math.max(
    ...paymentSummary.map((x) => x.value),
    1
  );

  const paymentPercent = (value) =>
    total > 0 ? (value / total) * 100 : 0;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>הוצאות</h2>
          <p>
            {filtered.length} הוצאות · סה״כ{" "}
            {money(total)}
          </p>
        </div>

        <button className="primary" onClick={onAdd}>
          ＋ הוצאה
        </button>
      </div>

      {/* =========================
          סינון
         ========================= */}
      <div className="expense-filters">
        <div className="filter-title">
          סינון הוצאות
        </div>

        <div className="filter-grid">
          <label>
            חיפוש
            <input
              type="text"
              placeholder="תיאור / בית עסק / הערה..."
              value={filters.search}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  search: e.target.value,
                })
              }
            />
          </label>

          <label>
            מתאריך
            <input
              type="date"
              value={filters.fromDate}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  fromDate: e.target.value,
                })
              }
            />
          </label>

          <label>
            עד תאריך
            <input
              type="date"
              value={filters.toDate}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  toDate: e.target.value,
                })
              }
            />
          </label>

          <label>
            סכום מינימום
            <input
              type="number"
              min="0"
              step="0.01"
              value={filters.minAmount}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  minAmount: e.target.value,
                })
              }
            />
          </label>

          <label>
            סכום מקסימום
            <input
              type="number"
              min="0"
              step="0.01"
              value={filters.maxAmount}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  maxAmount: e.target.value,
                })
              }
            />
          </label>

          <label>
            קטגוריה
            <select
              value={filters.categoryId}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  categoryId: e.target.value,
                })
              }
            >
              <option value="">כל הקטגוריות</option>

              {[
                ...new Map(
                  transactions
                    .filter((t) => t.category_id)
                    .map((t) => [
                      t.category_id,
                      t.category_id,
                    ])
                ).values(),
              ].map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>

          <label>
            אופן תשלום
            <select
              value={filters.paymentMethod}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  paymentMethod: e.target.value,
                })
              }
            >
              <option value="">
                כל אמצעי התשלום
              </option>
              <option value="credit_card">
                כרטיס אשראי
              </option>
              <option value="bank">
                חשבון בנק
              </option>
              <option value="direct_debit">
                הוראת קבע
              </option>
              <option value="cash">
                מזומן
              </option>
              <option value="bit">
                ביט
              </option>
              <option value="paybox">
                פייבוקס
              </option>
              <option value="other">
                אחר / לא צוין
              </option>
            </select>
          </label>

          <button
            type="button"
            className="ghost filter-reset"
            onClick={resetFilters}
          >
            איפוס סינון
          </button>
        </div>
      </div>

      {/* =========================
          סיכום
         ========================= */}
      <div className="expense-summary-cards">
        <div className="expense-summary-card">
          <span>סה״כ הוצאות</span>
          <strong>{money(total)}</strong>
        </div>

        <div className="expense-summary-card">
          <span>מספר הוצאות</span>
          <strong>{filtered.length}</strong>
        </div>

        <div className="expense-summary-card">
          <span>ממוצע להוצאה</span>
          <strong>{money(average)}</strong>
        </div>
      </div>

      {/* =========================
          גרף הוצאות לפי אופן תשלום
         ========================= */}
      <div className="payment-chart-card">
        <div className="payment-chart-header">
          <div>
            <h3>
              סה״כ הוצאות לפי אופן תשלום
            </h3>

            <p>
              הסכומים מתעדכנים אוטומטית לפי הסינון
              שבחרת.
            </p>
          </div>

          <strong>{money(total)}</strong>
        </div>

        {paymentSummary.length > 0 ? (
          <div className="payment-chart-list">
            {paymentSummary.map((item) => {
              const percent = paymentPercent(
                item.value
              );

              return (
                <div
                  className="payment-chart-item"
                  key={item.label}
                >
                  <div className="payment-chart-top">
                    <span>{item.label}</span>

                    <div>
                      <strong>
                        {money(item.value)}
                      </strong>

                      <small>
                        {percent.toFixed(1)}%
                      </small>
                    </div>
                  </div>

                  <div className="payment-chart-track">
                    <div
                      className="payment-chart-bar"
                      style={{
                        width: `${Math.min(
                          100,
                          (item.value /
                            maxPaymentValue) *
                            100
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty text="אין הוצאות להצגה לפי הסינון שבחרת." />
        )}
      </div>

      {/* =========================
          טבלת הוצאות
         ========================= */}
      <div className="table-wrap">
        <table className="transactions-table expenses-table">
          <thead>
            <tr>
              <th>
                <button
                  type="button"
                  className="sort-button"
                  onClick={() =>
                    toggleSort("date")
                  }
                >
                  תאריך
                  <span>
                    {sort.key === "date"
                      ? sort.direction === "asc"
                        ? " ↑"
                        : " ↓"
                      : " ↕"}
                  </span>
                </button>
              </th>

              <th>
                <button
                  type="button"
                  className="sort-button"
                  onClick={() =>
                    toggleSort("description")
                  }
                >
                  הוצאה
                  <span>
                    {sort.key ===
                    "description"
                      ? sort.direction === "asc"
                        ? " ↑"
                        : " ↓"
                      : " ↕"}
                  </span>
                </button>
              </th>

              <th>
                <button
                  type="button"
                  className="sort-button"
                  onClick={() =>
                    toggleSort("category")
                  }
                >
                  קטגוריה
                  <span>
                    {sort.key === "category"
                      ? sort.direction === "asc"
                        ? " ↑"
                        : " ↓"
                        : " ↕"}
                  </span>
                </button>
              </th>

              <th>
                <button
                  type="button"
                  className="sort-button"
                  onClick={() =>
                    toggleSort("amount")
                  }
                >
                  סכום
                  <span>
                    {sort.key === "amount"
                      ? sort.direction === "asc"
                        ? " ↑"
                        : " ↓"
                      : " ↕"}
                  </span>
                </button>
              </th>

              <th>
                <button
                  type="button"
                  className="sort-button"
                  onClick={() =>
                    toggleSort("payment")
                  }
                >
                  אופן תשלום
                  <span>
                    {sort.key === "payment"
                      ? sort.direction === "asc"
                        ? " ↑"
                        : " ↓"
                      : " ↕"}
                  </span>
                </button>
              </th>
            </tr>
          </thead>

          <tbody>
            {filtered.map((t) => (
              <tr
                key={t.id}
                className="clickable-row"
                onClick={() =>
                  onEdit(t, "expense")
                }
              >
                <td>
                  {dateText(
                    t.transaction_date
                  )}
                </td>

                <td>
                  <strong>
                    {t.description}
                  </strong>

                  {t.merchant && (
                    <small className="table-sub">
                      {t.merchant}
                    </small>
                  )}
                </td>

                <td>
                  {t.category_id ||
                    "ללא קטגוריה"}
                </td>

                <td>
                  <strong>
                    {money(t.actual_amount)}
                  </strong>
                </td>

                <td>
                  <PaymentDisplay tx={t} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!filtered.length && (
          <Empty text="אין הוצאות בהתאם לסינון שבחרת." />
        )}
      </div>
    </section>
  );
        }

function PaymentDisplay({ tx }) {
  if (tx.payment_method === "credit_card") {
    return (
      <div className="payment-display">
        <strong>כרטיס אשראי</strong>
        <small>
          {providerLabel(tx.credit_card_provider) || "חברת אשראי לא צוינה"}
          {tx.credit_card_last4
            ? ` · •••• ${tx.credit_card_last4}`
            : ""}
        </small>
      </div>
    );
  }

  return <span>{paymentLabel(tx)}</span>;
}

function TransactionTable({
  transactions,
  categoryMap,
  memberMap,
  onEdit,
  onDelete,
}) {
  return (
    <div className="table-wrap">
      <table className="transactions-table">
        <thead>
          <tr>
            <th>תאריך</th>
            <th>תיאור</th>
            <th>קטגוריה</th>
            <th>סוג</th>
            <th>מתוכנן</th>
            <th>בפועל</th>
            <th>מי</th>
            <th />
          </tr>
        </thead>

        <tbody>
          {transactions.map((t) => {
            const income = t.kind === "income";

            return (
              <tr key={t.id}>
                <td>{dateText(t.transaction_date)}</td>

                <td>
                  <strong>{t.description}</strong>
                  {t.merchant && (
                    <small className="table-sub">
                      {t.merchant}
                    </small>
                  )}
                </td>

                <td>
                  {categoryMap[t.category_id] || "ללא קטגוריה"}
                </td>

                <td>
                  <span
                    className={`badge ${
                      income
                        ? "success"
                        : t.expense_type === "fixed"
                        ? "fixed"
                        : "variable"
                    }`}
                  >
                    {income
                      ? "הכנסה"
                      : t.expense_type === "fixed"
                      ? "קבועה"
                      : "משתנה"}
                  </span>
                </td>

                <td>
                  {!income && t.expense_type === "fixed"
                    ? money(t.planned_amount)
                    : "—"}
                </td>

                <td className={income ? "positive" : "negative"}>
                  {t.actual_amount === null
                    ? "—"
                    : money(t.actual_amount)}
                </td>

                <td>
                  {memberMap[t.person_user_id] || "לא צוין"}
                </td>

                <td>
                  <div className="table-actions">
                    <button
                      className="icon"
                      onClick={() =>
                        onEdit(
                          t,
                          income ? "income" : "expense"
                        )
                      }
                    >
                      ✎
                    </button>

                    <button
                      className="icon danger"
                      onClick={() => onDelete(t)}
                    >
                      ×
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {!transactions.length && (
        <Empty text="אין תנועות בחודש הזה." />
      )}
    </div>
  );
}

function Stat({ title, value, subtitle, tone = "" }) {
  return (
    <div className="stat">
      <span>{title}</span>
      <strong className={tone}>{value}</strong>
      {subtitle && <small>{subtitle}</small>}
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
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

          <div className="chart-track">
            <div
              className="chart-bar"
              style={{
                width: `${(x.value / max) * 100}%`,
              }}
            />
          </div>

          <strong>{money(x.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modal-head">
          <h2>{title}</h2>

          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
      }
