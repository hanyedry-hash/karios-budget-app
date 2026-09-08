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
          <button className="iconBtn" onClick={onClose}>×</button>
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
      alert("שגיאה בטעינת המשפחה: " + hmError.message);
      setLoading(false);
      return;
    }

    if (!hm) {
      alert("המשתמש לא משויך למשפחה.");
      setLoading(false);
      return;
    }

    const { data: h, error: hError } = await supabase
      .from("households")
      .select("*")
      .eq("id", hm.household_id)
      .single();

    if (hError) {
      alert("שגיאה בטעינת המשפחה: " + hError.message);
      setLoading(false);
      return;
    }

    const { data: p, error: pError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (pError) {
      alert("שגיאה בטעינת הפרופיל: " + pError.message);
    }

    const { data: cats, error: catsError } = await supabase
      .from("categories")
      .select("*")
      .eq("household_id", hm.household_id)
      .eq("is_active", true)
      .order("name");

    if (catsError) {
      alert("שגיאה בטעינת הקטגוריות: " + catsError.message);
    }

    const { data: tx, error: txError } = await supabase
      .from("transactions")
      .select("*")
      .eq("household_id", hm.household_id)
      .order("transaction_date", { ascending: false });

    if (txError) {
      alert("שגיאה בטעינת התנועות: " + txError.message);
    }

    const { data: rec, error: recError } = await supabase
      .from("recurring_expenses")
      .select("*")
      .eq("household_id", hm.household_id)
      .eq("is_active", true)
      .order("day_of_month");

    if (recError) {
      alert("שגיאה בטעינת ההוצאות הקבועות: " + recError.message);
    }

    const { data: mem, error: memError } = await supabase
      .from("household_members")
      .select("user_id, role")
      .eq("household_id", hm.household_id);

    if (memError) {
      alert("שגיאה בטעינת בני המשפחה: " + memError.message);
    }

    const { data: profs, error: profsError } = await supabase
      .from("profiles")
      .select("id, display_name");

    if (profsError) {
      alert("שגיאה בטעינת שמות בני המשפחה: " + profsError.message);
    }

    const membersWithProfiles = (mem || []).map((m) => ({
      ...
