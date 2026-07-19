function ts(): string {
  return new Date().toISOString();
}

function line(level: string, scope: string, msg: string): string {
  return `${ts()} [${level}] [${scope}] ${msg}`;
}

export function makeLogger(scope: string) {
  return {
    info: (msg: string) => console.log(line("INFO", scope, msg)),
    warn: (msg: string) => console.warn(line("WARN", scope, msg)),
    error: (msg: string, err?: unknown) =>
      console.error(line("ERROR", scope, msg) + (err ? ` :: ${errText(err)}` : "")),
    decision: (msg: string) => console.log(line("SETTLE", scope, msg))
  };
}

export function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
