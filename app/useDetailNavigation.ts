"use client";

import { useEffect, useRef } from "react";

/** A same-document entry lets Safari's native Back gesture dismiss details.
 * Only a UI marker enters browser history, never statement or holding data. */
export function useDetailNavigation(onDismiss: () => void) {
  const active = useRef(false);
  const dismiss = useRef(onDismiss);
  useEffect(() => { dismiss.current = onDismiss; }, [onDismiss]);
  useEffect(() => {
    const back = () => { active.current = false; dismiss.current(); };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  return {
    open: () => {
      if (active.current) return;
      window.history.pushState({ ...window.history.state, folioVistaDetails: true }, "", window.location.href);
      active.current = true;
    },
    close: () => {
      if (active.current) { active.current = false; window.history.back(); }
      else dismiss.current();
    },
  };
}
