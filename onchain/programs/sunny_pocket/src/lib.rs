use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

declare_id!("7RhPyrf1C4t3QDce8hW19i6FK5wevEEPgBMne8Pt4wvy");

/// Sunny's pocket money: the owner's USDC sits in a program vault, and Sunny's agent
/// key can draw from it only within the owner's limits (per payment and per day), and
/// never while frozen. The owner can top up, change limits, freeze or withdraw any time.

#[constant]
pub const POCKET_SEED: &[u8] = b"pocket";
#[constant]
pub const VAULT_SEED: &[u8] = b"vault";

const SECONDS_PER_DAY: i64 = 86_400;

#[program]
pub mod sunny_pocket {
    use super::*;

    /// Creates the owner's pocket and its vault, with Sunny's agent key and the limits.
    pub fn open_pocket(
        ctx: Context<OpenPocket>,
        agent: Pubkey,
        daily_limit: u64,
        per_tx_limit: u64,
    ) -> Result<()> {
        validate_limits(daily_limit, per_tx_limit)?;
        let now = Clock::get()?.unix_timestamp;
        let pocket = &mut ctx.accounts.pocket;
        pocket.owner = ctx.accounts.owner.key();
        pocket.agent = agent;
        pocket.mint = ctx.accounts.mint.key();
        pocket.daily_limit = daily_limit;
        pocket.per_tx_limit = per_tx_limit;
        pocket.spent_today = 0;
        pocket.day = now / SECONDS_PER_DAY;
        pocket.frozen = false;
        pocket.total_drawn = 0;
        pocket.created_at = now;
        pocket.bump = ctx.bumps.pocket;
        pocket.vault_bump = ctx.bumps.vault;

        emit!(PocketOpened {
            pocket: pocket.key(),
            owner: pocket.owner,
            agent,
            daily_limit,
            per_tx_limit,
        });
        Ok(())
    }

    /// Adds money to the vault. Anyone can top up a pocket; only the owner can take money out.
    pub fn top_up(ctx: Context<TopUp>, amount: u64) -> Result<()> {
        require!(amount > 0, PocketError::InvalidAmount);
        transfer(
            &ctx.accounts.token_program,
            &ctx.accounts.payer_token,
            &ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.payer.to_account_info(),
            amount,
            &[],
        )?;
        emit!(ToppedUp {
            pocket: ctx.accounts.pocket.key(),
            from: ctx.accounts.payer.key(),
            amount,
        });
        Ok(())
    }

    /// Sunny takes pocket money for a payment. The limits are checked here, on-chain.
    pub fn draw(ctx: Context<Draw>, amount: u64) -> Result<()> {
        let (spent_today, daily_limit) = {
            let pocket = &mut ctx.accounts.pocket;
            require!(!pocket.frozen, PocketError::Frozen);
            require!(amount > 0, PocketError::InvalidAmount);
            require!(amount <= pocket.per_tx_limit, PocketError::OverPerPaymentLimit);

            let today = Clock::get()?.unix_timestamp / SECONDS_PER_DAY;
            if today != pocket.day {
                pocket.day = today;
                pocket.spent_today = 0;
            }
            let after = pocket
                .spent_today
                .checked_add(amount)
                .ok_or(PocketError::Overflow)?;
            require!(after <= pocket.daily_limit, PocketError::OverDailyLimit);
            pocket.spent_today = after;
            pocket.total_drawn = pocket.total_drawn.saturating_add(amount);
            (after, pocket.daily_limit)
        };

        let pocket = &ctx.accounts.pocket;
        let owner = pocket.owner;
        let bump = [pocket.bump];
        let signer_seeds: &[&[&[u8]]] = &[&[POCKET_SEED, owner.as_ref(), &bump]];
        transfer(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.agent_token,
            &ctx.accounts.mint,
            &ctx.accounts.pocket.to_account_info(),
            amount,
            signer_seeds,
        )?;

        emit!(Drawn {
            pocket: ctx.accounts.pocket.key(),
            amount,
            spent_today,
            daily_limit,
        });
        Ok(())
    }

    /// Owner changes the limits.
    pub fn set_limits(ctx: Context<OwnerOnly>, daily_limit: u64, per_tx_limit: u64) -> Result<()> {
        validate_limits(daily_limit, per_tx_limit)?;
        let pocket = &mut ctx.accounts.pocket;
        pocket.daily_limit = daily_limit;
        pocket.per_tx_limit = per_tx_limit;
        Ok(())
    }

    /// Owner freezes or unfreezes the pocket. Frozen means Sunny can't draw anything.
    pub fn set_frozen(ctx: Context<OwnerOnly>, frozen: bool) -> Result<()> {
        ctx.accounts.pocket.frozen = frozen;
        emit!(FrozenChanged {
            pocket: ctx.accounts.pocket.key(),
            frozen,
        });
        Ok(())
    }

    /// Owner replaces Sunny's agent key (e.g. after rotating it).
    pub fn set_agent(ctx: Context<OwnerOnly>, agent: Pubkey) -> Result<()> {
        ctx.accounts.pocket.agent = agent;
        Ok(())
    }

    /// Owner takes money back out of the vault, any time, no limits.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, PocketError::InvalidAmount);
        let pocket = &ctx.accounts.pocket;
        let owner = pocket.owner;
        let bump = [pocket.bump];
        let signer_seeds: &[&[&[u8]]] = &[&[POCKET_SEED, owner.as_ref(), &bump]];
        transfer(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.owner_token,
            &ctx.accounts.mint,
            &ctx.accounts.pocket.to_account_info(),
            amount,
            signer_seeds,
        )
    }
}

fn validate_limits(daily_limit: u64, per_tx_limit: u64) -> Result<()> {
    require!(
        per_tx_limit > 0 && per_tx_limit <= daily_limit,
        PocketError::InvalidLimits
    );
    Ok(())
}

fn transfer<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    authority: &AccountInfo<'info>,
    amount: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let accounts = TransferChecked {
        from: from.to_account_info(),
        mint: mint.to_account_info(),
        to: to.to_account_info(),
        authority: authority.clone(),
    };
    let ctx = CpiContext::new_with_signer(token_program.key(), accounts, signer_seeds);
    token_interface::transfer_checked(ctx, amount, mint.decimals)
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct OpenPocket<'info> {
    pub owner: Signer<'info>,

    /// Pays the rent for the pocket and vault, so the owner's wallet needs no SOL
    /// (Sunny's fee wallet in practice).
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Pocket::INIT_SPACE,
        seeds = [POCKET_SEED, owner.key().as_ref()],
        bump,
    )]
    pub pocket: Box<Account<'info, Pocket>>,

    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = payer,
        seeds = [VAULT_SEED, pocket.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = pocket,
        token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TopUp<'info> {
    pub payer: Signer<'info>,

    #[account(
        has_one = mint,
        seeds = [POCKET_SEED, pocket.owner.as_ref()],
        bump = pocket.bump,
    )]
    pub pocket: Box<Account<'info, Pocket>>,

    #[account(mut, seeds = [VAULT_SEED, pocket.key().as_ref()], bump = pocket.vault_bump)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = payer,
        token::token_program = token_program,
    )]
    pub payer_token: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Draw<'info> {
    pub agent: Signer<'info>,

    #[account(
        mut,
        has_one = agent @ PocketError::NotAgent,
        has_one = mint,
        seeds = [POCKET_SEED, pocket.owner.as_ref()],
        bump = pocket.bump,
    )]
    pub pocket: Box<Account<'info, Pocket>>,

    #[account(mut, seeds = [VAULT_SEED, pocket.key().as_ref()], bump = pocket.vault_bump)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// Sunny's own token account: drawn money can only go to the agent.
    #[account(
        mut,
        token::mint = mint,
        token::authority = agent,
        token::token_program = token_program,
    )]
    pub agent_token: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct OwnerOnly<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner @ PocketError::NotOwner,
        seeds = [POCKET_SEED, owner.key().as_ref()],
        bump = pocket.bump,
    )]
    pub pocket: Box<Account<'info, Pocket>>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub owner: Signer<'info>,

    #[account(
        has_one = owner @ PocketError::NotOwner,
        has_one = mint,
        seeds = [POCKET_SEED, owner.key().as_ref()],
        bump = pocket.bump,
    )]
    pub pocket: Box<Account<'info, Pocket>>,

    #[account(mut, seeds = [VAULT_SEED, pocket.key().as_ref()], bump = pocket.vault_bump)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = owner,
        token::token_program = token_program,
    )]
    pub owner_token: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

// ---------------------------------------------------------------------------
// State, events, errors
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct Pocket {
    pub owner: Pubkey,
    /// Sunny's key for this owner; the only signer that can draw.
    pub agent: Pubkey,
    pub mint: Pubkey,
    pub daily_limit: u64,
    pub per_tx_limit: u64,
    /// Drawn so far on `day` (UTC day number).
    pub spent_today: u64,
    pub day: i64,
    pub frozen: bool,
    pub total_drawn: u64,
    pub created_at: i64,
    pub bump: u8,
    pub vault_bump: u8,
}

#[event]
pub struct PocketOpened {
    pub pocket: Pubkey,
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub daily_limit: u64,
    pub per_tx_limit: u64,
}

#[event]
pub struct ToppedUp {
    pub pocket: Pubkey,
    pub from: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Drawn {
    pub pocket: Pubkey,
    pub amount: u64,
    pub spent_today: u64,
    pub daily_limit: u64,
}

#[event]
pub struct FrozenChanged {
    pub pocket: Pubkey,
    pub frozen: bool,
}

#[error_code]
pub enum PocketError {
    #[msg("Per-payment limit must be above zero and no more than the daily limit")]
    InvalidLimits,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("The pocket is frozen")]
    Frozen,
    #[msg("Over the per-payment limit")]
    OverPerPaymentLimit,
    #[msg("Over today's limit")]
    OverDailyLimit,
    #[msg("Only Sunny's agent key can draw from this pocket")]
    NotAgent,
    #[msg("Only the owner can do this")]
    NotOwner,
    #[msg("Arithmetic overflow")]
    Overflow,
}
