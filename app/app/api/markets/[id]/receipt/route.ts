import { json, fail } from "@/lib/http";
import { getMarket } from "@/lib/db";
import { marketTypeName, outcomeLabels } from "@/lib/onchain/program";
import { parseTxlineScoreProof } from "@/lib/txline/proof";
import type { TxlineProofNode } from "@/lib/onchain/program";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function nodesToHex(nodes: TxlineProofNode[]) {
  return nodes.map((n) => ({ hash: `0x${n.hash.toString("hex")}`, isRightSibling: n.isRightSibling }));
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const row = getMarket(decodeURIComponent(params.id));
    if (!row) return json({ error: "Market not found" }, 404);
    if (row.status !== "SETTLED" || !row.proofJson || !row.settleSignature) {
      // No settlement yet — SPEC allows returning null.
      return json(null);
    }

    const rawProof = JSON.parse(row.proofJson) as unknown;
    const payload = parseTxlineScoreProof(rawProof);

    const winningOutcome = row.winningOutcome ?? -1;
    const label =
      winningOutcome >= 0 ? outcomeLabels(row.marketType)[winningOutcome] ?? `#${winningOutcome}` : "n/a";
    const home = row.finalHomeGoals ?? 0;
    const away = row.finalAwayGoals ?? 0;
    const type = marketTypeName(row.marketType);

    const explanation =
      `TxLINE cryptographically proved the final score was ${home}-${away} for fixture ${row.fixtureId}. ` +
      `Each total-goal stat (participant 1 and participant 2) was verified against TxLINE's on-chain ` +
      `event-stat Merkle root ${`0x${payload.eventStatRoot.toString("hex")}`} via a Merkle proof, then anchored ` +
      `up through the sub-tree and main-tree roots the TxLINE program published for that day. Because the ` +
      `prediction_escrow program derived the winning ${type} outcome ("${label}") directly from those proven ` +
      `leaves — not from any operator input — settlement transaction ${row.settleSignature} is trustless: ` +
      `anyone can re-verify the proof against TxLINE's Solana state.`;

    return json({
      settlement: {
        signature: row.settleSignature,
        finalHomeGoals: home,
        finalAwayGoals: away,
        winningOutcome,
      },
      proof: {
        root: `0x${payload.eventStatRoot.toString("hex")}`,
        eventsSubTreeRoot: `0x${payload.fixtureSummary.eventsSubTreeRoot.toString("hex")}`,
        fixtureId: payload.fixtureSummary.fixtureId.toString(),
        ts: payload.ts.toString(),
        stats: payload.stats.map((leaf) => ({
          key: leaf.stat.key,
          value: leaf.stat.value,
          period: leaf.stat.period,
        })),
        statProofs: payload.stats.map((leaf) => nodesToHex(leaf.statProof)),
        subTreeProof: nodesToHex(payload.fixtureProof),
        mainTreeProof: nodesToHex(payload.mainTreeProof),
      },
      explanation,
    });
  } catch (error) {
    return fail(error, 500);
  }
}
