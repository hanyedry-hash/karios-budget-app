"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const money = (n) =>
  new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0
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

    const { data: hm } = await supabase
      .from("household_members")
      .select("household_id, role")
      .eq("user_id", userId)
      .maybeSingle();

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
      .select("*")
      .eq("id", userId)
      .single();

    const [cats, tx, rec, mem] = await Promise.all([
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

      supabase
        .from("household_members")
        .select("user_id, role")
        .eq("household_id", hm.household_id)
    ]);

    const memberRows = mem.data || [];
    const userIds = memberRows.map((m) => m.user_id);

    const { data: profs } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);

    const profilesById = Object.fromEntries(
      (profs || []).map((profile) => [profile.id, profile])
    );

    const membersWithProfiles = memberRows.map((member) => ({
      ...member,
      profiles: profilesById[member.user_id] || null
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

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      set
