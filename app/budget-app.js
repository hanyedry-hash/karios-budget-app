"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

const money = (v) => new Intl.NumberFormat("he-IL", {
  style: "currency", currency: "ILS", maximumFractionDigits: 0
}).format(Number(v || 0));

const dateText = (v) => v ? new Date(`${v}T00:00:00`).toLocaleDateString("he-IL") : "";

const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const monthKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const monthLabel = (m) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("he-IL", { month: "long", year: "numeric" });
};

const shiftMonth = (m, n) => {
  const [y, mo] = m.split("-").map(Number);
  return monthKey(new Date(y, mo - 1 + n, 1));
};

const emptyTx = () => ({
  description: "", category_id: "", expense_type: "variable",
  planned_amount: "", actual_amount: "", person_user_id: "",
  transaction_date: todayKey(), note: "", payment_method: "",
  merchant: "", credit_card_last4: "", credit_card_provider: ""
});

const emptyRecurring = () => ({
  name: "", category_id: "", planned_amount: "", day_of_month: "1",
  payment_method: "", merchant: "", person_user_id: "", note: ""
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
    date: "", description: "", amount: "", paymentMethod: "", cardLast4: ""
  });
  const [expenseSort, setExpenseSort] = useState({ key: "date", direction: "desc" });

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setUser(data.session?.user || null);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user || null));
    return () => { mounted = false; data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (user) refresh();
    else {
      setHousehold(null); setProfiles([]); setCategories([]);
      setTransactions([]); setRecurring([]);
    }
  }, [user, month]);

  async function refresh() {
    if (!user) return;
    setLoading(true);
    try {
      const h = await supabase.rpc("get_my_household");
      if (h.error) throw h.error;
      const hr = h.data?.[0];
      if (!hr) { setHousehold(null); return; }

      const householdId = hr.household_id;
      setHousehold({ id: householdId, name: hr.household_name });

      const [m, c, t, r] = await Promise.all([
        supabase.rpc("get_my_household_members"),
        supabase.from("categories").select("*").eq("household_id", householdId).order("name"),
        supabase.from("transactions").select("*").eq("household_id", householdId)
          .gte("transaction_date", `${month}-01`)
          .lt("transaction_date", `${shiftMonth(month, 1)}-01`)
          .order("transaction_date", { ascending: false }).order("created_at", { ascending: false }),
        supabase.from("recurring_expenses").select("*").eq("household_id", householdId)
          .eq("is_active", true).order("day_of_month").order("name")
      ]);

      if (m.error) console.error(m.error);
      if (c.error) console.error(c.error);
      if (t.error) console.error(t.error);
      if (r.error) console.error(r.error);

      const members = m.data || [];
      setProfiles(members.map((x) => ({
        id: x.user_id, display_name: x.display_name || "ללא שם", role: x.role
      })));
      setCategories(c.data || []);
      setTransactions(t.data || []);
      setRecurring(r.data || []);
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
      email: email.trim(), password
    });
    if (error) setLoginError("ההתחברות נכשלה. בדקי את האימייל והסיסמה.");
  }

  async function signOut() { await supabase.auth.signOut(); }

  function openTx(tx = null, kind = "expense") {
    setError(""); setEditingTx(tx);
    if (tx) {
      setTxForm({
        description: tx.description || "", category_id: tx.category_id || "",
        expense_type: tx.expense_type || "variable", planned_amount: tx.planned_amount ?? "",
        actual_amount: tx.actual_amount ?? "", person_user_id: tx.person_user_id || "",
        transaction_date: tx.transaction_date || todayKey(), note: tx.note || "",
        payment_method: tx.payment_method || "", merchant: tx.merchant || "",
        credit_card_last4: tx.credit_card_last4 || "",
        credit_card_provider: tx.credit_card_provider || "", kind
      });
    } else setTxForm({ ...emptyTx(), kind });
    setModal(kind === "income" ? "income" : "transaction");
  }

  function closeModal() {
    setModal(null); setEditingTx(null); setEditingRecurring(null); setError("");
  }

  async function saveTx(e) {
    e.preventDefault();
    if (saving || !household) return;
    setError("");
    const f = txForm;
    const kind = modal === "income" ? "income" : "expense";
    const description = String(f.description || "").trim();
    const actual = f.actual_amount === "" ? null : Number(f.actual_amount);
    const planned = kind === "expense" && f.expense_type === "fixed" ? Number(f.planned_amount) : actual;

    if (!description) return setError("יש להזין תיאור.");
    if (!f.transaction_date) return setError("יש לבחור תאריך.");
    if (kind === "expense" && f.expense_type === "fixed" && (!Number.isFinite(planned) || planned < 0))
      return setError("יש להזין סכום מתוכנן תקין.");
    if (actual !== null && (!Number.isFinite(actual) || actual < 0))
      return setError("יש להזין סכום בפועל תקין.");
    if (kind === "income" && (!Number.isFinite(actual) || actual < 0))
      return setError("יש להזין סכום תקין.");

    const row = {
      household_id: household.id, created_by: user?.id || null, kind, description,
      category_id: f.category_id || null, transaction_date: f.transaction_date,
      planned_amount: kind === "expense" && f.expense_type === "fixed" ? planned : actual,
      completed: kind === "income" ? true : actual !== null, actual_amount: actual,
      expense_type: kind === "expense" ? f.expense_type : null,
      person_user_id: f.person_user_id || null, note: String(f.note || "").trim() || null,
      payment_method: f.payment_method || null, merchant: String(f.merchant || "").trim() || null,
      credit_card_last4: String(f.credit_card_last4 || "").replace(/\D/g, "").slice(-4) || null,
      credit_card_provider: f.payment_method === "credit_card" ? (f.credit_card_provider || null) : null
    };

    setSaving(true);
    try {
      const q = editingTx
        ? supabase.from("transactions").update(row).eq("id", editingTx.id).eq("household_id", household.id)
        : supabase.from("transactions").insert(row);
      const result = await q.select("*").single();
      if (result.error) throw result.error;
      closeModal(); await refresh();
    } catch (e) {
      console.error(e); setError(e.message || "לא הצלחתי לשמור.");
    } finally { setSaving(false); }
  }

  function openRecurring(item = null) {
    setError(""); setEditingRecurring(item);
    setRecForm(item ? {
      name: item.name || "", category_id: item.category_id || "",
      planned_amount: item.planned_amount ?? "", day_of_month: item.day_of_month ?? "1",
      payment_method: item.payment_method || "", merchant: item.merchant || "",
      person_user_id: item.person_user_id || "", note: item.note || ""
    } : emptyRecurring());
    setModal("recurring");
  }

  async function saveRecurring(e) {
    e.preventDefault();
    if (saving || !household) return;
    setError("");
    const f = recForm, planned = Number(f.planned_amount), day = Number(f.day_of_month);
    if (!String(f.name || "").trim()) return setError("יש להזין שם הוצאה.");
    if (!Number.isFinite(planned) || planned < 0) return setError("יש להזין סכום מתוכנן תקין.");
    if (!Number.isInteger(day) || day < 1 || day > 31) return setError("יום בחודש חייב להיות בין 1 ל־31.");

    const row = {
      household_id: household.id, name: String(f.name).trim(), category_id: f.category_id || null,
      planned_amount: planned, day_of_month: day, person_user_id: f.person_user_id || null,
      is_active: true, note: String(f.note || "").trim() || null,
      payment_method: f.payment_method || null, merchant: String(f.merchant || "").trim() || null
    };

    setSaving(true);
    try {
      const q = editingRecurring
        ? supabase.from("recurring_expenses").update(row).eq("id", editingRecurring.id).eq("household_id", household.id)
        : supabase.from("recurring_expenses").insert(row);
      const result = await q.select("*").single();
      if (result.error) throw result.error;
      closeModal(); await refresh();
    } catch (e) {
      console.error(e); setError(e.message || "לא הצלחתי לשמור את ההוצאה הקבועה.");
    } finally { setSaving(false); }
  }

  async function chargeRecurring(item) {
    if (saving || !household) return;
    const actualText = window.prompt(
      `סכום בפועל עבור ${item.name}\nמתוכנן: ${money(item.planned_amount)}`,
      String(item.planned_amount ?? "")
    );
    if (actualText === null) return;
    const actual = Number(actualText);
    if (!Number.isFinite(actual) || actual < 0) { alert("יש להזין סכום תקין."); return; }

    setSaving(true); setError("");
    try {
      const { data: existing, error: findError } = await supabase.from("transactions")
        .select("*").eq("recurring_expense_id", item.id).eq("recurring_month", month).maybeSingle();
      if (findError) throw findError;

      const row = {
        household_id: household.id, created_by: user?.id || null, kind: "expense",
        description: item.name, category_id: item.category_id || null,
        transaction_date: `${month}-${String(Math.min(Number(item.day_of_month) || 1, 28)).padStart(2, "0")}`,
        planned_amount: Number(item.planned_amount || 0), completed: true, actual_amount: actual,
        expense_type: "fixed", person_user_id: item.person_user_id || null, note: item.note || null,
        payment_method: item.payment_method || null, merchant: item.merchant || null,
        recurring_expense_id: item.id, recurring_month: month
      };

      const result = existing
        ? await supabase.from("transactions").update(row).eq("id", existing.id).select("*").single()
        : await supabase.from("transactions").insert(row).select("*").single();

      if (result.error) throw result.error;
      await refresh();
    } catch (e) {
      console.error(e); setError(e.message || "לא הצלחתי לסמן כחויב.");
    } finally { setSaving(false); }
  }

  async function deleteTx(tx) {
    setConfirm(null); setSaving(true);
    try {
      const { error } = await supabase.from("transactions").delete().eq("id", tx.id).eq("household_id", household.id);
      if (error) throw error; await refresh();
    } catch (e) { setError(e.message || "המחיקה נכשלה."); }
    finally { setSaving(false); }
  }

  async function deleteRecurring(item) {
    setConfirm(null); setSaving(true);
    try {
      const { error } = await supabase.from("recurring_expenses").delete().eq("id", item.id).eq("household_id", household.id);
      if (error) throw error; await refresh();
    } catch (e) { setError(e.message || "המחיקה נכשלה."); }
    finally { setSaving(false); }
  }

  async function addCategory() {
    const name = String(newCategory || "").trim();
    if (!name || !household) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("categories").insert({ household_id: household.id, name });
      if (error) throw error;
      setNewCategory(""); await refresh();
    } catch (e) { setError(e.message || "לא הצלחתי להוסיף קטגוריה."); }
    finally { setSaving(false); }
  }

  const categoryMap = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c.name])), [categories]
  );
  const memberMap = useMemo(
    () => Object.fromEntries(profiles.map((p) => [p.id, p.display_name])), [profiles]
  );

  const expenseTx = useMemo(
    () => transactions.filter((t) => t.kind === "expense" && t.actual_amount !== null), [transactions]
  );
  const incomeTx = useMemo(
    () => transactions.filter((t) => t.kind === "income"), [transactions]
  );

  const actualIncome = incomeTx.reduce((s, t) => s + Number(t.actual_amount || 0), 0);
  const actualExpenses = expenseTx.reduce((s, t) => s + Number(t.actual_amount || 0), 0);
  const fixedActual = expenseTx.filter((t) => t.expense_type === "fixed")
    .reduce((s, t) => s + Number(t.actual_amount || 0), 0);
  const variableActual = expenseTx.filter((t) => t.expense_type === "variable")
    .reduce((s, t) => s + Number(t.actual_amount || 0), 0);

  const chargedRecurringIds = new Set(
    expenseTx.filter((t) => t.recurring_expense_id && t.recurring_month === month)
      .map((t) => t.recurring_expense_id)
  );
  const pendingRecurring = recurring.filter((r) => !chargedRecurringIds.has(r.id));
  const plannedFixed = recurring.reduce((s, r) => s + Number(r.planned_amount || 0), 0);
  const pendingPlanned = pendingRecurring.reduce((s, r) => s + Number(r.planned_amount || 0), 0);

  const typeChart = [
    { label: "קבועות", value: fixedActual },
    { label: "משתנות", value: variableActual }
  ];

  const categoryChart = useMemo(() => {
    const map = {};
    expenseTx.forEach((t) => {
      const name = categoryMap[t.category_id] || "ללא קטגוריה";
      map[name] = (map[name] || 0) + Number(t.actual_amount || 0);
    });
    return Object.entries(map).map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value).slice(0, 8);
  }, [expenseTx, categoryMap]);

  if (!user) return (
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

  if (loading && !household) return <main className="loading-page" dir="rtl">טוען...</main>;

  return (
    <main className="app" dir="rtl">
      <header className="topbar">
        <div><div className="eyebrow">התקציב המשפחתי</div><h1>{household?.name || "התקציב שלי"}</h1></div>
        <div className="top-actions"><span className="user-name">{memberMap[user.id] || "משתמשת"}</span><button className="ghost" onClick={signOut}>יציאה</button></div>
      </header>

      <section className="monthbar">
        <button className="month-arrow" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <strong>{monthLabel(month)}</strong>
        <button className="month-arrow" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
      </section>

      <nav className="tabs">
        {[["dashboard", "סיכום"], ["expenses", "הוצאות"], ["fixed", "הוצאות קבועות"], ["income", "הכנסות"], ["categories", "קטגוריות"]].map(([id, label]) => (
          <button key={id} className={tab === id ? "tab active" : "tab"} onClick={() => setTab(id)}>{label}</button>
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

          <div className="two-columns">
            <Panel title="קבועות מול משתנות"><Bars data={typeChart} /></Panel>
            <Panel title="הוצאות לפי קטגוריה">{categoryChart.length ? <Bars data={categoryChart} /> : <Empty text="אין עדיין הוצאות בפועל בחודש הזה." />}</Panel>
          </div>

          <div className="two-columns">
            <Panel title="הוצאות קבועות ממתינות לחיוב">
              {pendingRecurring.length ? (
                <div className="fixed-list">
                  {pendingRecurring.slice(0, 6).map((r) => (
                    <div className="fixed-item" key={r.id}>
                      <div><strong>{r.name}</strong><small>יום {r.day_of_month} · {money(r.planned_amount)}</small></div>
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
          onOpen={(tx) => openTx(tx, "expense")}
          filters={expenseFilters}
          setFilters={setExpenseFilters}
          sort={expenseSort}
          setSort={setExpenseSort}
          onAdd={() => openTx()}
        />
      )}

      {tab === "fixed" && (
        <section className="panel">
          <div className="panel-head">
            <div><h2>הוצאות קבועות</h2><p>מתוכנן ובפועל. חיוב בפועל נכנס להוצאות רק לאחר סימון כחויב.</p></div>
            <button className="primary" onClick={() => openRecurring()}>＋ הוצאה קבועה</button>
          </div>
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
                  <div className="fixed-main"><strong>{r.name}</strong><span>{categoryMap[r.category_id] || "ללא קטגוריה"} · יום {r.day_of_month}</span></div>
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
              <label>קטגוריה<select value={txForm.category_id} onChange={(e) => setTxForm({ ...txForm, category_id: e.target.value })}><option value="">ללא קטגוריה</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              {modal !== "income" && txForm.expense_type === "fixed" && <label>סכום מתוכנן<input type="number" min="0" step="0.01" value={txForm.planned_amount} onChange={(e) => setTxForm({ ...txForm, planned_amount: e.target.value })} /></label>}
              <label>סכום בפועל<input type="number" min="0" step="0.01" value={txForm.actual_amount} onChange={(e) => setTxForm({ ...txForm, actual_amount: e.target.value })} placeholder={modal === "income" ? "" : "השאירי ריק אם טרם חויב"} /></label>
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
        .active-filters{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 16px}
        .active-filters button{border:1px solid rgba(0,0,0,.1);background:rgba(0,0,0,.025);border-radius:999px;padding:7px 11px;cursor:pointer;font:inherit}
        .active-filters .clear-all{background:transparent;border-color:transparent;text-decoration:underline}
        .payment-summary{margin:18px 0 22px;padding:18px;border:1px solid rgba(0,0,0,.08);border-radius:16px}
        .payment-summary-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:12px}
        .payment-summary-head h3{margin:0 0 4px}.payment-summary-head p{margin:0}.payment-summary-head>strong{font-size:20px}
        .column-head{display:inline-flex;align-items:center;gap:4px;position:relative}
        .sort-head{border:0;background:transparent;padding:4px 0;font:inherit;font-weight:700;cursor:pointer;color:inherit;white-space:nowrap}
        .sort-head:hover{opacity:.7}
        .column-filter{position:relative;display:inline-block}
        .column-filter summary{list-style:none;cursor:pointer;border:0;background:transparent;padding:4px 5px;font-size:13px;line-height:1;opacity:.65}
        .column-filter summary::-webkit-details-marker{display:none}.column-filter.active summary{opacity:1;font-weight:800}
        .column-filter-menu{position:absolute;z-index:100;top:calc(100% + 6px);right:0;min-width:170px;max-width:260px;max-height:260px;overflow:auto;padding:6px;background:white;border:1px solid rgba(0,0,0,.12);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.14)}
        .filter-option{display:block;width:100%;border:0;background:transparent;padding:9px 10px;border-radius:8px;text-align:right;font:inherit;cursor:pointer}
        .filter-option:hover{background:rgba(0,0,0,.05)}.filter-option.all{font-weight:700}
        .clickable-row{cursor:pointer}.clickable-row:hover{background:rgba(0,0,0,.035)}
      `}</style>
    </main>
  );
}

function Stat({ title, value, subtitle, tone = "" }) {
  return <div className="stat"><span>{title}</span><strong className={tone}>{value}</strong>{subtitle && <small>{subtitle}</small>}</div>;
}

function Panel({ title, children }) {
  return <section className="panel"><div className="panel-head"><h2>{title}</h2></div>{children}</section>;
}

function Empty({ text }) { return <div className="empty">{text}</div>; }

function Bars({ data }) {
  const max = Math.max(...data.map((x) => x.value), 1);
  return <div className="chart-list">{data.map((x) => (
    <div className="chart-row" key={x.label}>
      <div className="chart-label">{x.label}</div>
      <div className="chart-track"><div className="chart-bar" style={{ width: `${(x.value / max) * 100}%` }} /></div>
      <strong>{money(x.value)}</strong>
    </div>
  ))}</div>;
}

function paymentMethodLabel(tx) {
  const method = tx.payment_method || "other";
  return {
    credit_card:"כרטיס אשראי", direct_debit:"הוראת קבע", standing_order:"הוראת קבע",
    horaat_kava:"הוראת קבע", bank:"חשבון בנק", cash:"מזומן", bit:"ביט",
    paybox:"פייבוקס", other:"אחר / לא צוין"
  }[method] || "אחר / לא צוין";
}

function cardLast4(tx) {
  return tx.payment_method === "credit_card" && tx.credit_card_last4
    ? String(tx.credit_card_last4).slice(-4) : "";
}

function paymentGroupKey(tx) {
  return tx.payment_method === "credit_card"
    ? `card:${cardLast4(tx) || "unknown"}`
    : `method:${tx.payment_method || "other"}`;
}

function paymentGroupLabel(tx) {
  if (tx.payment_method === "credit_card") {
    const last4 = cardLast4(tx);
    return last4 ? `כרטיס אשראי •••• ${last4}` : "כרטיס אשראי •••• לא צוין";
  }
  return paymentMethodLabel(tx);
}

/* =========================================================
   הוצאות
   הטבלה כאן משתמשת במחלקות חדשות לחלוטין.
   היא לא משתמשת ב-transactions-table או expense-table,
   ולכן חוקי ה-CSS הישנים לא יכולים להפוך את ה-td לבלוקים.
   ========================================================= */

function ExpensesView({ transactions, onOpen, filters, setFilters, sort, setSort, onAdd }) {
  const [openFilter, setOpenFilter] = useState(null);

  const options = useMemo(() => ({
    date: [...new Set(transactions.map((t) => t.transaction_date).filter(Boolean))].sort((a,b) => b.localeCompare(a)),
    description: [...new Set(transactions.map((t) => t.description || "ללא תיאור"))].sort((a,b) => a.localeCompare(b,"he")),
    amount: [...new Set(transactions.map((t) => Number(t.actual_amount || 0)))].sort((a,b) => a-b),
    payment: [...new Set(transactions.map((t) => t.payment_method || "other"))],
    card: [...new Set(transactions.map(cardLast4).filter(Boolean))].sort()
  }), [transactions]);

  const filtered = useMemo(() => transactions.filter((t) => {
    const amount = Number(t.actual_amount || 0);
    const date = String(t.transaction_date || "");
    const description = t.description || "ללא תיאור";
    const payment = t.payment_method || "other";
    const card = cardLast4(t);
    if (filters.date && date !== filters.date) return false;
    if (filters.description && description !== filters.description) return false;
    if (filters.amount !== "" && amount !== Number(filters.amount)) return false;
    if (filters.paymentMethod && payment !== filters.paymentMethod) return false;
    if (filters.cardLast4 && card !== filters.cardLast4) return false;
    return true;
  }), [transactions, filters]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a,b) => {
      let av, bv;
      if (sort.key === "description") { av = a.description || ""; bv = b.description || ""; }
      else if (sort.key === "amount") { av = Number(a.actual_amount || 0); bv = Number(b.actual_amount || 0); }
      else if (sort.key === "payment") { av = paymentMethodLabel(a); bv = paymentMethodLabel(b); }
      else if (sort.key === "card") { av = cardLast4(a); bv = cardLast4(b); }
      else { av = String(a.transaction_date || ""); bv = String(b.transaction_date || ""); }
      const cmp = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv), "he");
      return sort.direction === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [filtered, sort]);

  const paymentSummary = useMemo(() => {
    const map = new Map();
    filtered.forEach((t) => {
      const key = paymentGroupKey(t), existing = map.get(key);
      if (existing) existing.value += Number(t.actual_amount || 0);
      else map.set(key, { label: paymentGroupLabel(t), value: Number(t.actual_amount || 0) });
    });
    return [...map.values()].sort((a,b) => b.value-a.value);
  }, [filtered]);

  const total = filtered.reduce((sum,t) => sum + Number(t.actual_amount || 0), 0);

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
    setFilters((prev) => ({ ...prev, [key]: value }));
    setOpenFilter(null);
  }

  function clearFilter(key) {
    setFilters((prev) => ({ ...prev, [key]: "" }));
  }

  function filterValue(key) {
    if (key === "payment") return filters.paymentMethod;
    if (key === "card") return filters.cardLast4;
    return filters[key] || "";
  }

  function renderFilter(key, items, labelFor = (x) => x) {
    const active = Boolean(filterValue(key));
    const filterKey = key === "payment" ? "paymentMethod" : key === "card" ? "cardLast4" : key;
    return (
      <details className={`column-filter ${active ? "active" : ""}`} open={openFilter === key}
        onToggle={(e) => setOpenFilter(e.currentTarget.open ? key : null)}>
        <summary title="סינון">⌄</summary>
        <div className="column-filter-menu">
          <button type="button" className="filter-option all" onClick={() => setFilter(filterKey, "")}>הכל</button>
          {items.map((item) => {
            const value = key === "amount" ? String(item) : item;
            return <button type="button" className="filter-option" key={String(value)}
              onClick={() => setFilter(filterKey, value)}>{labelFor(item)}</button>;
          })}
        </div>
      </details>
    );
  }

  const cellStyle = {
    display: "table-cell", padding: "12px 14px", textAlign: "right",
    verticalAlign: "middle", borderBottom: "1px solid rgba(0,0,0,.08)", whiteSpace: "nowrap"
  };

  const headerCellStyle = {
    ...cellStyle, fontWeight: 700, background: "rgba(0,0,0,.035)",
    position: "relative"
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <div><h2>הוצאות</h2><p>{filtered.length} הוצאות · סה״כ {money(total)}</p></div>
        <button className="primary" onClick={onAdd}>＋ הוצאה</button>
      </div>

      <div className="active-filters">
        {filters.date && <button type="button" onClick={() => clearFilter("date")}>תאריך: {dateText(filters.date)} ×</button>}
        {filters.description && <button type="button" onClick={() => clearFilter("description")}>תיאור: {filters.description} ×</button>}
        {filters.amount !== "" && <button type="button" onClick={() => clearFilter("amount")}>סכום: {money(filters.amount)} ×</button>}
        {filters.paymentMethod && <button type="button" onClick={() => clearFilter("paymentMethod")}>אופן תשלום: {paymentMethodLabel({payment_method: filters.paymentMethod})} ×</button>}
        {filters.cardLast4 && <button type="button" onClick={() => clearFilter("cardLast4")}>כרטיס: •••• {filters.cardLast4} ×</button>}
        {Object.values(filters).some((v) => v !== "") && <button type="button" className="clear-all"
          onClick={() => setFilters({date:"",description:"",amount:"",paymentMethod:"",cardLast4:""})}>ניקוי הכל</button>}
      </div>

      <div className="payment-summary">
        <div className="payment-summary-head">
          <div><h3>הוצאות לפי אמצעי תשלום וכרטיס</h3><p>כרטיסי אשראי מסוכמים לפי 4 הספרות האחרונות</p></div>
          <strong>{money(total)}</strong>
        </div>
        {paymentSummary.length ? <Bars data={paymentSummary} /> : <Empty text="אין הוצאות שתואמות לסינון." />}
      </div>

      <div className="expenses-table-wrap" style={{
        width:"100%", overflowX:"auto", overflowY:"visible",
        WebkitOverflowScrolling:"touch", direction:"rtl"
      }}>
        <table className="expenses-data-table" style={{
          width:"100%", minWidth:"820px", tableLayout:"fixed",
          borderCollapse:"collapse", borderSpacing:0, direction:"rtl"
        }}>
          <colgroup>
            <col style={{width:"130px"}} />
            <col style={{width:"250px"}} />
            <col style={{width:"130px"}} />
            <col style={{width:"180px"}} />
            <col style={{width:"150px"}} />
          </colgroup>

          <thead>
            <tr style={{display:"table-row"}}>
              <th scope="col" style={headerCellStyle}><div className="column-head">
                <button type="button" className="sort-head" onClick={() => toggleSort("date")}>תאריך {sortIcon("date")}</button>
                {renderFilter("date", options.date, dateText)}
              </div></th>

              <th scope="col" style={headerCellStyle}><div className="column-head">
                <button type="button" className="sort-head" onClick={() => toggleSort("description")}>תיאור {sortIcon("description")}</button>
                {renderFilter("description", options.description)}
              </div></th>

              <th scope="col" style={headerCellStyle}><div className="column-head">
                <button type="button" className="sort-head" onClick={() => toggleSort("amount")}>סכום {sortIcon("amount")}</button>
                {renderFilter("amount", options.amount, (x) => money(x))}
              </div></th>

              <th scope="col" style={headerCellStyle}><div className="column-head">
                <button type="button" className="sort-head" onClick={() => toggleSort("payment")}>אופן תשלום {sortIcon("payment")}</button>
                {renderFilter("payment", options.payment, (x) => paymentMethodLabel({payment_method:x}))}
              </div></th>

              <th scope="col" style={headerCellStyle}><div className="column-head">
                <button type="button" className="sort-head" onClick={() => toggleSort("card")}>4 ספרות אחרונות {sortIcon("card")}</button>
                {renderFilter("card", options.card, (x) => `•••• ${x}`)}
              </div></th>
            </tr>
          </thead>

          <tbody>
            {sorted.map((t) => (
              <tr key={t.id} className="expenses-data-row" onClick={() => onOpen(t)}
                title="לחצי לפתיחת פרטי ההוצאה" style={{display:"table-row",cursor:"pointer"}}>
                <td style={cellStyle}>{dateText(t.transaction_date)}</td>
                <td style={cellStyle}>{t.description || "ללא תיאור"}</td>
                <td style={cellStyle} className="negative"><strong>{money(t.actual_amount)}</strong></td>
                <td style={cellStyle}>{paymentMethodLabel(t)}</td>
                <td style={cellStyle}>{cardLast4(t) ? `•••• ${cardLast4(t)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {!sorted.length && <Empty text="אין הוצאות שתואמות לסינון." />}
      </div>

      <style jsx>{`
        .expenses-data-table th,.expenses-data-table td{box-sizing:border-box}
        .expenses-data-table .expenses-data-row:hover{background:rgba(0,0,0,.035)}
        .expenses-data-table .column-head{display:inline-flex;align-items:center;gap:4px;position:relative}
        .expenses-data-table .sort-head{border:0;background:transparent;padding:4px 0;font:inherit;font-weight:700;cursor:pointer;color:inherit;white-space:nowrap}
        .expenses-data-table .sort-head:hover{opacity:.7}
        .expenses-data-table .column-filter{position:relative;display:inline-block}
        .expenses-data-table .column-filter summary{list-style:none;cursor:pointer;border:0;background:transparent;padding:4px 5px;font-size:13px;line-height:1;opacity:.65}
        .expenses-data-table .column-filter summary::-webkit-details-marker{display:none}
        .expenses-data-table .column-filter.active summary{opacity:1;font-weight:800}
        .expenses-data-table .column-filter-menu{position:absolute;z-index:100;top:calc(100% + 6px);right:0;min-width:170px;max-width:260px;max-height:260px;overflow:auto;padding:6px;background:white;border:1px solid rgba(0,0,0,.12);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.14)}
        .expenses-data-table .filter-option{display:block;width:100%;border:0;background:transparent;padding:9px 10px;border-radius:8px;text-align:right;font:inherit;cursor:pointer}
        .expenses-data-table .filter-option:hover{background:rgba(0,0,0,.05)}
        .expenses-data-table .filter-option.all{font-weight:700}
        @media(max-width:700px){
          .expenses-table-wrap{margin-left:0;margin-right:0;width:100%}
          .expenses-data-table{min-width:820px}
          .expenses-data-table .column-filter-menu{position:fixed;right:12px;left:12px;top:auto;max-width:none}
        }
      `}</style>
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
