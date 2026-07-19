// MatchCall — tiny helpers for JSON API route handlers.
import { NextResponse } from "next/server";

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

export function fail(error: unknown, status = 400): NextResponse {
  return NextResponse.json({ error: errorMessage(error) }, { status });
}
