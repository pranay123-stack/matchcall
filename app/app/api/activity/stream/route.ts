import { onActivity, recentActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-Sent Events: recent backlog, then live events as they happen.
export async function GET(request: Request) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      // backlog (oldest first so the client appends in order)
      for (const a of recentActivity(20).reverse()) send(a);

      const unsub = onActivity(send);
      const keepAlive = setInterval(() => controller.enqueue(encoder.encode(`: ka\n\n`)), 15000);

      const close = () => {
        clearInterval(keepAlive);
        unsub();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
