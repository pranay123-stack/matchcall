import { txlineClient } from "@/lib/txline/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SSE proxy for TxLINE live odds / implied probability. Credentials stay inside
// TxlineClient and are never exposed to the browser.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const fixtureId = decodeURIComponent(params.id);
  const upstreamAbort = new AbortController();
  request.signal.addEventListener("abort", () => upstreamAbort.abort());

  let upstream: Response;
  try {
    upstream = await txlineClient.openOddsStream(fixtureId, upstreamAbort.signal);
  } catch (error) {
    return new Response(
      `event: error\ndata: ${JSON.stringify({
        error: error instanceof Error ? error.message : "TxLINE odds stream unavailable",
      })}\n\n`,
      { status: 200, headers: sseHeaders() }
    );
  }

  const body = upstream.body!;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } catch {
        // upstream ended or aborted
      } finally {
        controller.close();
      }
    },
    cancel() {
      upstreamAbort.abort();
    },
  });

  return new Response(stream, { status: 200, headers: sseHeaders() });
}

function sseHeaders(): HeadersInit {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  };
}
