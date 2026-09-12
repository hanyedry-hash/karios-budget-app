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

const money = (value) =>
  new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

const monthKey = (date = new Date()) => {
  const d = new Date(date);

  return `${d.getFullYear()}-${String(
    d.getMonth() + 1
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

const isFixedExpense = (transaction) =>
  transaction?.kind === "expense" &&
  (
    transaction.expense_type === "fixed" ||
    Boolean(transaction.recurring_expense_id)
  );

const isVariableExpense = (transaction) =>
  transaction?.kind === "expense" &&
  !isFixedExpense(transaction);

const hasActualAmount = (transaction) =>
  transaction?.actual_amount !== null &&
  transaction?.actual_amount !== undefined &&
  transaction?.actual_amount !== "";

const isActualExpense = (transaction) =>
  transaction?.kind === "expense" &&
  transaction?.completed === true &&
  hasActualAmount(transaction);

const emptyTransactionForm = () => ({
  kind: "expense",

  description: "",
  category_id: "",
  transaction_date: todayKey(),

  expense_type: "variable",
  income_type: "variable",

  planned_amount: "",
  actual_amount: "",

  payment_method: "",
  merchant: "",
  credit_card_last4: "",

  person_user_id: "",
  completed: true,

  note: "",
});

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
        onMouseDown={(event) =>
          event.stopPropagation()
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
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [household, setHousehold] = useState(null);

  const [categories, setCategories] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [members, setMembers] = useState([]);

  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [tab, setTab] = useState("dashboard");
  const [month, setMonth] = useState(monthKey());

  const [modal, setModal] = useState(null);

  const [editingTransaction, setEditingTransaction] =
    useState(null);

  const [editingRecurring, setEditingRecurring] =
    useState(null);

  const [chargingRecurring, setChargingRecurring] =
    useState(null);

  const [transactionForm, setTransactionForm] =
    useState(emptyTransactionForm());

  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  /*
   * =========================================================
   * AUTH + LOAD
   * =========================================================
   */

  useEffect(() => {
    let mounted = true;

    async function init() {
      const {
        data,
        error,
      } = await supabase.auth.getSession();

      if (!mounted) return;

      if (error) {
        setLoading(false);
        return;
      }

      setSession(data.session);

      if (data.session?.user) {
        await loadData(data.session.user.id);
      } else {
        setLoading(false);
      }
    }

    init();

    const {
      data: authListener,
    } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        if (!mounted) return;

        setSession(newSession);

        if (newSession?.user) {
          await loadData(newSession.user.id);
        } else {
          setProfile(null);
          setHousehold(null);
          setCategories([]);
          setTransactions([]);
          setRecurring([]);
          setMembers([]);
          setLoading(false);
        }
      }
    );

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  async function loadData(userId) {
    setLoading(true);

    const {
      data: membership,
      error: membershipError,
    } = await supabase
      .from("household_members")
      .select("household_id, role")
      .eq("user_id", userId)
      .maybeSingle();

    if (membershipError || !membership) {
      setLoading(false);
      return;
    }

    const householdId = membership.household_id;

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
        .eq("id", householdId)
        .single(),

      supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single(),

      supabase
        .from("categories")
        .select("*")
        .eq("household_id", householdId)
        .eq("is_active", true)
        .order("name"),

      supabase
        .from("transactions")
        .select("*")
        .eq("household_id", householdId)
        .order("transaction_date", {
          ascending: false,
        }),

      supabase
        .from("recurring_expenses")
        .select("*")
        .eq("household_id", householdId)
        .eq("is_active", true)
        .order("day_of_month"),

      supabase.rpc(
        "get_my_household_members"
      ),
    ]);

    setHousehold(
      householdResult.data || null
    );

    setProfile(
      profileResult.data || null
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

  async function refresh() {
    if (!session?.user?.id) return;

    await loadData(session.user.id);
  }

  /*
   * =========================================================
   * LOGIN
   * =========================================================
   */

  async function login(event) {
    event.preventDefault();

    setAuthError("");

    const {
      error,
    } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

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
   * MONTH
   * =========================================================
   */

  const currentTransactions = useMemo(
    () =>
      transactions.filter(
        (transaction) =>
          String(
            transaction.transaction_date || ""
          ).startsWith(month)
      ),
    [transactions, month]
  );

  /*
   * =========================================================
   * RECURRING FOR CURRENT MONTH
   * =========================================================
   */

  const recurringForMonth = useMemo(
    () =>
      recurring.map(
        (recurringExpense) => {
          const chargedTransaction =
            transactions.find(
              (transaction) =>
                transaction.recurring_expense_id ===
                  recurringExpense.id &&
                transaction.recurring_month ===
                  month &&
                transaction.kind ===
                  "expense" &&
                transaction.completed ===
                  true &&
                hasActualAmount(
                  transaction
                )
            );

          return {
            ...recurringExpense,

            chargedTransaction:
              chargedTransaction ||
              null,

            charged:
              Boolean(
                chargedTransaction
              ),
          };
        }
      ),
    [
      recurring,
      transactions,
      month,
    ]
  );

  /*
   * =========================================================
   * INCOME
   * =========================================================
   */

  const income = useMemo(
    () =>
      currentTransactions
        .filter(
          (transaction) =>
            transaction.kind ===
              "income" &&
            transaction.completed ===
              true &&
            hasActualAmount(
              transaction
            )
        )
        .reduce(
          (sum, transaction) =>
            sum +
            Number(
              transaction.actual_amount ||
                0
            ),
          0
        ),
    [currentTransactions]
  );

  /*
   * =========================================================
   * ACTUAL EXPENSES
   * =========================================================
   */

  const actualExpenses = useMemo(
    () =>
      currentTransactions
        .filter(
          isActualExpense
        )
        .reduce(
          (sum, transaction) =>
            sum +
            Number(
              transaction.actual_amount ||
                0
            ),
          0
        ),
    [currentTransactions]
  );

  /*
   * =========================================================
   * FIXED ACTUAL
   * =========================================================
   */

  const fixedCharged = useMemo(
    () =>
      currentTransactions
        .filter(
          (transaction) =>
            isFixedExpense(
              transaction
            ) &&
            transaction.completed ===
              true &&
            hasActualAmount(
              transaction
            )
        )
        .reduce(
          (sum, transaction) =>
            sum +
            Number(
              transaction.actual_amount ||
                0
            ),
          0
        ),
    [currentTransactions]
  );

  /*
   * =========================================================
   * VARIABLE ACTUAL
   * =========================================================
   */

  const variableExpenses = useMemo(
    () =>
      currentTransactions
        .filter(
          (transaction) =>
            isVariableExpense(
              transaction
            ) &&
            transaction.completed ===
              true &&
            hasActualAmount(
              transaction
            )
        )
        .reduce(
          (sum, transaction) =>
            sum +
            Number(
              transaction.actual_amount ||
                0
            ),
          0
        ),
    [currentTransactions]
  );

  /*
   * =========================================================
   * MANUAL FIXED PENDING
   * =========================================================
   */

  const manualFixedPending = useMemo(
    () =>
      currentTransactions
        .filter(
          (transaction) =>
            isFixedExpense(
              transaction
            ) &&
            !transaction.recurring_expense_id &&
            transaction.completed !==
              true
        )
        .reduce(
          (sum, transaction) =>
            sum +
            Number(
              transaction.planned_amount ||
                0
            ),
          0
        ),
    [currentTransactions]
  );

  /*
   * =========================================================
   * RECURRING PENDING
   * =========================================================
   */

  const recurringPending = useMemo(
    () =>
      recurringForMonth
        .filter(
          (item) =>
            !item.charged
        )
        .reduce(
          (sum, item) =>
            sum +
            Number(
              item.planned_amount ||
                0
            ),
          0
        ),
    [recurringForMonth]
  );

  const pendingFixed =
    recurringPending +
    manualFixedPending;

  /*
   * VARIABLE HAS NO PLANNED TOTAL
   */

  const pendingVariable = 0;

  /*
   * =========================================================
   * PLANNED FIXED
   * =========================================================
   */

  const fixedPlanned =
    fixedCharged +
    pendingFixed;

  /*
   * =========================================================
   * TOTAL EXPENSE OBLIGATION
   * =========================================================
   */

  const plannedExpenses =
    actualExpenses +
    pendingFixed;

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
   * PERCENTAGES
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
    useMemo(
      () =>
        categories
          .filter(
            (category) =>
              category.kind ===
                "expense" ||
              category.kind ===
                "both"
          )
          .map((category) => {
            const amount =
              currentTransactions
                .filter(
                  (transaction) =>
                    isActualExpense(
                      transaction
                    ) &&
                    transaction.category_id ===
                      category.id
                )
                .reduce(
                  (
                    sum,
                    transaction
                  ) =>
                    sum +
                    Number(
                      transaction.actual_amount ||
                        0
                    ),
                  0
                );

            return {
              ...category,
              amount,

              percent:
                actualExpenses > 0
                  ? (amount /
                      actualExpenses) *
                    100
                  : 0,
            };
          })
          .filter(
            (category) =>
              category.amount > 0
          )
          .sort(
            (a, b) =>
              b.amount -
              a.amount
          ),
      [
        categories,
        currentTransactions,
        actualExpenses,
      ]
    );

  /*
   * =========================================================
   * TRANSACTION MODAL
   * =========================================================
   */

  function openTransactionModal(
    transaction = null
  ) {
    setSaveError("");

    if (transaction) {
      setEditingTransaction(
        transaction
      );

      setTransactionForm({
        kind:
          transaction.kind ||
          "expense",

        description:
          transaction.description ||
          "",

        category_id:
          transaction.category_id ||
          "",

        transaction_date:
          transaction.transaction_date ||
          todayKey(),

        expense_type:
          transaction.expense_type ===
          "fixed"
            ? "fixed"
            : "variable",

        income_type:
          transaction.expense_type ===
          "fixed"
            ? "fixed"
            : "variable",

        planned_amount:
          transaction.planned_amount ??
          "",

        actual_amount:
          transaction.actual_amount ??
          "",

        payment_method:
          transaction.payment_method ||
          "",

        merchant:
          transaction.merchant ||
          "",

        credit_card_last4:
          transaction.credit_card_last4 ||
          "",

        person_user_id:
          transaction.person_user_id ||
          "",

        completed:
          transaction.completed ===
          true,

        note:
          transaction.note ||
          "",
      });
    } else {
      setEditingTransaction(
        null
      );

      setTransactionForm(
        emptyTransactionForm()
      );
    }

    setModal("transaction");
  }

  function closeTransactionModal() {
    if (saving) return;

    setEditingTransaction(null);
    setModal(null);
    setSaveError("");

    setTransactionForm(
      emptyTransactionForm()
    );
  }

  function updateTransactionField(
    field,
    value
  ) {
    setTransactionForm(
      (current) => ({
        ...current,
        [field]: value,
      })
    );
  }

  /*
   * =========================================================
   * EXPENSE TYPE
   *
   * IMPORTANT:
   * We deliberately preserve BOTH amounts.
   *
   * Switching type only changes which fields are shown.
   * Nothing already entered gets erased.
   * =========================================================
   */

  function changeExpenseType(
    value
  ) {
    setSaveError("");

    setTransactionForm(
      (current) => ({
        ...current,

        expense_type:
          value,

        /*
         * Variable expenses are always actual.
         * Fixed expenses preserve the user's
         * current charged/not charged state.
         */
        completed:
          value === "variable"
            ? true
            : current.completed,
      })
    );
  }

  /*
   * =========================================================
   * SAVE TRANSACTION
   * =========================================================
   */

  async function saveTransaction(
    event
  ) {
    event.preventDefault();

    if (saving) return;

    setSaveError("");

    const form =
      transactionForm;

    if (!household?.id) {
      setSaveError(
        "לא נמצא התקציב המשפחתי."
      );
      return;
    }

    if (
      !form.description.trim()
    ) {
      setSaveError(
        "יש להזין תיאור."
      );
      return;
    }

    if (!form.category_id) {
      setSaveError(
        "יש לבחור קטגוריה."
      );
      return;
    }

    if (!form.transaction_date) {
      setSaveError(
        "יש לבחור תאריך."
      );
      return;
    }

    /*
     * =======================================================
     * VARIABLE EXPENSE
     * =======================================================
     */

    if (
      form.kind === "expense" &&
      form.expense_type ===
        "variable"
    ) {
      const actual =
        Number(
          form.actual_amount
        );

      if (
        form.actual_amount ===
          "" ||
        Number.isNaN(actual)
      ) {
        setSaveError(
          "יש להזין סכום בפועל."
        );
        return;
      }

      if (actual < 0) {
        setSaveError(
          "הסכום לא יכול להיות שלילי."
        );
        return;
      }

      const row = {
        household_id:
          household.id,

        kind: "expense",

        description:
          form.description.trim(),

        category_id:
          form.category_id,

        transaction_date:
          form.transaction_date,

        /*
         * The DB currently requires planned_amount.
         * For variable expenses we store the actual
         * amount there only for DB compatibility.
         *
         * The application never treats this as planned.
         */
        planned_amount:
          actual,

        completed: true,

        actual_amount:
          actual,

        expense_type:
          "variable",

        person_user_id:
          form.person_user_id ||
          null,

        note:
          form.note?.trim() ||
          null,

        payment_method:
          form.payment_method ||
          null,

        merchant:
          form.merchant?.trim() ||
          null,

        credit_card_last4:
          form.payment_method ===
          "credit_card"
            ? form.credit_card_last4 ||
              null
            : null,

        updated_at:
          new Date().toISOString(),
      };

      await persistTransaction(
        row
      );

      return;
    }

    /*
     * =======================================================
     * FIXED EXPENSE
     * =======================================================
     */

    if (
      form.kind === "expense" &&
      form.expense_type ===
        "fixed"
    ) {
      const planned =
        Number(
          form.planned_amount
        );

      if (
        form.planned_amount ===
          "" ||
        Number.isNaN(planned)
      ) {
        setSaveError(
          "יש להזין סכום מתוכנן."
        );
        return;
      }

      if (planned < 0) {
        setSaveError(
          "הסכום לא יכול להיות שלילי."
        );
        return;
      }

      let actual = null;

      if (
        form.actual_amount !==
          "" &&
        form.actual_amount !==
          null &&
        form.actual_amount !==
          undefined
      ) {
        actual =
          Number(
            form.actual_amount
          );

        if (
          Number.isNaN(actual) ||
          actual < 0
        ) {
          setSaveError(
            "הסכום בפועל אינו תקין."
          );
          return;
        }
      }

      /*
       * If the user marked it as charged
       * but did not enter an actual amount,
       * planned becomes actual.
       */

      if (
        form.completed === true &&
        actual === null
      ) {
        actual = planned;
      }

      /*
       * An actual amount means the expense
       * is charged.
       */

      const completed =
        actual !== null;

      const row = {
        household_id:
          household.id,

        kind: "expense",

        description:
          form.description.trim(),

        category_id:
          form.category_id,

        transaction_date:
          form.transaction_date,

        planned_amount:
          planned,

        completed,

        actual_amount:
          actual,

        expense_type:
          "fixed",

        person_user_id:
          form.person_user_id ||
          null,

        note:
          form.note?.trim() ||
          null,

        payment_method:
          form.payment_method ||
          null,

        merchant:
          form.merchant?.trim() ||
          null,

        credit_card_last4:
          form.payment_method ===
          "credit_card"
            ? form.credit_card_last4 ||
              null
            : null,

        updated_at:
          new Date().toISOString(),
      };

      await persistTransaction(
        row
      );

      return;
    }

    /*
     * =======================================================
     * INCOME
     * =======================================================
     */

    if (
      form.kind === "income"
    ) {
      const actual =
        Number(
          form.actual_amount
        );

      if (
        form.actual_amount ===
          "" ||
        Number.isNaN(actual)
      ) {
        setSaveError(
          "יש להזין סכום הכנסה."
        );
        return;
      }

      if (actual < 0) {
        setSaveError(
          "הסכום לא יכול להיות שלילי."
        );
        return;
      }

      let planned = actual;

      if (
        form.planned_amount !==
          "" &&
        form.planned_amount !==
          null &&
        form.planned_amount !==
          undefined
      ) {
        planned =
          Number(
            form.planned_amount
          );

        if (
          Number.isNaN(planned) ||
          planned < 0
        ) {
          setSaveError(
            "הסכום המתוכנן אינו תקין."
          );
          return;
        }
      }

      const row = {
        household_id:
          household.id,

        kind: "income",

        description:
          form.description.trim(),

        category_id:
          form.category_id,

        transaction_date:
          form.transaction_date,

        planned_amount:
          planned,

        completed: true,

        actual_amount:
          actual,

        expense_type:
          form.income_type ||
          "variable",

        person_user_id:
          form.person_user_id ||
          null,

        note:
          form.note?.trim() ||
          null,

        payment_method:
          form.payment_method ||
          null,

        merchant:
          form.merchant?.trim() ||
          null,

        credit_card_last4:
          null,

        updated_at:
          new Date().toISOString(),
      };

      await persistTransaction(
        row
      );
    }
  }

  /*
   * =========================================================
   * PERSIST TRANSACTION
   * =========================================================
   */

  async function persistTransaction(
    row
  ) {
    setSaving(true);
    setSaveError("");

    let result;

    if (
      editingTransaction
    ) {
      /*
       * IMPORTANT:
       * Do NOT send created_by during update.
       */

      result =
        await supabase
          .from("transactions")
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
      /*
       * created_by is only assigned
       * when creating a new transaction.
       */

      result =
        await supabase
          .from("transactions")
          .insert({
            ...row,
            created_by:
              session.user.id,
          });
    }

    if (result.error) {
      console.error(
        "Transaction save error:",
        result.error
      );

      setSaveError(
        "לא הצלחתי לשמור את התנועה.\n\n" +
          result.error.message
      );

      setSaving(false);

      return;
    }

    setSaving(false);

    /*
     * Only AFTER successful save
     * do we close/reset the form.
     */

    setEditingTransaction(null);
    setModal(null);
    setTransactionForm(
      emptyTransactionForm()
    );

    await refresh();
  }

  /*
   * =========================================================
   * DELETE TRANSACTION
   * =========================================================
   */

  async function deleteTransaction(
    transaction
  ) {
    const ok =
      window.confirm(
        `למחוק את התנועה "${transaction.description}"?\n\nהפעולה אינה ניתנת לביטול.`
      );

    if (!ok) return;

    const {
      error,
    } = await supabase
      .from("transactions")
      .delete()
      .eq(
        "id",
        transaction.id
      )
      .eq(
        "household_id",
        household.id
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
   * RECURRING MODAL
   * =========================================================
   */

  function openRecurringModal(
    recurringExpense = null
  ) {
    setEditingRecurring(
      recurringExpense
    );

    setSaveError("");
    setModal("recurring");
  }

  function closeRecurringModal() {
    if (saving) return;

    setEditingRecurring(null);
    setModal(null);
    setSaveError("");
  }

  /*
   * =========================================================
   * SAVE RECURRING
   * =========================================================
   */

  async function saveRecurring(
    event
  ) {
    event.preventDefault();

    if (saving) return;

    setSaveError("");
    setSaving(true);

    const form =
      new FormData(
        event.currentTarget
      );

    const name =
      String(
        form.get("name") ||
          ""
      ).trim();

    const planned =
      Number(
        form.get(
          "planned_amount"
        ) || 0
      );

    const day =
      Number(
        form.get(
          "day_of_month"
        ) || 1
      );

    if (!name) {
      setSaveError(
        "יש להזין שם הוצאה."
      );
      setSaving(false);
      return;
    }

    if (
      Number.isNaN(planned) ||
      planned < 0
    ) {
      setSaveError(
        "יש להזין סכום מתוכנן תקין."
      );
      setSaving(false);
      return;
    }

    if (
      day < 1 ||
      day > 31
    ) {
      setSaveError(
        "יום בחודש חייב להיות בין 1 ל־31."
      );
      setSaving(false);
      return;
    }

    const row = {
      household_id:
        household.id,

      name,

      category_id:
        form.get(
          "category_id"
        ) || null,

      planned_amount:
        planned,

      day_of_month:
        day,

      person_user_id:
        form.get(
          "person_user_id"
        ) || null,

      is_active: true,

      note:
        form.get("note") ||
        null,

      payment_method:
        form.get(
          "payment_method"
        ) || null,

      merchant:
        form.get("merchant") ||
        null,
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
      setSaveError(
        "לא הצלחתי לשמור את ההוצאה הקבועה.\n\n" +
          result.error.message
      );

      setSaving(false);
      return;
    }

    setSaving(false);
    setEditingRecurring(null);
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

    const {
      error,
    } = await supabase
      .from(
        "recurring_expenses"
      )
      .update({
        is_active: false,
      })
      .eq(
        "id",
        recurringExpense.id
      )
      .eq(
        "household_id",
        household.id
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

    setSaveError("");
    setModal("charge");
  }

  function closeChargeModal() {
    if (saving) return;

    setChargingRecurring(null);
    setModal(null);
    setSaveError("");
  }

  async function saveRecurringCharge(
    event
  ) {
    event.preventDefault();

    if (
      saving ||
      !chargingRecurring
    )
      return;

    setSaveError("");
    setSaving(true);

    const form =
      new FormData(
        event.currentTarget
      );

    const actual =
      Number(
        form.get(
          "actual_amount"
        ) || 0
      );

    if (
      Number.isNaN(actual) ||
      actual < 0
    ) {
      setSaveError(
        "יש להזין סכום בפועל."
      );
      setSaving(false);
      return;
    }

    /*
     * Check client data first.
     */

    const alreadyCharged =
      transactions.some(
        (transaction) =>
          transaction.recurring_expense_id ===
            chargingRecurring.id &&
          transaction.recurring_month ===
            month &&
          transaction.completed ===
            true &&
          hasActualAmount(
            transaction
          )
      );

    if (alreadyCharged) {
      setSaveError(
        "הוצאה זו כבר סומנה כחויבה בחודש הזה."
      );
      setSaving(false);
      return;
    }

    const paymentMethod =
      form.get(
        "payment_method"
      ) ||
      chargingRecurring.payment_method ||
      null;

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
        form.get(
          "transaction_date"
        ),

      planned_amount:
        Number(
          chargingRecurring.planned_amount ||
            0
        ),

      completed: true,

      actual_amount:
        actual,

      expense_type:
        "fixed",

      person_user_id:
        form.get(
          "person_user_id"
        ) ||
        chargingRecurring.person_user_id ||
        null,

      note:
        form.get("note") ||
        chargingRecurring.note ||
        null,

      payment_method:
        paymentMethod,

      merchant:
        form.get("merchant") ||
        chargingRecurring.merchant ||
        null,

      credit_card_last4:
        paymentMethod ===
        "credit_card"
          ? form.get(
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

    const {
      error,
    } = await supabase
      .from("transactions")
      .insert(row);

    if (error) {
      setSaveError(
        "לא הצלחתי לרשום את החיוב.\n\n" +
          error.message
      );

      setSaving(false);
      return;
    }

    setSaving(false);
    setChargingRecurring(null);
    setModal(null);

    await refresh();
  }

  /*
   * =========================================================
   * CATEGORY
   * =========================================================
   */

  async function saveCategory(
    event
  ) {
    event.preventDefault();

    const form =
      new FormData(
        event.currentTarget
      );

    const name =
      String(
        form.get("name") ||
          ""
      ).trim();

    if (!name) {
      alert(
        "יש להזין שם קטגוריה."
      );
      return;
    }

    const {
      error,
    } = await supabase
      .from("categories")
      .insert({
        household_id:
          household.id,

        name,

        kind:
          form.get("kind"),

        is_active: true,
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
                onChange={(event) =>
                  setEmail(
                    event.target.value
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
                onChange={(event) =>
                  setPassword(
                    event.target.value
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

  /*
   * =========================================================
   * LOADING
   * =========================================================
   */

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
          ["dashboard", "סקירה"],
          ["transactions", "תנועות"],
          ["fixed", "הוצאות קבועות"],
          ["categories", "קטגוריות"],
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

        {/* ===================================================
            DASHBOARD
           =================================================== */}

        {tab === "dashboard" && (
          <>
            <div className="monthBar">
              <button
                onClick={() => {
                  const date =
                    new Date(
                      month +
                        "-15"
                    );

                  date.setMonth(
                    date.getMonth() -
                      1
                  );

                  setMonth(
                    monthKey(date)
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
                    month: "long",
                    year: "numeric",
                  }
                )}
              </strong>

              <button
                onClick={() => {
                  const date =
                    new Date(
                      month +
                        "-15"
                    );

                  date.setMonth(
                    date.getMonth() +
                      1
                  );

                  setMonth(
                    monthKey(date)
                  );
                }}
              >
                ›
              </button>
            </div>

            <div
              className={
                balance >= 0
                  ? "card balance"
                  : "card balance negative"
              }
              style={{
                marginBottom: 16,
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
                  marginTop: 14,
                  paddingTop: 12,
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
                      fontSize: 18,
                    }}
                  >
                    {money(income)}
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
                      fontSize: 18,
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
                  marginTop: 10,
                  opacity:
                    0.75,
                }}
              >
                הכנסות בפועל פחות
                הוצאות שחויבו
                בפועל
              </small>
            </div>

            <div
              className="panel"
              style={{
                marginBottom: 16,
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
                  marginTop: 16,
                  display:
                    "flex",
                }}
              >
                <div
                  style={{
                    width:
                      `${fixedProgress}%`,
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
                  marginTop: 10,
                  fontSize: 13,
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
                  marginTop: 14,
                  paddingTop: 12,
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

            <div
              className="panel"
              style={{
                marginBottom: 16,
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
                  marginTop: 16,
                  display:
                    "flex",
                }}
              >
                <div
                  style={{
                    width:
                      `${fixedPercent}%`,
                    background:
                      "#5964d8",
                  }}
                />

                <div
                  style={{
                    width:
                      `${variablePercent}%`,
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
                  marginTop: 16,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize:
                        13,
                    }}
                  >
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
            </div>

            <div className="panel">
              <h2>
                פירוט הוצאות לפי
                קטגוריה
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
                    marginTop: 8,
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
                            marginTop: 8,
                          }}
                        >
                          <div
                            style={{
                              width:
                                `${Math.min(
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
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop:
                    "1px solid #eee",
                }}
              >
                <span>
                  בפועל + קבועות
                  שטרם חויבו
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

        {/* ===================================================
            TRANSACTIONS
           =================================================== */}

        {tab === "transactions" && (
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
                onChange={(event) =>
                  setMonth(
                    event.target.value
                  )
                }
              />
            </div>

            {currentTransactions.length ===
            0 ? (
              <p className="muted">
                אין תנועות בחודש
                הזה.
              </p>
            ) : (
              <div className="txList">
                {currentTransactions.map(
                  (transaction) => {
                    const category =
                      categories.find(
                        (item) =>
                          item.id ===
                          transaction.category_id
                      );

                    const member =
                      members.find(
                        (item) =>
                          item.user_id ===
                          transaction.person_user_id
                      );

                    const fixed =
                      isFixedExpense(
                        transaction
                      );

                    const amount =
                      hasActualAmount(
                        transaction
                      )
                        ? transaction.actual_amount
                        : transaction.planned_amount;

                    return (
                      <div
                        className="tx"
                        key={
                          transaction.id
                        }
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
                              transaction.description
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
                              transaction.transaction_date
                            }

                            {" · "}

                            {category?.name ||
                              "ללא קטגוריה"}

                            {" · "}

                            {transaction.kind ===
                            "income"
                              ? "הכנסה"
                              : fixed
                              ? "הוצאה קבועה"
                              : "הוצאה משתנה"}

                            {transaction.merchant && (
                              <>
                                {" · "}
                                {
                                  transaction.merchant
                                }
                              </>
                            )}

                            {transaction.payment_method && (
                              <>
                                {" · "}
                                {paymentLabel(
                                  transaction.payment_method
                                )}
                              </>
                            )}

                            {transaction.credit_card_last4 && (
                              <>
                                {" · "}
                                ****{" "}
                                {
                                  transaction.credit_card_last4
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

                            {transaction.kind ===
                              "expense" &&
                              transaction.completed !==
                                true && (
                                <>
                                  {" · "}
                                  <span>
                                    ממתין
                                    לחיוב
                                  </span>
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
                              transaction.kind ===
                              "income"
                                ? "positive"
                                : "negative"
                            }
                          >
                            {transaction.kind ===
                            "income"
                              ? "+"
                              : "−"}{" "}
                            {money(
                              amount
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
                                  transaction
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
                                  transaction
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

        {/* ===================================================
            FIXED
           =================================================== */}

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
                  (item) => {
                    const monthly =
                      recurringForMonth.find(
                        (row) =>
                          row.id ===
                          item.id
                      );

                    const category =
                      categories.find(
                        (row) =>
                          row.id ===
                          item.category_id
                      );

                    const member =
                      members.find(
                        (row) =>
                          row.user_id ===
                          item.person_user_id
                      );

                    return (
                      <div
                        className="listRow"
                        key={item.id}
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
                              {item.name}
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
                                item.day_of_month
                              }

                              {" · "}

                              {category?.name ||
                                "ללא קטגוריה"}

                              {item.merchant && (
                                <>
                                  {" · "}
                                  {
                                    item.merchant
                                  }
                                </>
                              )}

                              {item.payment_method && (
                                <>
                                  {" · "}
                                  {paymentLabel(
                                    item.payment_method
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
                              item.planned_amount
                            )}
                          </b>
                        </div>

                        <div
                          style={{
                            marginTop: 10,
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
                                  item
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
                                  item
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
                                  item
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

        {/* ===================================================
            CATEGORIES
           =================================================== */}

        {tab === "categories" && (
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
                (category) => (
                  <div
                    className="category"
                    key={
                      category.id
                    }
                  >
                    <span>
                      {
                        category.name
                      }
                    </span>

                    <small>
                      {category.kind ===
                      "income"
                        ? "הכנסה"
                        : category.kind ===
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

      {/* =====================================================
          TRANSACTION MODAL
         ===================================================== */}

      {modal ===
        "transaction" && (
        <Modal
          title={
            editingTransaction
              ? "עריכת תנועה"
              : "הוספת תנועה"
          }
          onClose={
            closeTransactionModal
          }
        >
          <form
            className="form"
            onSubmit={
              saveTransaction
            }
          >
            {/* TYPE */}

            <label>
              סוג

              <select
                value={
                  transactionForm.kind
                }
                onChange={(event) => {
                  const kind =
                    event.target.value;

                  setSaveError("");

                  setTransactionForm(
                    (current) => ({
                      ...current,

                      kind,

                      /*
                       * When switching between
                       * expense and income we do NOT
                       * destroy the existing amounts.
                       */

                      expense_type:
                        current.expense_type ||
                        "variable",

                      income_type:
                        current.income_type ||
                        "variable",
                    })
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

            {/* DESCRIPTION */}

            <label>
              תיאור

              <input
                value={
                  transactionForm.description
                }
                onChange={(event) =>
                  updateTransactionField(
                    "description",
                    event.target.value
                  )
                }
                placeholder={
                  transactionForm.kind ===
                  "income"
                    ? "למשל: משכורת"
                    : "למשל: סופר"
                }
                required
              />
            </label>

            {/* CATEGORY */}

            <label>
              קטגוריה

              <select
                value={
                  transactionForm.category_id
                }
                onChange={(event) =>
                  updateTransactionField(
                    "category_id",
                    event.target.value
                  )
                }
                required
              >
                <option value="">
                  בחרי קטגוריה
                </option>

                {categories
                  .filter(
                    (category) =>
                      category.kind ===
                        transactionForm.kind ||
                      category.kind ===
                        "both"
                  )
                  .map(
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

            {/* DATE */}

            <label>
              תאריך

              <input
                type="date"
                value={
                  transactionForm.transaction_date
                }
                onChange={(event) =>
                  updateTransactionField(
                    "transaction_date",
                    event.target.value
                  )
                }
                required
              />
            </label>

            {/* =================================================
                EXPENSE TYPE
               ================================================= */}

            {transactionForm.kind ===
            "expense" ? (
              <>
                <label>
                  סוג ההוצאה
                </label>

                <div
                  style={{
                    display:
                      "grid",
                    gridTemplateColumns:
                      "1fr 1fr",
                    gap: 8,
                    marginTop:
                      -8,
                  }}
                >
                  <button
                    type="button"
                    onClick={() =>
                      changeExpenseType(
                        "variable"
                      )
                    }
                    style={{
                      padding:
                        "13px 10px",
                      borderRadius:
                        12,
                      border:
                        transactionForm.expense_type ===
                        "variable"
                          ? "2px solid #5964d8"
                          : "1px solid #ddd",
                      background:
                        transactionForm.expense_type ===
                        "variable"
                          ? "#eef0ff"
                          : "white",
                      fontWeight:
                        transactionForm.expense_type ===
                        "variable"
                          ? 700
                          : 500,
                      cursor:
                        "pointer",
                    }}
                  >
                    משתנה
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      changeExpenseType(
                        "fixed"
                      )
                    }
                    style={{
                      padding:
                        "13px 10px",
                      borderRadius:
                        12,
                      border:
                        transactionForm.expense_type ===
                        "fixed"
                          ? "2px solid #5964d8"
                          : "1px solid #ddd",
                      background:
                        transactionForm.expense_type ===
                        "fixed"
                          ? "#eef0ff"
                          : "white",
                      fontWeight:
                        transactionForm.expense_type ===
                        "fixed"
                          ? 700
                          : 500,
                      cursor:
                        "pointer",
                    }}
                  >
                    קבועה
                  </button>
                </div>

                {/* =================================================
                    VARIABLE
                   ================================================= */}

                {transactionForm.expense_type ===
                  "variable" && (
                  <div
                    style={{
                      padding:
                        12,
                      borderRadius:
                        12,
                      background:
                        "#f5f6fb",
                      border:
                        "1px solid #e5e6ef",
                    }}
                  >
                    <small
                      className="muted"
                      style={{
                        display:
                          "block",
                        marginBottom:
                          8,
                      }}
                    >
                      הוצאה משתנה –
                      מזינים רק את
                      הסכום ששולם
                      בפועל
                    </small>

                    <label>
                      סכום בפועל

                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={
                          transactionForm.actual_amount
                        }
                        onChange={(event) =>
                          updateTransactionField(
                            "actual_amount",
                            event.target.value
                          )
                        }
                        placeholder="כמה שילמת בפועל?"
                        required
                      />
                    </label>
                  </div>
                )}

                {/* =================================================
                    FIXED
                   ================================================= */}

                {transactionForm.expense_type ===
                  "fixed" && (
                  <div
                    style={{
                      padding:
                        12,
                      borderRadius:
                        12,
                      background:
                        "#f5f6fb",
                      border:
                        "1px solid #e5e6ef",
                    }}
                  >
                    <small
                      className="muted"
                      style={{
                        display:
                          "block",
                        marginBottom:
                          8,
                      }}
                    >
                      הוצאה קבועה –
                      יש סכום מתוכנן
                      וסכום בפועל
                    </small>

                    <label>
                      סכום מתוכנן

                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={
                          transactionForm.planned_amount
                        }
                        onChange={(event) =>
                          updateTransactionField(
                            "planned_amount",
                            event.target.value
                          )
                        }
                        placeholder="למשל: 8000"
                        required
                      />
                    </label>

                    <label>
                      סכום בפועל

                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={
                          transactionForm.actual_amount
                        }
                        onChange={(event) =>
                          updateTransactionField(
                            "actual_amount",
                            event.target.value
                          )
                        }
                        placeholder="השאירי ריק אם עדיין לא חויב"
                      />
                    </label>

                    <label className="check">
                      <input
                        type="checkbox"
                        checked={
                          transactionForm.completed
                        }
                        onChange={(event) =>
                          updateTransactionField(
                            "completed",
                            event.target.checked
                          )
                        }
                      />

                      בוצע / חויב בפועל
                    </label>

                    <small className="muted">
                      אם מסמנים כחויב
                      ולא מזינים סכום
                      בפועל, הסכום
                      המתוכנן ייחשב
                      כסכום בפועל.
                    </small>
                  </div>
                )}
              </>
            ) : (
              <>
                {/* INCOME TYPE */}

                <label>
                  סוג ההכנסה
                </label>

                <div
                  style={{
                    display:
                      "grid",
                    gridTemplateColumns:
                      "1fr 1fr",
                    gap: 8,
                    marginTop:
                      -8,
                  }}
                >
                  <button
                    type="button"
                    onClick={() =>
                      updateTransactionField(
                        "income_type",
                        "variable"
                      )
                    }
                    style={{
                      padding:
                        "13px 10px",
                      borderRadius:
                        12,
                      border:
                        transactionForm.income_type ===
                        "variable"
                          ? "2px solid #5964d8"
                          : "1px solid #ddd",
                      background:
                        transactionForm.income_type ===
                        "variable"
                          ? "#eef0ff"
                          : "white",
                      fontWeight:
                        transactionForm.income_type ===
                        "variable"
                          ? 700
                          : 500,
                      cursor:
                        "pointer",
                    }}
                  >
                    משתנה
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      updateTransactionField(
                        "income_type",
                        "fixed"
                      )
                    }
                    style={{
                      padding:
                        "13px 10px",
                      borderRadius:
                        12,
                      border:
                        transactionForm.income_type ===
                        "fixed"
                          ? "2px solid #5964d8"
                          : "1px solid #ddd",
                      background:
                        transactionForm.income_type ===
                        "fixed"
                          ? "#eef0ff"
                          : "white",
                      fontWeight:
                        transactionForm.income_type ===
                        "fixed"
                          ? 700
                          : 500,
                      cursor:
                        "pointer",
                    }}
                  >
                    קבועה
                  </button>
                </div>

                <label>
                  סכום בפועל

                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={
                      transactionForm.actual_amount
                    }
                    onChange={(event) =>
                      updateTransactionField(
                        "actual_amount",
                        event.target.value
                      )
                    }
                    placeholder="כמה התקבל בפועל?"
                    required
                  />
                </label>

                <label>
                  סכום מתוכנן

                  <small className="muted">
                    אופציונלי
                  </small>

                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={
                      transactionForm.planned_amount
                    }
                    onChange={(event) =>
                      updateTransactionField(
                        "planned_amount",
                        event.target.value
                      )
                    }
                    placeholder="אם רוצים להשוות לתכנון"
                  />
                </label>
              </>
            )}

            {/* PAYMENT */}

            <label>
              אמצעי תשלום

              <select
                value={
                  transactionForm.payment_method
                }
                onChange={(event) =>
                  updateTransactionField(
                    "payment_method",
                    event.target.value
                  )
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

            {/* MERCHANT */}

            <label>
              בית עסק / מקור הכנסה

              <input
                value={
                  transactionForm.merchant
                }
                onChange={(event) =>
                  updateTransactionField(
                    "merchant",
                    event.target.value
                  )
                }
                placeholder={
                  transactionForm.kind ===
                  "income"
                    ? "למשל: מעסיק"
                    : "למשל: שופרסל"
                }
              />
            </label>

            {/* CREDIT CARD */}

            {transactionForm.payment_method ===
              "credit_card" && (
              <label>
                4 ספרות אחרונות של
                האשראי

                <input
                  inputMode="numeric"
                  maxLength={4}
                  value={
                    transactionForm.credit_card_last4
                  }
                  onChange={(event) =>
                    updateTransactionField(
                      "credit_card_last4",
                      event.target.value
                        .replace(
                          /\D/g,
                          ""
                        )
                        .slice(0, 4)
                    )
                  }
                  placeholder="למשל: 1234"
                />
              </label>
            )}

            {/* PERSON */}

            <label>
              מי שילם / קיבל

              <select
                value={
                  transactionForm.person_user_id
                }
                onChange={(event) =>
                  updateTransactionField(
                    "person_user_id",
                    event.target.value
                  )
                }
              >
                <option value="">
                  לא צוין
                </option>

                {members.map(
                  (member) => (
                    <option
                      key={
                        member.user_id
                      }
                      value={
                        member.user_id
                      }
                    >
                      {member.display_name ||
                        "משתמש"}
                    </option>
                  )
                )}
              </select>
            </label>

            {/* NOTE */}

            <label>
              הערה

              <textarea
                rows="3"
                value={
                  transactionForm.note
                }
                onChange={(event) =>
                  updateTransactionField(
                    "note",
                    event.target.value
                  )
                }
              />
            </label>

            {/* SAVE ERROR */}

            {saveError && (
              <div
                className="error"
                style={{
                  whiteSpace:
                    "pre-line",
                }}
              >
                {saveError}
              </div>
            )}

            {/* BUTTONS */}

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
                disabled={saving}
              >
                {saving
                  ? "שומרת…"
                  : "שמירה"}
              </button>

              <button
                className="ghost"
                type="button"
                onClick={
                  closeTransactionModal
                }
                disabled={saving}
              >
                ביטול
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* =====================================================
          RECURRING MODAL
         ===================================================== */}

      {modal ===
        "recurring" && (
        <Modal
          title={
            editingRecurring
              ? "עריכת הוצאה קבועה"
              : "הוספת הוצאה קבועה"
          }
          onClose={
            closeRecurringModal
          }
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
                    (category) =>
                      category.kind !==
                      "income"
                  )
                  .map(
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
                  (member) => (
                    <option
                      key={
                        member.user_id
                      }
                      value={
                        member.user_id
                      }
                    >
                      {member.display_name ||
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

            {saveError && (
              <div
                className="error"
                style={{
                  whiteSpace:
                    "pre-line",
                }}
              >
                {saveError}
              </div>
            )}

            <button
              className="primary"
              type="submit"
              disabled={saving}
            >
              {saving
                ? "שומרת…"
                : "שמירה"}
            </button>
          </form>
        </Modal>
      )}

      {/* =====================================================
          CHARGE MODAL
         ===================================================== */}

      {modal ===
        "charge" &&
        chargingRecurring && (
          <Modal
            title={`חיוב: ${chargingRecurring.name}`}
            onClose={
              closeChargeModal
            }
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
                    fontSize: 22,
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
                  defaultValue=""
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
                    (member) => (
                      <option
                        key={
                          member.user_id
                        }
                        value={
                          member.user_id
                        }
                      >
                        {member.display_name ||
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

              {saveError && (
                <div
                  className="error"
                  style={{
                    whiteSpace:
                      "pre-line",
                  }}
                >
                  {saveError}
                </div>
              )}

              <button
                className="primary"
                type="submit"
                disabled={saving}
              >
                {saving
                  ? "שומרת…"
                  : "אישור חיוב"}
              </button>
            </form>
          </Modal>
        )}

      {/* =====================================================
          CATEGORY MODAL
         ===================================================== */}

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
