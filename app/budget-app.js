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

const todayKey = () =>
  new Date().toISOString().slice(0, 10);

function Modal({ title, children, onClose }) {
  return (
    <div
      className="modalBackdrop"
      onMouseDown={onClose}
    >
      <div
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
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

  const [transactionKind, setTransactionKind] =
    useState("expense");

  const [editingTransaction, setEditingTransaction] =
    useState(null);

  const [editingRecurring, setEditingRecurring] =
    useState(null);

  const [chargingRecurring, setChargingRecurring] =
    useState(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  /*
   * ==========================================
   * DATA
   * ==========================================
   */

  async function loadData(userId) {
    setLoading(true);

    const { data: hm, error: hmError } =
      await supabase
        .from("household_members")
        .select("household_id, role")
        .eq("user_id", userId)
        .maybeSingle();

    if (hmError || !hm) {
      setLoading(false);
      return;
    }

    const { data: householdRows } =
      await supabase.rpc("get_my_household");

    const h = {
      data: householdRows?.[0]
        ? {
            id: householdRows[0].household_id,
            name: householdRows[0].household_name,
          }
        : null,
    };

    if (!h.data) {
      setLoading(false);
      return;
    }

    /*
     * חשוב:
     *
     * אין כאן יותר קריאה ל-
     * ensure_recurring_transactions.
     *
     * הוצאה קבועה אינה נוצרת כתנועה
     * עד שבאמת מסמנים אותה כחויבה.
     */

    const p = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    const [cats, tx, rec] =
      await Promise.all([
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

    const membersWithProfiles = (
      householdMembers || []
    ).map((member) => ({
      user_id: member.user_id,
      role: member.role,
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
    setMembers(membersWithProfiles);

    setLoading(false);
  }

  /*
   * טעינה ראשונית ואימות
   */

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);

      if (data.session?.user) {
        loadData(data.session.user.id);
      } else {
        setLoading(false);
      }
    });

    const { data: sub } =
      supabase.auth.onAuthStateChange(
        (_e, s) => {
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

  /*
   * כשעוברים חודש:
   * פשוט מרעננים את הנתונים.
   *
   * ההוצאות הקבועות עצמן קיימות
   * בכל חודש באופן אוטומטי דרך התבנית.
   */

  useEffect(() => {
    if (!session?.user?.id) {
      return;
    }

    loadData(session.user.id);
  }, [month]);

  async function refresh() {
    if (session?.user?.id) {
      await loadData(session.user.id);
    }
  }

  /*
   * ==========================================
   * AUTH
   * ==========================================
   */

  async function login(e) {
    e.preventDefault();
    setAuthError("");

    const { error } =
      await supabase.auth.signInWithPassword({
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
   * ==========================================
   * MONTH / CALCULATIONS
   * ==========================================
   */

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
      (t) => t.kind === "income"
    )
    .reduce(
      (s, t) =>
        s +
        Number(
          t.actual_amount ??
            t.planned_amount ??
            0
        ),
      0
    );

  const expenses = currentTx
    .filter(
      (t) => t.kind === "expense"
    )
    .reduce(
      (s, t) =>
        s +
        Number(
          t.actual_amount ??
            t.planned_amount ??
            0
        ),
      0
    );

  /*
   * הוצאות מתוכננות:
   *
   * כולל:
   * 1. תנועות רגילות
   * 2. תנועות קבועות שכבר חויבו
   * 3. הוצאות קבועות שעדיין ממתינות לחיוב
   *
   * לכן זו תחזית ולא הוצאה בפועל.
   */

  const recurringForMonth =
    useMemo(() => {
      return recurring.map((r) => {
        const chargedTransaction =
          transactions.find(
            (t) =>
              t.recurring_expense_id ===
                r.id &&
              t.recurring_month ===
                month
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
        (s, t) =>
          s +
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
        (s, r) =>
          s +
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
            "fixed"
      )
      .reduce(
        (s, t) =>
          s +
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
        (s, r) =>
          s +
          Number(
            r.planned_amount || 0
          ),
        0
      );

  const balance =
    income - expenses;

  /*
   * ==========================================
   * TRANSACTIONS
   * ==========================================
   */

  function openNewTransaction() {
    setEditingTransaction(null);
    setTransactionKind("expense");
    setModal("transaction");
  }

  function openEditTransaction(item) {
    setEditingTransaction(item);
    setTransactionKind(
      item.kind || "expense"
    );
    setModal("transaction");
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

    const ok = window.confirm(
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

  async function saveTransaction(e) {
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

    const f = new FormData(
      e.currentTarget
    );

    const kind = f.get("kind");

    const cardLast4Raw = String(
      f.get(
        "credit_card_last4"
      ) || ""
    )
      .replace(/\D/g, "")
      .slice(-4);

    const row = {
      household_id:
        household.id,

      kind,

      description:
        f.get("description"),

      category_id:
        f.get("category_id") ||
        null,

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

      /*
       * גם הכנסה יכולה להיות
       * קבועה או משתנה.
       */
      expense_type:
        f.get("expense_type") ||
        null,

      person_user_id:
        f.get(
          "person_user_id"
        ) || null,

      /*
       * לא מוחקים כרטיס קיים
       * כשעורכים הוצאה.
       */
      credit_card_last4:
        kind === "expense" &&
        cardLast4Raw.length ===
          4
          ? cardLast4Raw
          : null,

      note:
        f.get("note") || null,
    };

    let result;

    if (
      editingTransaction?.id
    ) {
      result = await supabase
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
      result = await supabase
        .from("transactions")
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

    setEditingTransaction(null);
    setModal(null);

    await refresh();
  }

  /*
   * ==========================================
   * RECURRING EXPENSES
   * ==========================================
   */

  function openNewRecurring() {
    setEditingRecurring(null);
    setModal("recurring");
  }

  function openEditRecurring(item) {
    setEditingRecurring(item);
    setModal("recurring");
  }

  async function saveRecurring(e) {
    e.preventDefault();

    if (!household?.id) {
      alert(
        "לא נמצא משק הבית."
      );
      return;
    }

    const f = new FormData(
      e.currentTarget
    );

    const row = {
      household_id:
        household.id,

      name:
        f.get("name"),

      category_id:
        f.get("category_id") ||
        null,

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
        f.get("note") || null,
    };

    let result;

    if (
      editingRecurring?.id
    ) {
      result = await supabase
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
      result = await supabase
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

    setEditingRecurring(null);
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

    const ok = window.confirm(
      `למחוק את ההוצאה הקבועה "${item.name}"?`
    );

    if (!ok) {
      return;
    }

    /*
     * Soft delete:
     * ההיסטוריה נשארת.
     * רק מפסיקים ליצור התחייבות
     * בחודשים עתידיים.
     */
    const { error } =
      await supabase
        .from(
          "recurring_expenses"
        )
        .update({
          is_active: false,
        })
        .eq(
          "id",
          item.id
        )
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

  /*
   * ==========================================
   * MARK RECURRING AS CHARGED
   * ==========================================
   */

  function openChargeRecurring(
    item
  ) {
    setChargingRecurring(item);
    setModal("chargeRecurring");
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

    const f = new FormData(
      e.currentTarget
    );

    const actualAmountRaw =
      f.get("actual_amount");

    const actualAmount =
      Number(actualAmountRaw || 0);

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
      f.get("transaction_date") ||
      todayKey();

    const cardLast4Raw = String(
      f.get(
        "credit_card_last4"
      ) || ""
    )
      .replace(/\D/g, "")
      .slice(-4);

    /*
     * יצירת התנועה רק עכשיו,
     * כאשר ידוע שהחיוב באמת קרה.
     */
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

      credit_card_last4:
        cardLast4Raw.length === 4
          ? cardLast4Raw
          : null,

      note:
        f.get("note") ||
        chargingRecurring.note ||
        null,

      created_by:
        session.user.id,

      /*
       * הקישור לתבנית הקבועה
       * ולחודש הספציפי.
       */
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
      /*
       * אם כבר קיימת תנועה
       * לאותו חיוב באותו חודש,
       * ה-UNIQUE INDEX יחסום כפילות.
       */
      alert(
        "לא הצלחתי לרשום את החיוב. " +
          error.message
      );
      return;
    }

    setChargingRecurring(null);
    setModal(null);

    await refresh();
  }

  /*
   * ==========================================
   * CATEGORIES
   * ==========================================
   */

  async function saveCategory(e) {
    e.preventDefault();

    if (!household?.id) {
      alert(
        "לא נמצא משק הבית."
      );
      return;
    }

    const f = new FormData(
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
  }

  /*
   * ==========================================
   * LOGIN
   * ==========================================
   */

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

  /*
   * ==========================================
   * APP
   * ==========================================
   */

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
          ["dashboard", "סקירה"],
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
        ].map(([id, label]) => (
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
        ))}
      </nav>

      <section className="content">

        {/*
         * ==================================
         * DASHBOARD
         * ==================================
         */}

        {tab === "dashboard" && (
          <>
            <div className="monthBar">
              <button
                type="button"
                onClick={() => {
                  const d =
                    new Date(
                      month + "-15"
                    );

                  d.setMonth(
                    d.getMonth() - 1
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
                  month + "-15"
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
                      month + "-15"
                    );

                  d.setMonth(
                    d.getMonth() + 1
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
                  {money(income)}
                </b>
              </div>

              <div className="card expense">
                <span>
                  הוצאות בפועל
                </span>

                <b>
                  {money(expenses)}
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
                  {money(balance)}
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
                  .length ===
                0 ? (
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
                            key={r.id}
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
                            </div>

                            <b>
                              {money(
                                r.chargedTransaction
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

        {/*
         * ==================================
         * TRANSACTIONS
         * ==================================
         */}

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
                  בפועל בחודש
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

                          {t.expense_type
                            ? " · " +
                              (t.expense_type ===
                              "fixed"
                                ? "קבועה"
                                : "משתנה")
                            : ""}

                          {t.credit_card_last4
                            ? " · כרטיס ••••" +
                              t.credit_card_last4
                            : ""}

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

        {/*
         * ==================================
         * FIXED EXPENSES
         * ==================================
         */}

        {tab === "fixed" && (
          <div className="panel">
            <div className="panelHead">
              <div>
                <h2>
                  הוצאות קבועות
                </h2>

                <small className="muted">
                  {new Date(
                    month + "-15"
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
                        key={r.id}
                      >
                        <div>
                          <b>
                            {r.name}
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

        {/*
         * ==================================
         * CATEGORIES
         * ==================================
         */}

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

      {/*
       * ==================================
       * TRANSACTION MODAL
       * ==================================
       */}

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
                defaultValue={
                  editingTransaction
                    ?.description ||
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
                  editingTransaction
                    ?.category_id ||
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
                  .map(
                    (c) => (
                      <option
                        key={c.id}
                        value={c.id}
                      >
                        {c.name}
                      </option>
                    )
                  )}
              </select>
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
                  ""
                }
              />
            </label>

            <label>
              סוג תנועה

              <select
                name="expense_type"
                defaultValue={
                  editingTransaction
                    ?.expense_type ||
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

            {transactionKind ===
              "expense" && (
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
                      value={m.user_id}
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
                    : true
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

      {/*
       * ==================================
       * RECURRING TEMPLATE MODAL
       * ==================================
       */}

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
                        key={c.id}
                        value={c.id}
                      >
                        {c.name}
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
                      key={m.user_id}
                      value={m.user_id}
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

      {/*
       * ==================================
       * CHARGE RECURRING MODAL
       * ==================================
       */}

      {modal ===
        "chargeRecurring" &&
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
              <div className="panel">
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
              </div>

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

      {/*
       * ==================================
       * CATEGORY MODAL
       * ==================================
       */}

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
