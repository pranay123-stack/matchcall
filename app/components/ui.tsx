import Link from "next/link";
import type { ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Card({
  children,
  className,
  hover,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return (
    <div className={cx("glass", hover && "glass-hover", "p-4 sm:p-5", className)}>{children}</div>
  );
}

export function SectionTitle({
  children,
  right,
  id,
}: {
  children: ReactNode;
  right?: ReactNode;
  id?: string;
}) {
  return (
    <div id={id} className="mb-3 flex items-end justify-between gap-3 scroll-mt-20">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-white/60">{children}</h2>
      {right}
    </div>
  );
}

export function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-red-400 ring-1 ring-red-500/30">
      <span className="live-dot" /> Live
    </span>
  );
}

const STATUS_STYLE: Record<string, string> = {
  OPEN: "bg-neon/15 text-neon ring-neon/30",
  LOCKED: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  SETTLED: "bg-gold/15 text-gold ring-gold/30",
  REFUNDING: "bg-amber-500/15 text-amber-400 ring-amber-500/30",
};

export function StatusPill({ status }: { status: string }) {
  const style = STATUS_STYLE[status] ?? "bg-white/10 text-white/70 ring-white/20";
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1",
        style,
      )}
    >
      {status.toLowerCase()}
    </span>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  type = "button",
  variant = "primary",
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  variant?: "primary" | "ghost" | "outline" | "gold";
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
  const variants: Record<string, string> = {
    primary: "bg-neon-600 text-pitch-950 hover:bg-neon",
    gold: "bg-gold text-pitch-950 hover:brightness-110",
    outline: "border border-neon/40 text-neon hover:bg-neon/10",
    ghost: "text-white/70 hover:bg-white/5 hover:text-white",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(base, variants[variant], className)}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
      aria-label="loading"
    />
  );
}

export function StatePanel({
  kind,
  title,
  detail,
  action,
}: {
  kind: "loading" | "empty" | "error";
  title: string;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  const icon = kind === "loading" ? <Spinner className="text-neon" /> : kind === "error" ? "⚠️" : "◎";
  return (
    <div className="glass flex flex-col items-center gap-2 p-8 text-center">
      <div className="text-2xl">{icon}</div>
      <div className="font-semibold text-white/80">{title}</div>
      {detail ? <div className="max-w-md text-sm text-white/50">{detail}</div> : null}
      {action}
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm text-white/50 transition hover:text-neon"
    >
      <span aria-hidden>←</span> {children}
    </Link>
  );
}

/** A labelled proportional bar (used for pools + implied probability). */
export function MeterBar({
  label,
  rightLabel,
  fraction,
  color = "neon",
  active,
}: {
  label: ReactNode;
  rightLabel?: ReactNode;
  fraction: number; // 0..1
  color?: "neon" | "gold" | "sky" | "violet";
  active?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0)) * 100;
  const fill: Record<string, string> = {
    neon: "bg-neon",
    gold: "bg-gold",
    sky: "bg-sky-400",
    violet: "bg-violet-400",
  };
  return (
    <div className={cx("rounded-lg p-2", active && "ring-1 ring-neon/40")}>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-medium text-white/85">{label}</span>
        <span className="tabular-nums text-white/60">{rightLabel}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/8">
        <div
          className={cx("h-full rounded-full transition-all duration-500", fill[color])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
