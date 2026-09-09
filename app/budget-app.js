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

    if (hmError) {
      console.error("household_members error:", hmError);
    }

    if (!hm) {
      setLoading(false);
      return;
    }

    const h = await supabase
      .from("households")
      .select("*")
      .eq("id", hm.household_id)
      .single();

    const p = await supabase
      .from("profiles")
      .select("id, display_name")
      .eq("id", userId)
      .single();

    const [cats, tx, rec] = await Promise.all([
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
        .order("transaction_date", {
          ascending: false,
        }),

      supabase
        .from("recurring_expenses")
        .select("*")
        .eq("household_id", hm.household_id)
        .eq("is_active", true)
        .order("day_of_month"),
    ]);

    /*
      Load household members through the
      SECURITY DEFINER function in Supabase.
      This avoids relying on the profiles RLS
      relationship from the browser.
    */
    const {
      data: householdMembers,
      error: membersError,
    } = await supabase.rpc(
      "get_my_household_members"
    );

    if (membersError) {
      console.error(
        "get_my_household_members error:",
        membersError
      );
    }

    const membersWithProfiles = (
      householdMembers || []
    ).map((member) => ({
      user_id: member.user_id,
      role: member.role,
      profiles: {
        display_name:
          member.display_name || "משתמש",
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
      supabase.auth.onAuthStateChange((_e, s) => {
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

    return () => sub.subscription.unsubscribe();
  }, []);

  async function login(e) {
    e.preventDefault();
    setAuthError("");

    const { error } =
      await supabase.auth.signInWithPassword({
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
        String(
          t.transaction_date || ""
        ).startsWith(month)
      ),
    [transactions, month]
  );

  const income = currentTx
    .filter((t) => t.kind === "income")
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
    .filter((t) => t.kind === "expense")
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

  const plannedExpenses = currentTx
    .filter((t) => t.kind === "expense")
    .reduce(
      (s, t) =>
        s + Number(t.planned_amount || 0),
      0
    );

  const fixedExpenses = currentTx
    .filter(
      (t) =>
        t.kind === "expense" &&
        t.expense_type === "fixed"
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

  const balance = income - expenses;

  async function refresh() {
    if (session?.user) {
      await loadData(session.user.id);
    }
  }

  async function saveTransaction(e) {
    e.preventDefault();

    const f = new FormData(e.currentTarget);
    const kind = f.get("kind");

    const row = {
      household_id: household.id,
      kind,
      description: f.get("description"),
      category_id:
        f.get("category_id") || null,
      transaction_date:
        f.get("transaction_date"),
      planned_amount: Number(
        f.get("planned_amount") || 0
      ),
      completed:
        f.get("completed") === "on",
      actual_amount: f.get(
        "actual_amount"
      )
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

    const { error } = await supabase
      .from("transactions")
      .insert(row);

    if (error) {
      alert(
        "לא הצלחתי לשמור. " +
          error.message
      );
    } else {
      setModal(null);
      await refresh();
    }
  }

  async function saveRecurring(e) {
    e.preventDefault();

    const f = new FormData(e.currentTarget);

    const row = {
      household_id: household.id,
      name: f.get("name"),
      category_id:
        f.get("category_id") || null,
      planned_amount: Number(
        f.get("planned_amount") || 0
      ),
      day_of_month: Number(
