"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const money = (n) =>
  new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(Number(n || 0));

const monthKey = (d = new Date()) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
};

function Modal({ title, children, onClose }) {
  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <h2>{title}</h2>
          <button className="iconBtn" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function BudgetApp() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [household, setHousehold] = useState(null);
  const [categories, setCategories] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [members, setMembers] = useState([]);
  const [tab, setTab] = useState("dashboard");
  const [month, setMonth] = useState(monthKey());
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [modal, setModal] = useState(null);
  const [transactionKind, setTransactionKind] = useState("expense");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function loadData(userId) {
    setLoading(true);

    const { data: hm, error: hmError } = await supabase
      .from("household_members")
      .select("household_id, role")
      .eq("user_id", userId)
      .maybeSingle();

    if (hmError || !hm) {
      setLoading(false);
      return;
    }

    const { data: householdRows } = await supabase.rpc("get_my_household");
const h = {
  data: householdRows?.[0]
    ? {
        id: householdRows[0].household_id,
        name: householdRows[0].household_name
      }
    : null
};

    const p = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    const [cats, tx, rec, memberResult] = await Promise.all([
      supabase
        .from("categories")
        .select("*")
        .eq("household_id", hm.household_id)
        .eq("is_active", true)
        .order("name"),

      supabase
        .from("transactions")
        .select("*")
        .eq("household_id", hm.household_id)
        .order("transaction_date", { ascending: false }),

      supabase
        .from("recurring_expenses")
        .select("*")
        .eq("household_id", hm.household_id)
        .eq("is_active", true)
        .order("day_of_month"),

      supabase.rpc("get_my_household_members"),
    ]);

    setHousehold(h.data);
    setProfile(p.data);
    setCategories(cats.data || []);
    setTransactions(tx.data || []);
    setRecurring(rec.data || []);

    const membersWithProfiles = (memberResult.data || []).map((member) => ({
      user_id: member.user_id,
      role: member.role,
      profiles: {
        display_name: member.display_name || "משתמש",
      },
    }));

    setMembers(membersWithProfiles);

    setLoading(false);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);

      if (data.session?.user) {
        loadData(data.session.user.id);
      } else {
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);

      if (s?.user) {
        loadData(s.user.id);
      } else {
        setProfile(null);
        setHousehold(null);
        setTransactions([]);
        setRecurring([]);
        setMembers([]);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function login(e) {
    e.preventDefault();
    setAuthError("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setAuthError("פרטי הכניסה לא נכונים.");
    }
  }

  async function logout() {
    await supabase.auth.signOut();
  }

  const currentTx = useMemo(
    () =>
      transactions.filter((t) =>
        String(t.transaction_date || "").startsWith(month)
      ),
    [transactions, month]
  );

  const income = currentTx
    .filter((t) => t.kind === "income")
    .reduce(
      (s, t) => s + Number(t.actual_amount ?? t.planned_amount ?? 0),
      0
    );

  const expenses = currentTx
    .filter((t) => t.kind === "expense")
    .reduce(
      (s, t) => s + Number(t.actual_amount ?? t.planned_amount ?? 0),
      0
    );

  const plannedExpenses = currentTx
    .filter((t) => t.kind === "expense")
    .reduce((s, t) => s + Number(t.planned_amount || 0), 0);

  const fixedExpenses = currentTx
    .filter(
      (t) => t.kind === "expense" && t.expense_type === "fixed"
    )
    .reduce(
      (s, t) => s + Number(t.actual_amount ?? t.planned_amount ?? 0),
      0
    );

  const variableExpenses = expenses - fixedExpenses;
  const balance = income - expenses;

  async function refresh() {
    if (session?.user) {
      await loadData(session.user.id);
    }
  }

  async function saveTransaction(e) {
  alert("הגענו לשמירה");

  e.preventDefault();
    try {
      const f = new FormData(e.currentTarget);
      const kind = f.get("kind");

      if (!household?.id) {
        alert("שגיאה: לא נמצא משק הבית.");
        return;
      }

      if (!session?.user?.id) {
        alert("שגיאה: המשתמש לא מחובר.");
        return;
      }

      const row = {
        household_id: household.id,
        kind,
        description: f.get("description"),
        category_id: f.get("category_id") || null,
        transaction_date: f.get("transaction_date"),
        planned_amount: Number(f.get("planned_amount") || 0),
        completed: f.get("completed") === "on",
        actual_amount: f.get("actual_amount")
          ? Number(f.get("actual_amount"))
          : null,
        expense_type:
          kind === "expense"
            ? f.get("expense_type")
            : null,
        person_user_id:
          f.get("person_user_id") || null,
        note: f.get("note") || null,
        created_by: session.user.id,
      };

      console.log("Saving transaction:", row);

      const { data, error } = await supabase
        .from("transactions")
        .insert(row)
        .select();

      if (error) {
        console.error("Supabase transaction error:", error);
        alert("שגיאה בשמירה:\n" + error.message);
        return;
      }

      console.log("Transaction saved:", data);

      setModal(null);
      await refresh();
    } catch (error) {
      console.error("Unexpected save error:", error);

      alert(
        "שגיאה לא צפויה:\n" +
          (error?.message || String(error))
      );
    }
  }

  async function saveRecurring(e) {
    e.preventDefault();

    try {
      const f = new FormData(e.currentTarget);

      if (!household?.id) {
        alert("שגיאה: לא נמצא משק הבית.");
        return;
      }

      const row = {
        household_id: household.id,
        name: f.get("name"),
        category_id: f.get("category_id") || null,
        planned_amount: Number(f.get("planned_amount") || 0),
        day_of_month: Number(f.get("day_of_month") || 1),
        person_user_id: f.get("person_user_id") || null,
        is_active: true,
        note: f.get("note") || null,
      };

      const { error } = await supabase
        .from("recurring_expenses")
        .insert(row);

      if (error) {
        alert("לא הצלחתי לשמור. " + error.message);
        return;
      }

      setModal(null);
      await refresh();
    } catch (error) {
      alert(
        "שגיאה לא צפויה:\n" +
          (error?.message || String(error))
      );
    }
  }

  async function saveCategory(e) {
    e.preventDefault();

    try {
      const f = new FormData(e.currentTarget);

      if (!household?.id) {
        alert("שגיאה: לא נמצא משק הבית.");
        return;
      }

      const { error } = await supabase
        .from("categories")
        .insert({
          household_id: household.id,
          name: f.get("name"),
          kind: f.get("kind"),
          is_active: true,
        });

      if (error) {
        alert(
          "לא הצלחתי להוסיף קטגוריה. " +
            error.message
        );
        return;
      }

      setModal(null);
      await refresh();
    } catch (error) {
      alert(
        "שגיאה לא צפויה:\n" +
          (error?.message || String(error))
      );
    }
  }

  if (!session) {
    return (
      <main className="auth">
        <div className="authCard">
          <div className="brandMark">₪</div>

          <h1>Kario&apos;s budget</h1>

          <p>התקציב המשפחתי המשותף שלכם</p>

          <form onSubmit={login} className="form">
            <label>
              אימייל

              <input
                type="email"
                value={email}
                onChange={(e) =>
                  setEmail(e.target.value)
                }
                required
              />
            </label>

            <label>
              סיסמה

              <input
                type="password"
                value={password}
                onChange={(e) =>
                  setPassword(e.target.value)
                }
                required
              />
            </label>

            {authError && (
              <div className="error">
                {authError}
              </div>
            )}

            <button
              className="primary"
              type="submit"
            >
              כניסה
            </button>
          </form>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="loading">
        טוען את התקציב…
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="title">
            Kario&apos;s budget
          </div>

          <div className="subtitle">
            {profile?.display_name || "משפחה"} ·{" "}
            {household?.name || "תקציב משותף"}
          </div>
        </div>

        <button
          className="ghost"
          onClick={logout}
        >
          יציאה
        </button>
      </header>

      <nav className="tabs">
        {[
          ["dashboard", "סקירה"],
          ["transactions", "תנועות"],
          ["fixed", "הוצאות קבועות"],
          ["categories", "קטגוריות"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={
              tab === id
                ? "tab active"
                : "tab"
            }
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <section className="content">
        {tab === "dashboard" && (
          <>
            <div className="monthBar">
              <button
                onClick={() => {
                  const d = new Date(
                    month + "-15"
                  );

                  d.setMonth(
                    d.getMonth() - 1
                  );

                  setMonth(monthKey(d));
                }}
              >
                ‹
              </button>

              <strong>
                {new Date(
                  month + "-15"
                ).toLocaleDateString(
                  "he-IL",
                  {
                    month: "long",
                    year: "numeric",
                  }
                )}
              </strong>

              <button
                onClick={() => {
                  const d = new Date(
                    month + "-15"
                  );

                  d.setMonth(
                    d.getMonth() + 1
                  );

                  setMonth(monthKey(d));
                }}
              >
                ›
              </button>
            </div>

            <div className="cards">
              <div className="card income">
                <span>
                  הכנסות בפועל
                </span>

                <b>{money(income)}</b>
              </div>

              <div className="card expense">
                <span>
                  הוצאות בפועל
                </span>

                <b>{money(expenses)}</b>
              </div>

              <div className="card">
                <span>
                  מתוכנן להוצאות
                </span>

                <b>
                  {money(plannedExpenses)}
                </b>
              </div>

              <div
                className={
                  balance >= 0
                    ? "card balance"
                    : "card balance negative"
                }
              >
                <span>יתרה</span>

                <b>{money(balance)}</b>
              </div>
            </div>

            <div className="split">
              <div className="panel">
                <h2>
                  הוצאות קבועות מול משתנות
                </h2>

                <div className="bigStat">
                  {money(fixedExpenses)}
                </div>

                <div className="muted">
                  קבועות
                </div>

                <div className="bar">
                  <span
                    style={{
                      width: expenses
                        ? `${Math.min(
                            100,
                            (fixedExpenses /
                              expenses) *
                              100
                          )}%`
                        : "0%",
                    }}
                  />
                </div>

                <div className="row">
                  <span>משתנות</span>

                  <b>
                    {money(variableExpenses)}
                  </b>
                </div>
              </div>

              <div className="panel">
                <h2>
                  הוצאות קבועות קרובות
                </h2>

                {recurring.length === 0 ? (
                  <p className="muted">
                    עדיין לא הוזנו הוצאות
                    קבועות.
                  </p>
                ) : (
                  recurring
                    .slice(0, 6)
                    .map((r) => (
                      <div
                        className="listRow"
                        key={r.id}
                      >
                        <div>
                          <b>{r.name}</b>

                          <small>
                            כל חודש · יום{" "}
                            {r.day_of_month}
                          </small>
                        </div>

                        <b>
                          {money(
                            r.planned_amount
                          )}
                        </b>
                      </div>
                    ))
                )}
              </div>
            </div>
          </>
        )}

        {tab === "transactions" && (
          <div className="panel">
            <div className="panelHead">
              <h2>תנועות</h2>

              <button
                className="primary small"
                onClick={() =>
                  setModal("transaction")
                }
              >
                + הוספת תנועה
              </button>
            </div>

            <div className="filters">
              <input
                type="month"
                value={month}
                onChange={(e) =>
                  setMonth(e.target.value)
                }
              />
            </div>

            <div className="txList">
              {currentTx.length === 0 ? (
                <p className="muted">
                  אין תנועות בחודש הזה.
                </p>
              ) : (
                currentTx.map((t) => (
                  <div
                    className="tx"
                    key={t.id}
                  >
                    <div>
                      <b>
                        {t.description}
                      </b>

                      <small>
                        {t.transaction_date} ·{" "}
                        {categories.find(
                          (c) =>
                            c.id ===
                            t.category_id
                        )?.name ||
                          "ללא קטגוריה"}

                        {t.expense_type
                          ? " · " +
                            (t.expense_type ===
                            "fixed"
                              ? "קבועה"
                              : "משתנה")
                          : ""}
                      </small>
                    </div>

                    <strong
                      className={
                        t.kind === "income"
                          ? "positive"
                          : "negative"
                      }
                    >
                      {t.kind === "income"
                        ? "+"
                        : "−"}{" "}
                      {money(
                        t.actual_amount ??
                          t.planned_amount
                      )}
                    </strong>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === "fixed" && (
          <div className="panel">
            <div className="panelHead">
              <h2>
                הוצאות קבועות
              </h2>

              <button
                className="primary small"
                onClick={() =>
                  setModal("recurring")
                }
              >
                + הוצאה קבועה
              </button>
            </div>

            {recurring.length === 0 ? (
              <p className="muted">
                אין הוצאות קבועות עדיין.
              </p>
            ) : (
              <div>
                {recurring.map((r) => (
                  <div
                    className="listRow"
                    key={r.id}
                  >
                    <div>
                      <b>{r.name}</b>

                      <small>
                        יום{" "}
                        {r.day_of_month} ·{" "}
                        {categories.find(
                          (c) =>
                            c.id ===
                            r.category_id
                        )?.name ||
                          "ללא קטגוריה"}
                      </small>
                    </div>

                    <b>
                      {money(
                        r.planned_amount
                      )}
                    </b>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "categories" && (
          <div className="panel">
            <div className="panelHead">
              <h2>קטגוריות</h2>

              <button
                className="primary small"
                onClick={() =>
                  setModal("category")
                }
              >
                + קטגוריה
              </button>
            </div>

            <div className="categoryGrid">
              {categories.map((c) => (
                <div
                  className="category"
                  key={c.id}
                >
                  <span>{c.name}</span>

                  <small>
                    {c.kind === "income"
                      ? "הכנסה"
                      : c.kind === "expense"
                      ? "הוצאה"
                      : "שניהם"}
                  </small>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {modal === "transaction" && (
        <Modal
          title="הוספת תנועה"
          onClose={() =>
            setModal(null)
          }
        >
          <form
            className="form"
            onSubmit={saveTransaction}
          >
            <label>
              סוג

              <select
                name="kind"
                value={transactionKind}
                onChange={(e) =>
                  setTransactionKind(
                    e.target.value
                  )
                }
              >
                <option value="expense">
                  הוצאה
                </option>

                <option value="income">
                  הכנסה
                </option>
              </select>
            </label>

            <label>
              תיאור

              <input
                name="description"
                placeholder="למשל: סופר / משכורת"
                required
              />
            </label>

            <label>
              קטגוריה

              <select
                name="category_id"
                required
              >
                <option value="">
                  בחרי קטגוריה
                </option>

                {categories
                  .filter(
                    (c) =>
                      c.kind ===
                        transactionKind ||
                      c.kind === "both"
                  )
                  .map((c) => (
                    <option
                      key={c.id}
                      value={c.id}
                    >
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>

            <div className="two">
              <label>
                תאריך

                <input
                  name="transaction_date"
                  type="date"
                  defaultValue={new Date()
                    .toISOString()
                    .slice(0, 10)}
                  required
                />
              </label>

              <label>
                סכום מתוכנן

                <input
                  name="planned_amount"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                />
              </label>
            </div>

            <label>
              סכום בפועל (אם שונה)

              <input
                name="actual_amount"
                type="number"
                min="0"
                step="0.01"
              />
            </label>

            {transactionKind ===
              "expense" && (
              <label>
                סוג הוצאה

                <select
                  name="expense_type"
                  defaultValue="variable"
                >
                  <option value="variable">
                    משתנה
                  </option>

                  <option value="fixed">
                    קבועה
                  </option>
                </select>
              </label>
            )}

            <label>
              מי שילם/קיבל

              <select name="person_user_id">
                <option value="">
                  לא צוין
                </option>

                {members.map((m) => (
                  <option
                    key={m.user_id}
                    value={m.user_id}
                  >
                    {m.profiles
                      ?.display_name ||
                      "משתמש"}
                  </option>
                ))}
              </select>
            </label>

            <label className="check">
              <input
                name="completed"
                type="checkbox"
                defaultChecked
              />

              {" "}בוצע / חויב בפועל
            </label>

            <label>
              הערה

              <textarea
                name="note"
                rows="3"
              />
            </label>

            <button
              className="primary"
              type="submit"
            >
              שמירה
            </button>
          </form>
        </Modal>
      )}

      {modal === "recurring" && (
        <Modal
          title="הוספת הוצאה קבועה"
          onClose={() =>
            setModal(null)
          }
        >
          <form
            className="form"
            onSubmit={saveRecurring}
          >
            <label>
              שם ההוצאה

              <input
                name="name"
                placeholder="למשל: משכנתא"
                required
              />
            </label>

            <label>
              קטגוריה

              <select name="category_id">
                <option value="">
                  ללא קטגוריה
                </option>

                {categories
                  .filter(
                    (c) =>
                      c.kind !== "income"
                  )
                  .map((c) => (
                    <option
                      key={c.id}
                      value={c.id}
                    >
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>

            <div className="two">
              <label>
                סכום מתוכנן

                <input
                  name="planned_amount"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                />
              </label>

              <label>
                יום בחודש

                <input
                  name="day_of_month"
                  type="number"
                  min="1"
                  max="31"
                  defaultValue="1"
                  required
                />
              </label>
            </div>

            <label>
              מי אחראי

              <select name="person_user_id">
                <option value="">
                  לא צוין
                </option>

                {members.map((m) => (
                  <option
                    key={m.user_id}
                    value={m.user_id}
                  >
                    {m.profiles
                      ?.display_name ||
                      "משתמש"}
                  </option>
                ))}
              </select>
            </label>

            <label>
              הערה

              <textarea
                name="note"
                rows="3"
              />
            </label>

            <button
              className="primary"
              type="submit"
            >
              שמירה
            </button>
          </form>
        </Modal>
      )}

      {modal === "category" && (
        <Modal
          title="קטגוריה חדשה"
          onClose={() =>
            setModal(null)
          }
        >
          <form
            className="form"
            onSubmit={saveCategory}
          >
            <label>
              שם הקטגוריה

              <input
                name="name"
                required
                placeholder="למשל: חופשות"
              />
            </label>

            <label>
              סוג

              <select
                name="kind"
                defaultValue="expense"
              >
                <option value="expense">
                  הוצאה
                </option>

                <option value="income">
                  הכנסה
                </option>

                <option value="both">
                  שניהם
                </option>
              </select>
            </label>

            <button
              className="primary"
              type="submit"
            >
              הוספה
            </button>
          </form>
        </Modal>
      )}
    </main>
  );
                }
