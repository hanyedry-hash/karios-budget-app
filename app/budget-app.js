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

  return `${x.getFullYear()}-${String(
    x.getMonth() + 1
  ).padStart(2, "0")}`;
};

const todayKey = () =>
  new Date().toISOString().slice(0, 10);

const PAYMENT_METHODS = [
  ["bank_transfer", "העברה בנקאית"],
  ["credit_card", "אשראי"],
  ["bit", "Bit"],
  ["paybox", "PayBox"],
  ["cash", "מזומן"],
  ["standing_order", "הוראת קבע"],
  ["apple_google_pay", "Apple Pay / Google Pay"],
  ["other", "אחר"],
];

const paymentMethodLabel = (value) =>
  PAYMENT_METHODS.find(
    ([id]) => id === value
  )?.[1] || "";

function Modal({
  title,
  children,
  onClose,
}) {
  return (
    <div
      className="modalBackdrop"
      onMouseDown={onClose}
    >
      <div
        className="modal"
        onMouseDown={(e) =>
          e.stopPropagation()
        }
      >
        <div className="modalHead">
          <h2>{title}</h2>

          <button
            className="iconBtn"
            type="button"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}

export default function BudgetApp() {
  const [session, setSession] =
    useState(null);

  const [profile, setProfile] =
    useState(null);

  const [household, setHousehold] =
    useState(null);

  const [categories, setCategories] =
    useState([]);

  const [transactions, setTransactions] =
    useState([]);

  const [recurring, setRecurring] =
    useState([]);

  const [members, setMembers] =
    useState([]);

  const [tab, setTab] =
    useState("dashboard");

  const [month, setMonth] =
    useState(monthKey());

  const [loading, setLoading] =
    useState(true);

  const [authError, setAuthError] =
    useState("");

  const [modal, setModal] =
    useState(null);

  const [transactionKind, setTransactionKind] =
    useState("expense");

  const [editingTransaction, setEditingTransaction] =
    useState(null);

  const [editingRecurring, setEditingRecurring] =
    useState(null);

  const [chargingRecurring, setChargingRecurring] =
    useState(null);

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [transactionCategory, setTransactionCategory] =
    useState("");

  const [transactionPaymentMethod, setTransactionPaymentMethod] =
    useState("");

  const [recurringPaymentMethod, setRecurringPaymentMethod] =
    useState("");

  const [chargePaymentMethod, setChargePaymentMethod] =
    useState("");

  const [categorySource, setCategorySource] =
    useState(null);

  const [transactionDraft, setTransactionDraft] =
    useState(null);

  async function loadData(userId) {
    setLoading(true);

    const {
      data: hm,
      error: hmError,
    } = await supabase
      .from("household_members")
      .select("household_id, role")
      .eq("user_id", userId)
      .maybeSingle();

    if (hmError || !hm) {
      setLoading(false);
      return;
    }

    const {
      data: householdRows,
    } = await supabase.rpc(
      "get_my_household"
    );

    const h = {
      data: householdRows?.[0]
        ? {
            id:
              householdRows[0]
                .household_id,
            name:
              householdRows[0]
                .household_name,
          }
        : null,
    };

    if (!h.data) {
      setLoading(false);
      return;
    }

    const p = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    const [
      cats,
      tx,
      rec,
    ] = await Promise.all([
      supabase
        .from("categories")
        .select("*")
        .eq(
          "household_id",
          hm.household_id
        )
        .eq("is_active", true)
        .order("name"),

      supabase
        .from("transactions")
        .select("*")
        .eq(
          "household_id",
          hm.household_id
        )
        .order(
          "transaction_date",
          {
            ascending: false,
          }
        ),

      supabase
        .from("recurring_expenses")
        .select("*")
        .eq(
          "household_id",
          hm.household_id
        )
        .eq("is_active", true)
        .order("day_of_month"),
    ]);

    const {
      data: householdMembers,
    } = await supabase.rpc(
      "get_my_household_members"
    );

    const membersWithProfiles =
      (
        householdMembers || []
      ).map((member) => ({
        user_id:
          member.user_id,
        role:
          member.role,
        profiles: {
          display_name:
            member.display_name ||
            "משתמש",
        },
      }));

    setHousehold(h.data);
    setProfile(p.data);
    setCategories(cats.data || []);
    setTransactions(tx.data || []);
    setRecurring(rec.data || []);
    setMembers(
      membersWithProfiles
    );

    setLoading(false);
  }

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);

        if (data.session?.user) {
          loadData(
            data.session.user.id
          );
        } else {
          setLoading(false);
        }
      });

    const {
      data: sub,
    } =
      supabase.auth.onAuthStateChange(
        (_event, s) => {
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
        }
      );

    return () =>
      sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user?.id) {
      return;
    }

    loadData(
      session.user.id
    );
  }, [month]);

  async function refresh() {
    if (session?.user?.id) {
      await loadData(
        session.user.id
      );
    }
  }

  async function login(e) {
    e.preventDefault();

    setAuthError("");

    const { error } =
      await supabase.auth.signInWithPassword(
        {
          email,
          password,
        }
      );

    if (error) {
      setAuthError(
        "פרטי הכניסה לא נכונים."
      );
    }
  }

  async function logout() {
    await supabase.auth.signOut();
  }

  const currentTx = useMemo(
    () =>
      transactions.filter((t) =>
        String(
          t.transaction_date || ""
        ).startsWith(month)
      ),
    [transactions, month]
  );

  const income = currentTx
    .filter(
      (t) =>
        t.kind === "income" &&
        t.completed
    )
    .reduce(
      (sum, t) =>
        sum +
        Number(
          t.actual_amount ??
            t.planned_amount ??
            0
        ),
      0
    );

  const expenses = currentTx
    .filter(
      (t) =>
        t.kind === "expense" &&
        t.completed
    )
    .reduce(
      (sum, t) =>
        sum +
        Number(
          t.actual_amount ??
            t.planned_amount ??
            0
        ),
      0
    );

  const recurringForMonth =
    useMemo(() => {
      return recurring.map((r) => {
        const chargedTransaction =
          transactions.find(
            (t) =>
              t.recurring_expense_id ===
                r.id &&
              t.recurring_month ===
                month &&
              t.completed === true &&
              t.actual_amount !== null
          );

        return {
          ...r,
          chargedTransaction:
            chargedTransaction ||
            null,
        };
      });
    }, [
      recurring,
      transactions,
      month,
    ]);

  const plannedExpenses =
    currentTx
      .filter(
        (t) =>
          t.kind === "expense"
      )
      .reduce(
        (sum, t) =>
          sum +
          Number(
            t.planned_amount || 0
          ),
        0
      ) +
    recurringForMonth
      .filter(
        (r) =>
          !r.chargedTransaction
      )
      .reduce(
        (sum, r) =>
          sum +
          Number(
            r.planned_amount || 0
          ),
        0
      );

  const fixedExpenses =
    currentTx
      .filter(
        (t) =>
          t.kind === "expense" &&
          t.expense_type ===
            "fixed" &&
          t.completed
      )
      .reduce(
        (sum, t) =>
          sum +
          Number(
            t.actual_amount ??
              t.planned_amount ??
              0
          ),
        0
      );

  const variableExpenses =
    expenses - fixedExpenses;

  const pendingRecurringAmount =
    recurringForMonth
      .filter(
        (r) =>
          !r.chargedTransaction
      )
      .reduce(
        (sum, r) =>
          sum +
          Number(
            r.planned_amount || 0
          ),
        0
      );

  const balance =
    income - expenses;

  function openNewTransaction() {
    setEditingTransaction(null);
    setTransactionKind("expense");

    const savedDraft =
      typeof window !==
      "undefined"
        ? localStorage.getItem(
            "karios-budget-transaction-draft"
          )
        : null;

    if (savedDraft) {
      try {
        const parsed =
          JSON.parse(
            savedDraft
          );

        setTransactionDraft(
          parsed
        );

        setTransactionKind(
          parsed.kind ||
            "expense"
        );

        setTransactionCategory(
          parsed.category_id ||
            ""
        );

        setTransactionPaymentMethod(
          parsed.payment_method ||
            ""
        );
      } catch {
        setTransactionDraft(
          null
        );

        setTransactionCategory(
          ""
        );

        setTransactionPaymentMethod(
          ""
        );
      }
    } else {
      setTransactionDraft(
        null
      );

      setTransactionCategory(
        ""
      );

      setTransactionPaymentMethod(
        ""
      );
    }

    setModal(
      "transaction"
    );
  }

  function openEditTransaction(
    item
  ) {
    setEditingTransaction(item);

    setTransactionKind(
      item.kind ||
        "expense"
    );

    setTransactionCategory(
      item.category_id ||
        ""
    );

    setTransactionPaymentMethod(
      item.payment_method ||
        ""
    );

    setTransactionDraft(
      null
    );

    setModal(
      "transaction"
    );
  }

  function clearTransactionDraft() {
    if (
      typeof window !==
      "undefined"
    ) {
      localStorage.removeItem(
        "karios-budget-transaction-draft"
      );
    }

    setTransactionDraft(
      null
    );
  }

  function updateTransactionDraft(
    e
  ) {
    if (editingTransaction) {
      return;
    }

    const form =
      e.currentTarget;

    const data =
      new FormData(form);

    const draft = {
      kind:
        data.get("kind") ||
        "expense",

      description:
        data.get(
          "description"
        ) || "",

      category_id:
        data.get(
          "category_id"
        ) || "",

      merchant:
        data.get("merchant") ||
        "",

      transaction_date:
        data.get(
          "transaction_date"
        ) || "",

      planned_amount:
        data.get(
          "planned_amount"
        ) || "",

      actual_amount:
        data.get(
          "actual_amount"
        ) || "",

      expense_type:
        data.get(
          "expense_type"
        ) || "variable",

      payment_method:
        data.get(
          "payment_method"
        ) || "",

      credit_card_last4:
        data.get(
          "credit_card_last4"
        ) || "",

      person_user_id:
        data.get(
          "person_user_id"
        ) || "",

      completed:
        data.get(
          "completed"
        ) === "on",

      note:
        data.get("note") ||
        "",
    };

    setTransactionDraft(
      draft
    );

    if (
      typeof window !==
      "undefined"
    ) {
      localStorage.setItem(
        "karios-budget-transaction-draft",
        JSON.stringify(
          draft
        )
      );
    }
  }

  async function deleteTransaction(
    item
  ) {
    if (
      !item?.id ||
      !household?.id
    ) {
      return;
    }

    const ok =
      window.confirm(
        `למחוק את התנועה "${item.description}"?`
      );

    if (!ok) {
      return;
    }

    const { error } =
      await supabase
        .from("transactions")
        .delete()
        .eq("id", item.id)
        .eq(
          "household_id",
          household.id
        );

    if (error) {
      alert(
        "לא הצלחתי למחוק את התנועה. " +
          error.message
      );
      return;
    }

    await refresh();
  }

  async function saveTransaction(
    e
  ) {
    e.preventDefault();

    if (
      !household?.id ||
      !session?.user?.id
    ) {
      alert(
        "לא נמצא משק הבית או המשתמש המחובר."
      );
      return;
    }

    const f =
      new FormData(
        e.currentTarget
      );

    const kind =
      f.get("kind");

    const paymentMethod =
      f.get(
        "payment_method"
      ) || null;

    const cardLast4Raw =
      String(
        f.get(
          "credit_card_last4"
        ) || ""
      )
        .replace(/\D/g, "")
        .slice(-4);

    const existingCardLast4 =
      editingTransaction
        ?.credit_card_last4 ||
      null;

    const row = {
      household_id:
        household.id,

      kind,

      description:
        f.get(
          "description"
        ),

      merchant:
        kind === "expense"
          ? f.get("merchant") ||
            null
          : null,

      category_id:
        f.get(
          "category_id"
        ) || null,

      transaction_date:
        f.get(
          "transaction_date"
        ),

      planned_amount:
        Number(
          f.get(
            "planned_amount"
          ) || 0
        ),

      completed:
        f.get("completed") ===
        "on",

      actual_amount:
        f.get(
          "actual_amount"
        )
          ? Number(
              f.get(
                "actual_amount"
              )
            )
          : null,

      expense_type:
        kind === "expense"
          ? f.get(
              "expense_type"
            ) ||
            "variable"
          : null,

      person_user_id:
        f.get(
          "person_user_id"
        ) || null,

      payment_method:
        kind === "expense"
          ? paymentMethod
          : null,

      credit_card_last4:
        kind === "expense" &&
        paymentMethod ===
          "credit_card"
          ? cardLast4Raw.length ===
            4
            ? cardLast4Raw
            : existingCardLast4
          : null,

      note:
        f.get("note") ||
        null,
    };

    let result;

    if (
      editingTransaction?.id
    ) {
      result =
        await supabase
          .from(
            "transactions"
          )
          .update(row)
          .eq(
            "id",
            editingTransaction.id
          )
          .eq(
            "household_id",
            household.id
          );
    } else {
      result =
        await supabase
          .from(
            "transactions"
          )
          .insert({
            ...row,
            created_by:
              session.user.id,
          });
    }

    if (result.error) {
      alert(
        "לא הצלחתי לשמור את התנועה. " +
          result.error.message
      );
      return;
    }

    clearTransactionDraft();

    setEditingTransaction(
      null
    );

    setModal(null);

    await refresh();
  }

  function openNewRecurring() {
    setEditingRecurring(
      null
    );

    setRecurringPaymentMethod(
      ""
    );

    setModal(
      "recurring"
    );
  }

  function openEditRecurring(
    item
  ) {
    setEditingRecurring(
      item
    );

    setRecurringPaymentMethod(
      item.payment_method ||
        ""
    );

    setModal(
      "recurring"
    );
  }

  async function saveRecurring(
    e
  ) {
    e.preventDefault();

    if (!household?.id) {
      alert(
        "לא נמצא משק הבית."
      );
      return;
    }

    const f =
      new FormData(
        e.currentTarget
      );

    const row = {
      household_id:
        household.id,

      name:
        f.get("name"),

      merchant:
        f.get("merchant") ||
        null,

      category_id:
        f.get(
          "category_id"
        ) || null,

      planned_amount:
        Number(
          f.get(
            "planned_amount"
          ) || 0
        ),

      day_of_month:
        Number(
          f.get(
            "day_of_month"
          ) || 1
        ),

      person_user_id:
        f.get(
          "person_user_id"
        ) || null,

      payment_method:
        f.get(
          "payment_method"
        ) || null,

      is_active: true,

      note:
        f.get("note") ||
        null,
    };

    let result;

    if (
      editingRecurring?.id
    ) {
      result =
        await supabase
          .from(
            "recurring_expenses"
          )
          .update(row)
          .eq(
            "id",
            editingRecurring.id
          )
          .eq(
            "household_id",
            household.id
          );
    } else {
      result =
        await supabase
          .from(
            "recurring_expenses"
          )
          .insert(row);
    }

    if (result.error) {
      alert(
        "לא הצלחתי לשמור. " +
          result.error.message
      );
      return;
    }

    setEditingRecurring(
      null
    );

    setRecurringPaymentMethod(
      ""
    );

    setModal(null);

    await refresh();
  }

  async function deleteRecurring(
    item
  ) {
    if (
      !item?.id ||
      !household?.id
    ) {
      return;
    }

    const ok =
      window.confirm(
        `למחוק את ההוצאה הקבועה "${item.name}"?`
      );

    if (!ok) {
      return;
    }

    const { error } =
      await supabase
        .from(
          "recurring_expenses"
        )
        .update({
          is_active: false,
        })
        .eq("id", item.id)
        .eq(
          "household_id",
          household.id
        );

    if (error) {
      alert(
        "לא הצלחתי למחוק. " +
          error.message
      );
      return;
    }

    await refresh();
  }

  function openChargeRecurring(
    item
  ) {
    setChargingRecurring(
      item
    );

    setChargePaymentMethod(
      item.payment_method ||
        ""
    );

    setModal(
      "chargeRecurring"
    );
  }

  async function saveRecurringCharge(
    e
  ) {
    e.preventDefault();

    if (
      !chargingRecurring?.id ||
      !household?.id ||
      !session?.user?.id
    ) {
      alert(
        "לא נמצאו הנתונים הדרושים."
      );
      return;
    }

    const f =
      new FormData(
        e.currentTarget
      );

    const actualAmount =
      Number(
        f.get(
          "actual_amount"
        ) || 0
      );

    if (
      !actualAmount ||
      actualAmount <= 0
    ) {
      alert(
        "יש להזין סכום שחויב בפועל."
      );
      return;
    }

    const transactionDate =
      f.get(
        "transaction_date"
      ) ||
      todayKey();

    const paymentMethod =
      f.get(
        "payment_method"
      ) || null;

    const cardLast4Raw =
      String(
        f.get(
          "credit_card_last4"
        ) || ""
      )
        .replace(/\D/g, "")
        .slice(-4);

    const row = {
      household_id:
        household.id,

      kind: "expense",

      description:
        chargingRecurring.name,

      merchant:
        f.get("merchant") ||
        chargingRecurring.merchant ||
        null,

      category_id:
        chargingRecurring.category_id ||
        null,

      transaction_date:
        transactionDate,

      planned_amount:
        Number(
          chargingRecurring.planned_amount ||
            0
        ),

      completed: true,

      actual_amount:
        actualAmount,

      expense_type:
        "fixed",

      person_user_id:
        chargingRecurring.person_user_id ||
        null,

      payment_method:
        paymentMethod,

      credit_card_last4:
        paymentMethod ===
          "credit_card" &&
        cardLast4Raw.length ===
          4
          ? cardLast4Raw
          : null,

      note:
        f.get("note") ||
        chargingRecurring.note ||
        null,

      created_by:
        session.user.id,

      recurring_expense_id:
        chargingRecurring.id,

      recurring_month:
        month,
    };

    const { error } =
      await supabase
        .from("transactions")
        .insert(row);

    if (error) {
      alert(
        "לא הצלחתי לרשום את החיוב. " +
          error.message
      );
      return;
    }

    setChargingRecurring(
      null
    );

    setChargePaymentMethod(
      ""
    );

    setModal(null);

    await refresh();
  }

  async function saveCategory(
    e
  ) {
    e.preventDefault();

    if (!household?.id) {
      alert(
        "לא נמצא משק הבית."
      );
      return;
    }

    const f =
      new FormData(
        e.currentTarget
      );

    const name =
      String(
        f.get("name") || ""
      ).trim();

    const kind =
      f.get("kind");

    if (!name) {
      alert(
        "יש להזין שם קטגוריה."
      );
      return;
    }

    const {
      data,
      error,
    } = await supabase
      .from("categories")
      .insert({
        household_id:
          household.id,

        name,

        kind,

        is_active: true,
      })
      .select()
      .single();

    if (error) {
      alert(
        "לא הצלחתי להוסיף קטגוריה. " +
          error.message
      );
      return;
    }

    await refresh();

    if (
      categorySource ===
        "transaction" &&
      data?.id &&
      (
        kind ===
          transactionKind ||
        kind === "both"
      )
    ) {
      setTransactionCategory(
        data.id
      );

      setCategorySource(
        null
      );

      setModal(
        "transaction"
      );
    } else {
      setCategorySource(
        null
      );

      setModal(null);
    }
  }

  function openCategoryFromTransaction() {
    setCategorySource(
      "transaction"
    );

    setModal(
      "category"
    );
  }

  if (!session) {
    return (
      <main className="auth">
        <div className="authCard">
          <div className="brandMark">
            ₪
          </div>

          <h1>
            Kario's budget
          </h1>

          <p>
            התקציב המשפחתי המשותף שלכם
          </p>

          <form
            onSubmit={login}
            className="form"
          >
            <label>
              אימייל

              <input
                type="email"
                value={email}
                onChange={(e) =>
                  setEmail(
                    e.target.value
                  )
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
                  setPassword(
                    e.target.value
                  )
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
            Kario's budget
          </div>

          <div className="subtitle">
            {profile?.display_name ||
              "משפחה"}{" "}
            ·{" "}
            {household?.name ||
              "תקציב משותף"}
          </div>
        </div>

        <button
          className="ghost"
          type="button"
          onClick={logout}
        >
          יציאה
        </button>
      </header>

      <nav className="tabs">
        {[
          [
            "dashboard",
            "סקירה",
          ],
          [
            "transactions",
            "תנועות",
          ],
          [
            "fixed",
            "הוצאות קבועות",
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
              type="button"
              onClick={() =>
                setTab(id)
              }
            >
              {label}
            </button>
          )
        )}
      </nav>

      <section className="content">
        {tab ===
          "dashboard" && (
          <>
            <div className="monthBar">
              <button
                type="button"
                onClick={() => {
                  const d =
                    new Date(
                      month +
                        "-15"
                    );

                  d.setMonth(
                    d.getMonth() -
                      1
                  );

                  setMonth(
                    monthKey(d)
                  );
                }}
              >
                ‹
              </button>

              <strong>
                {new Date(
                  month +
                    "-15"
                ).toLocaleDateString(
                  "he-IL",
                  {
                    month:
                      "long",
                    year:
                      "numeric",
                  }
                )}
              </strong>

              <button
                type="button"
                onClick={() => {
                  const d =
                    new Date(
                      month +
                        "-15"
                    );

                  d.setMonth(
                    d.getMonth() +
                      1
                  );

                  setMonth(
                    monthKey(d)
                  );
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

                <b>
                  {money(
                    income
                  )}
                </b>
              </div>

              <div className="card expense">
                <span>
                  הוצאות בפועל
                </span>

                <b>
                  {money(
                    expenses
                  )}
                </b>
              </div>

              <div className="card">
                <span>
                  מתוכנן להוצאות
                </span>

                <b>
                  {money(
                    plannedExpenses
                  )}
                </b>
              </div>

              <div
                className={
                  balance >= 0
                    ? "card balance"
                    : "card balance negative"
                }
              >
                <span>
                  יתרה
                </span>

                <b>
                  {money(
                    balance
                  )}
                </b>
              </div>
            </div>

            <div className="split">
              <div className="panel">
                <h2>
                  הוצאות קבועות
                  מול משתנות
                </h2>

                <div className="bigStat">
                  {money(
                    fixedExpenses
                  )}
                </div>

                <div className="muted">
                  קבועות שחויבו
                </div>

                <div className="bar">
                  <span
                    style={{
                      width:
                        expenses
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
                  <span>
                    משתנות
                  </span>

                  <b>
                    {money(
                      variableExpenses
                    )}
                  </b>
                </div>
              </div>

              <div className="panel">
                <h2>
                  הוצאות קבועות
                  לחודש
                </h2>

                {recurringForMonth
                  .length === 0 ? (
                  <p className="muted">
                    עדיין לא הוזנו
                    הוצאות קבועות.
                  </p>
                ) : (
                  <>
                    {recurringForMonth
                      .slice(
                        0,
                        6
                      )
                      .map(
                        (r) => (
                          <div
                            className="listRow"
                            key={
                              r.id
                            }
                          >
                            <div>
                              <b>
                                {
                                  r.name
                                }
                              </b>

                              <small>
                                יום{" "}
                                {
                                  r.day_of_month
                                }{" "}
                                ·{" "}
                                {r.chargedTransaction
                                  ? "חויב"
                                  : "ממתין לחיוב"}
                              </small>

                              {r.merchant && (
                                <small>
                                  עסק:{" "}
                                  {
                                    r.merchant
                                  }
                                </small>
                              )}

                              {r.payment_method && (
                                <small>
                                  {
                                    paymentMethodLabel(
                                      r.payment_method
                                    )
                                  }

                                  {r.payment_method ===
                                    "credit_card" &&
                                    r
                                      .chargedTransaction
                                      ?.credit_card_last4 && (
                                      <>
                                        {" "}
                                        ••••
                                        {
                                          r
                                            .chargedTransaction
                                            .credit_card_last4
                                        }
                                      </>
                                    )}
                                </small>
                              )}
                            </div>

                            <b>
                              {money(
                                r
                                  .chargedTransaction
                                  ?.actual_amount ??
                                  r.planned_amount
                              )}
                            </b>
                          </div>
                        )
                      )}

                    {pendingRecurringAmount >
                      0 && (
                      <p className="muted">
                        ממתין לחיוב:{" "}
                        {money(
                          pendingRecurringAmount
                        )}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}

        {tab ===
          "transactions" && (
          <div className="panel">
            <div className="panelHead">
              <h2>
                תנועות
              </h2>

              <button
                className="primary small"
                type="button"
                onClick={
                  openNewTransaction
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
                  setMonth(
                    e.target.value
                  )
                }
              />
            </div>

            <div className="txList">
              {currentTx.length ===
              0 ? (
                <p className="muted">
                  אין תנועות
                  בחודש
                  הזה.
                </p>
              ) : (
                currentTx.map(
                  (t) => (
                    <div
                      className="tx"
                      key={t.id}
                    >
                      <div>
                        <b>
                          {
                            t.description
                          }
                        </b>

                        <small>
                          {
                            t.transaction_date
                          }{" "}
                          ·{" "}
                          {categories.find(
                            (c) =>
                              c.id ===
                              t.category_id
                          )?.name ||
                            "ללא קטגוריה"}

                          {t.merchant &&
                            t.kind ===
                              "expense" && (
                              <>
                                {" "}
                                ·{" "}
                                {t.merchant}
                              </>
                            )}

                          {t.expense_type &&
                            t.kind ===
                              "expense" &&
                            " · " +
                              (t.expense_type ===
                              "fixed"
                                ? "קבועה"
                                : "משתנה")}

                          {t.payment_method &&
                            t.kind ===
                              "expense" &&
                            " · " +
                              paymentMethodLabel(
                                t.payment_method
                              )}

                          {t.credit_card_last4 &&
                            t.payment_method ===
                              "credit_card" &&
                            " · כרטיס ••••" +
                              t.credit_card_last4}

                          {t.completed
                            ? " · בוצע"
                            : " · ממתין"}
                        </small>
                      </div>

                      <div className="rowActions">
                        <strong
                          className={
                            t.kind ===
                            "income"
                              ? "positive"
                              : "negative"
                          }
                        >
                          {t.kind ===
                          "income"
                            ? "+"
                            : "−"}{" "}
                          {money(
                            t.actual_amount ??
                              t.planned_amount
                          )}
                        </strong>

                        <button
                          className="ghost small"
                          type="button"
                          onClick={() =>
                            openEditTransaction(
                              t
                            )
                          }
                        >
                          עריכה
                        </button>

                        <button
                          className="ghost small"
                          type="button"
                          onClick={() =>
                            deleteTransaction(
                              t
                            )
                          }
                        >
                          מחיקה
                        </button>
                      </div>
                    </div>
                  )
                )
              )}
            </div>
          </div>
        )}

        {tab === "fixed" && (
          <div className="panel">
            <div className="panelHead">
              <div>
                <h2>
                  הוצאות קבועות
                </h2>

                <small className="muted">
                  {new Date(
                    month +
                      "-15"
                  ).toLocaleDateString(
                    "he-IL",
                    {
                      month:
                        "long",
                      year:
                        "numeric",
                    }
                  )}
                </small>
              </div>

              <button
                className="primary small"
                type="button"
                onClick={
                  openNewRecurring
                }
              >
                + הוצאה קבועה
              </button>
            </div>

            {recurringForMonth.length ===
            0 ? (
              <p className="muted">
                אין הוצאות
                קבועות עדיין.
              </p>
            ) : (
              <div>
                {recurringForMonth.map(
                  (r) => {
                    const charged =
                      r.chargedTransaction;

                    return (
                      <div
                        className="listRow"
                        key={
                          r.id
                        }
                      >
                        <div>
                          <b>
                            {
                              r.name
                            }
                          </b>

                          <small>
                            יום{" "}
                            {
                              r.day_of_month
                            }{" "}
                            ·{" "}
                            {categories.find(
                              (c) =>
                                c.id ===
                                r.category_id
                            )?.name ||
                              "ללא קטגוריה"}
                          </small>

                          {r.merchant && (
                            <small>
                              עסק:{" "}
                              {
                                r.merchant
                              }
                            </small>
                          )}

                          {r.payment_method && (
                            <small>
                              אמצעי תשלום:{" "}
                              {paymentMethodLabel(
                                r.payment_method
                              )}

                              {r.payment_method ===
                                "credit_card" &&
                                charged?.credit_card_last4 && (
                                  <>
                                    {" "}
                                    ••••
                                    {
                                      charged.credit_card_last4
                                    }
                                  </>
                                )}
                            </small>
                          )}

                          <small>
                            {charged
                              ? `✓ חויב ${money(
                                  charged.actual_amount ??
                                    charged.planned_amount
                                )}`
                              : "○ ממתין לחיוב"}
                          </small>
                        </div>

                        <div className="rowActions">
                          <b>
                            {money(
                              charged
                                ?.actual_amount ??
                                r.planned_amount
                            )}
                          </b>

                          {!charged && (
                            <button
                              className="primary small"
                              type="button"
                              onClick={() =>
                                openChargeRecurring(
                                  r
                                )
                              }
                            >
                              סמן כחויב
                            </button>
                          )}

                          {charged && (
                            <button
                              className="ghost small"
                              type="button"
                              onClick={() =>
                                openEditTransaction(
                                  charged
                                )
                              }
                            >
                              עריכת חיוב
                            </button>
                          )}

                          <button
                            className="ghost small"
                            type="button"
                            onClick={() =>
                              openEditRecurring(
                                r
                              )
                            }
                          >
                            עריכת קבועה
                          </button>

                          <button
                            className="ghost small"
                            type="button"
                            onClick={() =>
                              deleteRecurring(
                                r
                              )
                            }
                          >
                            מחיקה
                          </button>
                        </div>
                      </div>
                    );
                  }
                )}
              </div>
            )}
          </div>
        )}

        {tab ===
          "categories" && (
          <div className="panel">
            <div className="panelHead">
              <h2>
                קטגוריות
              </h2>

              <button
                className="primary small"
                type="button"
                onClick={() => {
                  setCategorySource(
                    null
                  );

                  setModal(
                    "category"
                  );
                }}
              >
                + קטגוריה
              </button>
            </div>

            <div className="categoryGrid">
              {categories.map(
                (c) => (
                  <div
                    className="category"
                    key={c.id}
                  >
                    <span>
                      {c.name}
                    </span>

                    <small>
                      {c.kind ===
                      "income"
                        ? "הכנסה"
                        : c.kind ===
                          "expense"
                        ? "הוצאה"
                        : "שניהם"}
                    </small>
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </section>

      {modal ===
        "transaction" && (
        <Modal
          title={
            editingTransaction
              ? "עריכת תנועה"
              : "הוספת תנועה"
          }
          onClose={() => {
            setEditingTransaction(
              null
            );

            setModal(null);
          }}
        >
          <form
            className="form"
            key={
              editingTransaction?.id ||
              "new-transaction"
            }
            onChange={
              updateTransactionDraft
            }
            onSubmit={
              saveTransaction
            }
          >
            <label>
              סוג

              <select
                name="kind"
                value={
                  transactionKind
                }
                onChange={(e) => {
                  setTransactionKind(
                    e.target.value
                  );

                  setTransactionCategory(
                    ""
                  );
                }}
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
                defaultValue={
                  editingTransaction
                    ?.description ||
                  transactionDraft?.description ||
                  ""
                }
                required
              />
            </label>

            {transactionKind ===
              "expense" && (
              <label>
                עסק / ספק

                <input
                  name="merchant"
                  placeholder="למשל: רמי לוי / שופרסל / IKEA"
                  defaultValue={
                    editingTransaction
                      ?.merchant ||
                    transactionDraft?.merchant ||
                    ""
                  }
                />
              </label>
            )}

            <label>
              קטגוריה

              <div className="row">
                <select
                  name="category_id"
                  value={
                    transactionCategory
                  }
                  onChange={(e) =>
                    setTransactionCategory(
                      e.target.value
                    )
                  }
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
                        c.kind ===
                          "both"
                    )
                    .map(
                      (c) => (
                        <option
                          key={
                            c.id
                          }
                          value={
                            c.id
                          }
                        >
                          {
                            c.name
                          }
                        </option>
                      )
                    )}
                </select>

                <button
                  className="ghost small"
                  type="button"
                  onClick={
                    openCategoryFromTransaction
                  }
                >
                  + חדשה
                </button>
              </div>
            </label>

            <div className="two">
              <label>
                תאריך

                <input
                  name="transaction_date"
                  type="date"
                  defaultValue={
                    editingTransaction
                      ?.transaction_date ||
                    transactionDraft?.transaction_date ||
                    todayKey()
                  }
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
                  defaultValue={
                    editingTransaction
                      ?.planned_amount ??
                    transactionDraft?.planned_amount ??
                    ""
                  }
                  required
                />
              </label>
            </div>

            <label>
              סכום בפועל
              (אם שונה)

              <input
                name="actual_amount"
                type="number"
                min="0"
                step="0.01"
                defaultValue={
                  editingTransaction
                    ?.actual_amount ??
                  transactionDraft?.actual_amount ??
                  ""
                }
              />
            </label>

            {transactionKind ===
              "expense" && (
              <label>
                סוג תנועה

                <select
                  name="expense_type"
                  defaultValue={
                    editingTransaction
                      ?.expense_type ||
                    transactionDraft?.expense_type ||
                    "variable"
                  }
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

            {transactionKind ===
              "expense" && (
              <label>
                אמצעי תשלום

                <select
                  name="payment_method"
                  value={
                    transactionPaymentMethod
                  }
                  onChange={(e) =>
                    setTransactionPaymentMethod(
                      e.target.value
                    )
                  }
                >
                  <option value="">
                    בחרי אמצעי תשלום
                  </option>

                  {PAYMENT_METHODS.map(
                    ([
                      id,
                      label,
                    ]) => (
                      <option
                        key={id}
                        value={id}
                      >
                        {label}
                      </option>
                    )
                  )}
                </select>
              </label>
            )}

            {transactionKind ===
              "expense" &&
              transactionPaymentMethod ===
                "credit_card" && (
                <label>
                  4 ספרות אחרונות
                  של כרטיס האשראי

                  <input
                    name="credit_card_last4"
                    inputMode="numeric"
                    pattern="[0-9]{4}"
                    maxLength="4"
                    placeholder="לדוגמה: 4821"
                    defaultValue={
                      editingTransaction
                        ?.credit_card_last4 ||
                      transactionDraft?.credit_card_last4 ||
                      ""
                    }
                  />
                </label>
              )}

            <label>
              מי שילם/קיבל

              <select
                name="person_user_id"
                defaultValue={
                  editingTransaction
                    ?.person_user_id ||
                  transactionDraft?.person_user_id ||
                  ""
                }
              >
                <option value="">
                  לא צוין
                </option>

                {members.map(
                  (m) => (
                    <option
                      key={
                        m.user_id
                      }
                      value={
                        m.user_id
                      }
                    >
                      {m.profiles
                        ?.display_name ||
                        "משתמש"}
                    </option>
                  )
                )}
              </select>
            </label>

            <label className="check">
              <input
                name="completed"
                type="checkbox"
                defaultChecked={
                  editingTransaction
                    ? !!editingTransaction.completed
                    : transactionDraft?.completed ??
                      true
                }
              />{" "}
              בוצע / חויב בפועל
            </label>

            <label>
              הערה

              <textarea
                name="note"
                rows="3"
                defaultValue={
                  editingTransaction
                    ?.note ||
                  transactionDraft?.note ||
                  ""
                }
              />
            </label>

            <button
              className="primary"
              type="submit"
            >
              {editingTransaction
                ? "עדכון"
                : "שמירה"}
            </button>
          </form>
        </Modal>
      )}

      {modal ===
        "recurring" && (
        <Modal
          title={
            editingRecurring
              ? "עריכת הוצאה קבועה"
              : "הוספת הוצאה קבועה"
          }
          onClose={() => {
            setEditingRecurring(
              null
            );

            setRecurringPaymentMethod(
              ""
            );

            setModal(null);
          }}
        >
          <form
            className="form"
            key={
              editingRecurring?.id ||
              "new-recurring"
            }
            onSubmit={
              saveRecurring
            }
          >
            <label>
              שם ההוצאה

              <input
                name="name"
                placeholder="למשל: משכנתא"
                defaultValue={
                  editingRecurring
                    ?.name ||
                  ""
                }
                required
              />
            </label>

            <label>
              עסק / ספק

              <input
                name="merchant"
                placeholder="למשל: בנק הפועלים / חברת חשמל"
                defaultValue={
                  editingRecurring
                    ?.merchant ||
                  ""
                }
              />
            </label>

            <label>
              קטגוריה

              <select
                name="category_id"
                defaultValue={
                  editingRecurring
                    ?.category_id ||
                  ""
                }
              >
                <option value="">
                  ללא קטגוריה
                </option>

                {categories
                  .filter(
                    (c) =>
                      c.kind !==
                      "income"
                  )
                  .map(
                    (c) => (
                      <option
                        key={
                          c.id
                        }
                        value={
                          c.id
                        }
                      >
                        {
                          c.name
                        }
                      </option>
                    )
                  )}
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
                  defaultValue={
                    editingRecurring
                      ?.planned_amount ??
                    ""
                  }
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
                  defaultValue={
                    editingRecurring
                      ?.day_of_month ??
                    1
                  }
                  required
                />
              </label>
            </div>

            <label>
              אמצעי תשלום

              <select
                name="payment_method"
                value={
                  recurringPaymentMethod
                }
                onChange={(e) =>
                  setRecurringPaymentMethod(
                    e.target.value
                  )
                }
              >
                <option value="">
                  בחרי אמצעי תשלום
                </option>

                {PAYMENT_METHODS.map(
                  ([
                    id,
                    label,
                  ]) => (
                    <option
                      key={id}
                      value={id}
                    >
                      {label}
                    </option>
                  )
                )}
              </select>
            </label>

            <label>
              מי אחראי

              <select
                name="person_user_id"
                defaultValue={
                  editingRecurring
                    ?.person_user_id ||
                  ""
                }
              >
                <option value="">
                  לא צוין
                </option>

                {members.map(
                  (m) => (
                    <option
                      key={
                        m.user_id
                      }
                      value={
                        m.user_id
                      }
                    >
                      {m.profiles
                        ?.display_name ||
                        "משתמש"}
                    </option>
                  )
                )}
              </select>
            </label>

            <label>
              הערה

              <textarea
                name="note"
                rows="3"
                defaultValue={
                  editingRecurring
                    ?.note ||
                  ""
                }
              />
            </label>

            <button
              className="primary"
              type="submit"
            >
              {editingRecurring
                ? "עדכון"
                : "שמירה"}
            </button>
          </form>
        </Modal>
      )}

      {modal ===
        "chargeRecurring" &&
        chargingRecurring && (
          <Modal
            title={`חיוב: ${chargingRecurring.name}`}
            onClose={() => {
              setChargingRecurring(
                null
              );

              setChargePaymentMethod(
                ""
              );

              setModal(null);
            }}
          >
            <form
              className="form"
              onSubmit={
                saveRecurringCharge
              }
            >
              <div className="panel">
                <div className="row">
                  <span>
                    עסק / ספק
                  </span>

                  <b>
                    {chargingRecurring.merchant ||
                      "לא צוין"}
                  </b>
                </div>

                <div className="row">
                  <span>
                    סכום מתוכנן
                  </span>

                  <b>
                    {money(
                      chargingRecurring.planned_amount
                    )}
                  </b>
                </div>

                {chargingRecurring.payment_method && (
                  <div className="row">
                    <span>
                      אמצעי תשלום
                    </span>

                    <b>
                      {paymentMethodLabel(
                        chargingRecurring.payment_method
                      )}
                    </b>
                  </div>
                )}
              </div>

              <label>
                עסק / ספק בפועל

                <input
                  name="merchant"
                  placeholder="אם שונה מהעסק שהוגדר"
                  defaultValue={
                    chargingRecurring.merchant ||
                    ""
                  }
                />
              </label>

              <label>
                סכום שחויב בפועל

                <input
                  name="actual_amount"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={
                    chargingRecurring.planned_amount
                  }
                  required
                  autoFocus
                />
              </label>

              <label>
                תאריך החיוב

                <input
                  name="transaction_date"
                  type="date"
                  defaultValue={
                    todayKey()
                  }
                  required
                />
              </label>

              <label>
                אמצעי תשלום

                <select
                  name="payment_method"
                  value={
                    chargePaymentMethod
                  }
                  onChange={(e) =>
                    setChargePaymentMethod(
                      e.target.value
                    )
                  }
                  required
                >
                  <option value="">
                    בחרי אמצעי תשלום
                  </option>

                  {PAYMENT_METHODS.map(
                    ([
                      id,
                      label,
                    ]) => (
                      <option
                        key={id}
                        value={id}
                      >
                        {label}
                      </option>
                    )
                  )}
                </select>
              </label>

              {chargePaymentMethod ===
                "credit_card" && (
                <label>
                  4 ספרות אחרונות
                  של כרטיס האשראי

                  <input
                    name="credit_card_last4"
                    inputMode="numeric"
                    pattern="[0-9]{4}"
                    maxLength="4"
                    placeholder="לדוגמה: 4821"
                  />
                </label>
              )}

              <label>
                הערה

                <textarea
                  name="note"
                  rows="3"
                  defaultValue={
                    chargingRecurring.note ||
                    ""
                  }
                  placeholder="למשל: החיוב היה גבוה בגלל הצמדה"
                />
              </label>

              <button
                className="primary"
                type="submit"
              >
                אישור חיוב
              </button>
            </form>
          </Modal>
        )}

      {modal ===
        "category" && (
        <Modal
          title="קטגוריה חדשה"
          onClose={() => {
            setCategorySource(
              null
            );

            setModal(null);
          }}
        >
          <form
            className="form"
            onSubmit={
              saveCategory
            }
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
                defaultValue={
                  transactionKind ===
                  "income"
                    ? "income"
                    : "expense"
                }
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
