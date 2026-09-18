"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

const RECURRING_DRAFT_KEY = "karios-budget-recurring-draft";

const emptyTransactionForm = () => ({
  description: "",
  category_id: "",
  expense_type: "variable",
  planned_amount: "",
  actual_amount: "",
  completed: true,
  person_user_id: "",
  transaction_date: new Date().toISOString().slice(0, 10),
  note: "",
  payment_method: "",
  merchant: "",
  credit_card_last4: "",
});

const emptyRecurringForm = () => ({
  name: "",
  category_id: "",
  planned_amount: "",
  day_of_month: "1",
  payment_method: "",
  merchant: "",
  person_user_id: "",
  note: "",
});

function formatMoney(value) {
  const number = Number(value || 0);

  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(number);
}

function formatDate(value) {
  if (!value) return "";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("he-IL");
}

function getMonthKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");

  return `${year}-${month}`;
}

function getMonthLabel(monthKey) {
  if (!monthKey) return "";

  const [year, month] = monthKey.split("-");

  const date = new Date(Number(year), Number(month) - 1, 1);

  return date.toLocaleDateString("he-IL", {
    month: "long",
    year: "numeric",
  });
}

function addMonths(monthKey, amount) {
  const [year, month] = monthKey.split("-").map(Number);

  const date = new Date(year, month - 1 + amount, 1);

  return getMonthKey(date);
}

function loadRecurringDraft() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(RECURRING_DRAFT_KEY);

    if (!raw) return null;

    return {
      ...emptyRecurringForm(),
      ...JSON.parse(raw),
    };
  } catch {
    return null;
  }
}

function saveRecurringDraft(form) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      RECURRING_DRAFT_KEY,
      JSON.stringify(form)
    );
  } catch {
    // localStorage is only a convenience; ignore failures.
  }
}

function clearRecurringDraft() {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(RECURRING_DRAFT_KEY);
  } catch {
    // Ignore.
  }
}

function getTransactionActualAmount(transaction) {
  if (!transaction) return 0;

  const actual = Number(transaction.actual_amount);

  return Number.isFinite(actual) ? actual : 0;
}

function getTransactionPlannedAmount(transaction) {
  if (!transaction) return 0;

  const planned = Number(transaction.planned_amount);

  return Number.isFinite(planned) ? planned : 0;
}

export default function BudgetApp() {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);

  const [household, setHousehold] = useState(null);
  const [members, setMembers] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [categories, setCategories] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [recurringExpenses, setRecurringExpenses] = useState([]);

  const [month, setMonth] = useState(getMonthKey());

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [modal, setModal] = useState(null);
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [editingRecurring, setEditingRecurring] = useState(null);

  const [transactionForm, setTransactionForm] = useState(
    emptyTransactionForm()
  );

  const [recurringForm, setRecurringForm] = useState(
    emptyRecurringForm()
  );

  const [saveError, setSaveError] = useState("");
  const [loginError, setLoginError] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [newCategoryName, setNewCategoryName] = useState("");
  const [showCategoryCreator, setShowCategoryCreator] = useState(false);

  const [activeTab, setActiveTab] = useState("dashboard");

  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;

      setSession(session);
      setUser(session?.user || null);
      setLoading(false);
    }

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user || null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setHousehold(null);
      setMembers([]);
      setProfiles([]);
      setCategories([]);
      setTransactions([]);
      setRecurringExpenses([]);
      return;
    }

    refresh();
  }, [user, month]);

  async function refresh() {
    if (!user) return;

    setLoading(true);

    try {
      const householdResult = await supabase.rpc(
        "get_my_household"
      );

      if (householdResult.error) {
        console.error(
          "get_my_household error:",
          householdResult.error
        );

        throw householdResult.error;
      }

      const householdRow =
        householdResult.data?.[0] || null;

      setHousehold(
        householdRow
          ? {
              id: householdRow.household_id,
              name: householdRow.household_name,
            }
          : null
      );

      if (!householdRow) {
        setMembers([]);
        setProfiles([]);
        setCategories([]);
        setTransactions([]);
        setRecurringExpenses([]);
        return;
      }

      const householdId = householdRow.household_id;

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
            `${addMonths(month, 1)}-01`
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
          "members error:",
          membersResult.error
        );
      }

      if (categoriesResult.error) {
        console.error(
          "categories error:",
          categoriesResult.error
        );
      }

      if (transactionsResult.error) {
        console.error(
          "transactions error:",
          transactionsResult.error
        );
      }

      if (recurringResult.error) {
        console.error(
          "recurring expenses error:",
          recurringResult.error
        );
      }

      const memberRows = membersResult.data || [];

      setMembers(memberRows);

      setProfiles(
        memberRows.map((member) => ({
          id: member.user_id,
          display_name:
            member.display_name || "ללא שם",
          role: member.role,
        }))
      );

      setCategories(categoriesResult.data || []);
      setTransactions(transactionsResult.data || []);
      setRecurringExpenses(recurringResult.data || []);
    } catch (error) {
      console.error("Refresh error:", error);
    } finally {
      setLoading(false);
    }
  }

  async function signIn(event) {
    event.preventDefault();

    setLoginError("");

    if (!email.trim() || !password) {
      setLoginError("יש להזין אימייל וסיסמה.");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      console.error("Login error:", error);

      setLoginError(
        "ההתחברות נכשלה. בדקי את האימייל והסיסמה."
      );
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  function openTransactionModal(
    transaction = null,
    kind = "expense"
  ) {
    setSaveError("");

    if (transaction) {
      setEditingTransaction(transaction);

      setTransactionForm({
        description: transaction.description || "",
        category_id:
          transaction.category_id || "",
        expense_type:
          transaction.expense_type || "variable",
        planned_amount:
          transaction.planned_amount ?? "",
        actual_amount:
          transaction.actual_amount ?? "",
        completed:
          transaction.completed ?? true,
        person_user_id:
          transaction.person_user_id || "",
        transaction_date:
          transaction.transaction_date ||
          new Date().toISOString().slice(0, 10),
        note: transaction.note || "",
        payment_method:
          transaction.payment_method || "",
        merchant: transaction.merchant || "",
        credit_card_last4:
          transaction.credit_card_last4 || "",
      });
    } else {
      setEditingTransaction(null);

      const form = emptyTransactionForm();

      if (kind === "income") {
        form.expense_type = "";
      }

      setTransactionForm(form);
    }

    setModal(kind === "income" ? "income" : "transaction");
  }

  function closeTransactionModal() {
    if (saving) return;

    setModal(null);
    setEditingTransaction(null);
    setSaveError("");
    setTransactionForm(emptyTransactionForm());
  }

  function updateTransactionField(field, value) {
    setTransactionForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function saveTransaction(event) {
    event.preventDefault();

    if (saving) return;

    setSaveError("");

    if (!household?.id) {
      setSaveError("לא נמצא התקציב המשפחתי.");
      return;
    }

    const form = transactionForm;

    const description = String(
      form.description || ""
    ).trim();

    const amount =
      form.expense_type === "variable" &&
      form.actual_amount !== ""
        ? Number(form.actual_amount)
        : Number(
            form.actual_amount !== ""
              ? form.actual_amount
              : form.planned_amount
          );

    if (!description) {
      setSaveError("יש להזין תיאור.");
      return;
    }

    if (!form.transaction_date) {
      setSaveError("יש לבחור תאריך.");
      return;
    }

    if (!Number.isFinite(amount) || amount < 0) {
      setSaveError("יש להזין סכום תקין.");
      return;
    }

    let kind = "expense";

    if (modal === "income") {
      kind = "income";
    }

    const isFixed =
      kind === "expense" &&
      form.expense_type === "fixed";

    const plannedAmount = isFixed
      ? Number(form.planned_amount || 0)
      : amount;

    const actualAmount =
      kind === "income"
        ? amount
        : form.actual_amount === ""
        ? null
        : Number(form.actual_amount);

    if (
      isFixed &&
      (form.planned_amount === "" ||
        !Number.isFinite(plannedAmount) ||
        plannedAmount < 0)
    ) {
      setSaveError(
        "יש להזין סכום מתוכנן תקין."
      );
      return;
    }

    if (
      actualAmount !== null &&
      (!Number.isFinite(actualAmount) ||
        actualAmount < 0)
    ) {
      setSaveError("יש להזין סכום בפועל תקין.");
      return;
    }

const row = {
  household_id: household.id,
  created_by: user?.id || null,
      kind,
      description,
      category_id:
        form.category_id || null,
      transaction_date:
        form.transaction_date,
      planned_amount: plannedAmount,
      completed:
        kind === "income"
          ? true
          : actualAmount !== null,
      actual_amount:
        kind === "income"
          ? amount
          : actualAmount,
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
        ).replace(/\D/g, "").slice(-4) || null,
    };

    setSaving(true);

    try {
      let result;

      if (editingTransaction) {
        result = await supabase
          .from("transactions")
          .update(row)
          .eq("id", editingTransaction.id)
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
        console.error(
          "Transaction save error:",
          result.error
        );

        setSaveError(
          "לא הצלחתי לשמור את התנועה.\n\n" +
            result.error.message
        );

        return;
      }

      if (!result.data) {
        setSaveError(
          "Supabase לא החזיר את הרשומה שנשמרה. נסי שוב."
        );

        return;
      }

      setModal(null);
      setEditingTransaction(null);
      setTransactionForm(
        emptyTransactionForm()
      );
      setSaveError("");

      await refresh();
    } catch (error) {
      console.error(
        "Unexpected transaction save error:",
        error
      );

      setSaveError(
        "אירעה שגיאה לא צפויה בשמירה.\n\n" +
          (error?.message || String(error))
      );
    } finally {
      setSaving(false);
    }
  }

  function openRecurringModal(
    recurringExpense = null
  ) {
    setSaveError("");

    if (recurringExpense) {
      setEditingRecurring(
        recurringExpense
      );

      setRecurringForm({
        name:
          recurringExpense.name || "",
        category_id:
          recurringExpense.category_id ||
          "",
        planned_amount:
          recurringExpense.planned_amount ??
          "",
        day_of_month:
          recurringExpense.day_of_month ??
          "1",
        payment_method:
          recurringExpense.payment_method ||
          "",
        merchant:
          recurringExpense.merchant || "",
        person_user_id:
          recurringExpense.person_user_id ||
          "",
        note:
          recurringExpense.note || "",
      });
    } else {
      setEditingRecurring(null);

      const draft =
        loadRecurringDraft();

      setRecurringForm(
        draft || emptyRecurringForm()
      );
    }

    setModal("recurring");
  }

  function closeRecurringModal() {
    if (saving) return;

    setModal(null);
    setEditingRecurring(null);
    setSaveError("");

    /*
     * Intentionally keep the draft when the user
     * closes the modal without saving.
     */
  }

  function updateRecurringField(
    field,
    value
  ) {
    setRecurringForm((current) => {
      const next = {
        ...current,
        [field]: value,
      };

      if (!editingRecurring) {
        saveRecurringDraft(next);
      }

      return next;
    });
  }

  async function saveRecurring(event) {
    event.preventDefault();

    if (saving) return;

    setSaveError("");

    if (!household?.id) {
      setSaveError(
        "לא נמצא התקציב המשפחתי."
      );
      return;
    }

    const form = recurringForm;

    const name = String(
      form.name || ""
    ).trim();

    const planned =
      form.planned_amount === ""
        ? NaN
        : Number(form.planned_amount);

    const day =
      form.day_of_month === ""
        ? NaN
        : Number(form.day_of_month);

    if (!name) {
      setSaveError(
        "יש להזין שם הוצאה."
      );
      return;
    }

    if (
      !Number.isFinite(planned) ||
      planned < 0
    ) {
      setSaveError(
        "יש להזין סכום מתוכנן תקין."
      );
      return;
    }

    if (
      !Number.isInteger(day) ||
      day < 1 ||
      day > 31
    ) {
      setSaveError(
        "יום בחודש חייב להיות מספר שלם בין 1 ל־31."
      );
      return;
    }

    const row = {
      household_id: household.id,
      name,
      category_id:
        form.category_id || null,
      planned_amount: planned,
      day_of_month: day,
      person_user_id:
        form.person_user_id || null,
      is_active: true,
      note:
        String(form.note || "").trim() ||
        null,
      payment_method:
        form.payment_method || null,
      merchant:
        String(form.merchant || "").trim() ||
        null,
    };

    console.log(
      "Saving recurring expense:",
      row
    );

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

      console.log(
        "Recurring save result:",
        result
      );

      if (result.error) {
        console.error(
          "Recurring save error:",
          result.error
        );

        setSaveError(
          "לא הצלחתי לשמור את ההוצאה הקבועה.\n\n" +
            result.error.message
        );

        return;
      }

      if (!result.data) {
        setSaveError(
          "Supabase לא החזיר את ההוצאה הקבועה שנשמרה. נסי שוב."
        );

        return;
      }

      /*
       * IMPORTANT:
       * We update the local list immediately from the
       * returned database row, so the new expense appears
       * even before refresh finishes.
       */
      if (editingRecurring) {
        setRecurringExpenses(
          (current) =>
            current.map((item) =>
              item.id ===
              editingRecurring.id
                ? result.data
                : item
            )
        );
      } else {
        setRecurringExpenses(
          (current) =>
            [
              ...current,
              result.data,
            ].sort(
              (a, b) =>
                Number(a.day_of_month || 0) -
                Number(b.day_of_month || 0)
            )
        );
      }

      clearRecurringDraft();

      setSaving(false);
      setEditingRecurring(null);
      setModal(null);
      setSaveError("");
      setRecurringForm(
        emptyRecurringForm()
      );

      await refresh();
    } catch (error) {
      console.error(
        "Unexpected recurring save error:",
        error
      );

      setSaveError(
        "אירעה שגיאה לא צפויה בשמירת ההוצאה הקבועה.\n\n" +
          (error?.message ||
            String(error))
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteTransaction(
    transaction
  ) {
    if (!transaction?.id) return;

    setSaving(true);

    try {
      const { error } = await supabase
        .from("transactions")
        .delete()
        .eq("id", transaction.id)
        .eq(
          "household_id",
          household.id
        );

      if (error) {
        console.error(
          "Delete transaction error:",
          error
        );

        alert(
          "לא הצלחתי למחוק את התנועה.\n\n" +
            error.message
        );

        return;
      }

      setTransactions((current) =>
        current.filter(
          (item) =>
            item.id !== transaction.id
        )
      );

      setConfirmDelete(null);

      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecurring(
    recurringExpense
  ) {
    if (!recurringExpense?.id) return;

    setSaving(true);

    try {
      const { error } = await supabase
        .from("recurring_expenses")
        .delete()
        .eq(
          "id",
          recurringExpense.id
        )
        .eq(
          "household_id",
          household.id
        );

      if (error) {
        console.error(
          "Delete recurring error:",
          error
        );

        alert(
          "לא הצלחתי למחוק את ההוצאה הקבועה.\n\n" +
            error.message
        );

        return;
      }

      setRecurringExpenses(
        (current) =>
          current.filter(
            (item) =>
              item.id !==
              recurringExpense.id
          )
      );

      setConfirmDelete(null);

      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function markRecurringCharged(
    recurringExpense
  ) {
    if (!recurringExpense?.id) return;

    setSaveError("");

    const actual = window.prompt(
      `מה הסכום שחויב בפועל עבור "${recurringExpense.name}"?`,
      String(
        recurringExpense.planned_amount ??
          ""
      )
    );

    if (actual === null) return;

    const amount = Number(actual);

    if (
      !Number.isFinite(amount) ||
      amount < 0
    ) {
      alert("יש להזין סכום תקין.");
      return;
    }

    const yearMonth = month;

    /*
     * One actual transaction per recurring expense
     * per month.
     */
    const { data: existing } =
      await supabase
        .from("transactions")
        .select("id")
        .eq(
          "household_id",
          household.id
        )
        .eq(
          "recurring_expense_id",
          recurringExpense.id
        )
        .eq(
          "recurring_month",
          yearMonth
        )
        .maybeSingle();

    if (existing) {
      alert(
        "ההוצאה הזו כבר סומנה כחויבה בחודש הזה."
      );
      return;
    }

    setSaving(true);

    try {
      const day = Math.min(
        Number(
          recurringExpense.day_of_month ||
            1
        ),
        new Date(
          Number(yearMonth.slice(0, 4)),
          Number(yearMonth.slice(5, 7)),
          0
        ).getDate()
      );

      const transactionDate =
        `${yearMonth}-${String(day).padStart(
          2,
          "0"
        )}`;

      const row = {
        household_id: household.id,
        kind: "expense",
        description:
          recurringExpense.name,
        category_id:
          recurringExpense.category_id ||
          null,
        transaction_date:
          transactionDate,
        planned_amount:
          Number(
            recurringExpense.planned_amount ||
              0
          ),
        completed: true,
        actual_amount: amount,
        expense_type: "fixed",
        person_user_id:
          recurringExpense.person_user_id ||
          null,
        note:
          recurringExpense.note || null,
        created_by:
          user?.id || null,
        recurring_expense_id:
          recurringExpense.id,
        recurring_month:
          yearMonth,
        payment_method:
          recurringExpense.payment_method ||
          null,
        merchant:
          recurringExpense.merchant ||
          null,
      };

      const { data, error } =
        await supabase
          .from("transactions")
          .insert(row)
          .select("*")
          .single();

      if (error) {
        console.error(
          "Charge recurring error:",
          error
        );

        alert(
          "לא הצלחתי לרשום את החיוב בפועל.\n\n" +
            error.message
        );

        return;
      }

      if (data) {
        setTransactions((current) => [
          data,
          ...current,
        ]);
      }

      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function addCategory() {
    const name =
      newCategoryName.trim();

    if (!name) return;

    if (!household?.id) return;

    const { data, error } =
      await supabase
        .from("categories")
        .insert({
          household_id: household.id,
          name,
        })
        .select("*")
        .single();

    if (error) {
      console.error(
        "Category error:",
        error
      );

      alert(
        "לא הצלחתי להוסיף קטגוריה.\n\n" +
          error.message
      );

      return;
    }

    if (data) {
      setCategories((current) =>
        [...current, data].sort(
          (a, b) =>
            String(a.name).localeCompare(
              String(b.name),
              "he"
            )
        )
      );
    }

    setNewCategoryName("");
    setShowCategoryCreator(false);
  }

  const categoryMap = useMemo(() => {
    const map = {};

    for (const category of categories) {
      map[category.id] = category.name;
    }

    return map;
  }, [categories]);

  const memberMap = useMemo(() => {
    const map = {};

    for (const member of profiles) {
      map[member.id] =
        member.display_name ||
        "ללא שם";
    }

    return map;
  }, [profiles]);

  const monthTransactions = useMemo(
    () => transactions,
    [transactions]
  );

  const incomeTransactions =
    useMemo(
      () =>
        monthTransactions.filter(
          (transaction) =>
            transaction.kind ===
            "income"
        ),
      [monthTransactions]
    );

  const expenseTransactions =
    useMemo(
      () =>
        monthTransactions.filter(
          (transaction) =>
            transaction.kind ===
            "expense"
        ),
      [monthTransactions]
    );

  const actualIncome = useMemo(
    () =>
      incomeTransactions.reduce(
        (sum, transaction) =>
          sum +
          getTransactionActualAmount(
            transaction
          ),
        0
      ),
    [incomeTransactions]
  );

  const actualExpenses = useMemo(
    () =>
      expenseTransactions.reduce(
        (sum, transaction) =>
          sum +
          getTransactionActualAmount(
            transaction
          ),
        0
      ),
    [expenseTransactions]
  );

  const fixedActual = useMemo(
    () =>
      expenseTransactions
        .filter(
          (transaction) =>
            transaction.expense_type ===
            "fixed"
        )
        .reduce(
          (sum, transaction) =>
            sum +
            getTransactionActualAmount(
              transaction
            ),
          0
        ),
    [expenseTransactions]
  );

  const variableActual = useMemo(
    () =>
      expenseTransactions
        .filter(
          (transaction) =>
            transaction.expense_type ===
            "variable"
        )
        .reduce(
          (sum, transaction) =>
            sum +
            getTransactionActualAmount(
              transaction
            ),
          0
        ),
    [expenseTransactions]
  );

  const plannedFixed = useMemo(
    () =>
      recurringExpenses.reduce(
        (sum, expense) =>
          sum +
          Number(
            expense.planned_amount || 0
          ),
        0
      ),
    [recurringExpenses]
  );

  const chargedRecurringIds =
    useMemo(() => {
      const set = new Set();

      for (const transaction of transactions) {
        if (
          transaction.recurring_expense_id &&
          transaction.recurring_month ===
            month
        ) {
          set.add(
            transaction.recurring_expense_id
          );
        }
      }

      return set;
    }, [transactions, month]);

  const pendingFixed = useMemo(
    () =>
      recurringExpenses.filter(
        (expense) =>
          !chargedRecurringIds.has(
            expense.id
          )
      ),
    [
      recurringExpenses,
      chargedRecurringIds,
    ]
  );

  const balance =
    actualIncome - actualExpenses;

  const previousMonth = addMonths(
    month,
    -1
  );

  const nextMonth = addMonths(
    month,
    1
  );

  function changeMonth(amount) {
    setMonth((current) =>
      addMonths(current, amount)
    );
  }

  function renderCategoryName(
    categoryId
  ) {
    return (
      categoryMap[categoryId] ||
      "ללא קטגוריה"
    );
  }

  function renderMemberName(
    memberId
  ) {
    return (
      memberMap[memberId] ||
      "לא צוין"
    );
  }

  if (loading && !user) {
    return (
      <div
        dir="rtl"
        className="app-shell"
      >
        <div className="loading">
          טוען...
        </div>
      </div>
    );
  }

  if (!session || !user) {
    return (
      <div
        dir="rtl"
        className="app-shell login-page"
      >
        <div className="login-card">
          <div className="brand">
            <div className="brand-icon">
              ₪
            </div>

            <div>
              <h1>
                התקציב המשפחתי
              </h1>
              <p>
                Kario's Budget
              </p>
            </div>
          </div>

          <form
            onSubmit={signIn}
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
                autoComplete="email"
                placeholder="your@email.com"
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
                autoComplete="current-password"
                placeholder="••••••••"
              />
            </label>

            {loginError && (
              <div className="error">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              className="primary full"
            >
              כניסה
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div
      dir="rtl"
      className="app-shell"
    >
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-icon">
              ₪
            </div>

            <div>
              <div className="brand-title">
                {household?.name ||
                  "התקציב המשפחתי"}
              </div>

              <div className="brand-subtitle">
                {user.email}
              </div>
            </div>
          </div>

          <button
            className="ghost"
            onClick={signOut}
          >
            יציאה
          </button>
        </div>
      </header>

      <main className="container">
        <div className="month-bar">
          <button
            className="month-arrow"
            onClick={() =>
              setMonth(previousMonth)
            }
          >
            ‹
          </button>

          <div className="month-title">
            {getMonthLabel(month)}
          </div>

          <button
            className="month-arrow"
            onClick={() =>
              setMonth(nextMonth)
            }
          >
            ›
          </button>
        </div>

        <nav className="tabs">
          <button
            className={
              activeTab ===
              "dashboard"
                ? "tab active"
                : "tab"
            }
            onClick={() =>
              setActiveTab("dashboard")
            }
          >
            סיכום
          </button>

          <button
            className={
              activeTab ===
              "expenses"
                ? "tab active"
                : "tab"
            }
            onClick={() =>
              setActiveTab("expenses")
            }
          >
            הוצאות
          </button>

          <button
            className={
              activeTab ===
              "fixed"
                ? "tab active"
                : "tab"
            }
            onClick={() =>
              setActiveTab("fixed")
            }
          >
            הוצאות קבועות
          </button>

          <button
            className={
              activeTab ===
              "income"
                ? "tab active"
                : "tab"
            }
            onClick={() =>
              setActiveTab("income")
            }
          >
            הכנסות
          </button>

          <button
            className={
              activeTab ===
              "categories"
                ? "tab active"
                : "tab"
            }
            onClick={() =>
              setActiveTab(
                "categories"
              )
            }
          >
            קטגוריות
          </button>
        </nav>

        {activeTab ===
          "dashboard" && (
          <section>
            <div className="page-heading">
              <div>
                <h1>
                  {getMonthLabel(month)}
                </h1>
                <p>
                  תמונת מצב של התקציב
                  המשפחתי
                </p>
              </div>

              <button
                className="primary"
                onClick={() =>
                  openTransactionModal()
                }
              >
                + הוצאה
              </button>
            </div>

            <div className="cards">
              <div className="card">
                <div className="card-label">
                  הכנסות בפועל
                </div>
                <div className="card-value positive">
                  {formatMoney(
                    actualIncome
                  )}
                </div>
              </div>

              <div className="card">
                <div className="card-label">
                  הוצאות בפועל
                </div>
                <div className="card-value negative">
                  {formatMoney(
                    actualExpenses
                  )}
                </div>
              </div>

              <div className="card">
                <div className="card-label">
                  יתרה
                </div>
                <div
                  className={
                    balance >= 0
                      ? "card-value positive"
                      : "card-value negative"
                  }
                >
                  {formatMoney(balance)}
                </div>
              </div>

              <div className="card">
                <div className="card-label">
                  קבועות מתוכננות
                </div>
                <div className="card-value">
                  {formatMoney(
                    plannedFixed
                  )}
                </div>
                <div className="card-hint">
                  {pendingFixed.length}{" "}
                  ממתינות לחיוב
                </div>
              </div>
            </div>

            <div className="two-columns">
              <div className="panel">
                <div className="panel-header">
                  <h2>
                    הוצאות בפועל
                  </h2>
                </div>

                <div className="split-row">
                  <span>
                    הוצאות קבועות
                  </span>
                  <strong>
                    {formatMoney(
                      fixedActual
                    )}
                  </strong>
                </div>

                <div className="split-row">
                  <span>
                    הוצאות משתנות
                  </span>
                  <strong>
                    {formatMoney(
                      variableActual
                    )}
                  </strong>
                </div>
              </div>

              <div className="panel">
                <div className="panel-header">
                  <h2>
                    קבועות שממתינות
                  </h2>

                  <button
                    className="link-button"
                    onClick={() =>
                      setActiveTab(
                        "fixed"
                      )
                    }
                  >
                    לכל ההוצאות
                  </button>
                </div>

                {pendingFixed.length ===
                0 ? (
                  <div className="empty">
                    כל ההוצאות הקבועות
                    של החודש חויבו 🎉
                  </div>
                ) : (
                  <div className="compact-list">
                    {pendingFixed
                      .slice(0, 5)
                      .map((expense) => (
                        <div
                          className="list-row"
                          key={
                            expense.id
                          }
                        >
                          <div>
                            <strong>
                              {
                                expense.name
                              }
                            </strong>

                            <small>
                              יום{" "}
                              {
                                expense.day_of_month
                              }
                            </small>
                          </div>

                          <div className="row-right">
                            <strong>
                              {formatMoney(
                                expense.planned_amount
                              )}
                            </strong>

                            <button
                              className="small primary"
                              onClick={() =>
                                markRecurringCharged(
                                  expense
                                )
                              }
                            >
                              סומן כחויב
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>

            <div className="panel">
              <div className="panel-header">
                <h2>
                  תנועות אחרונות
                </h2>

                <button
                  className="link-button"
                  onClick={() =>
                    setActiveTab(
                      "expenses"
                    )
                  }
                >
                  לכל התנועות
                </button>
              </div>

              {monthTransactions.length ===
              0 ? (
                <div className="empty">
                  אין תנועות בחודש הזה.
                </div>
              ) : (
                <TransactionTable
                  transactions={monthTransactions.slice(
                    0,
                    8
                  )}
                  categoryMap={
                    categoryMap
                  }
                  memberMap={memberMap}
                  onEdit={
                    openTransactionModal
                  }
                  onDelete={
                    setConfirmDelete
                  }
                />
              )}
            </div>
          </section>
        )}

        {activeTab ===
          "expenses" && (
          <section>
            <div className="page-heading">
              <div>
                <h1>הוצאות</h1>
                <p>
                  כל ההוצאות של{" "}
                  {getMonthLabel(month)}
                </p>
              </div>

              <button
                className="primary"
                onClick={() =>
                  openTransactionModal()
                }
              >
                + הוצאה
              </button>
            </div>

            <div className="cards">
              <div className="card">
                <div className="card-label">
                  סה״כ בפועל
                </div>
                <div className="card-value negative">
                  {formatMoney(
                    actualExpenses
                  )}
                </div>
              </div>

              <div className="card">
                <div className="card-label">
                  קבועות
                </div>
                <div className="card-value">
                  {formatMoney(
                    fixedActual
                  )}
                </div>
              </div>

              <div className="card">
                <div className="card-label">
                  משתנות
                </div>
                <div className="card-value">
                  {formatMoney(
                    variableActual
                  )}
                </div>
              </div>
            </div>

            <div className="panel">
              {expenseTransactions.length ===
              0 ? (
                <div className="empty">
                  אין הוצאות בחודש הזה.
                </div>
              ) : (
                <TransactionTable
                  transactions={
                    expenseTransactions
                  }
                  categoryMap={
                    categoryMap
                  }
                  memberMap={memberMap}
                  onEdit={
                    openTransactionModal
                  }
                  onDelete={
                    setConfirmDelete
                  }
                />
              )}
            </div>
          </section>
        )}

        {activeTab ===
          "fixed" && (
          <section>
            <div className="page-heading">
              <div>
                <h1>
                  הוצאות קבועות
                </h1>

                <p>
                  הוצאות מתוכננות שחוזרות
                  בכל חודש
                </p>
              </div>

              <button
                type="button"
                className="primary small"
                onClick={() =>
                  openRecurringModal()
                }
              >
                + הוצאה קבועה
              </button>
            </div>

            <div className="cards">
              <div className="card">
                <div className="card-label">
                  מתוכנן לחודש
                </div>
                <div className="card-value">
                  {formatMoney(
                    plannedFixed
                  )}
                </div>
              </div>

              <div className="card">
                <div className="card-label">
                  חויב בפועל
                </div>
                <div className="card-value negative">
                  {formatMoney(
                    fixedActual
                  )}
                </div>
              </div>

              <div className="card">
                <div className="card-label">
                  ממתין לחיוב
                </div>
                <div className="card-value">
                  {formatMoney(
                    pendingFixed.reduce(
                      (sum, expense) =>
                        sum +
                        Number(
                          expense.planned_amount ||
                            0
                        ),
                      0
                    )
                  )}
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-header">
                <h2>
                  הוצאות קבועות לחודש
                </h2>
              </div>

              {recurringExpenses.length ===
              0 ? (
                <div className="empty">
                  עדיין אין הוצאות קבועות.
                  <br />
                  לחצי על "+ הוצאה קבועה"
                  כדי להוסיף.
                </div>
              ) : (
                <div className="fixed-list">
                  {recurringExpenses.map(
                    (expense) => {
                      const charged =
                        chargedRecurringIds.has(
                          expense.id
                        );

                      return (
                        <div
                          className="fixed-row"
                          key={expense.id}
                        >
                          <div className="fixed-main">
                            <div className="fixed-name">
                              {
                                expense.name
                              }
                            </div>

                            <div className="fixed-meta">
                              {renderCategoryName(
                                expense.category_id
                              )}

                              {" · "}

                              יום{" "}
                              {
                                expense.day_of_month
                              }

                              {" · "}

                              {renderMemberName(
                                expense.person_user_id
                              )}
                            </div>

                            {expense.merchant && (
                              <div className="fixed-meta">
                                {
                                  expense.merchant
                                }
                              </div>
                            )}
                          </div>

                          <div className="fixed-planned">
                            <small>
                              מתוכנן
                            </small>
                            <strong>
                              {formatMoney(
                                expense.planned_amount
                              )}
                            </strong>
                          </div>

                          <div className="fixed-status">
                            {charged ? (
                              <span className="badge success">
                                חויב
                              </span>
                            ) : (
                              <span className="badge warning">
                                ממתין
                              </span>
                            )}
                          </div>

                          <div className="fixed-actions">
                            {!charged && (
                              <button
                                type="button"
                                className="small primary"
                                onClick={() =>
                                  markRecurringCharged(
                                    expense
                                  )
                                }
                              >
                                חיוב בפועל
                              </button>
                            )}

                            <button
                              type="button"
                              className="small ghost"
                              onClick={() =>
                                openRecurringModal(
                                  expense
                                )
                              }
                            >
                              עריכה
                            </button>

                            <button
                              type="button"
                              className="small danger"
                              onClick={() =>
                                setConfirmDelete(
                                  {
                                    type: "recurring",
                                    item: expense,
                                  }
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
          </section>
        )}

        {activeTab ===
          "income" && (
          <section>
            <div className="page-heading">
              <div>
                <h1>הכנסות</h1>
                <p>
                  הכנסות של{" "}
                  {getMonthLabel(month)}
                </p>
              </div>

              <button
                className="primary"
                onClick={() =>
                  openTransactionModal(
                    null,
                    "income"
                  )
                }
              >
                + הכנסה
              </button>
            </div>

            <div className="cards">
              <div className="card">
                <div className="card-label">
                  הכנסות בפועל
                </div>
                <div className="card-value positive">
                  {formatMoney(
                    actualIncome
                  )}
                </div>
              </div>
            </div>

            <div className="panel">
              {incomeTransactions.length ===
              0 ? (
                <div className="empty">
                  אין הכנסות בחודש הזה.
                </div>
              ) : (
                <TransactionTable
                  transactions={
                    incomeTransactions
                  }
                  categoryMap={
                    categoryMap
                  }
                  memberMap={memberMap}
                  onEdit={
                    openTransactionModal
                  }
                  onDelete={
                    setConfirmDelete
                  }
                />
              )}
            </div>
          </section>
        )}

        {activeTab ===
          "categories" && (
          <section>
            <div className="page-heading">
              <div>
                <h1>קטגוריות</h1>
                <p>
                  קטגוריות התקציב המשפחתי
                </p>
              </div>

              <button
                className="primary"
                onClick={() =>
                  setShowCategoryCreator(
                    true
                  )
                }
              >
                + קטגוריה
              </button>
            </div>

            <div className="category-grid">
              {categories.map(
                (category) => (
                  <div
                    className="category-card"
                    key={category.id}
                  >
                    {category.name}
                  </div>
                )
              )}
            </div>
          </section>
        )}
      </main>

      {modal ===
        "transaction" && (
        <Modal
          title={
            editingTransaction
              ? "עריכת הוצאה"
              : "הוצאה חדשה"
          }
          onClose={
            closeTransactionModal
          }
        >
          <form
            noValidate
            className="form"
            onSubmit={
              saveTransaction
            }
          >
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
                placeholder="למשל: קניות בסופר"
              />
            </label>

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
              >
                <option value="">
                  ללא קטגוריה
                </option>

                {categories.map(
                  (category) => (
                    <option
                      key={category.id}
                      value={
                        category.id
                      }
                    >
                      {category.name}
                    </option>
                  )
                )}
              </select>
            </label>

            <label>
              סוג הוצאה
              <select
                value={
                  transactionForm.expense_type
                }
                onChange={(event) =>
                  updateTransactionField(
                    "expense_type",
                    event.target.value
                  )
                }
              >
                <option value="variable">
                  משתנה — בפועל בלבד
                </option>
                <option value="fixed">
                  קבועה — מתוכנן + בפועל
                </option>
              </select>
            </label>

            {transactionForm.expense_type ===
              "fixed" && (
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
                  transactionForm.actual_amount
                }
                onChange={(event) =>
                  updateTransactionField(
                    "actual_amount",
                    event.target.value
                  )
                }
                placeholder={
                  transactionForm.expense_type ===
                  "fixed"
                    ? "אפשר להשאיר ריק עד לחיוב"
                    : "סכום בפועל"
                }
              />
            </label>

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
              />
            </label>

            <label>
              מי שילם?
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

                {profiles.map(
                  (profile) => (
                    <option
                      key={profile.id}
                      value={profile.id}
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
              בית עסק
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
                placeholder="למשל: שופרסל"
              />
            </label>

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

            {transactionForm.payment_method ===
              "credit_card" && (
              <label>
                4 ספרות אחרונות של הכרטיס
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
                        .replace(/\D/g, "")
                        .slice(0, 4)
                    )
                  }
                  placeholder="1234"
                />
              </label>
            )}

            <label>
              הערה
              <textarea
                value={
                  transactionForm.note
                }
                onChange={(event) =>
                  updateTransactionField(
                    "note",
                    event.target.value
                  )
                }
                rows={3}
              />
            </label>

            {saveError && (
              <div className="error pre">
                {saveError}
              </div>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="ghost"
                onClick={
                  closeTransactionModal
                }
                disabled={saving}
              >
                ביטול
              </button>

              <button
                type="submit"
                className="primary"
                disabled={saving}
              >
                {saving
                  ? "שומר..."
                  : "שמירה"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal ===
        "income" && (
        <Modal
          title={
            editingTransaction
              ? "עריכת הכנסה"
              : "הכנסה חדשה"
          }
          onClose={
            closeTransactionModal
          }
        >
          <form
            noValidate
            className="form"
            onSubmit={
              saveTransaction
            }
          >
            <label>
              מקור ההכנסה
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
                placeholder="למשל: משכורת"
              />
            </label>

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
              >
                <option value="">
                  ללא קטגוריה
                </option>

                {categories.map(
                  (category) => (
                    <option
                      key={category.id}
                      value={
                        category.id
                      }
                    >
                      {category.name}
                    </option>
                  )
                )}
              </select>
            </label>

            <label>
              סכום
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
              />
            </label>

            <label>
              למי?
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

                {profiles.map(
                  (profile) => (
                    <option
                      key={profile.id}
                      value={profile.id}
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
              />
            </label>

            <label>
              הערה
              <textarea
                value={
                  transactionForm.note
                }
                onChange={(event) =>
                  updateTransactionField(
                    "note",
                    event.target.value
                  )
                }
                rows={3}
              />
            </label>

            {saveError && (
              <div className="error pre">
                {saveError}
              </div>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="ghost"
                onClick={
                  closeTransactionModal
                }
                disabled={saving}
              >
                ביטול
              </button>

              <button
                type="submit"
                className="primary"
                disabled={saving}
              >
                {saving
                  ? "שומר..."
                  : "שמירה"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal ===
        "recurring" && (
        <Modal
          title={
            editingRecurring
              ? "עריכת הוצאה קבועה"
              : "הוצאה קבועה חדשה"
          }
          onClose={
            closeRecurringModal
          }
        >
          <form
            noValidate
            className="form"
            onSubmit={saveRecurring}
          >
            <label>
              שם ההוצאה
              <input
                value={
                  recurringForm.name
                }
                onChange={(event) =>
                  updateRecurringField(
                    "name",
                    event.target.value
                  )
                }
                placeholder="למשל: משכנתא"
              />
            </label>

            <label>
              קטגוריה
              <select
                value={
                  recurringForm.category_id
                }
                onChange={(event) =>
                  updateRecurringField(
                    "category_id",
                    event.target.value
                  )
                }
              >
                <option value="">
                  ללא קטגוריה
                </option>

                {categories.map(
                  (category) => (
                    <option
                      key={category.id}
                      value={
                        category.id
                      }
                    >
                      {category.name}
                    </option>
                  )
                )}
              </select>
            </label>

            <label>
              סכום מתוכנן
              <input
                type="number"
                min="0"
                step="0.01"
                value={
                  recurringForm.planned_amount
                }
                onChange={(event) =>
                  updateRecurringField(
                    "planned_amount",
                    event.target.value
                  )
                }
                placeholder="8000"
              />
            </label>

            <label>
              יום בחודש
              <input
                type="number"
                min="1"
                max="31"
                step="1"
                value={
                  recurringForm.day_of_month
                }
                onChange={(event) =>
                  updateRecurringField(
                    "day_of_month",
                    event.target.value
                  )
                }
              />
            </label>

            <label>
              בית עסק
              <input
                value={
                  recurringForm.merchant
                }
                onChange={(event) =>
                  updateRecurringField(
                    "merchant",
                    event.target.value
                  )
                }
                placeholder="למשל: בנק לאומי"
              />
            </label>

            <label>
              אמצעי תשלום
              <select
                value={
                  recurringForm.payment_method
                }
                onChange={(event) =>
                  updateRecurringField(
                    "payment_method",
                    event.target.value
                  )
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
              על שם מי?
              <select
                value={
                  recurringForm.person_user_id
                }
                onChange={(event) =>
                  updateRecurringField(
                    "person_user_id",
                    event.target.value
                  )
                }
              >
                <option value="">
                  לא צוין
                </option>

                {profiles.map(
                  (profile) => (
                    <option
                      key={profile.id}
                      value={profile.id}
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
                value={
                  recurringForm.note
                }
                onChange={(event) =>
                  updateRecurringField(
                    "note",
                    event.target.value
                  )
                }
                rows={3}
                placeholder="הערה אופציונלית"
              />
            </label>

            <div className="info-box">
              <strong>
                חשוב:
              </strong>{" "}
              ההוצאה הזו היא תכנון חודשי.
              היא לא נחשבת כהוצאה בפועל
              עד שתסמני שהיא חויבה ותזיני
              את הסכום בפועל.
            </div>

            {saveError && (
              <div className="error pre">
                {saveError}
              </div>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="ghost"
                onClick={
                  closeRecurringModal
                }
                disabled={saving}
              >
                ביטול
              </button>

              <button
                type="submit"
                className="primary"
                disabled={saving}
              >
                {saving
                  ? "שומר..."
                  : editingRecurring
                  ? "שמירת שינויים"
                  : "הוספת הוצאה קבועה"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showCategoryCreator && (
        <Modal
          title="קטגוריה חדשה"
          onClose={() =>
            setShowCategoryCreator(
              false
            )
          }
        >
          <div className="form">
            <label>
              שם הקטגוריה
              <input
                autoFocus
                value={newCategoryName}
                onChange={(event) =>
                  setNewCategoryName(
                    event.target.value
                  )
                }
                placeholder="למשל: חוגים"
              />
            </label>

            <div className="modal-actions">
              <button
                className="ghost"
                onClick={() =>
                  setShowCategoryCreator(
                    false
                  )
                }
              >
                ביטול
              </button>

              <button
                className="primary"
                onClick={addCategory}
              >
                הוספה
              </button>
            </div>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          title="אישור מחיקה"
          onClose={() =>
            setConfirmDelete(null)
          }
        >
          <div className="confirm-box">
            <p>
              האם את בטוחה שאת רוצה למחוק
              את{" "}
              <strong>
                {confirmDelete.item
                  ?.name ||
                  confirmDelete.item
                    ?.description ||
                  "הרשומה"}
              </strong>
              ?
            </p>

            <p className="muted">
              לא ניתן לבטל את המחיקה.
            </p>

            <div className="modal-actions">
              <button
                className="ghost"
                onClick={() =>
                  setConfirmDelete(null)
                }
              >
                ביטול
              </button>

              <button
                className="danger-button"
                disabled={saving}
                onClick={() => {
                  if (
                    confirmDelete.type ===
                    "recurring"
                  ) {
                    deleteRecurring(
                      confirmDelete.item
                    );
                  } else {
                    deleteTransaction(
                      confirmDelete.item
                    );
                  }
                }}
              >
                {saving
                  ? "מוחק..."
                  : "כן, למחוק"}
              </button>
            </div>
          </div>
        </Modal>
      )}
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
            <th>תאריך</th>
            <th>תיאור</th>
            <th>קטגוריה</th>
            <th>סוג</th>
            <th>מתוכנן</th>
            <th>בפועל</th>
            <th>מי</th>
            <th></th>
          </tr>
        </thead>

        <tbody>
          {transactions.map(
            (transaction) => {
              const isIncome =
                transaction.kind ===
                "income";

              const actual =
                getTransactionActualAmount(
                  transaction
                );

              const planned =
                getTransactionPlannedAmount(
                  transaction
                );

              return (
                <tr
                  key={transaction.id}
                >
                  <td>
                    {formatDate(
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
                    {isIncome ? (
                      <span className="badge success">
                        הכנסה
                      </span>
                    ) : (
                      <span
                        className={
                          transaction.expense_type ===
                          "fixed"
                            ? "badge fixed"
                            : "badge variable"
                        }
                      >
                        {transaction.expense_type ===
                        "fixed"
                          ? "קבועה"
                          : "משתנה"}
                      </span>
                    )}
                  </td>

                  <td>
                    {!isIncome &&
                    transaction.expense_type ===
                      "fixed"
                      ? formatMoney(
                          planned
                        )
                      : "—"}
                  </td>

                  <td
                    className={
                      isIncome
                        ? "money-positive"
                        : "money-negative"
                    }
                  >
                    {actual
                      ? formatMoney(
                          actual
                        )
                      : "—"}
                  </td>

                  <td>
                    {memberMap[
                      transaction
                        .person_user_id
                    ] ||
                      "לא צוין"}
                  </td>

                  <td>
                    <div className="table-actions">
                      <button
                        className="icon-button"
                        title="עריכה"
                        onClick={() =>
                          onEdit(
                            transaction,
                            isIncome
                              ? "income"
                              : "expense"
                          )
                        }
                      >
                        ✎
                      </button>

                      <button
                        className="icon-button danger"
                        title="מחיקה"
                        onClick={() =>
                          onDelete({
                            type: "transaction",
                            item: transaction,
                          })
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
        <div className="modal-header">
          <h2>{title}</h2>

          <button
            type="button"
            className="modal-close"
            onClick={onClose}
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
