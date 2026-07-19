// MatchCall — prediction_escrow integration tests (live devnet).
//
// These run against the ALREADY-DEPLOYED devnet program
//   DuB3yJQMPWCESJoEzShBWt1Jc3Q6j6DXLyi1XpAB6EQ2
// using the funded deployer keypair (.keys/deployer.json) as a throwaway
// player. Nothing here builds or redeploys the program (anchor build is broken
// by an edition2024 toolchain issue) — they are pure @solana/web3.js client
// tests, the same code path the app/keeper use in production.
//
// What is covered:
//   * config PDA is initialized and decodes (admin, stake_mint == mUSDC)
//   * create_market (MATCH_WINNER) — Market decodes, escrow is the market ATA
//   * place_prediction — Position decodes, escrow token balance increases
//   * negative guards:
//       - settle_market before lock              -> MarketStillOpen
//       - place_prediction after lock            -> MarketLocked
//       - settle_market with wrong TxLINE program-> InvalidTxlineProgram
//
// NOT covered here (documented in tests/README.md): the full settle_market
// happy path. That requires a REAL TxLINE `game_finalised` Merkle proof, which
// only exists after a fixture actually finishes and TxLINE anchors its daily
// roots on-chain. It is exercised by the keeper / live demo, not by unit tests.
//
// Idempotent: every market uses a unique seed derived from a per-run timestamp,
// so re-running never collides with a previously created market/position PDA.
import { expect } from "chai";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  MARKET_MATCH_WINNER,
  MUSDC_MINT,
  MUSDC_UNIT,
  airdropMusdc,
  configPda,
  connection,
  createMarketIx,
  decodeConfig,
  decodeMarket,
  decodePosition,
  deployerKeypair,
  escrowBalance,
  expectTxError,
  marketEscrow,
  marketPda,
  marketSeed,
  placePredictionIxs,
  positionPda,
  sendTx,
  settleMarketIx,
  waitForChainTime,
} from "./onchain";

// A unique tag for this run so every derived PDA is fresh (idempotent re-runs).
const RUN = `test-${Date.now()}`;

describe("prediction_escrow (devnet, deployed program)", function () {
  // On-chain confirmations + a short lock wait; give Mocha generous headroom.
  this.timeout(600_000);

  const conn: Connection = connection();
  let deployer: Keypair;

  before(function () {
    deployer = deployerKeypair();
  });

  it("config PDA is initialized and decodes (admin, stake_mint == mUSDC)", async function () {
    const cfg = configPda();
    const info = await conn.getAccountInfo(cfg, "confirmed");
    expect(info, "config account should already exist on devnet").to.not.be.null;
    const decoded = decodeConfig(info!.data);
    expect(decoded.stakeMint.toBase58()).to.equal(MUSDC_MINT.toBase58());
    // admin is a valid pubkey; on this deployment it is the deployer authority.
    expect(decoded.admin).to.be.instanceOf(PublicKey);
    expect(decoded.paused).to.equal(false);
  });

  // ----- Long-lock market: used for create + place + settle-before-lock -----
  const seedA = marketSeed(`${RUN}-A`);
  const marketA = marketPda(seedA);
  const fixtureIdA = 900000 + (Date.now() % 90000);
  const lockAtA = Math.floor(Date.now() / 1000) + 3600; // 1h in the future

  it("create_market: creates a MATCH_WINNER market that decodes correctly", async function () {
    const ix = createMarketIx({
      creator: deployer.publicKey,
      seed: seedA,
      txlineFixtureId: fixtureIdA,
      participant1IsHome: true,
      marketType: MARKET_MATCH_WINNER,
      lineParam: 0,
      lockAt: lockAtA,
    });
    await sendTx(conn, [ix], deployer);

    const info = await conn.getAccountInfo(marketA, "confirmed");
    expect(info, "market account should exist after create_market").to.not.be.null;
    const m = decodeMarket(info!.data);
    expect(m.status).to.equal("OPEN");
    expect(m.marketType).to.equal(MARKET_MATCH_WINNER);
    expect(m.numOutcomes).to.equal(3);
    expect(Number(m.txlineFixtureId)).to.equal(fixtureIdA);
    expect(Number(m.lockAt)).to.equal(lockAtA);
    expect(m.participant1IsHome).to.equal(true);
    expect(m.stakeMint.toBase58()).to.equal(MUSDC_MINT.toBase58());
    // escrow stored on the market must be the market PDA's mUSDC ATA.
    expect(m.escrow.toBase58()).to.equal(marketEscrow(marketA).toBase58());
    expect(m.outcomeStakes.every((s) => s === 0n)).to.equal(true);
  });

  it("place_prediction: stakes on an outcome; Position decodes and escrow balance increases", async function () {
    const outcome = 0; // Home
    const stakeHuman = 5;
    const stakeBase = BigInt(stakeHuman) * MUSDC_UNIT;

    // Ensure the player holds enough mUSDC (deployer is the mint authority).
    // Reuses the same faucet path as app/lib/onchain/musdc.ts airdropMusdc.
    await airdropMusdc(conn, deployer, deployer.publicKey, stakeHuman + 10);

    const before = await escrowBalance(conn, marketA); // fresh market -> 0
    await sendTx(
      conn,
      placePredictionIxs({
        user: deployer.publicKey,
        market: marketA,
        outcome,
        amountBase: stakeBase,
      }),
      deployer
    );

    const position = positionPda(marketA, deployer.publicKey, outcome);
    const info = await conn.getAccountInfo(position, "confirmed");
    expect(info, "position account should exist after place_prediction").to.not.be.null;
    const p = decodePosition(info!.data);
    expect(p.market.toBase58()).to.equal(marketA.toBase58());
    expect(p.user.toBase58()).to.equal(deployer.publicKey.toBase58());
    expect(p.outcome).to.equal(outcome);
    expect(p.amount).to.equal(stakeBase);
    expect(p.claimed).to.equal(false);

    const after = await escrowBalance(conn, marketA);
    expect(after - before).to.equal(stakeBase);

    // The market's pool + per-outcome stake reflect the deposit too.
    const m = decodeMarket((await conn.getAccountInfo(marketA, "confirmed"))!.data);
    expect(m.totalPool).to.equal(stakeBase);
    expect(m.outcomeStakes[outcome]).to.equal(stakeBase);
  });

  it("negative: settle_market before lock reverts with MarketStillOpen", async function () {
    // marketA locks 1h out, so settlement must refuse. The lock check runs
    // before any TxLINE-account check, so bogus accounts are fine here.
    const logs = await expectTxError(
      conn,
      [
        settleMarketIx({
          cranker: deployer.publicKey,
          market: marketA,
          txlineProgram: SystemProgram.programId, // irrelevant; reverts earlier
          rootsAccount: SystemProgram.programId,
        }),
      ],
      deployer
    );
    expect(logs).to.contain("MarketStillOpen");
  });

  // ----- Short-lock market: used for the after-lock negative guards -----
  const seedB = marketSeed(`${RUN}-B`);
  const marketB = marketPda(seedB);
  const fixtureIdB = 800000 + (Date.now() % 80000);
  // Lock ~12s out, then wait for the chain clock to pass it.
  const lockAtB = Math.floor(Date.now() / 1000) + 12;

  before(async function () {
    // Create the short-lock market and wait until its lock has passed on-chain,
    // so the after-lock negative tests below are meaningful.
    this.timeout(180_000);
    const dep = deployerKeypair();
    await sendTx(
      conn,
      [
        createMarketIx({
          creator: dep.publicKey,
          seed: seedB,
          txlineFixtureId: fixtureIdB,
          participant1IsHome: true,
          marketType: MARKET_MATCH_WINNER,
          lineParam: 0,
          lockAt: lockAtB,
        }),
      ],
      dep
    );
    await waitForChainTime(conn, lockAtB + 2);
  });

  it("negative: place_prediction after lock reverts with MarketLocked", async function () {
    const logs = await expectTxError(
      conn,
      placePredictionIxs({
        user: deployer.publicKey,
        market: marketB,
        outcome: 0,
        amountBase: 1n * MUSDC_UNIT,
      }),
      deployer
    );
    expect(logs).to.contain("MarketLocked");
  });

  it("negative: settle_market with the wrong TxLINE program reverts with InvalidTxlineProgram", async function () {
    // marketB is now past its lock, so settlement passes the lock check and
    // reaches the TxLINE-program identity check — which must reject a bogus one.
    const bogusTxline = Keypair.generate().publicKey;
    const logs = await expectTxError(
      conn,
      [
        settleMarketIx({
          cranker: deployer.publicKey,
          market: marketB,
          txlineProgram: bogusTxline,
          rootsAccount: SystemProgram.programId,
        }),
      ],
      deployer
    );
    expect(logs).to.contain("InvalidTxlineProgram");
  });
});
