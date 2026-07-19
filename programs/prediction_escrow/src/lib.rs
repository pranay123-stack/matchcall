// MatchCall — prediction_escrow
//
// A trustlessly-settled prediction market for World Cup fixtures. Stakes are
// held in a market-owned SPL token escrow (mUSDC, a devnet test token — never
// the restricted TxL token). Markets settle by CPI-ing into TxLINE's on-chain
// `validate_stat_v2` instruction, which cryptographically verifies the final
// score against the Merkle root TxLINE anchors on Solana. Settlement is
// therefore PERMISSIONLESS: anyone (our keeper) can settle a market by
// supplying a valid TxLINE proof — no trusted oracle signer is involved.
//
// Anchor expands compatibility cfgs the host-side check-cfg lint does not know.
#![allow(deprecated, unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{get_return_data, invoke},
    pubkey,
};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("DuB3yJQMPWCESJoEzShBWt1Jc3Q6j6DXLyi1XpAB6EQ2");

/// TxLINE's documented devnet program. Verified against the on-chain program at
/// CPI time; a mainnet build must swap this for the reviewed mainnet address.
pub const TXLINE_DEVNET_PROGRAM_ID: Pubkey =
    pubkey!("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");

/// Upper bound on outcome buckets a single market may hold. Keeps `Market` a
/// fixed, small allocation (BPF has a 4 KB stack limit for account validation).
pub const MAX_OUTCOMES: usize = 8;

// Market type tags (stored as u8 in the account).
pub const MARKET_MATCH_WINNER: u8 = 0; // outcomes: 0=Home, 1=Draw, 2=Away
pub const MARKET_TOTALS: u8 = 1; // outcomes: 0=Over, 1=Under  (line_param = line * 2, odd)
pub const MARKET_BTTS: u8 = 2; // outcomes: 0=Yes, 1=No  (both teams to score)

#[program]
pub mod prediction_escrow {
    use super::*;

    /// One-time platform configuration. `stake_mint` is the devnet mUSDC test
    /// token every market escrows. `admin` may only pause new markets.
    pub fn initialize_config(ctx: Context<InitializeConfig>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.stake_mint = ctx.accounts.stake_mint.key();
        config.paused = false;
        config.market_count = 0;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn set_paused(ctx: Context<AdminConfig>, paused: bool) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.config.admin,
            EscrowError::Unauthorized
        );
        ctx.accounts.config.paused = paused;
        Ok(())
    }

    /// Anyone may create a market for a real TxLINE fixture. Settlement is
    /// proof-gated, so permissionless creation is safe: a market can only ever
    /// resolve to the outcome TxLINE cryptographically proves.
    pub fn create_market(
        ctx: Context<CreateMarket>,
        market_seed: [u8; 32],
        txline_fixture_id: i64,
        participant1_is_home: bool,
        market_type: u8,
        line_param: i32,
        lock_at: i64,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, EscrowError::Paused);
        require!(txline_fixture_id > 0, EscrowError::InvalidFixture);
        require!(
            lock_at > Clock::get()?.unix_timestamp,
            EscrowError::InvalidLockTime
        );

        let num_outcomes: u8 = match market_type {
            MARKET_MATCH_WINNER => 3,
            MARKET_TOTALS => {
                // Half-goal lines only (odd line_param) so a total can never
                // tie the line — every market has a definite Over/Under winner.
                require!(
                    line_param > 0 && line_param % 2 == 1,
                    EscrowError::InvalidMarketParams
                );
                2
            }
            MARKET_BTTS => 2,
            _ => return err!(EscrowError::InvalidMarketType),
        };

        let market = &mut ctx.accounts.market;
        market.config = ctx.accounts.config.key();
        market.creator = ctx.accounts.creator.key();
        market.stake_mint = ctx.accounts.stake_mint.key();
        market.escrow = ctx.accounts.escrow.key();
        market.seed = market_seed;
        market.txline_fixture_id = txline_fixture_id;
        market.participant1_is_home = participant1_is_home;
        market.market_type = market_type;
        market.line_param = line_param;
        market.num_outcomes = num_outcomes;
        market.lock_at = lock_at;
        market.total_pool = 0;
        // Bounded Vec keeps a fixed on-chain allocation without a 2 KB array on
        // the validation stack frame.
        market.outcome_stakes = vec![0u64; MAX_OUTCOMES];
        market.final_home_goals = 0;
        market.final_away_goals = 0;
        market.winning_outcome = -1;
        market.winning_pool = 0;
        market.claimed_pool = 0;
        market.status = MarketStatus::Open;
        market.bump = ctx.bumps.market;

        ctx.accounts.config.market_count = ctx
            .accounts
            .config
            .market_count
            .checked_add(1)
            .ok_or(EscrowError::Overflow)?;

        emit!(MarketCreated {
            market: market.key(),
            txline_fixture_id,
            market_type,
            line_param,
            lock_at,
        });
        Ok(())
    }

    /// Stake `amount` mUSDC on `outcome`. Funds move into the market-owned
    /// escrow token account. A user may hold one position per (market, outcome)
    /// and top it up while the market is open.
    pub fn place_prediction(
        ctx: Context<PlacePrediction>,
        outcome: u8,
        amount: u64,
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(!ctx.accounts.config.paused, EscrowError::Paused);
        require!(market.status == MarketStatus::Open, EscrowError::MarketNotOpen);
        require!(
            Clock::get()?.unix_timestamp < market.lock_at,
            EscrowError::MarketLocked
        );
        require!(amount > 0, EscrowError::InvalidAmount);
        require!(
            (outcome as usize) < market.num_outcomes as usize,
            EscrowError::InvalidOutcome
        );

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        let position = &mut ctx.accounts.position;
        position.market = market.key();
        position.user = ctx.accounts.user.key();
        position.outcome = outcome;
        position.amount = position
            .amount
            .checked_add(amount)
            .ok_or(EscrowError::Overflow)?;
        position.claimed = false;
        position.bump = ctx.bumps.position;

        let idx = outcome as usize;
        market.outcome_stakes[idx] = market.outcome_stakes[idx]
            .checked_add(amount)
            .ok_or(EscrowError::Overflow)?;
        market.total_pool = market
            .total_pool
            .checked_add(amount)
            .ok_or(EscrowError::Overflow)?;

        emit!(PredictionPlaced {
            market: market.key(),
            user: position.user,
            outcome,
            amount,
            total_amount: position.amount,
        });
        Ok(())
    }

    /// Trustlessly settle by proving the final score through TxLINE's on-chain
    /// `validate_stat_v2`. The winning outcome is DERIVED from proven leaves,
    /// never supplied by the caller. Permissionless — the keeper is just a payer.
    pub fn settle_market(
        ctx: Context<SettleMarket>,
        payload: TxlineStatValidationInput,
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.status == MarketStatus::Open, EscrowError::MarketNotOpen);
        require!(
            Clock::get()?.unix_timestamp >= market.lock_at,
            EscrowError::MarketStillOpen
        );

        require_keys_eq!(
            ctx.accounts.txline_program.key(),
            TXLINE_DEVNET_PROGRAM_ID,
            EscrowError::InvalidTxlineProgram
        );
        require_keys_eq!(
            *ctx.accounts.daily_scores_merkle_roots.owner,
            TXLINE_DEVNET_PROGRAM_ID,
            EscrowError::InvalidTxlineRootsAccount
        );

        // Structural checks on the proof before we spend CU on the CPI.
        require!(payload.ts >= 0, EscrowError::InvalidProofTimestamp);
        require!(
            payload.fixture_summary.fixture_id == market.txline_fixture_id,
            EscrowError::FixtureMismatch
        );
        require!(
            payload.fixture_summary.update_stats.min_timestamp == payload.ts,
            EscrowError::InvalidProofTimestamp
        );
        require!(payload.stats.len() == 2, EscrowError::UnexpectedStats);
        require!(
            payload.stats[0].stat.key == 1
                && payload.stats[1].stat.key == 2
                && payload.stats[0].stat.period == 0
                && payload.stats[1].stat.period == 0,
            EscrowError::UnexpectedStats
        );
        require!(
            payload.stats[0].stat.value >= 0
                && payload.stats[1].stat.value >= 0
                && payload.stats[0].stat.value <= u8::MAX as i32
                && payload.stats[1].stat.value <= u8::MAX as i32,
            EscrowError::InvalidScore
        );

        // The roots account must be exactly the PDA TxLINE derives for the
        // proof's own timestamp — not a caller-chosen account.
        let expected_roots = txline_daily_scores_roots(payload.ts)?;
        require_keys_eq!(
            ctx.accounts.daily_scores_merkle_roots.key(),
            expected_roots,
            EscrowError::InvalidTxlineRootsAccount
        );

        // We build the strategy ourselves so every leaf is proven for EXACT
        // equality — the caller cannot leave a score value unconstrained.
        let strategy = exact_two_score_strategy(&payload)?;
        invoke_txline_validate_stat_v2(
            &payload,
            &strategy,
            &ctx.accounts.daily_scores_merkle_roots.to_account_info(),
            &ctx.accounts.txline_program.to_account_info(),
        )?;

        let participant1_goals = payload.stats[0].stat.value as u8;
        let participant2_goals = payload.stats[1].stat.value as u8;
        let (home_goals, away_goals) = if market.participant1_is_home {
            (participant1_goals, participant2_goals)
        } else {
            (participant2_goals, participant1_goals)
        };

        let winning_outcome: i16 = match market.market_type {
            MARKET_MATCH_WINNER => {
                if home_goals > away_goals {
                    0
                } else if home_goals == away_goals {
                    1
                } else {
                    2
                }
            }
            MARKET_TOTALS => {
                let total2 = (home_goals as i32 + away_goals as i32) * 2;
                if total2 > market.line_param {
                    0 // Over
                } else {
                    1 // Under
                }
            }
            MARKET_BTTS => {
                if home_goals > 0 && away_goals > 0 {
                    0 // Yes
                } else {
                    1 // No
                }
            }
            _ => return err!(EscrowError::InvalidMarketType),
        };

        market.final_home_goals = home_goals;
        market.final_away_goals = away_goals;
        market.winning_outcome = winning_outcome;
        market.winning_pool = market.outcome_stakes[winning_outcome as usize];
        // If nobody backed the proven outcome, the pool is refunded in full.
        market.status = if market.winning_pool == 0 {
            MarketStatus::Refunding
        } else {
            MarketStatus::Settled
        };

        emit!(MarketSettled {
            market: market.key(),
            final_home_goals: home_goals,
            final_away_goals: away_goals,
            winning_outcome,
            winning_pool: market.winning_pool,
            refunding: market.status == MarketStatus::Refunding,
        });
        Ok(())
    }

    /// Emergency void by the admin. Never moves funds to an operator — it only
    /// makes every staker's own stake refundable.
    pub fn void_market(ctx: Context<VoidMarket>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.config.admin,
            EscrowError::Unauthorized
        );
        require!(
            ctx.accounts.market.status == MarketStatus::Open,
            EscrowError::MarketNotOpen
        );
        ctx.accounts.market.status = MarketStatus::Refunding;
        emit!(MarketVoided {
            market: ctx.accounts.market.key(),
        });
        Ok(())
    }

    /// Winners (or refund-eligible stakers) pull their own mUSDC from escrow.
    /// Pari-mutuel: payout = stake * total_pool / winning_pool, floor division,
    /// so aggregate claims can never exceed the escrow balance.
    pub fn claim_payout(ctx: Context<ClaimPayout>) -> Result<()> {
        let market = &ctx.accounts.market;
        let position = &mut ctx.accounts.position;
        require!(!position.claimed, EscrowError::AlreadyClaimed);
        require!(
            market.status == MarketStatus::Settled || market.status == MarketStatus::Refunding,
            EscrowError::MarketNotClaimable
        );

        let payout: u64 = if market.status == MarketStatus::Refunding {
            position.amount
        } else {
            require!(
                market.winning_outcome >= 0
                    && position.outcome as i16 == market.winning_outcome,
                EscrowError::NotWinningPosition
            );
            require!(market.winning_pool > 0, EscrowError::MarketNotClaimable);
            (position.amount as u128)
                .checked_mul(market.total_pool as u128)
                .ok_or(EscrowError::Overflow)?
                .checked_div(market.winning_pool as u128)
                .ok_or(EscrowError::Overflow)?
                .try_into()
                .map_err(|_| error!(EscrowError::Overflow))?
        };

        require!(
            ctx.accounts.escrow.amount >= payout,
            EscrowError::InsufficientEscrow
        );

        let seeds: &[&[u8]] = &[b"market", market.seed.as_ref(), &[market.bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow.to_account_info(),
                    to: ctx.accounts.user_token.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                &[seeds],
            ),
            payout,
        )?;

        position.claimed = true;
        let market_mut = &mut ctx.accounts.market;
        market_mut.claimed_pool = market_mut
            .claimed_pool
            .checked_add(payout)
            .ok_or(EscrowError::Overflow)?;

        emit!(PayoutClaimed {
            market: market_mut.key(),
            user: position.user,
            payout,
            refund: market_mut.status == MarketStatus::Refunding,
        });
        Ok(())
    }
}

// ------------------------------- Accounts -----------------------------------

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = Config::SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub stake_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
#[instruction(market_seed: [u8; 32])]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = creator,
        space = Market::SPACE,
        seeds = [b"market", market_seed.as_ref()],
        bump
    )]
    pub market: Account<'info, Market>,
    #[account(address = config.stake_mint)]
    pub stake_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = creator,
        associated_token::mint = stake_mint,
        associated_token::authority = market
    )]
    pub escrow: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(outcome: u8)]
pub struct PlacePrediction<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"market", market.seed.as_ref()],
        bump = market.bump,
        has_one = config,
        has_one = escrow
    )]
    pub market: Account<'info, Market>,
    #[account(mut, address = market.escrow)]
    pub escrow: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = user_token.mint == market.stake_mint @ EscrowError::WrongMint,
        constraint = user_token.owner == user.key() @ EscrowError::Unauthorized
    )]
    pub user_token: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = user,
        space = Position::SPACE,
        seeds = [b"position", market.key().as_ref(), user.key().as_ref(), &[outcome]],
        bump
    )]
    pub position: Account<'info, Position>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleMarket<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(
        mut,
        seeds = [b"market", market.seed.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
    /// CHECK: verified equal to TxLINE's published devnet program ID and used
    /// only as the CPI target.
    pub txline_program: UncheckedAccount<'info>,
    /// CHECK: address is re-derived from the proof timestamp and its owner is
    /// checked to be the TxLINE program before the CPI.
    pub daily_scores_merkle_roots: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct VoidMarket<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"market", market.seed.as_ref()],
        bump = market.bump,
        has_one = config
    )]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct ClaimPayout<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"market", market.seed.as_ref()],
        bump = market.bump,
        has_one = escrow
    )]
    pub market: Account<'info, Market>,
    #[account(mut, address = market.escrow)]
    pub escrow: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = user_token.mint == market.stake_mint @ EscrowError::WrongMint,
        constraint = user_token.owner == user.key() @ EscrowError::Unauthorized
    )]
    pub user_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), user.key().as_ref(), &[position.outcome]],
        bump = position.bump,
        has_one = market,
        has_one = user
    )]
    pub position: Account<'info, Position>,
    pub token_program: Program<'info, Token>,
}

// -------------------------------- State -------------------------------------

#[account]
pub struct Config {
    pub admin: Pubkey,
    pub stake_mint: Pubkey,
    pub paused: bool,
    pub market_count: u64,
    pub bump: u8,
}

impl Config {
    pub const SPACE: usize = 8 + 32 + 32 + 1 + 8 + 1;
}

#[account]
pub struct Market {
    pub config: Pubkey,
    pub creator: Pubkey,
    pub stake_mint: Pubkey,
    pub escrow: Pubkey,
    pub seed: [u8; 32],
    pub txline_fixture_id: i64,
    pub participant1_is_home: bool,
    pub market_type: u8,
    pub line_param: i32,
    pub num_outcomes: u8,
    pub lock_at: i64,
    pub total_pool: u64,
    pub outcome_stakes: Vec<u64>,
    pub final_home_goals: u8,
    pub final_away_goals: u8,
    pub winning_outcome: i16,
    pub winning_pool: u64,
    pub claimed_pool: u64,
    pub status: MarketStatus,
    pub bump: u8,
}

impl Market {
    pub const SPACE: usize = 8
        + 32 // config
        + 32 // creator
        + 32 // stake_mint
        + 32 // escrow
        + 32 // seed
        + 8  // txline_fixture_id
        + 1  // participant1_is_home
        + 1  // market_type
        + 4  // line_param
        + 1  // num_outcomes
        + 8  // lock_at
        + 8  // total_pool
        + 4 + (8 * MAX_OUTCOMES) // outcome_stakes vec
        + 1  // final_home_goals
        + 1  // final_away_goals
        + 2  // winning_outcome
        + 8  // winning_pool
        + 8  // claimed_pool
        + 1  // status
        + 1; // bump
}

#[account]
pub struct Position {
    pub market: Pubkey,
    pub user: Pubkey,
    pub outcome: u8,
    pub amount: u64,
    pub claimed: bool,
    pub bump: u8,
}

impl Position {
    pub const SPACE: usize = 8 + 32 + 32 + 1 + 8 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum MarketStatus {
    Open,
    Settled,
    Refunding,
}

// ------------------- TxLINE validate_stat_v2 IDL mirror ---------------------
// These types mirror the public TxLINE devnet IDL exactly so Borsh-encoding
// them reproduces the byte layout `validate_stat_v2` expects.

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TxlineProofNode {
    pub hash: [u8; 32],
    pub is_right_sibling: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TxlineScoreStat {
    pub key: u32,
    pub value: i32,
    pub period: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TxlineScoresUpdateStats {
    pub update_count: i32,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TxlineScoresBatchSummary {
    pub fixture_id: i64,
    pub update_stats: TxlineScoresUpdateStats,
    pub events_sub_tree_root: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TxlineStatLeaf {
    pub stat: TxlineScoreStat,
    pub stat_proof: Vec<TxlineProofNode>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TxlineStatValidationInput {
    pub ts: i64,
    pub fixture_summary: TxlineScoresBatchSummary,
    pub fixture_proof: Vec<TxlineProofNode>,
    pub main_tree_proof: Vec<TxlineProofNode>,
    pub event_stat_root: [u8; 32],
    pub stats: Vec<TxlineStatLeaf>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum TxlineComparison {
    GreaterThan,
    LessThan,
    EqualTo,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TxlineTraderPredicate {
    pub threshold: i32,
    pub comparison: TxlineComparison,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum TxlineBinaryExpression {
    Add,
    Subtract,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum TxlineStatPredicate {
    Single {
        index: u8,
        predicate: TxlineTraderPredicate,
    },
    Binary {
        index_a: u8,
        index_b: u8,
        op: TxlineBinaryExpression,
        predicate: TxlineTraderPredicate,
    },
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TxlineGeometricTarget {
    pub stat_index: u8,
    pub prediction: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TxlineNDimensionalStrategy {
    pub geometric_targets: Vec<TxlineGeometricTarget>,
    pub distance_predicate: Option<TxlineTraderPredicate>,
    pub discrete_predicates: Vec<TxlineStatPredicate>,
}

fn txline_daily_scores_roots(timestamp_ms: i64) -> Result<Pubkey> {
    require!(timestamp_ms >= 0, EscrowError::InvalidProofTimestamp);
    let epoch_day = (timestamp_ms as u64)
        .checked_div(86_400_000)
        .ok_or(EscrowError::InvalidProofTimestamp)?;
    require!(epoch_day <= u16::MAX as u64, EscrowError::InvalidProofTimestamp);
    Ok(Pubkey::find_program_address(
        &[b"daily_scores_roots", &(epoch_day as u16).to_le_bytes()],
        &TXLINE_DEVNET_PROGRAM_ID,
    )
    .0)
}

/// A strategy asserting each proven stat EXACTLY equals its own leaf value, so
/// the CPI verifies the concrete final score rather than an open predicate.
fn exact_two_score_strategy(
    payload: &TxlineStatValidationInput,
) -> Result<TxlineNDimensionalStrategy> {
    require!(payload.stats.len() == 2, EscrowError::UnexpectedStats);
    Ok(TxlineNDimensionalStrategy {
        geometric_targets: vec![],
        distance_predicate: None,
        discrete_predicates: vec![
            TxlineStatPredicate::Single {
                index: 0,
                predicate: TxlineTraderPredicate {
                    threshold: payload.stats[0].stat.value,
                    comparison: TxlineComparison::EqualTo,
                },
            },
            TxlineStatPredicate::Single {
                index: 1,
                predicate: TxlineTraderPredicate {
                    threshold: payload.stats[1].stat.value,
                    comparison: TxlineComparison::EqualTo,
                },
            },
        ],
    })
}

fn invoke_txline_validate_stat_v2<'info>(
    payload: &TxlineStatValidationInput,
    strategy: &TxlineNDimensionalStrategy,
    daily_scores_merkle_roots: &AccountInfo<'info>,
    txline_program: &AccountInfo<'info>,
) -> Result<()> {
    // Public TxLINE devnet IDL discriminator for `validate_stat_v2`.
    const DISCRIMINATOR: [u8; 8] = [208, 215, 194, 214, 241, 71, 246, 178];
    let mut data = DISCRIMINATOR.to_vec();
    data.extend(payload.try_to_vec()?);
    data.extend(strategy.try_to_vec()?);
    let instruction = Instruction {
        program_id: TXLINE_DEVNET_PROGRAM_ID,
        accounts: vec![AccountMeta::new_readonly(
            *daily_scores_merkle_roots.key,
            false,
        )],
        data,
    };
    invoke(
        &instruction,
        &[daily_scores_merkle_roots.clone(), txline_program.clone()],
    )?;

    let (program_id, data) = get_return_data().ok_or(error!(EscrowError::TxlineDidNotReturn))?;
    require_keys_eq!(
        program_id,
        TXLINE_DEVNET_PROGRAM_ID,
        EscrowError::TxlineDidNotReturn
    );
    let validated =
        bool::try_from_slice(&data).map_err(|_| error!(EscrowError::TxlineDidNotReturn))?;
    require!(validated, EscrowError::TxlineProofRejected);
    Ok(())
}

// -------------------------------- Events ------------------------------------

#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub txline_fixture_id: i64,
    pub market_type: u8,
    pub line_param: i32,
    pub lock_at: i64,
}

#[event]
pub struct PredictionPlaced {
    pub market: Pubkey,
    pub user: Pubkey,
    pub outcome: u8,
    pub amount: u64,
    pub total_amount: u64,
}

#[event]
pub struct MarketSettled {
    pub market: Pubkey,
    pub final_home_goals: u8,
    pub final_away_goals: u8,
    pub winning_outcome: i16,
    pub winning_pool: u64,
    pub refunding: bool,
}

#[event]
pub struct MarketVoided {
    pub market: Pubkey,
}

#[event]
pub struct PayoutClaimed {
    pub market: Pubkey,
    pub user: Pubkey,
    pub payout: u64,
    pub refund: bool,
}

// -------------------------------- Errors ------------------------------------

#[error_code]
pub enum EscrowError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("The platform is paused")]
    Paused,
    #[msg("Invalid TxLINE fixture id")]
    InvalidFixture,
    #[msg("Market lock time must be in the future")]
    InvalidLockTime,
    #[msg("Unknown market type")]
    InvalidMarketType,
    #[msg("Invalid market parameters for this type")]
    InvalidMarketParams,
    #[msg("The market is not open")]
    MarketNotOpen,
    #[msg("The market is locked for new predictions")]
    MarketLocked,
    #[msg("Settlement cannot run before lock time")]
    MarketStillOpen,
    #[msg("Stake amount must be positive")]
    InvalidAmount,
    #[msg("Outcome index is out of range for this market")]
    InvalidOutcome,
    #[msg("The provided token account has the wrong mint")]
    WrongMint,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("The supplied TxLINE program is not the documented devnet program")]
    InvalidTxlineProgram,
    #[msg("The supplied TxLINE daily-scores roots account is invalid")]
    InvalidTxlineRootsAccount,
    #[msg("The proof timestamp is invalid")]
    InvalidProofTimestamp,
    #[msg("The proof fixture does not match this market")]
    FixtureMismatch,
    #[msg("The proof must contain participant 1 and participant 2 total goals")]
    UnexpectedStats,
    #[msg("Score value out of range")]
    InvalidScore,
    #[msg("TxLINE did not return a validation result")]
    TxlineDidNotReturn,
    #[msg("TxLINE rejected the supplied proof")]
    TxlineProofRejected,
    #[msg("The market is not settled or refunding")]
    MarketNotClaimable,
    #[msg("This position did not back the winning outcome")]
    NotWinningPosition,
    #[msg("This position has already been claimed")]
    AlreadyClaimed,
    #[msg("The escrow cannot cover this payout")]
    InsufficientEscrow,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_txline_daily_scores_pda_from_proof_timestamp() {
        let ts_ms = 1_720_000_000_000i64;
        let epoch_day = (ts_ms / 86_400_000) as u16;
        let expected = Pubkey::find_program_address(
            &[b"daily_scores_roots", &epoch_day.to_le_bytes()],
            &TXLINE_DEVNET_PROGRAM_ID,
        )
        .0;
        assert_eq!(txline_daily_scores_roots(ts_ms).unwrap(), expected);
    }
}
