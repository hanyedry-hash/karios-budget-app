"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

/* =========================================================
   HELPERS
========================================================= */

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
  return monthKey(new Date(y, mo - 1 + n, 1));
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

function normalizeText(value) {
  return String(value || "")
    .replace(/\uFEFF/g, "")
    .replace(/\r/g, "")
    .trim();
}

function cleanAmount(value) {
  if (value === null || value === undefined) return null;

  let text = String(value).trim();
  if (!text) return null;

  const negative =
    text.startsWith("-") || text.includes("(");

  text = text
    .replace(/₪/g, "")
    .replace(/ILS/gi, "")
    .replace(/,/g, "")
    .replace(/\s/g, "")
    .replace(/"/g, "");

  text = text.replace(/[^\d.]/g, "");

  if (!text) return null;

  const number = Number(text);
  if (!Number.isFinite(number)) return null;

  return negative ? -Math.abs(number) : number;
}

function normalizeDate(value) {
  const text = normalizeText(value);
  if (!text) return "";

  let match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);

  if (match) {
    let [, day, month, year] = match;
    if (year.length === 2) year = `20${year}`;

    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  match = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);

  if (match) {
    const [, year, month, day] = match;

    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return "";
}

function paymentMethodLabel(value) {
  const map = {
    credit_card: "כרטיס אשראי",
    bank: "חשבון בנק",
    cash: "מזומן",
    bit: "ביט",
    paybox: "פייבוקס",
    other: "אחר",
  };

  return map[value] || "לא צוין";
}

/* =========================================================
   CREDIT CARD
========================================================= */

function normalizeProvider(value) {
  const text = normalizeText(value).toLowerCase();

  if (
    text.includes("ישראכרט") ||
    text.includes("isracard") ||
    text.includes("flycard")
  ) {
    return "isracard";
  }

  if (
    text.includes("כאל") ||
    /(^|\W)cal(\W|$)/i.test(text) ||
    text.includes("cardcom") ||
    text.includes("calonline")
  ) {
    return "cal";
  }

  return "";
}

function providerLabel(provider) {
  if (provider === "isracard") return "ישראכרט";
  if (provider === "cal") return "כאל";
  return "לא ידוע";
}

function detectCardLast4(text, fileName = "") {
  const value = String(text || "")
    .replace(/\uFEFF/g, "")
    .replace(/\r/g, " ");

  const source = `${value} ${String(fileName || "")}`;

  const patterns = [
    /מסתיים\s*ב?\s*[-–—:]?\s*(\d{4})/i,
    /(?:last\s*4|ending)\D{0,20}(\d{4})/i,
    /(?:FLYCARD|כרטיס|card)\D{0,40}(\d{4})/i,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return match[1];
  }

  const fileText = String(fileName || "");

  if (/csv|אשראי|כרטיס|card|isracard|flycard|cal/i.test(fileText)) {
    const fileMatch = fileText.match(
      /(?:^|[^\d])(\d{4})(?:[^\d]|$)/
    );

    if (fileMatch?.[1]) return fileMatch[1];
  }

  return "";
}

function detectProviderFromFile(text, fileName = "") {
  return normalizeProvider(`${text || ""} ${fileName || ""}`);
}

/* =========================================================
   CSV
========================================================= */

function detectDelimiter(text) {
  const firstLines = String(text || "")
    .split(/\r?\n/)
    .slice(0, 10)
    .join("\n");

  const commaCount = (firstLines.match(/,/g) || []).length;
  const semicolonCount = (firstLines.match(/;/g) || []).length;
  const tabCount = (firstLines.match(/\t/g) || []).length;

  if (tabCount > commaCount && tabCount > semicolonCount) return "\t";
  if (semicolonCount > commaCount) return ";";

  return ",";
}

function parseCSV(text) {
  const input = String(text || "").replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(input);

  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }

    if (char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    if (char === "\r") {
      if (input[i + 1] === "\n") i++;

      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((r) =>
    r.some((c) => String(c || "").trim() !== "")
  );
}

function normalizeHeader(header) {
  return normalizeText(header)
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function findHeaderIndex(headers, variants) {
  for (const variant of variants) {
    const normalizedVariant = normalizeHeader(variant);

    const index = headers.findIndex((header) => {
      const normalized = normalizeHeader(header);

      return (
        normalized === normalizedVariant ||
        normalized.includes(normalizedVariant)
      );
    });

    if (index >= 0) return index;
  }

  return -1;
}

/* =========================================================
   CATEGORIES / CREDIT IMPORT
========================================================= */

function guessCategoryName(merchant, branch, description) {
  const text =
    `${merchant} ${branch} ${description}`.toLowerCase();

  if (
    /סופר|מינימרקט|שיווק|מזון|מכולת|אטליז|בשר|דגים|ניצת|ויקטורי|רמי לוי|שופרסל|carrefour|super/i.test(
      text
    )
  ) {
    return "סופר ומזון";
  }

  if (
    /מסעד|קפה|coffee|restaurant|פיצה|פסטה|בורגר|רוקו|בובה|על הנהר/i.test(
      text
    )
  ) {
    return "בילויים";
  }

  if (
    /דלק|סונול|פז |דור אלון|yellow|fuel|תחנה/i.test(
      text
    )
  ) {
    return "תחבורה ודלק";
  }

  if (
    /google one|google chatgpt|chatgpt|netflix|spotify|apple|מנוי|subscription/i.test(
      text
    )
  ) {
    return "מנויים";
  }

  if (
    /בריאות|כללית|מכבי|לאומית|רופא|בית חולים|רמב"ם/i.test(
      text
    )
  ) {
    return "בריאות";
  }

  if (
    /ביטוח|insurance|הראל|מגדל|כלל ביטוח|הפניקס/i.test(
      text
    )
  ) {
    return "ביטוחים";
  }

  if (
    /משרד הפנים|בתי המשפט|עירייה|ממשלה|מוסדות/i.test(
      text
    )
  ) {
    return "דיור וחשבונות";
  }

  if (
    /דלתא|אופנה|zara|h&m|fashion|בגדים/i.test(
      text
    )
  ) {
    return "קניות";
  }

  if (
    /בית|ריהוט|איקאה|ikea|זול פעמי/i.test(
      text
    )
  ) {
    return "בית";
  }

  if (/אמזון|amazon|פיס|בילוי|פנאי/i.test(text)) {
    return "בילויים";
  }

  return "אחר";
}

function findCategoryIdByName(categories, name) {
  const normalized = normalizeText(name).toLowerCase();

  const exact = categories.find(
    (category) =>
      normalizeText(category.name).toLowerCase() === normalized
  );

  return exact?.id || "";
}

function looksLikeRecurring(row) {
  const type = normalizeText(row.transactionType);

  const text =
    `${row.merchant} ${row.description} ${row.branch} ${type}`.toLowerCase();

  return (
    /הוראת קבע|חיוב חודשי|קבוע|recurring|standing order|direct debit/.test(
      text
    ) || type.includes("הוראת קבע")
  );
}

function makeImportKey(row) {
  return [
    row.credit_card_provider || "",
    row.credit_card_last4 || "",
    row.transaction_date || "",
    Number(row.actual_amount || 0).toFixed(2),
    normalizeText(row.merchant || row.description).toLowerCase(),
  ].join("|");
}

function parseCreditFile(
  text,
  categories,
  forcedProvider = "",
  fileName = ""
) {
  const rows = parseCSV(text);

  if (!rows.length) {
    throw new Error("הקובץ ריק או שלא ניתן לקרוא אותו.");
  }

  const fullText = rows.map((row) => row.join(" ")).join("\n");

  const provider =
    forcedProvider || detectProviderFromFile(fullText, fileName);

  const cardLast4 = detectCardLast4(fullText, fileName);

  let headerRowIndex = -1;

  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const joined = rows[i].map(normalizeHeader).join(" | ");

    const hasDate =
      /תאריך.*עסקה|תאריך.*רכישה|date.*transaction|transaction.*date|purchase.*date|תאריך/.test(
        joined
      );

    const hasMerchant =
      /שם.*בית עסק|בית עסק|merchant|description|פירוט|שם העסק/.test(
        joined
      );

    const hasAmount =
      /סכום.*עסקה|סכום.*רכישה|סכום.*חיוב|amount|charge|purchase amount/.test(
        joined
      );

    if ((hasDate && hasMerchant) || (hasDate && hasAmount)) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex < 0) {
    throw new Error("לא הצלחתי לזהות את שורת הכותרות בקובץ.");
  }

  const headers = rows[headerRowIndex].map(normalizeText);

  const dateIndex = findHeaderIndex(headers, [
    "תאריך עסקה",
    "תאריך\nעסקה",
    "תאריך רכישה",
    "תאריך\nרכישה",
    "transaction date",
    "purchase date",
    "date",
    "תאריך",
  ]);

  const merchantIndex = findHeaderIndex(headers, [
    "שם בית עסק",
    "בית עסק",
    "merchant",
    "description",
    "שם העסק",
    "שם בית העסק",
    "פירוט",
  ]);

  const chargeIndex = findHeaderIndex(headers, [
    "סכום חיוב",
    "סכום\nחיוב",
    "סכום חיוב בשח",
    'סכום חיוב בש"ח',
    "charge amount",
    "charged amount",
    "amount charged",
    "חיוב",
  ]);

  const purchaseIndex = findHeaderIndex(headers, [
    "סכום עסקה",
    "סכום\nעסקה",
    "סכום רכישה",
    "סכום\nרכישה",
    "transaction amount",
    "purchase amount",
    "amount",
    "סכום",
  ]);

  const typeIndex = findHeaderIndex(headers, [
    "סוג עסקה",
    "סוג\nעסקה",
    "transaction type",
    "type",
  ]);

  const branchIndex = findHeaderIndex(headers, [
    "ענף",
    "branch",
    "category",
    "תחום",
  ]);

  const notesIndex = findHeaderIndex(headers, [
    "הערות",
    "note",
    "notes",
    "remarks",
  ]);

  if (dateIndex < 0) {
    throw new Error("לא נמצאה עמודת תאריך עסקה / תאריך רכישה.");
  }

  if (merchantIndex < 0) {
    throw new Error("לא נמצאה עמודת בית עסק.");
  }

  if (chargeIndex < 0 && purchaseIndex < 0) {
    throw new Error("לא נמצאה עמודת סכום.");
  }

  const result = [];

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];

    const transactionDate = normalizeDate(row[dateIndex]);
    if (!transactionDate) continue;

    const merchant = normalizeText(row[merchantIndex]);
    if (!merchant) continue;

    const chargeAmount =
      chargeIndex >= 0 ? cleanAmount(row[chargeIndex]) : null;

    const purchaseAmount =
      purchaseIndex >= 0 ? cleanAmount(row[purchaseIndex]) : null;

    const actualAmount =
      chargeIndex >= 0 ? chargeAmount : purchaseAmount;

    if (
      actualAmount === null ||
      !Number.isFinite(actualAmount) ||
      actualAmount === 0
    ) {
      continue;
    }

    const transactionType =
      typeIndex >= 0 ? normalizeText(row[typeIndex]) : "";

    const branch =
      branchIndex >= 0 ? normalizeText(row[branchIndex]) : "";

    const notes =
      notesIndex >= 0 ? normalizeText(row[notesIndex]) : "";

    const categoryName = guessCategoryName(
      merchant,
      branch,
      notes
    );

    const categoryId = findCategoryIdByName(
      categories,
      categoryName
    );

    const recurringFlag = looksLikeRecurring({
      merchant,
      description: merchant,
      branch,
      transactionType,
    });

    const baseRow = {
      description: merchant,
      merchant,
      category_id: categoryId || "",
      category_name: categoryName,
      transaction_date: transactionDate,
      actual_amount: actualAmount,
      planned_amount: actualAmount,
      expense_type: recurringFlag ? "fixed" : "variable",
      transactionType,
      branch,
      notes,
      payment_method: "credit_card",
      credit_card_provider: provider,
      credit_card_last4: cardLast4,
      recurringCandidate: recurringFlag,
    };

    result.push({
      id: `import-${i}-${Math.random().toString(36).slice(2)}`,
      ...baseRow,
      importKey: makeImportKey(baseRow),
    });
  }

  return {
    provider,
    cardLast4,
    rows: result,
  };
}

/* =========================================================
   MAIN APP
========================================================= */

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
  const [detailsTx, setDetailsTx] = useState(null);

  const [txForm, setTxForm] = useState(emptyTx());
  const [recForm, setRecForm] = useState(emptyRecurring());

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  const [newCategory, setNewCategory] = useState("");
  const [editingCategory, setEditingCategory] = useState(null);
  const [categoryNameForm, setCategoryNameForm] = useState("");

  const [confirm, setConfirm] = useState(null);

  /* CREDIT IMPORT */

  const [importFile, setImportFile] = useState(null);
  const [importProvider, setImportProvider] = useState("");
  const [importPreview, setImportPreview] = useState([]);
  const [importFileInfo, setImportFileInfo] = useState(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importSaving, setImportSaving] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [importError, setImportError] = useState("");
  const [importSelected, setImportSelected] = useState({});
  const [importFromDate, setImportFromDate] = useState("");
  const [importToDate, setImportToDate] = useState("");

  /* =====================================================
     AUTH
  ===================================================== */

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

      if (h.error) throw h.error;

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

      if (membersResult.error)
        console.error("Members:", membersResult.error);

      if (categoriesResult.error)
        console.error("Categories:", categoriesResult.error);

      if (transactionsResult.error)
        console.error("Transactions:", transactionsResult.error);

      if (recurringResult.error)
        console.error("Recurring:", recurringResult.error);

      setProfiles(
        (membersResult.data || []).map((member) => ({
          id: member.user_id,
          display_name: member.display_name || "ללא שם",
          role: member.role,
        }))
      );

      setCategories(categoriesResult.data || []);
      setTransactions(transactionsResult.data || []);
      setRecurring(recurringResult.data || []);
    } catch (e) {
      console.error(e);
      setError(e.message || "שגיאה בטעינת הנתונים");
    } finally {
      setLoading(false);
    }
  }

  async function signIn(event) {
    event.preventDefault();
    setLoginError("");

    const { error } = await supabase.auth.signInWithPassword({
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

  /* =====================================================
     TRANSACTIONS
  ===================================================== */

  function openTx(transaction = null, kind = "expense") {
    setError("");
    setDetailsTx(null);
    setEditingTx(transaction);

    if (transaction) {
      setTxForm({
        description: transaction.description || "",
        category_id: transaction.category_id || "",
        expense_type: transaction.expense_type || "variable",
        planned_amount: transaction.planned_amount ?? "",
        actual_amount: transaction.actual_amount ?? "",
        person_user_id: transaction.person_user_id || "",
        transaction_date:
          transaction.transaction_date ||
          new Date().toISOString().slice(0, 10),
        note: transaction.note || "",
        payment_method: transaction.payment_method || "",
        merchant: transaction.merchant || "",
        credit_card_last4:
          transaction.credit_card_last4 || "",
        credit_card_provider:
          transaction.credit_card_provider || "",
        kind,
      });
    } else {
      setTxForm({
        ...emptyTx(),
        kind,
      });
    }

    setModal(kind === "income" ? "income" : "transaction");
  }

  function closeModal() {
    setModal(null);
    setEditingTx(null);
    setEditingRecurring(null);
    setError("");
  }

  async function saveTx(event) {
    event.preventDefault();

    if (saving || !household) return;

    setError("");

    const form = txForm;
    const kind = modal === "income" ? "income" : "expense";

    const description = String(form.description || "").trim();

    const actual =
      form.actual_amount === ""
        ? null
        : Number(form.actual_amount);

    const planned =
      kind === "expense" && form.expense_type === "fixed"
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
      (!Number.isFinite(planned) || planned < 0)
    ) {
      setError("יש להזין סכום מתוכנן תקין.");
      return;
    }

    if (
      actual !== null &&
      (!Number.isFinite(actual) || actual < 0)
    ) {
      setError("יש להזין סכום בפועל תקין.");
      return;
    }

    if (
      kind === "income" &&
      (!Number.isFinite(actual) || actual < 0)
    ) {
      setError("יש להזין סכום תקין.");
      return;
    }

    const row = {
      household_id: household.id,
      created_by: user?.id || null,
      kind,
      description,
      category_id: form.category_id || null,
      transaction_date: form.transaction_date,

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

      person_user_id: form.person_user_id || null,

      note:
        String(form.note || "").trim() || null,

      payment_method: form.payment_method || null,

      merchant:
        String(form.merchant || "").trim() || null,

      credit_card_last4:
        String(form.credit_card_last4 || "")
          .replace(/\D/g, "")
          .slice(-4) || null,

      credit_card_provider:
        form.credit_card_provider || null,
    };

    setSaving(true);

    try {
      let result;

      if (editingTx) {
        result = await supabase
          .from("transactions")
          .update(row)
          .eq("id", editingTx.id)
          .eq("household_id", household.id)
          .select("*")
          .single();
      } else {
        result = await supabase
          .from("transactions")
          .insert(row)
          .select("*")
          .single();
      }

      if (result.error) throw result.error;

      /*
       * חשוב:
       * מוסיפים את התנועה שחזרה מהשרת מיד לרשימה.
       * זה מונע מצב שבו השמירה הצליחה אבל המסך נשאר עם
       * רשימה ישנה.
       */
      if (result.data) {
        if (editingTx) {
          setTransactions((current) =>
            current.map((tx) =>
              tx.id === result.data.id
                ? result.data
                : tx
            )
          );
        } else {
          setTransactions((current) =>
            [result.data, ...current].sort((a, b) => {
              const dateCompare =
                String(b.transaction_date || "").localeCompare(
                  String(a.transaction_date || "")
                );

              if (dateCompare !== 0) return dateCompare;

              return String(b.created_at || "").localeCompare(
                String(a.created_at || "")
              );
            })
          );
        }
      }

      closeModal();

      /*
       * רענון נוסף מהשרת כדי לוודא שהמצב המקומי והשרת זהים.
       */
      await refresh();
    } catch (e) {
      console.error("SAVE TRANSACTION ERROR:", e);

      setError(
        e.message ||
          "לא הצלחתי לשמור את התנועה."
      );
    } finally {
      setSaving(false);
    }
  }

  /* =====================================================
     RECURRING
  ===================================================== */

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

  async function saveRecurring(event) {
    event.preventDefault();

    if (saving || !household) return;

    setError("");

    const planned = Number(recForm.planned_amount);
    const day = Number(recForm.day_of_month);

    if (!String(recForm.name || "").trim()) {
      setError("יש להזין שם הוצאה.");
      return;
    }

    if (!Number.isFinite(planned) || planned < 0) {
      setError("יש להזין סכום מתוכנן תקין.");
      return;
    }

    if (!Number.isInteger(day) || day < 1 || day > 31) {
      setError("יום בחודש חייב להיות בין 1 ל־31.");
      return;
    }

    const row = {
      household_id: household.id,
      name: String(recForm.name).trim(),
      category_id: recForm.category_id || null,
      planned_amount: planned,
      day_of_month: day,
      person_user_id: recForm.person_user_id || null,
      is_active: true,
      note: String(recForm.note || "").trim() || null,
      payment_method: recForm.payment_method || null,
      merchant: String(recForm.merchant || "").trim() || null,
    };

    setSaving(true);

    try {
      let result;

      if (editingRecurring) {
        result = await supabase
          .from("recurring_expenses")
          .update(row)
          .eq("id", editingRecurring.id)
          .eq("household_id", household.id)
          .select("*")
          .single();
      } else {
        result = await supabase
          .from("recurring_expenses")
          .insert(row)
          .select("*")
          .single();
      }

      if (result.error) throw result.error;

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
    if (saving || !household) return;

    const actualText = window.prompt(
      `סכום בפועל עבור ${item.name}\nמתוכנן: ${money(
        item.planned_amount
      )}`,
      String(item.planned_amount ?? "")
    );

    if (actualText === null) return;

    const actual = Number(actualText);

    if (!Number.isFinite(actual) || actual < 0) {
      window.alert("יש להזין סכום תקין.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const { data: existing, error: findError } =
        await supabase
          .from("transactions")
          .select("*")
          .eq("recurring_expense_id", item.id)
          .eq("recurring_month", month)
          .maybeSingle();

      if (findError) throw findError;

      const day = Math.min(
        Number(item.day_of_month) || 1,
        28
      );

      const row = {
        household_id: household.id,
        created_by: user?.id || null,
        kind: "expense",
        description: item.name,
        category_id: item.category_id || null,
        transaction_date: `${month}-${String(day).padStart(
          2,
          "0"
        )}`,
        planned_amount: Number(item.planned_amount || 0),
        completed: true,
        actual_amount: actual,
        expense_type: "fixed",
        person_user_id: item.person_user_id || null,
        note: item.note || null,
        payment_method: item.payment_method || null,
        merchant: item.merchant || null,
        credit_card_provider: null,
        credit_card_last4: null,
        recurring_expense_id: item.id,
        recurring_month: month,
      };

      let result;

      if (existing) {
        result = await supabase
          .from("transactions")
          .update(row)
          .eq("id", existing.id)
          .select("*")
          .single();
      } else {
        result = await supabase
          .from("transactions")
          .insert(row)
          .select("*")
          .single();
      }

      if (result.error) throw result.error;

      await refresh();
    } catch (e) {
      console.error(e);
      setError(
        e.message || "לא הצלחתי לסמן כחויב."
      );
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

      setDetailsTx(null);
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

  /* =====================================================
     CATEGORIES
  ===================================================== */

  async function addCategory() {
    const name = String(newCategory || "").trim();

    if (!name || !household) return;

    setSaving(true);
    setError("");

    try {
      const { error } = await supabase
        .from("categories")
        .insert({
          household_id: household.id,
          name,
        });

      if (error) throw error;

      setNewCategory("");
      await refresh();
    } catch (e) {
      console.error(e);
      setError(
        e.message || "לא הצלחתי להוסיף קטגוריה."
      );
    } finally {
      setSaving(false);
    }
  }

  function startEditCategory(category) {
    setEditingCategory(category);
    setCategoryNameForm(category.name || "");
    setError("");
  }

  function cancelEditCategory() {
    setEditingCategory(null);
    setCategoryNameForm("");
  }

  async function saveCategoryName() {
    if (!editingCategory || !household) return;

    const name = String(categoryNameForm || "").trim();

    if (!name) {
      setError("יש להזין שם קטגוריה.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const { error } = await supabase
        .from("categories")
        .update({ name })
        .eq("id", editingCategory.id)
        .eq("household_id", household.id);

      if (error) throw error;

      cancelEditCategory();
      await refresh();
    } catch (e) {
      console.error(e);
      setError(
        e.message || "לא הצלחתי לשנות את הקטגוריה."
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteCategory(category) {
    setConfirm(null);
    setSaving(true);
    setError("");

    try {
      const { count, error: countError } =
        await supabase
          .from("transactions")
          .select("id", {
            count: "exact",
            head: true,
          })
          .eq("household_id", household.id)
          .eq("category_id", category.id);

      if (countError) throw countError;

      if (Number(count || 0) > 0) {
        setError(
          `אי אפשר למחוק את "${category.name}" כי יש ${count} תנועות שמשויכות אליה. אפשר לשנות את השם במקום.`
        );
        return;
      }

      const { error } = await supabase
        .from("categories")
        .delete()
        .eq("id", category.id)
        .eq("household_id", household.id);

      if (error) throw error;

      await refresh();
    } catch (e) {
      console.error(e);
      setError(
        e.message || "לא הצלחתי למחוק את הקטגוריה."
      );
    } finally {
      setSaving(false);
    }
  }

  /* =====================================================
     CREDIT IMPORT
  ===================================================== */

  function resetImport() {
    setImportFile(null);
    setImportProvider("");
    setImportPreview([]);
    setImportFileInfo(null);
    setImportSelected({});
    setImportMessage("");
    setImportError("");
    setImportFromDate("");
    setImportToDate("");
  }

  async function handleCreditFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportLoading(true);
    setImportError("");
    setImportMessage("");
    setImportPreview([]);
    setImportSelected({});
    setImportFileInfo(null);

    try {
      const text = await file.text();

      let detectedProvider =
        detectProviderFromFile(text, file.name);

      if (!detectedProvider) {
        detectedProvider =
          normalizeProvider(importProvider);
      }

      const parsed = parseCreditFile(
        text,
        categories,
        detectedProvider,
        file.name
      );

      if (!parsed.provider) {
        throw new Error(
          "לא הצלחתי לזהות אם הקובץ שייך לישראכרט או לכאל. בחרי את החברה ידנית."
        );
      }

      const existingKeys = new Set(
        transactions.map((tx) =>
          makeImportKey({
            credit_card_provider:
              tx.credit_card_provider || "",
            credit_card_last4:
              tx.credit_card_last4 || "",
            transaction_date:
              tx.transaction_date || "",
            actual_amount:
              tx.actual_amount || 0,
            merchant: tx.merchant || "",
            description:
              tx.description || "",
          })
        )
      );

      const enriched = parsed.rows.map((row) => ({
        ...row,
        duplicate: existingKeys.has(row.importKey),
        selected: !existingKeys.has(row.importKey),
      }));

      const selected = {};

      enriched.forEach((row) => {
        selected[row.id] = row.selected;
      });

      setImportFile(file);
      setImportProvider(parsed.provider);

      setImportFileInfo({
        name: file.name,
        provider: parsed.provider,
        cardLast4: parsed.cardLast4,
        total: enriched.length,
        duplicates: enriched.filter(
          (r) => r.duplicate
        ).length,
        amount: enriched.reduce(
          (sum, r) =>
            sum + Number(r.actual_amount || 0),
          0
        ),
      });

      setImportPreview(enriched);
      setImportSelected(selected);

      if (!enriched.length) {
        setImportMessage(
          "לא נמצאו עסקאות לחיוב בקובץ."
        );
      }
    } catch (e) {
      console.error(e);
      setImportError(
        e.message || "לא הצלחתי לקרוא את הקובץ."
      );
    } finally {
      setImportLoading(false);
      event.target.value = "";
    }
  }

  function toggleImportRow(id) {
    setImportSelected((current) => ({
      ...current,
      [id]: !current[id],
    }));
  }

  function selectAllImportRows() {
    const next = { ...importSelected };

    filteredImportRows.forEach((row) => {
      next[row.id] = !row.duplicate;
    });

    setImportSelected(next);
  }

  function deselectAllImportRows() {
    const next = { ...importSelected };

    filteredImportRows.forEach((row) => {
      next[row.id] = false;
    });

    setImportSelected(next);
  }

  function changeImportCategory(id, categoryId) {
    setImportPreview((current) =>
      current.map((row) =>
        row.id === id
          ? { ...row, category_id: categoryId }
          : row
      )
    );
  }

  function changeImportType(id, expenseType) {
    setImportPreview((current) =>
      current.map((row) =>
        row.id === id
          ? { ...row, expense_type: expenseType }
          : row
      )
    );
  }

  async function importSelectedTransactions() {
    if (importSaving || !household) return;

    setImportError("");
    setImportMessage("");

    const selected = filteredImportRows.filter(
      (row) =>
        importSelected[row.id] &&
        !row.duplicate
    );

    if (!selected.length) {
      setImportError("לא נבחרו עסקאות לייבוא.");
      return;
    }

    setImportSaving(true);

    try {
      const { data: latest, error: latestError } =
        await supabase
          .from("transactions")
          .select(
            "id,credit_card_provider,credit_card_last4,transaction_date,actual_amount,merchant,description"
          )
          .eq("household_id", household.id);

      if (latestError) throw latestError;

      const existingKeys = new Set(
        (latest || []).map((tx) =>
          makeImportKey({
            credit_card_provider:
              tx.credit_card_provider || "",
            credit_card_last4:
              tx.credit_card_last4 || "",
            transaction_date:
              tx.transaction_date || "",
            actual_amount:
              tx.actual_amount || 0,
            merchant:
              tx.merchant || "",
            description:
              tx.description || "",
          })
        )
      );

      const rowsToInsert = selected
        .filter(
          (row) =>
            !existingKeys.has(row.importKey)
        )
        .map((row) => ({
          household_id: household.id,
          created_by: user?.id || null,
          kind: "expense",
          description: row.description,
          category_id: row.category_id || null,
          transaction_date: row.transaction_date,
          planned_amount: row.actual_amount,
          completed: true,
          actual_amount: row.actual_amount,
          expense_type:
            row.expense_type || "variable",
          person_user_id: null,
          note:
            [
              row.notes,
              row.transactionType
                ? `סוג: ${row.transactionType}`
                : "",
              row.branch
                ? `ענף: ${row.branch}`
                : "",
              "יובא מקובץ אשראי",
            ]
              .filter(Boolean)
              .join(" · ") || null,
          payment_method: "credit_card",
          merchant: row.merchant || null,
          credit_card_last4:
            row.credit_card_last4 || null,
          credit_card_provider:
            row.credit_card_provider ||
            importProvider ||
            null,
        }));

      if (!rowsToInsert.length) {
        setImportMessage(
          "כל העסקאות שנבחרו כבר קיימות במערכת — לא נוצרו כפילויות."
        );

        await refresh();
        return;
      }

      const { error } = await supabase
        .from("transactions")
        .insert(rowsToInsert);

      if (error) throw error;

      const skipped =
        selected.length - rowsToInsert.length;

      setImportMessage(
        `יובאו ${rowsToInsert.length} עסקאות בהצלחה${
          skipped > 0
            ? ` · ${skipped} כבר היו קיימות ולא יובאו שוב`
            : ""
        }.`
      );

      setImportPreview((current) =>
        current.map((row) =>
          importSelected[row.id]
            ? {
                ...row,
                duplicate: true,
                selected: false,
              }
            : row
        )
      );

      setImportSelected((current) => {
        const next = { ...current };

        selected.forEach((row) => {
          next[row.id] = false;
        });

        return next;
      });

      await refresh();
    } catch (e) {
      console.error(e);
      setImportError(
        e.message || "הייבוא נכשל."
      );
    } finally {
      setImportSaving(false);
    }
  }

  /* =====================================================
     CALCULATIONS
  ===================================================== */

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
        (t) => t.kind === "income"
      ),
    [transactions]
  );

  const actualIncome = incomeTx.reduce(
    (sum, t) =>
      sum + Number(t.actual_amount || 0),
    0
  );

  const actualExpenses = expenseTx.reduce(
    (sum, t) =>
      sum + Number(t.actual_amount || 0),
    0
  );

  const fixedActual = expenseTx
    .filter((t) => t.expense_type === "fixed")
    .reduce(
      (sum, t) =>
        sum + Number(t.actual_amount || 0),
      0
    );

  const variableActual = expenseTx
    .filter((t) => t.expense_type === "variable")
    .reduce(
      (sum, t) =>
        sum + Number(t.actual_amount || 0),
      0
    );

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
    (sum, r) =>
      sum + Number(r.planned_amount || 0),
    0
  );

  const pendingPlanned = pendingRecurring.reduce(
    (sum, r) =>
      sum + Number(r.planned_amount || 0),
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

  const categoryChart = useMemo(() => {
    const map = {};

    expenseTx.forEach((transaction) => {
      const name =
        categoryMap[transaction.category_id] ||
        "ללא קטגוריה";

      map[name] =
        (map[name] || 0) +
        Number(transaction.actual_amount || 0);
    });

    return Object.entries(map)
      .map(([label, value]) => ({
        label,
        value,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [expenseTx, categoryMap]);

  /* =====================================================
     IMPORT FILTER
  ===================================================== */

  const filteredImportRows = useMemo(() => {
    if (
      importFromDate &&
      importToDate &&
      importFromDate > importToDate
    ) {
      return [];
    }

    return importPreview.filter((row) => {
      const date = row.transaction_date || "";

      if (
        importFromDate &&
        date < importFromDate
      ) {
        return false;
      }

      if (
        importToDate &&
        date > importToDate
      ) {
        return false;
      }

      return true;
    });
  }, [
    importPreview,
    importFromDate,
    importToDate,
  ]);

  const importDateRangeError =
    importFromDate &&
    importToDate &&
    importFromDate > importToDate
      ? "התאריך 'מתאריך' חייב להיות לפני או שווה ל'עד תאריך'."
      : "";

  const filteredImportFileInfo = useMemo(() => {
    if (!importFileInfo) return null;

    return {
      ...importFileInfo,
      total: filteredImportRows.length,
      duplicates: filteredImportRows.filter(
        (row) => row.duplicate
      ).length,
      amount: filteredImportRows.reduce(
        (sum, row) =>
          sum + Number(row.actual_amount || 0),
        0
      ),
    };
  }, [
    importFileInfo,
    filteredImportRows,
  ]);

  const selectedImportCount =
    filteredImportRows.filter(
      (row) =>
        importSelected[row.id] &&
        !row.duplicate
    ).length;

  const selectedImportAmount =
    filteredImportRows
      .filter(
        (row) =>
          importSelected[row.id] &&
          !row.duplicate
      )
      .reduce(
        (sum, row) =>
          sum + Number(row.actual_amount || 0),
        0
      );

  /* =====================================================
     LOGIN
  ===================================================== */

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
              onChange={(e) =>
                setEmail(e.target.value)
              }
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

  if (loading && !household) {
    return (
      <main
        className="loading-page"
        dir="rtl"
      >
        טוען...
      </main>
    );
  }

  /* =====================================================
     APP
  ===================================================== */

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
            {household?.name || "התקציב שלי"}
          </h1>
        </div>

        <div className="top-actions">
          <span className="user-name">
            {memberMap[user.id] || "משתמשת"}
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
              shiftMonth(month, -1)
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
              shiftMonth(month, 1)
            )
          }
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
          ["import", "יבוא אשראי"],
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

      {error && (
        <div className="global-error">
          {error}
        </div>
      )}

      {/* ===================================================
          DASHBOARD
      =================================================== */}

      {tab === "dashboard" && (
        <>
          <div className="page-title">
            <div>
              <h2>סיכום חודשי</h2>
              <p>{monthLabel(month)}</p>
            </div>

            <button
              className="primary"
              onClick={() => openTx()}
            >
              ＋ הוצאה
            </button>
          </div>

          <section className="cards">
            <Stat
              title="הכנסות בפועל"
              value={money(actualIncome)}
              tone="positive"
            />

            <Stat
              title="הוצאות בפועל"
              value={money(actualExpenses)}
              tone="negative"
            />

            <Stat
              title="יתרה"
              value={money(
                actualIncome - actualExpenses
              )}
              tone={
                actualIncome - actualExpenses >= 0
                  ? "positive"
                  : "negative"
              }
            />

            <Stat
              title="קבועות מתוכננות"
              value={money(plannedFixed)}
              subtitle={`${pendingRecurring.length} ממתינות לחיוב`}
            />
          </section>

          <div className="two-columns">
            <Panel title="קבועות מול משתנות">
              <Bars data={typeChart} />
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
                            יום {item.day_of_month} ·{" "}
                            {money(
                              item.planned_amount
                            )}
                          </small>
                        </div>

                        <button
                          className="small primary"
                          onClick={() =>
                            chargeRecurring(item)
                          }
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
              {transactions
                .slice(0, 7)
                .map((transaction) => (
                  <div
                    className="recent-row clickable-row"
                    key={transaction.id}
                    onClick={() =>
                      setDetailsTx(transaction)
                    }
                  >
                    <div>
                      <strong>
                        {transaction.description}
                      </strong>

                      <small>
                        {dateText(
                          transaction.transaction_date
                        )}
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
                <Empty text="אין תנועות בחודש הזה." />
              )}
            </Panel>
          </div>
        </>
      )}

      {/* ===================================================
          EXPENSES
      =================================================== */}

      {tab === "expenses" && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>הוצאות</h2>
              <p>
                הוצאות בפועל בחודש הנבחר
              </p>
            </div>

            <button
              className="primary"
              onClick={() => openTx()}
            >
              ＋ הוצאה
            </button>
          </div>

          <TransactionList
            transactions={expenseTx}
            onOpen={setDetailsTx}
          />
        </section>
      )}

      {/* ===================================================
          FIXED
      =================================================== */}

      {tab === "fixed" && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>הוצאות קבועות</h2>

              <p>
                מתוכנן ובפועל. חיוב בפועל נכנס
                להוצאות רק לאחר סימון כחויב.
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
              value={money(plannedFixed)}
            />

            <Stat
              title="בפועל"
              value={money(fixedActual)}
              tone="negative"
            />

            <Stat
              title="ממתין"
              value={money(pendingPlanned)}
            />
          </div>

          <div className="fixed-list large">
            {recurring.map((item) => {
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
                      {categoryMap[
                        item.category_id
                      ] || "ללא קטגוריה"}{" "}
                      · יום{" "}
                      {item.day_of_month}
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
                          ? money(actual)
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
                          chargeRecurring(item)
                        }
                      >
                        סימון כחויבה
                      </button>
                    )}

                    <button
                      className="icon"
                      onClick={() =>
                        openRecurring(item)
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
            })}

            {!recurring.length && (
              <Empty text="עדיין לא הוגדרו הוצאות קבועות." />
            )}
          </div>
        </section>
      )}

      {/* ===================================================
          INCOME
      =================================================== */}

      {tab === "income" && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>הכנסות</h2>

              <p>
                הכנסות בפועל בחודש הנבחר
              </p>
            </div>

            <button
              className="primary"
              onClick={() =>
                openTx(null, "income")
              }
            >
              ＋ הכנסה
            </button>
          </div>

          <TransactionList
            transactions={incomeTx}
            onOpen={setDetailsTx}
          />
        </section>
      )}

      {/* ===================================================
          CREDIT IMPORT
      =================================================== */}

      {tab === "import" && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>יבוא עסקאות אשראי</h2>

              <p>
                העלאת קובץ מישראכרט או כאל
                והוספת העסקאות לחשבון המשפחתי.
              </p>
            </div>

            <button
              className="ghost"
              onClick={resetImport}
            >
              ניקוי
            </button>
          </div>

          <div className="import-info">
            <div>
              <strong>
                הכרטיסים שלך
              </strong>

              <span>
                ישראכרט: 2091 · 1710 · 4419
              </span>

              <span>
                כאל: 2109 · 2091
              </span>
            </div>

            <div>
              <strong>חשוב</strong>

              <span>
                בקובץ האשראי אנחנו משתמשים
                ב"סכום חיוב" כסכום בפועל.
              </span>
            </div>
          </div>

          <div className="import-upload">
            <label className="file-upload">
              <span>
                {importLoading
                  ? "קורא קובץ..."
                  : "📥 בחירת קובץ אשראי"}
              </span>

              <input
                type="file"
                accept=".csv,text/csv,.txt"
                onChange={handleCreditFile}
                disabled={importLoading}
              />
            </label>

            <div className="import-provider">
              <label>
                חברת אשראי

                <select
                  value={importProvider}
                  onChange={(e) =>
                    setImportProvider(
                      e.target.value
                    )
                  }
                >
                  <option value="">
                    זיהוי אוטומטי
                  </option>

                  <option value="isracard">
                    ישראכרט
                  </option>

                  <option value="cal">
                    כאל
                  </option>
                </select>
              </label>
            </div>
          </div>

          <div className="import-date-filter">
            <label>
              מתאריך

              <input
                type="date"
                value={importFromDate}
                onChange={(e) =>
                  setImportFromDate(
                    e.target.value
                  )
                }
              />
            </label>

            <label>
              עד תאריך

              <input
                type="date"
                value={importToDate}
                onChange={(e) =>
                  setImportToDate(
                    e.target.value
                  )
                }
              />
            </label>

            <button
              type="button"
              className="ghost small"
              onClick={() => {
                setImportFromDate("");
                setImportToDate("");
              }}
            >
              נקה סינון
            </button>
          </div>

          {importDateRangeError && (
            <div className="error">
              {importDateRangeError}
            </div>
          )}

          {importError && (
            <div className="error">
              {importError}
            </div>
          )}

          {importMessage && (
            <div className="success-message">
              {importMessage}
            </div>
          )}

          {filteredImportFileInfo && (
            <div className="import-summary">
              <Stat
                title="חברה"
                value={providerLabel(
                  filteredImportFileInfo.provider
                )}
              />

              <Stat
                title="כרטיס"
                value={
                  filteredImportFileInfo.cardLast4
                    ? `•••• ${filteredImportFileInfo.cardLast4}`
                    : "לא זוהה"
                }
              />

              <Stat
                title="עסקאות בטווח"
                value={String(
                  filteredImportFileInfo.total
                )}
              />

              <Stat
                title="כבר קיימות"
                value={String(
                  filteredImportFileInfo.duplicates
                )}
              />

              <Stat
                title="סכום בטווח"
                value={money(
                  filteredImportFileInfo.amount
                )}
              />
            </div>
          )}

          {filteredImportRows.length > 0 && (
            <>
              <div className="import-toolbar">
                <div>
                  <strong>
                    נבחרו{" "}
                    {selectedImportCount} עסקאות
                  </strong>

                  <span>
                    {" · "}
                    {money(
                      selectedImportAmount
                    )}
                  </span>
                </div>

                <div className="row-actions">
                  <button
                    className="ghost small"
                    onClick={
                      selectAllImportRows
                    }
                  >
                    בחירת חדשות
                  </button>

                  <button
                    className="ghost small"
                    onClick={
                      deselectAllImportRows
                    }
                  >
                    ביטול בחירה
                  </button>

                  <button
                    className="primary"
                    disabled={
                      importSaving ||
                      selectedImportCount ===
                        0 ||
                      !!importDateRangeError
                    }
                    onClick={
                      importSelectedTransactions
                    }
                  >
                    {importSaving
                      ? "מייבא..."
                      : `ייבוא ${selectedImportCount} עסקאות`}
                  </button>
                </div>
              </div>

              <div className="import-table-wrap">
                <table className="transactions-table import-table">
                  <thead>
                    <tr>
                      <th>✓</th>
                      <th>תאריך</th>
                      <th>בית עסק</th>
                      <th>סכום בפועל</th>
                      <th>קטגוריה</th>
                      <th>סוג</th>
                      <th>כרטיס</th>
                      <th>סטטוס</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredImportRows.map(
                      (row) => (
                        <tr
                          key={row.id}
                          className={
                            row.duplicate
                              ? "import-duplicate"
                              : ""
                          }
                        >
                          <td>
                            <input
                              type="checkbox"
                              checked={
                                !!importSelected[
                                  row.id
                                ] &&
                                !row.duplicate
                              }
                              disabled={
                                row.duplicate
                              }
                              onChange={() =>
                                toggleImportRow(
                                  row.id
                                )
                              }
                            />
                          </td>

                          <td>
                            {dateText(
                              row.transaction_date
                            )}
                          </td>

                          <td>
                            <strong>
                              {row.merchant}
                            </strong>
                          </td>

                          <td className="negative">
                            {money(
                              row.actual_amount
                            )}
                          </td>

                          <td>
                            <select
                              value={
                                row.category_id ||
                                ""
                              }
                              onChange={(e) =>
                                changeImportCategory(
                                  row.id,
                                  e.target.value
                                )
                              }
                              disabled={
                                row.duplicate
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
                          </td>

                          <td>
                            <select
                              value={
                                row.expense_type
                              }
                              onChange={(e) =>
                                changeImportType(
                                  row.id,
                                  e.target.value
                                )
                              }
                              disabled={
                                row.duplicate
                              }
                            >
                              <option value="variable">
                                משתנה
                              </option>

                              <option value="fixed">
                                קבועה
                              </option>
                            </select>
                          </td>

                          <td>
                            {providerLabel(
                              row.credit_card_provider
                            )}

                            <small className="table-sub">
                              {row.credit_card_last4
                                ? `•••• ${row.credit_card_last4}`
                                : ""}
                            </small>
                          </td>

                          <td>
                            {row.duplicate ? (
                              <span className="badge">
                                כבר קיים
                              </span>
                            ) : row.recurringCandidate ? (
                              <span className="badge fixed">
                                הוראת קבע
                              </span>
                            ) : (
                              <span className="badge variable">
                                חדש
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {importPreview.length > 0 &&
            filteredImportRows.length === 0 &&
            !importDateRangeError && (
              <Empty text="אין עסקאות בטווח התאריכים שנבחר." />
            )}

          {!importPreview.length &&
            !importLoading && (
              <Empty text="בחרי קובץ CSV של ישראכרט או כאל כדי לראות את העסקאות לפני הייבוא." />
            )}
        </section>
      )}

      {/* ===================================================
          CATEGORIES
      =================================================== */}

      {tab === "categories" && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>קטגוריות</h2>

              <p>
                ניתן להוסיף, לשנות ולמחוק קטגוריות.
              </p>
            </div>
          </div>

          <div className="category-add">
            <input
              value={newCategory}
              onChange={(e) =>
                setNewCategory(e.target.value)
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
            {categories.map((category) => (
              <div
                className="category-card"
                key={category.id}
              >
                {editingCategory?.id ===
                category.id ? (
                  <div className="category-edit">
                    <input
                      autoFocus
                      value={categoryNameForm}
                      onChange={(e) =>
                        setCategoryNameForm(
                          e.target.value
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          saveCategoryName();
                        }

                        if (e.key === "Escape") {
                          cancelEditCategory();
                        }
                      }}
                    />

                    <div className="row-actions">
                      <button
                        className="small primary"
                        onClick={
                          saveCategoryName
                        }
                        disabled={saving}
                      >
                        שמירה
                      </button>

                      <button
                        className="ghost small"
                        onClick={
                          cancelEditCategory
                        }
                      >
                        ביטול
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <strong>
                      {category.name}
                    </strong>

                    <div className="row-actions">
                      <button
                        className="icon"
                        title="שינוי שם"
                        onClick={() =>
                          startEditCategory(
                            category
                          )
                        }
                      >
                        ✎
                      </button>

                      <button
                        className="icon danger"
                        title="מחיקת קטגוריה"
                        onClick={() =>
                          setConfirm({
                            type: "category",
                            item: category,
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          {!categories.length && (
            <Empty text="עדיין אין קטגוריות." />
          )}
        </section>
      )}

      {/* ===================================================
          TRANSACTION DETAILS
      =================================================== */}

      {detailsTx && (
        <Modal
          title={
            detailsTx.kind === "income"
              ? "פרטי הכנסה"
              : "פרטי הוצאה"
          }
          onClose={() =>
            setDetailsTx(null)
          }
        >
          <div className="transaction-details">
            <div className="detail-main">
              <strong>
                {detailsTx.description}
              </strong>

              <span
                className={
                  detailsTx.kind ===
                  "income"
                    ? "positive"
                    : "negative"
                }
              >
                {detailsTx.kind ===
                "income"
                  ? "+"
                  : "-"}
                {money(
                  detailsTx.actual_amount
                )}
              </span>
            </div>

            <div className="details-grid">
              <Detail
                label="תאריך"
                value={dateText(
                  detailsTx.transaction_date
                )}
              />

              <Detail
                label="קטגוריה"
                value={
                  categoryMap[
                    detailsTx.category_id
                  ] || "ללא קטגוריה"
                }
              />

              {detailsTx.kind ===
                "expense" && (
                <Detail
                  label="סוג הוצאה"
                  value={
                    detailsTx.expense_type ===
                    "fixed"
                      ? "קבועה"
                      : "משתנה"
                  }
                />
              )}

              {detailsTx.kind ===
                "expense" &&
                detailsTx.expense_type ===
                  "fixed" && (
                  <Detail
                    label="סכום מתוכנן"
                    value={money(
                      detailsTx.planned_amount
                    )}
                  />
                )}

              <Detail
                label="מי"
                value={
                  memberMap[
                    detailsTx.person_user_id
                  ] || "לא צוין"
                }
              />

              <Detail
                label="בית עסק"
                value={
                  detailsTx.merchant ||
                  "לא צוין"
                }
              />

              <Detail
                label="אמצעי תשלום"
                value={paymentMethodLabel(
                  detailsTx.payment_method
                )}
              />

              {detailsTx.credit_card_provider && (
                <Detail
                  label="חברת אשראי"
                  value={providerLabel(
                    detailsTx.credit_card_provider
                  )}
                />
              )}

              {detailsTx.credit_card_last4 && (
                <Detail
                  label="כרטיס"
                  value={`•••• ${detailsTx.credit_card_last4}`}
                />
              )}
            </div>

            {detailsTx.note && (
              <div className="detail-note">
                <span>הערה</span>
                <p>
                  {detailsTx.note}
                </p>
              </div>
            )}

            <div className="modal-actions">
              <button
                className="ghost"
                onClick={() => {
                  setDetailsTx(null);

                  openTx(
                    detailsTx,
                    detailsTx.kind ===
                      "income"
                      ? "income"
                      : "expense"
                  );
                }}
              >
                ✎ עריכה
              </button>

              <button
                className="danger-button"
                onClick={() =>
                  setConfirm({
                    type: "tx",
                    item: detailsTx,
                  })
                }
              >
                🗑 מחיקה
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ===================================================
          TRANSACTION / RECURRING MODALS
      =================================================== */}

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
            <form
              className="form"
              onSubmit={saveRecurring}
            >
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
                  value={
                    recForm.category_id
                  }
                  onChange={(e) =>
                    setRecForm({
                      ...recForm,
                      category_id:
                        e.target.value,
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
                    onChange={(e) =>
                      setRecForm({
                        ...recForm,
                        planned_amount:
                          e.target.value,
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
                    onChange={(e) =>
                      setRecForm({
                        ...recForm,
                        day_of_month:
                          e.target.value,
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
                      merchant:
                        e.target.value,
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
                  onChange={(e) =>
                    setRecForm({
                      ...recForm,
                      payment_method:
                        e.target.value,
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
                  onChange={(e) =>
                    setRecForm({
                      ...recForm,
                      person_user_id:
                        e.target.value,
                    })
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

              {error && (
                <div className="error">
                  {error}
                </div>
              )}

              <div className="modal-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={closeModal}
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
                {modal === "income"
                  ? "מקור ההכנסה"
                  : "תיאור"}

                <input
                  value={
                    txForm.description
                  }
                  onChange={(e) =>
                    setTxForm({
                      ...txForm,
                      description:
                        e.target.value,
                    })
                  }
                />
              </label>

              {modal !== "income" && (
                <label>
                  סוג הוצאה

                  <select
                    value={
                      txForm.expense_type
                    }
                    onChange={(e) =>
                      setTxForm({
                        ...txForm,
                        expense_type:
                          e.target.value,
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
                  onChange={(e) =>
                    setTxForm({
                      ...txForm,
                      category_id:
                        e.target.value,
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

              {modal !== "income" &&
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
                      onChange={(e) =>
                        setTxForm({
                          ...txForm,
                          planned_amount:
                            e.target.value,
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
                  onChange={(e) =>
                    setTxForm({
                      ...txForm,
                      actual_amount:
                        e.target.value,
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
                    onChange={(e) =>
                      setTxForm({
                        ...txForm,
                        transaction_date:
                          e.target.value,
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
                    onChange={(e) =>
                      setTxForm({
                        ...txForm,
                        person_user_id:
                          e.target.value,
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
                    onChange={(e) =>
                      setTxForm({
                        ...txForm,
                        merchant:
                          e.target.value,
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
                    onChange={(e) =>
                      setTxForm({
                        ...txForm,
                        credit_card_last4:
                          e.target.value
                            .replace(
                              /\D/g,
                              ""
                            )
                            .slice(-4),
                      })
                    }
                  />
                </label>
              </div>

              <label>
                חברת אשראי

                <select
                  value={
                    txForm.credit_card_provider
                  }
                  onChange={(e) =>
                    setTxForm({
                      ...txForm,
                      credit_card_provider:
                        e.target.value,
                    })
                  }
                >
                  <option value="">
                    לא צוין
                  </option>

                  <option value="isracard">
                    ישראכרט
                  </option>

                  <option value="cal">
                    כאל
                  </option>
                </select>
              </label>

              <label>
                אמצעי תשלום

                <select
                  value={
                    txForm.payment_method
                  }
                  onChange={(e) =>
                    setTxForm({
                      ...txForm,
                      payment_method:
                        e.target.value,
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
                  value={txForm.note}
                  onChange={(e) =>
                    setTxForm({
                      ...txForm,
                      note: e.target.value,
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
                  onClick={closeModal}
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

      {/* ===================================================
          DELETE CONFIRM
      =================================================== */}

      {confirm && (
        <Modal
          title="אישור מחיקה"
          onClose={() =>
            setConfirm(null)
          }
        >
          <p>
            {confirm.type ===
            "category"
              ? `למחוק את הקטגוריה "${confirm.item.name}"?`
              : `למחוק את ${
                  confirm.item.name ||
                  confirm.item.description
                }?`}
          </p>

          {confirm.type ===
            "category" && (
            <p className="muted">
              אם הקטגוריה משויכת לתנועות,
              המחיקה לא תתבצע.
            </p>
          )}

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
              onClick={() => {
                if (
                  confirm.type ===
                  "tx"
                ) {
                  deleteTx(
                    confirm.item
                  );
                } else if (
                  confirm.type ===
                  "recurring"
                ) {
                  deleteRecurring(
                    confirm.item
                  );
                } else if (
                  confirm.type ===
                  "category"
                ) {
                  deleteCategory(
                    confirm.item
                  );
                }
              }}
            >
              כן, למחוק
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}

/* =========================================================
   COMPONENTS
========================================================= */

function Stat({
  title,
  value,
  subtitle,
  tone = "",
}) {
  return (
    <div className="stat">
      <span>{title}</span>

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
        <h2>{title}</h2>
      </div>

      {children}
    </section>
  );
}

function Empty({ text }) {
  return (
    <div className="empty">
      {text}
    </div>
  );
}

function Bars({ data }) {
  const max = Math.max(
    ...data.map((item) => item.value),
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
                  (item.value / max) * 100
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

/* =========================================================
   CLEAN TRANSACTION LIST
========================================================= */

function TransactionList({
  transactions,
  onOpen,
}) {
  return (
    <div className="transaction-list">
      {transactions.map((transaction) => (
        <button
          type="button"
          className="transaction-list-row"
          key={transaction.id}
          onClick={() =>
            onOpen(transaction)
          }
        >
          <span className="transaction-date">
            {dateText(
              transaction.transaction_date
            )}
          </span>

          <span className="transaction-description">
            {transaction.description}
          </span>

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
        </button>
      ))}

      {!transactions.length && (
        <Empty text="אין תנועות בחודש הזה." />
      )}
    </div>
  );
}

/* =========================================================
   DETAIL
========================================================= */

function Detail({
  label,
  value,
}) {
  return (
    <div className="detail-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/* =========================================================
   MODAL
========================================================= */

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
