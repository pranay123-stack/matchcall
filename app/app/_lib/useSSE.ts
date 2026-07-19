"use client";

import { useEffect, useRef, useState } from "react";

export type SSEStatus = "connecting" | "open" | "error" | "idle";

/**
 * Subscribe to an EventSource endpoint. Parses each message as JSON and calls
 * onMessage. Auto-reconnects via native EventSource behaviour; exposes status
 * and the last received (parsed) payload.
 */
export function useSSE<T = unknown>(
  url: string | null,
  onMessage?: (data: T) => void,
): { status: SSEStatus; last: T | null } {
  const [status, setStatus] = useState<SSEStatus>(url ? "connecting" : "idle");
  const [last, setLast] = useState<T | null>(null);
  const cbRef = useRef(onMessage);
  cbRef.current = onMessage;

  useEffect(() => {
    if (!url) {
      setStatus("idle");
      return;
    }
    setStatus("connecting");
    let es: EventSource | null = null;
    try {
      es = new EventSource(url);
    } catch {
      setStatus("error");
      return;
    }
    es.onopen = () => setStatus("open");
    es.onmessage = (ev: MessageEvent) => {
      if (!ev.data) return;
      try {
        const parsed = JSON.parse(ev.data) as T;
        setLast(parsed);
        cbRef.current?.(parsed);
      } catch {
        // ignore keep-alive / non-JSON frames
      }
    };
    es.onerror = () => setStatus((s) => (s === "open" ? "open" : "error"));
    return () => es?.close();
  }, [url]);

  return { status, last };
}
