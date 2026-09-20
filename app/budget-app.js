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

      const [m, c, t, r] = await Promise.all([
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

      const members = m.data || [];
      setProfiles(
        members.map((x) => ({
          id: x.user_id,
          display_name: x.display_name || "ללא שם",
          role: x.role,
        }))
      );
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
    const planned =
      kind === "expense" && f.expense_type === "fixed"
        ? Number(f.planned_amount)
        : actual;

    if (!description) return setError("יש להזין תיאור.");
    if (!f.transaction_date) return setError("יש לבחור תאריך.");
    if (kind === "expense" && f.expense_type === "fixed" && (!Number.isFinite(planned) || planned < 0))
      return setError("יש להזין סכום מתוכנן תקין.");
    if (actual !== null && (!Number.isFinite(actual) || actual < 0))
      return setError("יש להזין סכום בפועל תקין.");
    if (kind === "income" && (!Number.isFinite(actual) || actual < 0))
      return setError("יש להזין סכום תקין.");

    const row = {
      household_id: household.id,
      created_by: user?.id || null,
      kind,
      description,
      category_id: f.category_id || null,
      transaction_date: f.transaction_date,
      planned_amount: kind === "expense" && f.expense_type === "fixed" ? planned : actual,
      completed: kind === "income" ? true : actual !== null,
      actual_amount: actual,
      expense_type: kind === "expense" ? f.expense_type : null,
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
        .expense-column-filter summary { list-style: none; cursor: pointer; font-size: 13px; opacity: .7; padding: 2px 4px; border-radius: 6px; }
        .expense-column-filter summary::-webkit-details-marker { display: none; }
        .expense-column-filter.active summary { opacity: 1; font-weight: 800; }
        .expense-filter-menu { position: static; min-width: 170px; max-width: 240px; max-height: 220px; overflow-y: auto; overflow-x: hidden; margin-top: 7px; padding: 6px; border: 1px solid rgba(0,0,0,.12); border-radius: 10px; background: #fff; box-shadow: 0 6px 18px rgba(0,0,0,.10); }
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

function ExpensesView({ transactions, categoryMap, onOpen, filters, setFilters, sort, setSort, onAdd }) {
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
  }

  function filterMenu(key, items, labelFor = (x) => x) {
    const active = key === "date" ? Boolean(filters.fromDate || filters.toDate) : key === "amount" ? Boolean(filters.minAmount || filters.maxAmount) : key === "payment" ? Boolean(filters.paymentMethod) : Boolean(filters[key]);
    return (
      <details className={`expense-column-filter ${active ? "active" : ""}`}>
        <summary title="סינון">⌄</summary>
        <div className="expense-filter-menu">
          <button type="button" onClick={() => setFilter(key, "")}>הכל</button>
          {items.map((item) => (
            <button type="button" key={String(item)} onClick={() => setFilter(key, key === "payment" ? item : item)}>{labelFor(item)}</button>
          ))}
        </div>
      </details>
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
