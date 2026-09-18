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
  transaction_date: new Date().toISOString().slice(0, 10),
  note: "",
  payment_method: "",
  merchant: "",
  credit_card_last4: "",
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

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;

      setUser(data.session?.user || null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (user) {
      refresh();
    } else {
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

      if (h.error) {
        throw h.error;
      }

      const hr = h.data?.[0];

      if (!hr) {
        setHousehold(null);
        return;
      }

      const householdId = hr.household_id;

      setHousehold({
        id: householdId,
        name: hr.household_name,
      });

      const [
        membersResult,
        categoriesResult,
        transactionsResult,
        recurringResult,
      ] = await Promise.all([
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
          .lt(
            "transaction_date",
            `${shiftMonth(month, 1)}-01`
          )
          .order("transaction_date", {
            ascending: false,
          })
          .order("created_at", {
            ascending: false,
          }),

        supabase
          .from("recurring_expenses")
          .select("*")
          .eq("household_id", householdId)
          .eq("is_active", true)
          .order("day_of_month")
          .order("name"),
      ]);

      if (membersResult.error) {
        console.error(
          "Members error:",
          membersResult.error
        );
      }

      if (categoriesResult.error) {
        console.error(
          "Categories error:",
          categoriesResult.error
        );
      }

      if (transactionsResult.error) {
        console.error(
          "Transactions error:",
          transactionsResult.error
        );
      }

      if (recurringResult.error) {
        console.error(
          "Recurring error:",
          recurringResult.error
        );
      }

      const members = membersResult.data || [];

      setProfiles(
        members.map((member) => ({
          id: member.user_id,
          display_name:
            member.display_name || "ללא שם",
          role: member.role,
        }))
      );

      setCategories(
        categoriesResult.data || []
      );

      setTransactions(
        transactionsResult.data || []
      );

      setRecurring(
        recurringResult.data || []
      );
    } catch (e) {
      console.error(e);

      setError(
        e.message ||
          "שגיאה בטעינת הנתונים"
      );
    } finally {
      setLoading(false);
    }
  }

  async function signIn(event) {
    event.preventDefault();

    setLoginError("");

    const { error } =
      await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

    if (error) {
      setLoginError(
        "ההתחברות נכשלה. בדקי את האימייל והסיסמה."
      );
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  function openTx(
    transaction = null,
    kind = "expense"
  ) {
    setError("");
    setEditingTx(transaction);

    if (transaction) {
      setTxForm({
        description:
          transaction.description || "",

        category_id:
          transaction.category_id || "",

        expense_type:
          transaction.expense_type ||
          "variable",

        planned_amount:
          transaction.planned_amount ?? "",

        actual_amount:
          transaction.actual_amount ?? "",

        person_user_id:
          transaction.person_user_id ||
          "",

        transaction_date:
          transaction.transaction_date ||
          new Date()
            .toISOString()
            .slice(0, 10),

        note:
          transaction.note || "",

        payment_method:
          transaction.payment_method ||
          "",

        merchant:
          transaction.merchant || "",

        credit_card_last4:
          transaction.credit_card_last4 ||
          "",

        kind,
      });
    } else {
      setTxForm({
        ...emptyTx(),
        kind,
      });
    }

    setModal(
      kind === "income"
        ? "income"
        : "transaction"
    );
  }

  function closeModal() {
    setModal(null);
    setEditingTx(null);
    setEditingRecurring(null);
    setError("");
  }

  async function saveTx(event) {
    event.preventDefault();

    if (saving || !household) {
      return;
    }

    setError("");

    const form = txForm;

    const kind =
      modal === "income"
        ? "income"
        : "expense";

    const description = String(
      form.description || ""
    ).trim();

    const actual =
      form.actual_amount === ""
        ? null
        : Number(form.actual_amount);

    const planned =
      kind === "expense" &&
      form.expense_type === "fixed"
        ? Number(form.planned_amount)
        : actual;

    if (!description) {
      setError("יש להזין תיאור.");
      return;
    }

    if (!form.transaction_date) {
      setError("יש לבחור תאריך.");
      return;
    }

    if (
      kind === "expense" &&
      form.expense_type === "fixed" &&
      (
        !Number.isFinite(planned) ||
        planned < 0
      )
    ) {
      setError(
        "יש להזין סכום מתוכנן תקין."
      );
      return;
    }

    if (
      actual !== null &&
      (
        !Number.isFinite(actual) ||
        actual < 0
      )
    ) {
      setError(
        "יש להזין סכום בפועל תקין."
      );
      return;
    }

    if (
      kind === "income" &&
      (
        !Number.isFinite(actual) ||
        actual < 0
      )
    ) {
      setError("יש להזין סכום תקין.");
      return;
    }

    const row = {
      household_id: household.id,

      created_by:
        user?.id || null,

      kind,

      description,

      category_id:
        form.category_id || null,

      transaction_date:
        form.transaction_date,

      planned_amount:
        kind === "expense" &&
        form.expense_type === "fixed"
          ? planned
          : actual,

      completed:
        kind === "income"
          ? true
          : actual !== null,

      actual_amount: actual,

      expense_type:
        kind === "expense"
          ? form.expense_type
          : null,

      person_user_id:
        form.person_user_id || null,

      note:
        String(form.note || "").trim() ||
        null,

      payment_method:
        form.payment_method || null,

      merchant:
        String(form.merchant || "").trim() ||
        null,

      credit_card_last4:
        String(
          form.credit_card_last4 || ""
        )
          .replace(/\D/g, "")
          .slice(-4) || null,
    };

    setSaving(true);

    try {
      let result;

      if (editingTx) {
        result = await supabase
          .from("transactions")
          .update(row)
          .eq(
            "id",
            editingTx.id
          )
          .eq(
            "household_id",
            household.id
          )
          .select("*")
          .single();
      } else {
        result = await supabase
          .from("transactions")
          .insert(row)
          .select("*")
          .single();
      }

      if (result.error) {
        throw result.error;
      }

      closeModal();

      await refresh();
    } catch (e) {
      console.error(e);

      setError(
        e.message ||
          "לא הצלחתי לשמור את התנועה."
      );
    } finally {
      setSaving(false);
    }
  }

  function openRecurring(
    item = null
  ) {
    setError("");
    setEditingRecurring(item);

    setRecForm(
      item
        ? {
            name:
              item.name || "",

            category_id:
              item.category_id || "",

            planned_amount:
              item.planned_amount ?? "",

            day_of_month:
              item.day_of_month ?? "1",

            payment_method:
              item.payment_method || "",

            merchant:
              item.merchant || "",

            person_user_id:
              item.person_user_id || "",

            note:
              item.note || "",
          }
        : emptyRecurring()
    );

    setModal("recurring");
  }

  async function saveRecurring(event) {
    event.preventDefault();

    if (saving || !household) {
      return;
    }

    setError("");

    const form = recForm;

    const planned =
      Number(form.planned_amount);

    const day =
      Number(form.day_of_month);

    if (
      !String(form.name || "").trim()
    ) {
      setError(
        "יש להזין שם הוצאה."
      );
      return;
    }

    if (
      !Number.isFinite(planned) ||
      planned < 0
    ) {
      setError(
        "יש להזין סכום מתוכנן תקין."
      );
      return;
    }

    if (
      !Number.isInteger(day) ||
      day < 1 ||
      day > 31
    ) {
      setError(
        "יום בחודש חייב להיות בין 1 ל־31."
      );
      return;
    }

    const row = {
      household_id:
        household.id,

      name:
        String(form.name).trim(),

      category_id:
        form.category_id || null,

      planned_amount:
        planned,

      day_of_month:
        day,

      person_user_id:
        form.person_user_id || null,

      is_active:
        true,

      note:
        String(form.note || "").trim() ||
        null,

      payment_method:
        form.payment_method || null,

      merchant:
        String(form.merchant || "").trim() ||
        null,
    };

    setSaving(true);

    try {
      let result;

      if (editingRecurring) {
        result = await supabase
          .from("recurring_expenses")
          .update(row)
          .eq(
            "id",
            editingRecurring.id
          )
          .eq(
            "household_id",
            household.id
          )
          .select("*")
          .single();
      } else {
        result = await supabase
          .from("recurring_expenses")
          .insert(row)
          .select("*")
          .single();
      }

      if (result.error) {
        throw result.error;
      }

      closeModal();

      await refresh();
    } catch (e) {
      console.error(e);

      setError(
        e.message ||
          "לא הצלחתי לשמור את ההוצאה הקבועה."
      );
    } finally {
      setSaving(false);
    }
  }

  async function chargeRecurring(item) {
    if (saving || !household) {
      return;
    }

    const actualText =
      window.prompt(
        `סכום בפועל עבור ${item.name}\nמתוכנן: ${money(
          item.planned_amount
        )}`,
        String(
          item.planned_amount ?? ""
        )
      );

    if (actualText === null) {
      return;
    }

    const actual =
      Number(actualText);

    if (
      !Number.isFinite(actual) ||
      actual < 0
    ) {
      window.alert(
        "יש להזין סכום תקין."
      );
      return;
    }

    setSaving(true);
    setError("");

    try {
      const {
        data: existing,
        error: findError,
      } = await supabase
        .from("transactions")
        .select("*")
        .eq(
          "recurring_expense_id",
          item.id
        )
        .eq(
          "recurring_month",
          month
        )
        .maybeSingle();

      if (findError) {
        throw findError;
      }

      const day = Math.min(
        Number(item.day_of_month) || 1,
        28
      );

      const row = {
        household_id:
          household.id,

        created_by:
          user?.id || null,

        kind:
          "expense",

        description:
          item.name,

        category_id:
          item.category_id || null,

        transaction_date:
          `${month}-${String(day).padStart(
            2,
            "0"
          )}`,

        planned_amount:
          Number(
            item.planned_amount || 0
          ),

        completed:
          true,

        actual_amount:
          actual,

        expense_type:
          "fixed",

        person_user_id:
          item.person_user_id || null,

        note:
          item.note || null,

        payment_method:
          item.payment_method || null,

        merchant:
          item.merchant || null,

        recurring_expense_id:
          item.id,

        recurring_month:
          month,
      };

      let result;

      if (existing) {
        result = await supabase
          .from("transactions")
          .update(row)
          .eq(
            "id",
            existing.id
          )
          .select("*")
          .single();
      } else {
        result = await supabase
          .from("transactions")
          .insert(row)
          .select("*")
          .single();
      }

      if (result.error) {
        throw result.error;
      }

      await refresh();
    } catch (e) {
      console.error(e);

      setError(
        e.message ||
          "לא הצלחתי לסמן כחויב."
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteTx(tx) {
    setConfirm(null);
    setSaving(true);

    try {
      const { error } =
        await supabase
          .from("transactions")
          .delete()
          .eq("id", tx.id)
          .eq(
            "household_id",
            household.id
          );

      if (error) {
        throw error;
      }

      await refresh();
    } catch (e) {
      setError(
        e.message ||
          "המחיקה נכשלה."
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecurring(
    item
  ) {
    setConfirm(null);
    setSaving(true);

    try {
      const { error } =
        await supabase
          .from("recurring_expenses")
          .delete()
          .eq(
            "id",
            item.id
          )
          .eq(
            "household_id",
            household.id
          );

      if (error) {
        throw error;
      }

      await refresh();
    } catch (e) {
      setError(
        e.message ||
          "המחיקה נכשלה."
      );
    } finally {
      setSaving(false);
    }
  }

  async function addCategory() {
    const name =
      String(
        newCategory || ""
      ).trim();

    if (!name || !household) {
      return;
    }

    setSaving(true);

    try {
      const { error } =
        await supabase
          .from("categories")
          .insert({
            household_id:
              household.id,
            name,
          });

      if (error) {
        throw error;
      }

      setNewCategory("");

      await refresh();
    } catch (e) {
      setError(
        e.message ||
          "לא הצלחתי להוסיף קטגוריה."
      );
    } finally {
      setSaving(false);
    }
  }

  const categoryMap = useMemo(
    () =>
      Object.fromEntries(
        categories.map((c) => [
          c.id,
          c.name,
        ])
      ),
    [categories]
  );

  const memberMap = useMemo(
    () =>
      Object.fromEntries(
        profiles.map((p) => [
          p.id,
          p.display_name,
        ])
      ),
    [profiles]
  );

  const expenseTx = useMemo(
    () =>
      transactions.filter(
        (t) =>
          t.kind === "expense" &&
          t.actual_amount !== null
      ),
    [transactions]
  );

  const incomeTx = useMemo(
    () =>
      transactions.filter(
        (t) =>
          t.kind === "income"
      ),
    [transactions]
  );

  const actualIncome =
    incomeTx.reduce(
      (sum, t) =>
        sum +
        Number(
          t.actual_amount || 0
        ),
      0
    );

  const actualExpenses =
    expenseTx.reduce(
      (sum, t) =>
        sum +
        Number(
          t.actual_amount || 0
        ),
      0
    );

  const fixedActual =
    expenseTx
      .filter(
        (t) =>
          t.expense_type ===
          "fixed"
      )
      .reduce(
        (sum, t) =>
          sum +
          Number(
            t.actual_amount || 0
          ),
        0
      );

  const variableActual =
    expenseTx
      .filter(
        (t) =>
          t.expense_type ===
          "variable"
      )
      .reduce(
        (sum, t) =>
          sum +
          Number(
            t.actual_amount || 0
          ),
        0
      );

  const chargedRecurringIds =
    new Set(
      expenseTx
        .filter(
          (t) =>
            t.recurring_expense_id &&
            t.recurring_month ===
              month
        )
        .map(
          (t) =>
            t.recurring_expense_id
        )
    );

  const pendingRecurring =
    recurring.filter(
      (r) =>
        !chargedRecurringIds.has(
          r.id
        )
    );

  const plannedFixed =
    recurring.reduce(
      (sum, r) =>
        sum +
        Number(
          r.planned_amount || 0
        ),
      0
    );

  const pendingPlanned =
    pendingRecurring.reduce(
      (sum, r) =>
        sum +
        Number(
          r.planned_amount || 0
        ),
      0
    );

  const typeChart = [
    {
      label: "קבועות",
      value: fixedActual,
    },
    {
      label: "משתנות",
      value: variableActual,
    },
  ];

  const categoryChart =
    useMemo(() => {
      const map = {};

      expenseTx.forEach(
        (transaction) => {
          const name =
            categoryMap[
              transaction.category_id
            ] ||
            "ללא קטגוריה";

          map[name] =
            (map[name] || 0) +
            Number(
              transaction.actual_amount ||
                0
            );
        }
      );

      return Object.entries(map)
        .map(
          ([label, value]) => ({
            label,
            value,
          })
        )
        .sort(
          (a, b) =>
            b.value - a.value
        )
        .slice(0, 8);
    }, [expenseTx, categoryMap]);

  if (!user) {
    return (
      <main
        className="login-page"
        dir="rtl"
      >
        <form
          className="login-card"
          onSubmit={signIn}
        >
          <div className="logo-circle">
            ₪
          </div>

          <h1>
            התקציב המשפחתי
          </h1>

          <p className="muted">
            כניסה לחשבון המשפחתי
          </p>

          <label>
            אימייל

            <input
              type="email"
              value={email}
              onChange={(event) =>
                setEmail(
                  event.target.value
                )
              }
            />
          </label>

          <label>
            סיסמה

            <input
              type="password"
              value={password}
              onChange={(event) =>
                setPassword(
                  event.target.value
                )
              }
            />
          </label>

          {loginError && (
            <div className="error">
              {loginError}
            </div>
          )}

          <button
            className="primary wide"
            type="submit"
          >
            כניסה
          </button>
        </form>
      </main>
    );
  }

  if (
    loading &&
    !household
  ) {
    return (
      <main
        className="loading-page"
        dir="rtl"
      >
        טוען...
      </main>
    );
  }

  return (
    <main
      className="app"
      dir="rtl"
    >
      <header className="topbar">
        <div>
          <div className="eyebrow">
            התקציב המשפחתי
          </div>

          <h1>
            {household?.name ||
              "התקציב שלי"}
          </h1>
        </div>

        <div className="top-actions">
          <span className="user-name">
            {memberMap[user.id] ||
              "משתמשת"}
          </span>

          <button
            className="ghost"
            onClick={signOut}
          >
            יציאה
          </button>
        </div>
      </header>

      <section className="monthbar">
        <button
          className="month-arrow"
          onClick={() =>
            setMonth(
              shiftMonth(
                month,
                -1
              )
            )
          }
        >
          ‹
        </button>

        <strong>
          {monthLabel(month)}
        </strong>

        <button
          className="month-arrow"
          onClick={() =>
            setMonth(
              shiftMonth(
                month,
                1
              )
            )
          }
        >
          ›
        </button>
      </section>

      <nav className="tabs">
        {[
          [
            "dashboard",
            "סיכום",
          ],
          [
            "expenses",
            "הוצאות",
          ],
          [
            "fixed",
            "הוצאות קבועות",
          ],
          [
            "income",
            "הכנסות",
          ],
          [
            "categories",
            "קטגוריות",
          ],
        ].map(
          ([id, label]) => (
            <button
              key={id}
              className={
                tab === id
                  ? "tab active"
                  : "tab"
              }
              onClick={() =>
                setTab(id)
              }
            >
              {label}
            </button>
          )
        )}
      </nav>

      {error && (
        <div className="global-error">
          {error}
        </div>
      )}

      {tab === "dashboard" && (
        <>
          <div className="page-title">
            <div>
              <h2>
                סיכום חודשי
              </h2>

              <p>
                {monthLabel(month)}
              </p>
            </div>

            <button
              className="primary"
              onClick={() =>
                openTx()
              }
            >
              ＋ הוצאה
            </button>
          </div>

          <section className="cards">
            <Stat
              title="הכנסות בפועל"
              value={money(
                actualIncome
              )}
              tone="positive"
            />

            <Stat
              title="הוצאות בפועל"
              value={money(
                actualExpenses
              )}
              tone="negative"
            />

            <Stat
              title="יתרה"
              value={money(
                actualIncome -
                  actualExpenses
              )}
              tone={
                actualIncome -
                  actualExpenses >=
                0
                  ? "positive"
                  : "negative"
              }
            />

            <Stat
              title="קבועות מתוכננות"
              value={money(
                plannedFixed
              )}
              subtitle={`${pendingRecurring.length} ממתינות לחיוב`}
            />
          </section>

          <div className="two-columns">
            <Panel title="קבועות מול משתנות">
              <Bars
                data={typeChart}
              />
            </Panel>

            <Panel title="הוצאות לפי קטגוריה">
              {categoryChart.length ? (
                <Bars
                  data={categoryChart}
                />
              ) : (
                <Empty
                  text="אין עדיין הוצאות בפועל בחודש הזה."
                />
              )}
            </Panel>
          </div>

          <div className="two-columns">
            <Panel title="הוצאות קבועות ממתינות לחיוב">
              {pendingRecurring.length ? (
                <div className="fixed-list">
                  {pendingRecurring
                    .slice(0, 6)
                    .map((item) => (
                      <div
                        className="fixed-item"
                        key={item.id}
                      >
                        <div>
                          <strong>
                            {item.name}
                          </strong>

                          <small>
                            יום{" "}
                            {
                              item.day_of_month
                            }{" "}
                            ·{" "}
                            {money(
                              item.planned_amount
                            )}
                          </small>
                        </div>

                        <button
                          className="small primary"
                          onClick={() =>
                            chargeRecurring(
                              item
                            )
                          }
                        >
                          סימון כחויבה
                        </button>
                      </div>
                    ))}
                </div>
              ) : (
                <Empty
                  text="כל ההוצאות הקבועות סומנו כחויבות."
                />
              )}
            </Panel>

            <Panel title="תנועות אחרונות">
              {transactions
                .slice(0, 7)
                .map((transaction) => (
                  <div
                    className="recent-row"
                    key={transaction.id}
                  >
                    <div>
                      <strong>
                        {
                          transaction.description
                        }
                      </strong>

                      <small>
                        {dateText(
                          transaction.transaction_date
                        )}{" "}
                        ·{" "}
                        {categoryMap[
                          transaction.category_id
                        ] ||
                          "ללא קטגוריה"}
                      </small>
                    </div>

                    <strong
                      className={
                        transaction.kind ===
                        "income"
                          ? "positive"
                          : "negative"
                      }
                    >
                      {transaction.kind ===
                      "income"
                        ? "+"
                        : "-"}
                      {money(
                        transaction.actual_amount
                      )}
                    </strong>
                  </div>
                ))}

              {!transactions.length && (
                <Empty
                  text="אין תנועות בחודש הזה."
                />
              )}
            </Panel>
          </div>
        </>
      )}

      {tab === "expenses" && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>
                הוצאות
              </h2>

              <p>
                כל ההוצאות בפועל בחודש הנבחר
              </p>
            </div>

            <button
              className="primary"
              onClick={() =>
                openTx()
              }
            >
              ＋ הוצאה
            </button>
          </div>

          <TransactionTable
            transactions={expenseTx}
            categoryMap={categoryMap}
            memberMap={memberMap}
            onEdit={openTx}
            onDelete={(transaction) =>
              setConfirm({
                type: "tx",
                item: transaction,
              })
            }
          />
        </section>
      )}

      {tab === "fixed" && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>
                הוצאות קבועות
              </h2>

              <p>
                מתוכנן ובפועל. חיוב בפועל נכנס להוצאות רק לאחר סימון כחויב.
              </p>
            </div>

            <button
              className="primary"
              onClick={() =>
                openRecurring()
              }
            >
              ＋ הוצאה קבועה
            </button>
          </div>

          <div className="fixed-summary">
            <Stat
              title="מתוכנן"
              value={money(
                plannedFixed
              )}
            />

            <Stat
              title="בפועל"
              value={money(
                fixedActual
              )}
              tone="negative"
            />

            <Stat
              title="ממתין"
              value={money(
                pendingPlanned
              )}
            />
          </div>

          <div className="fixed-list large">
            {recurring.map(
              (item) => {
                const charged =
                  chargedRecurringIds.has(
                    item.id
                  );

                const transaction =
                  expenseTx.find(
                    (t) =>
                      t.recurring_expense_id ===
                        item.id &&
                      t.recurring_month ===
                        month
                  );

                const actual =
                  transaction?.actual_amount;

                return (
                  <div
                    className="fixed-card"
                    key={item.id}
                  >
                    <div className="fixed-main">
                      <strong>
                        {item.name}
                      </strong>

                      <span>
                        {
                          categoryMap[
                            item.category_id
                          ] ||
                          "ללא קטגוריה"
                        }{" "}
                        · יום{" "}
                        {
                          item.day_of_month
                        }
                      </span>
                    </div>

                    <div className="amounts">
                      <span>
                        מתוכנן

                        <b>
                          {money(
                            item.planned_amount
                          )}
                        </b>
                      </span>

                      <span>
                        בפועל

                        <b>
                          {charged
                            ? money(
                                actual
                              )
                            : "—"}
                        </b>
                      </span>
                    </div>

                    <div className="row-actions">
                      {charged ? (
                        <span className="badge success">
                          חויבה
                        </span>
                      ) : (
                        <button
                          className="small primary"
                          onClick={() =>
                            chargeRecurring(
                              item
                            )
                          }
                        >
                          סימון כחויבה
                        </button>
                      )}

                      <button
                        className="icon"
                        onClick={() =>
                          openRecurring(
                            item
                          )
                        }
                      >
                        ✎
                      </button>

                      <button
                        className="icon danger"
                        onClick={() =>
                          setConfirm({
                            type: "recurring",
                            item,
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              }
            )}

            {!recurring.length && (
              <Empty
                text="עדיין לא הוגדרו הוצאות קבועות."
              />
            )}
          </div>
        </section>
      )}

      {tab === "income" && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>
                הכנסות
              </h2>

              <p>
                הכנסות בפועל בחודש הנבחר
              </p>
            </div>

            <button
              className="primary"
              onClick={() =>
                openTx(
                  null,
                  "income"
                )
              }
            >
              ＋ הכנסה
            </button>
          </div>

          <TransactionTable
            transactions={incomeTx}
            categoryMap={categoryMap}
            memberMap={memberMap}
            onEdit={openTx}
            onDelete={(transaction) =>
              setConfirm({
                type: "tx",
                item: transaction,
              })
            }
          />
        </section>
      )}

      {tab === "categories" && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>
                קטגוריות
              </h2>

              <p>
                ניתן להוסיף קטגוריה חדשה.
              </p>
            </div>
          </div>

          <div className="category-add">
            <input
              value={newCategory}
              onChange={(event) =>
                setNewCategory(
                  event.target.value
                )
              }
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
            {categories.map(
              (category) => (
                <div
                  className="category-card"
                  key={category.id}
                >
                  <strong>
                    {category.name}
                  </strong>
                </div>
              )
            )}
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
          {modal ===
          "recurring" ? (
            <form
              className="form"
              onSubmit={
                saveRecurring
              }
            >
              <label>
                שם ההוצאה

                <input
                  value={
                    recForm.name
                  }
                  onChange={(event) =>
                    setRecForm({
                      ...recForm,
                      name: event.target
                        .value,
                    })
                  }
                />
              </label>

              <label>
                קטגוריה

                <select
                  value={
                    recForm.category_id
                  }
                  onChange={(event) =>
                    setRecForm({
                      ...recForm,
                      category_id:
                        event.target
                          .value,
                    })
                  }
                >
                  <option value="">
                    ללא קטגוריה
                  </option>

                  {categories.map(
                    (category) => (
                      <option
                        key={
                          category.id
                        }
                        value={
                          category.id
                        }
                      >
                        {
                          category.name
                        }
                      </option>
                    )
                  )}
                </select>
              </label>

              <div className="form-grid">
                <label>
                  סכום מתוכנן

                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={
                      recForm.planned_amount
                    }
                    onChange={(
                      event
                    ) =>
                      setRecForm({
                        ...recForm,
                        planned_amount:
                          event.target
                            .value,
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
                    value={
                      recForm.day_of_month
                    }
                    onChange={(
                      event
                    ) =>
                      setRecForm({
                        ...recForm,
                        day_of_month:
                          event.target
                            .value,
                      })
                    }
                  />
                </label>
              </div>

              <label>
                בית עסק

                <input
                  value={
                    recForm.merchant
                  }
                  onChange={(event) =>
                    setRecForm({
                      ...recForm,
                      merchant:
                        event.target
                          .value,
                    })
                  }
                />
              </label>

              <label>
                אמצעי תשלום

                <select
                  value={
                    recForm.payment_method
                  }
                  onChange={(event) =>
                    setRecForm({
                      ...recForm,
                      payment_method:
                        event.target
                          .value,
                    })
                  }
                >
                  <option value="">
                    לא צוין
                  </option>

                  <option value="credit_card">
                    כרטיס אשראי
                  </option>

                  <option value="bank">
                    חשבון בנק
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
                    אחר
                  </option>
                </select>
              </label>

              <label>
                על שם מי

                <select
                  value={
                    recForm.person_user_id
                  }
                  onChange={(event) =>
                    setRecForm({
                      ...recForm,
                      person_user_id:
                        event.target
                          .value,
                    })
                  }
                >
                  <option value="">
                    לא צוין
                  </option>

                  {profiles.map(
                    (profile) => (
                      <option
                        key={
                          profile.id
                        }
                        value={
                          profile.id
                        }
                      >
                        {
                          profile.display_name
                        }
                      </option>
                    )
                  )}
                </select>
              </label>

              <label>
                הערה

                <textarea
                  rows="3"
                  value={
                    recForm.note
                  }
                  onChange={(event) =>
                    setRecForm({
                      ...recForm,
                      note: event.target
                        .value,
                    })
                  }
                />
              </label>

              {error && (
                <div className="error">
                  {error}
                </div>
              )}

              <div className="modal-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={
                    closeModal
                  }
                >
                  ביטול
                </button>

                <button
                  className="primary"
                  disabled={saving}
                >
                  {saving
                    ? "שומר..."
                    : "שמירה"}
                </button>
              </div>
            </form>
          ) : (
            <form
              className="form"
              onSubmit={saveTx}
            >
              <label>
                {modal ===
                "income"
                  ? "מקור ההכנסה"
                  : "תיאור"}

                <input
                  value={
                    txForm.description
                  }
                  onChange={(event) =>
                    setTxForm({
                      ...txForm,
                      description:
                        event.target
                          .value,
                    })
                  }
                />
              </label>

              {modal !==
                "income" && (
                <label>
                  סוג הוצאה

                  <select
                    value={
                      txForm.expense_type
                    }
                    onChange={(event) =>
                      setTxForm({
                        ...txForm,
                        expense_type:
                          event.target
                            .value,
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
                  value={
                    txForm.category_id
                  }
                  onChange={(event) =>
                    setTxForm({
                      ...txForm,
                      category_id:
                        event.target
                          .value,
                    })
                  }
                >
                  <option value="">
                    ללא קטגוריה
                  </option>

                  {categories.map(
                    (category) => (
                      <option
                        key={
                          category.id
                        }
                        value={
                          category.id
                        }
                      >
                        {
                          category.name
                        }
                      </option>
                    )
                  )}
                </select>
              </label>

              {modal !==
                "income" &&
                txForm.expense_type ===
                  "fixed" && (
                  <label>
                    סכום מתוכנן

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={
                        txForm.planned_amount
                      }
                      onChange={(
                        event
                      ) =>
                        setTxForm({
                          ...txForm,
                          planned_amount:
                            event.target
                              .value,
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
                  value={
                    txForm.actual_amount
                  }
                  onChange={(event) =>
                    setTxForm({
                      ...txForm,
                      actual_amount:
                        event.target
                          .value,
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
                    value={
                      txForm.transaction_date
                    }
                    onChange={(event) =>
                      setTxForm({
                        ...txForm,
                        transaction_date:
                          event.target
                            .value,
                      })
                    }
                  />
                </label>

                <label>
                  על שם מי

                  <select
                    value={
                      txForm.person_user_id
                    }
                    onChange={(event) =>
                      setTxForm({
                        ...txForm,
                        person_user_id:
                          event.target
                            .value,
                      })
                    }
                  >
                    <option value="">
                      לא צוין
                    </option>

                    {profiles.map(
                      (profile) => (
                        <option
                          key={
                            profile.id
                          }
                          value={
                            profile.id
                          }
                        >
                          {
                            profile.display_name
                          }
                        </option>
                      )
                    )}
                  </select>
                </label>
              </div>

              <div className="form-grid">
                <label>
                  בית עסק

                  <input
                    value={
                      txForm.merchant
                    }
                    onChange={(event) =>
                      setTxForm({
                        ...txForm,
                        merchant:
                          event.target
                            .value,
                      })
                    }
                  />
                </label>

                <label>
                  4 ספרות אחרונות

                  <input
                    inputMode="numeric"
                    maxLength="4"
                    value={
                      txForm.credit_card_last4
                    }
                    onChange={(event) =>
                      setTxForm({
                        ...txForm,
                        credit_card_last4:
                          event.target.value
                            .replace(
                              /\D/g,
                              ""
                            )
                            .slice(
                              -4
                            ),
                      })
                    }
                  />
                </label>
              </div>

              <label>
                אמצעי תשלום

                <select
                  value={
                    txForm.payment_method
                  }
                  onChange={(event) =>
                    setTxForm({
                      ...txForm,
                      payment_method:
                        event.target
                          .value,
                    })
                  }
                >
                  <option value="">
                    לא צוין
                  </option>

                  <option value="credit_card">
                    כרטיס אשראי
                  </option>

                  <option value="bank">
                    חשבון בנק
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
                    אחר
                  </option>
                </select>
              </label>

              <label>
                הערה

                <textarea
                  rows="3"
                  value={
                    txForm.note
                  }
                  onChange={(event) =>
                    setTxForm({
                      ...txForm,
                      note: event.target
                        .value,
                    })
                  }
                />
              </label>

              {error && (
                <div className="error">
                  {error}
                </div>
              )}

              <div className="modal-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={
                    closeModal
                  }
                >
                  ביטול
                </button>

                <button
                  className="primary"
                  disabled={saving}
                >
                  {saving
                    ? "שומר..."
                    : "שמירה"}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}

      {confirm && (
        <Modal
          title="אישור מחיקה"
          onClose={() =>
            setConfirm(null)
          }
        >
          <p>
            למחוק את{" "}
            <strong>
              {confirm.item.name ||
                confirm.item
                  .description}
            </strong>
            ?
          </p>

          <div className="modal-actions">
            <button
              className="ghost"
              onClick={() =>
                setConfirm(null)
              }
            >
              ביטול
            </button>

            <button
              className="danger-button"
              onClick={() =>
                confirm.type ===
                "tx"
                  ? deleteTx(
                      confirm.item
                    )
                  : deleteRecurring(
                      confirm.item
                    )
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

function Stat({
  title,
  value,
  subtitle,
  tone = "",
}) {
  return (
    <div className="stat">
      <span>
        {title}
      </span>

      <strong className={tone}>
        {value}
      </strong>

      {subtitle && (
        <small>
          {subtitle}
        </small>
      )}
    </div>
  );
}

function Panel({
  title,
  children,
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          {title}
        </h2>
      </div>

      {children}
    </section>
  );
}

function Empty({
  text,
}) {
  return (
    <div className="empty">
      {text}
    </div>
  );
}

function Bars({
  data,
}) {
  const max = Math.max(
    ...data.map(
      (item) => item.value
    ),
    1
  );

  return (
    <div className="chart-list">
      {data.map((item) => (
        <div
          className="chart-row"
          key={item.label}
        >
          <div className="chart-label">
            {item.label}
          </div>

          <div className="chart-track">
            <div
              className="chart-bar"
              style={{
                width: `${
                  (item.value /
                    max) *
                  100
                }%`,
              }}
            />
          </div>

          <strong>
            {money(item.value)}
          </strong>
        </div>
      ))}
    </div>
  );
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
            <th>
              תאריך
            </th>

            <th>
              תיאור
            </th>

            <th>
              קטגוריה
            </th>

            <th>
              סוג
            </th>

            <th>
              מתוכנן
            </th>

            <th>
              בפועל
            </th>

            <th>
              מי
            </th>

            <th></th>
          </tr>
        </thead>

        <tbody>
          {transactions.map(
            (transaction) => {
              const income =
                transaction.kind ===
                "income";

              return (
                <tr
                  key={
                    transaction.id
                  }
                >
                  <td>
                    {dateText(
                      transaction.transaction_date
                    )}
                  </td>

                  <td>
                    <strong>
                      {
                        transaction.description
                      }
                    </strong>

                    {transaction.merchant && (
                      <small className="table-sub">
                        {
                          transaction.merchant
                        }
                      </small>
                    )}

                    {transaction.credit_card_last4 && (
                      <small className="table-sub">
                        ••••{" "}
                        {
                          transaction.credit_card_last4
                        }
                      </small>
                    )}
                  </td>

                  <td>
                    {categoryMap[
                      transaction.category_id
                    ] ||
                      "ללא קטגוריה"}
                  </td>

                  <td>
                    <span
                      className={`badge ${
                        income
                          ? "success"
                          : transaction.expense_type ===
                            "fixed"
                          ? "fixed"
                          : "variable"
                      }`}
                    >
                      {income
                        ? "הכנסה"
                        : transaction.expense_type ===
                          "fixed"
                        ? "קבועה"
                        : "משתנה"}
                    </span>
                  </td>

                  <td>
                    {!income &&
                    transaction.expense_type ===
                      "fixed"
                      ? money(
                          transaction.planned_amount
                        )
                      : "—"}
                  </td>

                  <td
                    className={
                      income
                        ? "positive"
                        : "negative"
                    }
                  >
                    {transaction.actual_amount ===
                    null
                      ? "—"
                      : money(
                          transaction.actual_amount
                        )}
                  </td>

                  <td>
                    {memberMap[
                      transaction.person_user_id
                    ] ||
                      "לא צוין"}
                  </td>

                  <td>
                    <div className="table-actions">
                      <button
                        className="icon"
                        onClick={() =>
                          onEdit(
                            transaction,
                            income
                              ? "income"
                              : "expense"
                          )
                        }
                      >
                        ✎
                      </button>

                      <button
                        className="icon danger"
                        onClick={() =>
                          onDelete(
                            transaction
                          )
                        }
                      >
                        ×
                      </button>
                    </div>
                  </td>
                </tr>
              );
            }
          )}
        </tbody>
      </table>

      {!transactions.length && (
        <Empty
          text="אין תנועות בחודש הזה."
        />
      )}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <div className="modal">
        <div className="modal-head">
          <h2>
            {title}
          </h2>

          <button
            type="button"
            className="modal-close"
            onClick={
              onClose
            }
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          {children}
        </div>
      </div>
    </div>
  );
                }
