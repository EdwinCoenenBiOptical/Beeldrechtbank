"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserClient } from "../supabase/browser";
import { supabaseConfig } from "../supabase/config";
import { readApiResponse } from "../http/api-response.mjs";
type Access = {
  phase: "loading" | "guest" | "restricted" | "approved" | "error";
  message?: string;
};
export function usePortalAccess() {
  const [access, setAccess] = useState<Access>({ phase: "loading" }),
    generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const response = await fetch("/api/access", { cache: "no-store" }),
        data = await readApiResponse(response);
      if (current !== generation.current) return;
      if (response.status === 401) {
        setAccess({ phase: "guest" });
        return;
      }
      if (!response.ok)
        throw Error(data.error || "Je toegang kon niet worden gecontroleerd.");
      setAccess({ phase: data.approved === true ? "approved" : "restricted" });
    } catch (error) {
      if (current === generation.current)
        setAccess({
          phase: "error",
          message:
            error instanceof Error
              ? error.message
              : "De accountdienst is tijdelijk niet bereikbaar.",
        });
    }
  }, []);
  useEffect(() => {
    void refresh();
    const subscription = supabaseConfig()
      ? browserClient().auth.onAuthStateChange((event) => {
          if (
            event === "SIGNED_IN" ||
            event === "SIGNED_OUT" ||
            event === "TOKEN_REFRESHED"
          )
            void refresh();
        }).data.subscription
      : null;
    const check = () => void refresh();
    window.addEventListener("focus", check);
    window.addEventListener("portal-session-changed", check);
    return () => {
      generation.current++;
      subscription?.unsubscribe();
      window.removeEventListener("focus", check);
      window.removeEventListener("portal-session-changed", check);
    };
  }, [refresh]);
  return { access, refresh };
}
