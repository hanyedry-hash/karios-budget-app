"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

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

const todayKey = () => {
  const d = new Date();

  return `${d.getFullYear()}-${String(
    d.getMonth() + 1
  ).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};

const paymentLabel = (value) =>
  PAYMENT_METHODS.find(
    ([id]) => id === value
  )?.[1] || "";

/*
 * =========================================================
 * ONE SOURCE OF TRUTH:
 * IS AN EXPENSE FIXED OR VARIABLE?
 *
 * Fixed if:
 * 1. It is explicitly marked fixed
 * OR
 * 2. It is linked to a recurring expense.
 *
 * Variable otherwise.
 * =========================================================
 */

const isFixedExpense = (transaction) =>
  transaction?.kind === "expense" &&
  (
    transaction.expense_type === "fixed" ||
    Boolean(transaction.recurring_expense_id)
  );

const isVariableExpense = (transaction) =>
  transaction?.kind === "expense" &&
  !isFixedExpense(transaction);

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
            type="button"
            className="iconBtn"
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

  const [
    transactionKind,
    setTransactionKind,
  ] = useState("expense");

  const [
    editingTransaction,
    setEditingTransaction,
  ] = useState(null);

  const [
    editingRecurring,
    setEditingRecurring,
  ] = useState(null);

  const [
    chargingRecurring,
    setChargingRecurring,
  ] = useState(null);

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [draft, setDraft] =
    useState(null);

  const DRAFT_KEY =
    "karios-budget-transaction-draft";

  /*
   * =========================================================
   * LOAD DATA
   * =========================================================
   */

  async function loadData(userId) {
    setLoading(true);

    const {
      data: hm,
      error: hmError,
    } = await supabase
      .from("household_members")
      .select(
        "household_id, role"
      )
      .eq("user_id", userId)
      .maybeSingle();

    if (hmError || !hm) {
      setLoading(false);
      return;
    }

    const [
      householdResult,
      profileResult,
      categoriesResult,
      transactionsResult,
      recurringResult,
      membersResult,
    ] = await Promise.all([
      supabase
        .from("households")
        .select("*")
        .eq("id", hm.household_id)
        .single(),

      supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single(),

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
        .from(
          "recurring_expenses"
        )
        .select("*")
        .eq(
          "household_id",
          hm.household_id
        )
        .eq(
          "is_active",
          true
        )
        .order(
          "day_of_month"
        ),

      supabase.rpc(
        "get_my_household_members"
      ),
    ]);

    setHousehold(
      householdResult.data
    );

    setProfile(
      profileResult.data
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

    setMembers(
      membersResult.data || []
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
      data: {
        subscription,
      },
    } =
      supabase.auth.onAuthStateChange(
        (_event, newSession) => {
          setSession(newSession);

          if (
            newSession?.user
          ) {
            loadData(
              newSession.user.id
            );
          } else {
            setProfile(null);
            setHousehold(null);
            setTransactions([]);
            setRecurring([]);
            setCategories([]);
            setMembers([]);
          }
        }
      );

    return () =>
      subscription.unsubscribe();
  }, []);

  async function refresh() {
    if (session?.user) {
      await loadData(
        session.user.id
      );
    }
  }

  /*
   * =========================================================
   * AUTH
   * =========================================================
   */

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

  /*
   * =========================================================
   * CURRENT MONTH
   * =========================================================
   */

  const currentTx = useMemo(
    () =>
      transactions.filter(
        (t) =>
          String(
            t.transaction_date ||
              ""
          ).startsWith(month)
      ),
    [transactions, month]
  );

  /*
   * =========================================================
   * RECURRING EXPENSES FOR CURRENT MONTH
   * =========================================================
   */

  const recurringForMonth =
    useMemo(() => {
      return recurring.map(
        (r) => {
          const linkedTransaction =
            transactions.find(
              (t) =>
                t.recurring_expense_id ===
                  r.id &&
                t.recurring_month ===
                  month &&
                t.kind ===
                  "expense" &&
                t.completed ===
                  true &&
                t.actual_amount !==
                  null
            );

          return {
            ...r,
            chargedTransaction:
              linkedTransaction ||
              null,
            charged:
              Boolean(
                linkedTransaction
              ),
          };
        }
      );
    }, [
      recurring,
      transactions,
      month,
    ]);

  /*
   * =========================================================
   * ACTUAL INCOME
   * =========================================================
   */

  const income = useMemo(
    () =>
      currentTx
        .filter(
          (t) =>
            t.kind ===
              "income" &&
            t.completed ===
              true
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
        ),
    [currentTx]
  );

  /*
   * =========================================================
   * ACTUAL EXPENSES
   * =========================================================
   */

  const actualExpenses =
    useMemo(
      () =>
        currentTx
          .filter(
            (t) =>
              t.kind ===
                "expense" &&
              t.completed ===
                true &&
              t.actual_amount !==
                null
          )
          .reduce(
            (sum, t) =>
              sum +
              Number(
                t.actual_amount ||
                  0
              ),
            0
          ),
      [currentTx]
    );

  /*
   * =========================================================
   * FIXED EXPENSES
   *
   * Uses the SAME classification as the transaction list.
   * =========================================================
   */

  const fixedCharged =
    useMemo(
      () =>
        currentTx
          .filter(
            (t) =>
              isFixedExpense(t) &&
              t.completed ===
                true &&
              t.actual_amount !==
                null
          )
          .reduce(
            (sum, t) =>
              sum +
              Number(
                t.actual_amount ||
                  0
              ),
            0
          ),
      [currentTx]
    );

  /*
   * =========================================================
   * VARIABLE EXPENSES
   * =========================================================
   */

  const variableExpenses =
    useMemo(
      () =>
        currentTx
          .filter(
            (t) =>
              isVariableExpense(
                t
              ) &&
              t.completed ===
                true &&
              t.actual_amount !==
                null
          )
          .reduce(
            (sum, t) =>
              sum +
              Number(
                t.actual_amount ||
                  0
              ),
            0
          ),
      [currentTx]
    );

  /*
   * =========================================================
   * SAFETY CHECK
   *
   * Fixed + variable should always equal actual expenses.
   * =========================================================
   */

  const classifiedExpenses =
    fixedCharged +
    variableExpenses;

  /*
   * =========================================================
   * PENDING FIXED
   * =========================================================
   */

  const pendingFixed =
    useMemo(
      () =>
        recurringForMonth
          .filter(
            (r) =>
              !r.charged
          )
          .reduce(
            (sum, r) =>
              sum +
              Number(
                r.planned_amount ||
                  0
              ),
            0
          ),
      [recurringForMonth]
    );

  const fixedPlanned =
    fixedCharged +
    pendingFixed;

  /*
   * =========================================================
   * PENDING VARIABLE
   * =========================================================
   */

  const pendingVariable =
    useMemo(
      () =>
        currentTx
          .filter(
            (t) =>
              isVariableExpense(
                t
              ) &&
              t.completed !==
                true
          )
          .reduce(
            (sum, t) =>
              sum +
              Number(
                t.planned_amount ||
                  0
              ),
            0
          ),
      [currentTx]
    );

  const plannedExpenses =
    actualExpenses +
    pendingFixed +
    pendingVariable;

  /*
   * =========================================================
   * BALANCE
   * =========================================================
   */

  const balance =
    income -
    actualExpenses;

  /*
   * =========================================================
   * FIXED / VARIABLE %
   * =========================================================
   */

  const fixedPercent =
    actualExpenses > 0
      ? (fixedCharged /
          actualExpenses) *
        100
      : 0;

  const variablePercent =
    actualExpenses > 0
      ? (variableExpenses /
          actualExpenses) *
        100
      : 0;

  /*
   * =========================================================
   * FIXED PROGRESS
   * =========================================================
   */

  const fixedProgress =
    fixedPlanned > 0
      ? Math.min(
          100,
          (fixedCharged /
            fixedPlanned) *
            100
        )
      : 0;

  /*
   * =========================================================
   * CATEGORY BREAKDOWN
   * =========================================================
   */

  const categoryBreakdown =
    useMemo(() => {
      return categories
        .filter(
          (c) =>
            c.kind ===
              "expense" ||
            c.kind ===
              "both"
        )
        .map(
          (category) => {
            const amount =
              currentTx
                .filter(
                  (t) =>
                    t.kind ===
                      "expense" &&
                    t.completed ===
                      true &&
                    t.actual_amount !==
                      null &&
                    t.category_id ===
                      category.id
                )
                .reduce(
                  (sum, t) =>
                    sum +
                    Number(
                      t.actual_amount ||
                        0
                    ),
                  0
                );

            return {
              ...category,
              amount,
              percent:
                actualExpenses >
                0
                  ? (amount /
                      actualExpenses) *
                    100
                  : 0,
            };
          }
        )
        .filter(
          (c) =>
            c.amount > 0
        )
        .sort(
          (a, b) =>
            b.amount -
            a.amount
        );
    }, [
      categories,
      currentTx,
      actualExpenses,
    ]);

  /*
   * =========================================================
   * DRAFT
   * =========================================================
   */

  function saveDraftFromForm(
    form
  ) {
    try {
      const fd =
        new FormData(form);

      const values =
        Object.fromEntries(
          fd.entries()
        );

      values.completed =
        fd.get(
          "completed"
        ) === "on";

      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify(
          values
        )
      );
    } catch {
      // Ignore.
    }
  }

  function clearDraft() {
    try {
      localStorage.removeItem(
        DRAFT_KEY
      );
    } catch {
      // Ignore.
    }

    setDraft(null);
  }

  function openTransactionModal(
    tx = null
  ) {
    setEditingTransaction(
      tx
    );

    if (tx) {
      setDraft(null);

      setTransactionKind(
        tx.kind ||
          "expense"
      );
    } else {
      try {
        const saved =
          localStorage.getItem(
            DRAFT_KEY
          );

        setDraft(
          saved
            ? JSON.parse(
                saved
              )
            : null
        );
      } catch {
        setDraft(null);
      }

      setTransactionKind(
        "expense"
      );
    }

    setModal(
      "transaction"
    );
  }

  /*
   * =========================================================
   * SAVE TRANSACTION
   * =========================================================
   */

  async function saveTransaction(
    e
  ) {
    e.preventDefault();

    const f =
      new FormData(
        e.currentTarget
      );

    const kind =
      f.get("kind");

    const completed =
      f.get(
        "completed"
      ) === "on";

    const actualRaw =
      f.get(
        "actual_amount"
      );

    const actualAmount =
      actualRaw !== null &&
      actualRaw !== ""
        ? Number(
            actualRaw
          )
        : completed
        ? Number(
            f.get(
              "planned_amount"
            ) || 0
          )
        : null;

    const expenseType =
      kind === "expense"
        ? f.get(
            "expense_type"
          )
        : f.get(
            "income_type"
          );

    const row = {
      household_id:
        household.id,

      kind,

      description:
        f.get(
          "description"
        ),

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

      completed,

      actual_amount:
        completed
          ? actualAmount
          : null,

      expense_type:
        expenseType ||
        null,

      person_user_id:
        f.get(
          "person_user_id"
        ) || null,

      note:
        f.get("note") ||
        null,

      payment_method:
        f.get(
          "payment_method"
        ) || null,

      merchant:
        f.get(
          "merchant"
        ) || null,

      credit_card_last4:
        f.get(
          "payment_method"
        ) ===
        "credit_card"
          ? f.get(
              "credit_card_last4"
            ) || null
          : null,

      created_by:
        editingTransaction?.created_by ||
        session.user.id,

      updated_at:
        new Date().toISOString(),
    };

    let result;

    if (
      editingTransaction
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
          );
    } else {
      result =
        await supabase
          .from(
            "transactions"
          )
          .insert(row);
    }

    if (result.error) {
      alert(
        "לא הצלחתי לשמור את התנועה.\n\n" +
          result.error.message
      );

      return;
    }

    clearDraft();

    setEditingTransaction(
      null
    );

    setModal(null);

    await refresh();
  }

  /*
   * =========================================================
   * DELETE TRANSACTION
   * =========================================================
   */

  async function deleteTransaction(
    tx
  ) {
    const ok =
      window.confirm(
        `למחוק את התנועה "${tx.description}"?\n\nהפעולה אינה ניתנת לביטול.`
      );

    if (!ok) return;

    const { error } =
      await supabase
        .from(
          "transactions"
        )
        .delete()
        .eq(
          "id",
          tx.id
        );

    if (error) {
      alert(
        "לא הצלחתי למחוק את התנועה.\n\n" +
          error.message
      );

      return;
    }

    await refresh();
  }

  /*
   * =========================================================
   * RECURRING
   * =========================================================
   */

  function openRecurringModal(
    recurringExpense = null
  ) {
    setEditingRecurring(
      recurringExpense
    );

    setModal(
      "recurring"
    );
  }

  async function saveRecurring(
    e
  ) {
    e.preventDefault();

    const f =
      new FormData(
        e.currentTarget
      );

    const row = {
      household_id:
        household.id,

      name:
        f.get("name"),

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

      is_active: true,

      note:
        f.get("note") ||
        null,

      payment_method:
        f.get(
          "payment_method"
        ) || null,

      merchant:
        f.get(
          "merchant"
        ) || null,
    };

    let result;

    if (
      editingRecurring
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
        "לא הצלחתי לשמור את ההוצאה הקבועה.\n\n" +
          result.error.message
      );

      return;
    }

    setEditingRecurring(
      null
    );

    setModal(null);

    await refresh();
  }

  /*
   * =========================================================
   * DELETE RECURRING
   * =========================================================
   */

  async function deleteRecurring(
    recurringExpense
  ) {
    const ok =
      window.confirm(
        `למחוק את ההוצאה הקבועה "${recurringExpense.name}"?\n\nהיא לא תופיע בחודשים הבאים. חיובים שכבר נרשמו יישארו.`
      );

    if (!ok) return;

    const { error } =
      await supabase
        .from(
          "recurring_expenses"
        )
        .update({
          is_active:
            false,
        })
        .eq(
          "id",
          recurringExpense.id
        );

    if (error) {
      alert(
        "לא הצלחתי למחוק את ההוצאה הקבועה.\n\n" +
          error.message
      );

      return;
    }

    await refresh();
  }

  /*
   * =========================================================
   * CHARGE RECURRING
   * =========================================================
   */

  function openChargeModal(
    recurringExpense
  ) {
    setChargingRecurring(
      recurringExpense
    );

    setModal("charge");
  }

  async function saveRecurringCharge(
    e
  ) {
    e.preventDefault();

    if (
      !chargingRecurring
    )
      return;

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
      actualAmount < 0
    ) {
      alert(
        "יש להזין סכום בפועל."
      );

      return;
    }

    const row = {
      household_id:
        household.id,

      kind: "expense",

      description:
        chargingRecurring.name,

      category_id:
        chargingRecurring.category_id ||
        null,

      transaction_date:
        f.get(
          "transaction_date"
        ),

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
        f.get(
          "person_user_id"
        ) ||
        chargingRecurring.person_user_id ||
        null,

      note:
        f.get("note") ||
        chargingRecurring.note ||
        null,

      payment_method:
        f.get(
          "payment_method"
        ) ||
        chargingRecurring.payment_method ||
        null,

      merchant:
        f.get("merchant") ||
        chargingRecurring.merchant ||
        null,

      credit_card_last4:
        f.get(
          "payment_method"
        ) ===
        "credit_card"
          ? f.get(
              "credit_card_last4"
            ) || null
          : null,

      recurring_expense_id:
        chargingRecurring.id,

      recurring_month:
        month,

      created_by:
        session.user.id,

      updated_at:
        new Date().toISOString(),
    };

    const { error } =
      await supabase
        .from(
          "transactions"
        )
        .insert(row);

    if (error) {
      alert(
        "לא הצלחתי לרשום את החיוב.\n\n" +
          error.message
      );

      return;
    }

    setChargingRecurring(
      null
    );

    setModal(null);

    await refresh();
  }

  /*
   * =========================================================
   * CATEGORY
   * =========================================================
   */

  async function saveCategory(
    e
  ) {
    e.preventDefault();

    const f =
      new FormData(
        e.currentTarget
      );

    const { error } =
      await supabase
        .from("categories")
        .insert({
          household_id:
            household.id,

          name:
            f.get("name"),

          kind:
            f.get("kind"),

          is_active:
            true,
        });

    if (error) {
      alert(
        "לא הצלחתי להוסיף קטגוריה.\n\n" +
          error.message
      );

      return;
    }

    setModal(null);

    await refresh();
  }

  /*
   * =========================================================
   * LOGIN
   * =========================================================
   */

  if (!session) {
    return (
      <main className="auth">
        <div className="authCard">
          <div className="brandMark">
            ₪
          </div>

          <h1>
            Kario&apos;s budget
          </h1>

          <p>
            התקציב המשפחתי
            המשותף שלכם
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

  /*
   * =========================================================
   * MAIN APP
   * =========================================================
   */

  return (
    <main
      className="shell"
      dir="rtl"
    >
      <header className="topbar">
        <div>
          <div className="title">
            Kario&apos;s budget
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

        {/* =====================================================
            DASHBOARD
           ===================================================== */}

        {tab ===
          "dashboard" && (
          <>
            <div className="monthBar">
              <button
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

            {/* =================================================
                1. BALANCE
               ================================================= */}

            <div
              className={
                balance >= 0
                  ? "card balance"
                  : "card balance negative"
              }
              style={{
                marginBottom:
                  16,
              }}
            >
              <span>
                יתרת תקציב
              </span>

              <b>
                {money(balance)}
              </b>

              <div
                style={{
                  display:
                    "grid",
                  gridTemplateColumns:
                    "1fr 1fr",
                  gap: 12,
                  marginTop:
                    14,
                  paddingTop:
                    12,
                  borderTop:
                    "1px solid rgba(0,0,0,.08)",
                }}
              >
                <div>
                  <small>
                    הכנסות בפועל
                  </small>

                  <strong
                    className="positive"
                    style={{
                      display:
                        "block",
                      fontSize:
                        18,
                    }}
                  >
                    {money(
                      income
                    )}
                  </strong>
                </div>

                <div>
                  <small>
                    הוצאות בפועל
                  </small>

                  <strong
                    className="negative"
                    style={{
                      display:
                        "block",
                      fontSize:
                        18,
                    }}
                  >
                    {money(
                      actualExpenses
                    )}
                  </strong>
                </div>
              </div>

              <small
                style={{
                  display:
                    "block",
                  marginTop:
                    10,
                  opacity:
                    0.75,
                }}
              >
                הכנסות בפועל פחות
                הוצאות שחויבו בפועל
              </small>
            </div>

            {/* =================================================
                2. FIXED EXPENSES
               ================================================= */}

            <div
              className="panel"
              style={{
                marginBottom:
                  16,
              }}
            >
              <h2>
                כמה נשאר מהוצאות
                קבועות
              </h2>

              <div className="row">
                <span>
                  חויב עד עכשיו
                </span>

                <b>
                  {money(
                    fixedCharged
                  )}
                </b>
              </div>

              <div className="row">
                <span>
                  צפוי לחיוב
                </span>

                <b>
                  {money(
                    pendingFixed
                  )}
                </b>
              </div>

              <div
                style={{
                  height: 16,
                  borderRadius:
                    999,
                  overflow:
                    "hidden",
                  background:
                    "#e9eaf0",
                  marginTop:
                    16,
                  display:
                    "flex",
                }}
              >
                <div
                  style={{
                    width: `${fixedProgress}%`,
                    background:
                      "#5964d8",
                    transition:
                      "width .25s",
                  }}
                />

                <div
                  style={{
                    flex: 1,
                    background:
                      "#f0b35a",
                  }}
                />
              </div>

              <div
                style={{
                  display:
                    "flex",
                  justifyContent:
                    "space-between",
                  marginTop:
                    10,
                  fontSize:
                    13,
                  gap: 10,
                }}
              >
                <span>
                  🟣 חויבו:{" "}
                  {money(
                    fixedCharged
                  )}
                </span>

                <span>
                  🟠 נשארו:{" "}
                  {money(
                    pendingFixed
                  )}
                </span>
              </div>

              <div
                className="row"
                style={{
                  marginTop:
                    14,
                  paddingTop:
                    12,
                  borderTop:
                    "1px solid #eee",
                }}
              >
                <span>
                  סה״כ הוצאות
                  קבועות מתוכננות
                </span>

                <b>
                  {money(
                    fixedPlanned
                  )}
                </b>
              </div>
            </div>

            {/* =================================================
                3. FIXED VS VARIABLE
               ================================================= */}

            <div
              className="panel"
              style={{
                marginBottom:
                  16,
              }}
            >
              <h2>
                קבועות מול משתנות
              </h2>

              <div
                style={{
                  height: 18,
                  borderRadius:
                    999,
                  overflow:
                    "hidden",
                  background:
                    "#e9eaf0",
                  marginTop:
                    16,
                  display:
                    "flex",
                }}
              >
                <div
                  style={{
                    width: `${fixedPercent}%`,
                    background:
                      "#5964d8",
                  }}
                />

                <div
                  style={{
                    width: `${variablePercent}%`,
                    background:
                      "#78b9a4",
                  }}
                />
              </div>

              <div
                style={{
                  display:
                    "grid",
                  gridTemplateColumns:
                    "1fr 1fr",
                  gap: 20,
                  marginTop:
                    16,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize:
                        13,
                    }}
                  >
                    <span
                      style={{
                        display:
                          "inline-block",
                        width: 10,
                        height: 10,
                        borderRadius:
                          "50%",
                        background:
                          "#5964d8",
                        marginLeft:
                          6,
                      }}
                    />

                    קבועות
                  </div>

                  <b>
                    {money(
                      fixedCharged
                    )}
                  </b>

                  <small
                    className="muted"
                    style={{
                      display:
                        "block",
                    }}
                  >
                    {fixedPercent.toFixed(
                      0
                    )}
                    %
                  </small>
                </div>

                <div
                  style={{
                    textAlign:
                      "left",
                  }}
                >
                  <div
                    style={{
                      fontSize:
                        13,
                    }}
                  >
                    משתנות

                    <span
                      style={{
                        display:
                          "inline-block",
                        width: 10,
                        height: 10,
                        borderRadius:
                          "50%",
                        background:
                          "#78b9a4",
                        marginRight:
                          6,
                      }}
                    />
                  </div>

                  <b>
                    {money(
                      variableExpenses
                    )}
                  </b>

                  <small
                    className="muted"
                    style={{
                      display:
                        "block",
                    }}
                  >
                    {variablePercent.toFixed(
                      0
                    )}
                    %
                  </small>
                </div>
              </div>

              {actualExpenses >
                0 &&
                classifiedExpenses !==
                  actualExpenses && (
                  <div
                    style={{
                      marginTop:
                        12,
                      fontSize:
                        12,
                      color:
                        "#b45309",
                    }}
                  >
                    יש פער בסיווג
                    ההוצאות. נבדוק
                    אותו לפני שנמשיך.
                  </div>
                )}
            </div>

            {/* =================================================
                4. CATEGORY BREAKDOWN
               ================================================= */}

            <div className="panel">
              <h2>
                פירוט הוצאות לפי
                סוג
              </h2>

              {categoryBreakdown.length ===
              0 ? (
                <p className="muted">
                  אין עדיין הוצאות
                  שחויבו בחודש הזה.
                </p>
              ) : (
                <div
                  style={{
                    marginTop:
                      8,
                  }}
                >
                  {categoryBreakdown.map(
                    (category) => (
                      <div
                        key={
                          category.id
                        }
                        style={{
                          padding:
                            "13px 0",
                          borderBottom:
                            "1px solid #eee",
                        }}
                      >
                        <div
                          style={{
                            display:
                              "flex",
                            justifyContent:
                              "space-between",
                            alignItems:
                              "center",
                            gap: 10,
                          }}
                        >
                          <b>
                            {
                              category.name
                            }
                          </b>

                          <b>
                            {money(
                              category.amount
                            )}
                          </b>
                        </div>

                        <div
                          style={{
                            height: 8,
                            borderRadius:
                              999,
                            background:
                              "#ececf2",
                            overflow:
                              "hidden",
                            marginTop:
                              8,
                          }}
                        >
                          <div
                            style={{
                              width: `${Math.min(
                                100,
                                category.percent
                              )}%`,
                              height:
                                "100%",
                              background:
                                "#5964d8",
                            }}
                          />
                        </div>

                        <small className="muted">
                          {category.percent.toFixed(
                            0
                          )}
                          % מהוצאות
                          החודש
                        </small>
                      </div>
                    )
                  )}
                </div>
              )}

              <div
                className="row"
                style={{
                  marginTop:
                    14,
                  paddingTop:
                    12,
                  borderTop:
                    "1px solid #eee",
                }}
              >
                <span>
                  מתוכנן להוצאות
                </span>

                <b>
                  {money(
                    plannedExpenses
                  )}
                </b>
              </div>
            </div>
          </>
        )}

        {/* =====================================================
            TRANSACTIONS
           ===================================================== */}

        {tab ===
          "transactions" && (
          <div className="panel">
            <div className="panelHead">
              <h2>
                תנועות
              </h2>

              <button
                className="primary small"
                onClick={() =>
                  openTransactionModal()
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

            {currentTx.length ===
            0 ? (
              <p className="muted">
                אין תנועות בחודש
                הזה.
              </p>
            ) : (
              <div className="txList">
                {currentTx.map(
                  (t) => {
                    const category =
                      categories.find(
                        (c) =>
                          c.id ===
                          t.category_id
                      );

                    const member =
                      members.find(
                        (m) =>
                          m.user_id ===
                          t.person_user_id
                      );

                    const fixed =
                      isFixedExpense(
                        t
                      );

                    return (
                      <div
                        className="tx"
                        key={t.id}
                        style={{
                          alignItems:
                            "center",
                        }}
                      >
                        <div
                          style={{
                            minWidth:
                              0,
                          }}
                        >
                          <b>
                            {
                              t.description
                            }
                          </b>

                          <small
                            style={{
                              display:
                                "block",
                              lineHeight:
                                1.7,
                            }}
                          >
                            {
                              t.transaction_date
                            }

                            {" · "}

                            {category?.name ||
                              "ללא קטגוריה"}

                            {" · "}

                            {t.kind ===
                            "income"
                              ? "הכנסה"
                              : fixed
                              ? "הוצאה קבועה"
                              : "הוצאה משתנה"}

                            {t.merchant && (
                              <>
                                {" · "}
                                {
                                  t.merchant
                                }
                              </>
                            )}

                            {t.payment_method && (
                              <>
                                {" · "}
                                {paymentLabel(
                                  t.payment_method
                                )}
                              </>
                            )}

                            {t.credit_card_last4 && (
                              <>
                                {" · "}
                                ****{" "}
                                {
                                  t.credit_card_last4
                                }
                              </>
                            )}

                            {member?.display_name && (
                              <>
                                {" · "}
                                {
                                  member.display_name
                                }
                              </>
                            )}
                          </small>
                        </div>

                        <div
                          style={{
                            textAlign:
                              "left",
                            flexShrink:
                              0,
                          }}
                        >
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

                          <div
                            style={{
                              display:
                                "flex",
                              gap: 6,
                              marginTop:
                                5,
                            }}
                          >
                            <button
                              type="button"
                              className="ghost small"
                              onClick={() =>
                                openTransactionModal(
                                  t
                                )
                              }
                            >
                              עריכה
                            </button>

                            <button
                              type="button"
                              className="ghost small"
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
                      </div>
                    );
                  }
                )}
              </div>
            )}
          </div>
        )}

        {/* =====================================================
            FIXED EXPENSES
           ===================================================== */}

        {tab === "fixed" && (
          <div className="panel">
            <div className="panelHead">
              <h2>
                הוצאות קבועות
              </h2>

              <button
                className="primary small"
                onClick={() =>
                  openRecurringModal()
                }
              >
                + הוצאה קבועה
              </button>
            </div>

            {recurring.length ===
            0 ? (
              <p className="muted">
                אין הוצאות קבועות
                עדיין.
              </p>
            ) : (
              <div>
                {recurring.map(
                  (r) => {
                    const monthly =
                      recurringForMonth.find(
                        (x) =>
                          x.id ===
                          r.id
                      );

                    const category =
                      categories.find(
                        (c) =>
                          c.id ===
                          r.category_id
                      );

                    const member =
                      members.find(
                        (m) =>
                          m.user_id ===
                          r.person_user_id
                      );

                    return (
                      <div
                        className="listRow"
                        key={r.id}
                        style={{
                          display:
                            "block",
                          padding:
                            "15px 0",
                        }}
                      >
                        <div
                          style={{
                            display:
                              "flex",
                            justifyContent:
                              "space-between",
                            gap: 12,
                          }}
                        >
                          <div>
                            <b>
                              {r.name}
                            </b>

                            <small
                              style={{
                                display:
                                  "block",
                                lineHeight:
                                  1.7,
                              }}
                            >
                              יום{" "}
                              {
                                r.day_of_month
                              }

                              {" · "}

                              {category?.name ||
                                "ללא קטגוריה"}

                              {r.merchant && (
                                <>
                                  {" · "}
                                  {
                                    r.merchant
                                  }
                                </>
                              )}

                              {r.payment_method && (
                                <>
                                  {" · "}
                                  {paymentLabel(
                                    r.payment_method
                                  )}
                                </>
                              )}

                              {member?.display_name && (
                                <>
                                  {" · "}
                                  {
                                    member.display_name
                                  }
                                </>
                              )}
                            </small>
                          </div>

                          <b>
                            {money(
                              r.planned_amount
                            )}
                          </b>
                        </div>

                        <div
                          style={{
                            marginTop:
                              10,
                            display:
                              "flex",
                            alignItems:
                              "center",
                            justifyContent:
                              "space-between",
                            gap: 8,
                            flexWrap:
                              "wrap",
                          }}
                        >
                          {monthly?.charged ? (
                            <span
                              style={{
                                fontSize:
                                  13,
                                fontWeight:
                                  600,
                              }}
                            >
                              ✓ חויב החודש:{" "}
                              {money(
                                monthly
                                  .chargedTransaction
                                  ?.actual_amount
                              )}
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="primary small"
                              onClick={() =>
                                openChargeModal(
                                  r
                                )
                              }
                            >
                              סימון כחויב
                            </button>
                          )}

                          <div
                            style={{
                              display:
                                "flex",
                              gap: 6,
                            }}
                          >
                            <button
                              type="button"
                              className="ghost small"
                              onClick={() =>
                                openRecurringModal(
                                  r
                                )
                              }
                            >
                              עריכה
                            </button>

                            <button
                              type="button"
                              className="ghost small"
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
                      </div>
                    );
                  }
                )}
              </div>
            )}
          </div>
        )}

        {/* =====================================================
            CATEGORIES
           ===================================================== */}

        {tab ===
          "categories" && (
          <div className="panel">
            <div className="panelHead">
              <h2>
                קטגוריות
              </h2>

              <button
                className="primary small"
                onClick={() =>
                  setModal(
                    "category"
                  )
                }
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

      {/* =======================================================
          TRANSACTION MODAL
         ======================================================= */}

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
            onSubmit={
              saveTransaction
            }
            onChange={(e) => {
              if (
                !editingTransaction
              ) {
                saveDraftFromForm(
                  e.currentTarget
                );
              }
            }}
          >
            <label>
              סוג

              <select
                name="kind"
                value={
                  transactionKind
                }
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
                defaultValue={
                  editingTransaction?.description ??
                  draft?.description ??
                  ""
                }
                placeholder="למשל: סופר / משכורת"
                required
              />
            </label>

            <label>
              קטגוריה

              <select
                name="category_id"
                defaultValue={
                  editingTransaction?.category_id ??
                  draft?.category_id ??
                  ""
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
                  defaultValue={
                    editingTransaction?.transaction_date ??
                    draft?.transaction_date ??
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
                    editingTransaction?.planned_amount ??
                    draft?.planned_amount ??
                    ""
                  }
                  required
                />
              </label>
            </div>

            <label>
              סכום בפועל

              <input
                name="actual_amount"
                type="number"
                min="0"
                step="0.01"
                defaultValue={
                  editingTransaction?.actual_amount ??
                  draft?.actual_amount ??
                  ""
                }
                placeholder="אם שונה מהמתוכנן"
              />
            </label>

            <label>
              סוג

              <select
                name={
                  transactionKind ===
                  "income"
                    ? "income_type"
                    : "expense_type"
                }
                defaultValue={
                  editingTransaction?.expense_type ??
                  draft?.expense_type ??
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

            <label>
              אמצעי תשלום

              <select
                name="payment_method"
                defaultValue={
                  editingTransaction?.payment_method ??
                  draft?.payment_method ??
                  ""
                }
              >
                <option value="">
                  לא צוין
                </option>

                {PAYMENT_METHODS.map(
                  ([id, label]) => (
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
              בית עסק / מקור הכנסה

              <input
                name="merchant"
                defaultValue={
                  editingTransaction?.merchant ??
                  draft?.merchant ??
                  ""
                }
                placeholder={
                  transactionKind ===
                  "income"
                    ? "למשל: משכורת"
                    : "למשל: שופרסל"
                }
              />
            </label>

            <label>
              4 ספרות אחרונות של
              האשראי

              <input
                name="credit_card_last4"
                inputMode="numeric"
                maxLength={4}
                defaultValue={
                  editingTransaction?.credit_card_last4 ??
                  draft?.credit_card_last4 ??
                  ""
                }
                placeholder="רק אם שולם באשראי"
              />
            </label>

            <label>
              מי שילם / קיבל

              <select
                name="person_user_id"
                defaultValue={
                  editingTransaction?.person_user_id ??
                  draft?.person_user_id ??
                  ""
                }
              >
                <option value="">
                  לא צוין
                </option>

                {members.map(
                  (m) => (
                    <option
                      key={m.user_id}
                      value={
                        m.user_id
                      }
                    >
                      {m.display_name ||
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
                    ? editingTransaction.completed ===
                      true
                    : draft?.completed !==
                      false
                }
              />

              בוצע / חויב בפועל
            </label>

            <label>
              הערה

              <textarea
                name="note"
                rows="3"
                defaultValue={
                  editingTransaction?.note ??
                  draft?.note ??
                  ""
                }
              />
            </label>

            <div
              style={{
                display:
                  "flex",
                gap: 8,
              }}
            >
              <button
                className="primary"
                type="submit"
              >
                שמירה
              </button>

              <button
                className="ghost"
                type="button"
                onClick={() => {
                  setEditingTransaction(
                    null
                  );

                  setModal(null);
                }}
              >
                ביטול
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* =======================================================
          RECURRING MODAL
         ======================================================= */}

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

            setModal(null);
          }}
        >
          <form
            className="form"
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
                  editingRecurring?.name ||
                  ""
                }
                required
              />
            </label>

            <label>
              קטגוריה

              <select
                name="category_id"
                defaultValue={
                  editingRecurring?.category_id ||
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
                  defaultValue={
                    editingRecurring?.planned_amount ??
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
                    editingRecurring?.day_of_month ??
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
                defaultValue={
                  editingRecurring?.payment_method ||
                  ""
                }
              >
                <option value="">
                  לא צוין
                </option>

                {PAYMENT_METHODS.map(
                  ([id, label]) => (
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
              בית עסק

              <input
                name="merchant"
                placeholder="למשל: חברת החשמל"
                defaultValue={
                  editingRecurring?.merchant ||
                  ""
                }
              />
            </label>

            <label>
              מי אחראי

              <select
                name="person_user_id"
                defaultValue={
                  editingRecurring?.person_user_id ||
                  ""
                }
              >
                <option value="">
                  לא צוין
                </option>

                {members.map(
                  (m) => (
                    <option
                      key={m.user_id}
                      value={
                        m.user_id
                      }
                    >
                      {m.display_name ||
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
                  editingRecurring?.note ||
                  ""
                }
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

      {/* =======================================================
          CHARGE RECURRING MODAL
         ======================================================= */}

      {modal ===
        "charge" &&
        chargingRecurring && (
          <Modal
            title={`חיוב: ${chargingRecurring.name}`}
            onClose={() => {
              setChargingRecurring(
                null
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
              <div
                style={{
                  padding: 12,
                  borderRadius:
                    10,
                  background:
                    "#f6f6f8",
                }}
              >
                <div className="muted">
                  סכום מתוכנן
                </div>

                <strong
                  style={{
                    fontSize:
                      22,
                  }}
                >
                  {money(
                    chargingRecurring.planned_amount
                  )}
                </strong>
              </div>

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
                סכום בפועל

                <input
                  name="actual_amount"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={
                    chargingRecurring.planned_amount
                  }
                  required
                />
              </label>

              <label>
                אמצעי תשלום

                <select
                  name="payment_method"
                  defaultValue={
                    chargingRecurring.payment_method ||
                    ""
                  }
                >
                  <option value="">
                    לא צוין
                  </option>

                  {PAYMENT_METHODS.map(
                    ([id, label]) => (
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
                בית עסק

                <input
                  name="merchant"
                  defaultValue={
                    chargingRecurring.merchant ||
                    ""
                  }
                />
              </label>

              <label>
                4 ספרות אחרונות של
                האשראי

                <input
                  name="credit_card_last4"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="רק אם שולם באשראי"
                />
              </label>

              <label>
                מי שילם

                <select
                  name="person_user_id"
                  defaultValue={
                    chargingRecurring.person_user_id ||
                    ""
                  }
                >
                  <option value="">
                    לא צוין
                  </option>

                  {members.map(
                    (m) => (
                      <option
                        key={m.user_id}
                        value={
                          m.user_id
                        }
                      >
                        {m.display_name ||
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
                    chargingRecurring.note ||
                    ""
                  }
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

      {/* =======================================================
          CATEGORY MODAL
         ======================================================= */}

      {modal ===
        "category" && (
        <Modal
          title="קטגוריה חדשה"
          onClose={() =>
            setModal(null)
          }
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
