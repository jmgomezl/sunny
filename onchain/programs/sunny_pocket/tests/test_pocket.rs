use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    litesvm_token::{
        get_spl_account, spl_token::state::Account as SplAccount, CreateAssociatedTokenAccount,
        CreateMint, MintTo, TOKEN_ID,
    },
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    spl_associated_token_account_interface::address::get_associated_token_address_with_program_id,
    sunny_pocket::{Pocket, POCKET_SEED, VAULT_SEED},
};

const USDC: u64 = 1_000_000; // 6 decimals
const DAILY: u64 = 10 * USDC;
const PER_TX: u64 = 5 * USDC;

struct Env {
    svm: LiteSVM,
    mint: Pubkey,
    owner: Keypair,
    agent: Keypair,
    stranger: Keypair,
    pocket: Pubkey,
    vault: Pubkey,
}

impl Env {
    /// A mint, an owner with 100 USDC, Sunny's agent and a stranger, each with a token account.
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/sunny_pocket.so"));
        svm.add_program(sunny_pocket::id(), bytes).unwrap();

        let authority = Keypair::new();
        svm.airdrop(&authority.pubkey(), 10_000_000_000).unwrap();
        let mint = CreateMint::new(&mut svm, &authority).decimals(6).send().unwrap();

        let (owner, agent, stranger) = (Keypair::new(), Keypair::new(), Keypair::new());
        for k in [&owner, &agent, &stranger] {
            svm.airdrop(&k.pubkey(), 1_000_000_000).unwrap();
            let ata = CreateAssociatedTokenAccount::new(&mut svm, k, &mint).send().unwrap();
            if k.pubkey() != agent.pubkey() {
                MintTo::new(&mut svm, &authority, &mint, &ata, 100 * USDC).send().unwrap();
            }
        }

        let pocket = Pubkey::find_program_address(&[POCKET_SEED, owner.pubkey().as_ref()], &sunny_pocket::id()).0;
        let vault = Pubkey::find_program_address(&[VAULT_SEED, pocket.as_ref()], &sunny_pocket::id()).0;
        Env { svm, mint, owner, agent, stranger, pocket, vault }
    }

    fn ata(&self, owner: &Pubkey) -> Pubkey {
        get_associated_token_address_with_program_id(owner, &self.mint, &TOKEN_ID)
    }

    fn send(&mut self, ix: Instruction, signer: &Keypair) -> Result<(), String> {
        self.svm.expire_blockhash();
        let msg = Message::new_with_blockhash(&[ix], Some(&signer.pubkey()), &self.svm.latest_blockhash());
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[signer]).unwrap();
        self.svm
            .send_transaction(tx)
            .map(|_| ())
            .map_err(|e| format!("{:?}\n{}", e.err, e.meta.logs.join("\n")))
    }

    fn open(&mut self, daily: u64, per_tx: u64) -> Result<(), String> {
        let owner = self.owner.insecure_clone();
        let ix = Instruction::new_with_bytes(
            sunny_pocket::id(),
            &sunny_pocket::instruction::OpenPocket { agent: self.agent.pubkey(), daily_limit: daily, per_tx_limit: per_tx }.data(),
            sunny_pocket::accounts::OpenPocket {
                owner: owner.pubkey(),
                pocket: self.pocket,
                mint: self.mint,
                vault: self.vault,
                token_program: TOKEN_ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        self.send(ix, &owner)
    }

    fn top_up(&mut self, payer: &Keypair, amount: u64) -> Result<(), String> {
        let ix = Instruction::new_with_bytes(
            sunny_pocket::id(),
            &sunny_pocket::instruction::TopUp { amount }.data(),
            sunny_pocket::accounts::TopUp {
                payer: payer.pubkey(),
                pocket: self.pocket,
                vault: self.vault,
                mint: self.mint,
                payer_token: self.ata(&payer.pubkey()),
                token_program: TOKEN_ID,
            }
            .to_account_metas(None),
        );
        self.send(ix, payer)
    }

    /// Draws to `to`'s token account, signed by `signer` (Sunny's agent unless testing abuse).
    fn draw_as(&mut self, signer: &Keypair, to: &Pubkey, amount: u64) -> Result<(), String> {
        let ix = Instruction::new_with_bytes(
            sunny_pocket::id(),
            &sunny_pocket::instruction::Draw { amount }.data(),
            sunny_pocket::accounts::Draw {
                agent: signer.pubkey(),
                pocket: self.pocket,
                vault: self.vault,
                mint: self.mint,
                agent_token: self.ata(to),
                token_program: TOKEN_ID,
            }
            .to_account_metas(None),
        );
        self.send(ix, signer)
    }

    fn draw(&mut self, amount: u64) -> Result<(), String> {
        let agent = self.agent.insecure_clone();
        let to = agent.pubkey();
        self.draw_as(&agent, &to, amount)
    }

    fn owner_ix(&mut self, signer: &Keypair, data: Vec<u8>) -> Result<(), String> {
        let ix = Instruction::new_with_bytes(
            sunny_pocket::id(),
            &data,
            sunny_pocket::accounts::OwnerOnly { owner: signer.pubkey(), pocket: self.pocket }.to_account_metas(None),
        );
        self.send(ix, signer)
    }

    fn set_frozen(&mut self, frozen: bool) -> Result<(), String> {
        let owner = self.owner.insecure_clone();
        self.owner_ix(&owner, sunny_pocket::instruction::SetFrozen { frozen }.data())
    }

    fn withdraw_as(&mut self, signer: &Keypair, amount: u64) -> Result<(), String> {
        let ix = Instruction::new_with_bytes(
            sunny_pocket::id(),
            &sunny_pocket::instruction::Withdraw { amount }.data(),
            sunny_pocket::accounts::Withdraw {
                owner: signer.pubkey(),
                pocket: self.pocket,
                vault: self.vault,
                mint: self.mint,
                owner_token: self.ata(&signer.pubkey()),
                token_program: TOKEN_ID,
            }
            .to_account_metas(None),
        );
        self.send(ix, signer)
    }

    fn state(&self) -> Pocket {
        let account = self.svm.get_account(&self.pocket).unwrap();
        Pocket::try_deserialize(&mut account.data.as_slice()).unwrap()
    }

    fn balance(&self, token_account: &Pubkey) -> u64 {
        get_spl_account::<SplAccount>(&self.svm, token_account).unwrap().amount
    }

    fn next_day(&mut self) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp += 86_400;
        self.svm.set_sysvar(&clock);
    }
}

fn assert_err(result: Result<(), String>, expected: &str) {
    match result {
        Ok(()) => panic!("expected {expected}, but the transaction succeeded"),
        Err(e) => assert!(e.contains(expected), "expected {expected}, got:\n{e}"),
    }
}

#[test]
fn sunny_draws_within_limits_only() {
    let mut env = Env::new();
    env.open(DAILY, PER_TX).unwrap();
    env.top_up(&env.owner.insecure_clone(), 20 * USDC).unwrap();
    assert_eq!(env.balance(&env.vault), 20 * USDC);

    env.draw(3 * USDC).unwrap();
    env.draw(5 * USDC).unwrap();
    assert_eq!(env.balance(&env.ata(&env.agent.pubkey())), 8 * USDC);
    assert_eq!(env.state().spent_today, 8 * USDC);

    // $6 in one payment is over the $5 per-payment limit.
    assert_err(env.draw(6 * USDC), "OverPerPaymentLimit");
    // $3 more would make $11 today, over the $10 daily limit.
    assert_err(env.draw(3 * USDC), "OverDailyLimit");
    env.draw(2 * USDC).unwrap();
    assert_eq!(env.state().spent_today, DAILY);
    assert_eq!(env.state().total_drawn, DAILY);
}

#[test]
fn allowance_refills_the_next_day() {
    let mut env = Env::new();
    env.open(DAILY, PER_TX).unwrap();
    env.top_up(&env.owner.insecure_clone(), 30 * USDC).unwrap();
    env.draw(5 * USDC).unwrap();
    env.draw(5 * USDC).unwrap();
    assert_err(env.draw(1 * USDC), "OverDailyLimit");

    env.next_day();
    env.draw(5 * USDC).unwrap();
    assert_eq!(env.state().spent_today, 5 * USDC);
    assert_eq!(env.state().total_drawn, 15 * USDC);
}

#[test]
fn freezing_stops_sunny() {
    let mut env = Env::new();
    env.open(DAILY, PER_TX).unwrap();
    env.top_up(&env.owner.insecure_clone(), 10 * USDC).unwrap();
    env.set_frozen(true).unwrap();
    assert_err(env.draw(1 * USDC), "Frozen");
    env.set_frozen(false).unwrap();
    env.draw(1 * USDC).unwrap();
}

#[test]
fn only_sunny_can_draw_and_only_to_itself() {
    let mut env = Env::new();
    env.open(DAILY, PER_TX).unwrap();
    env.top_up(&env.owner.insecure_clone(), 10 * USDC).unwrap();

    let stranger = env.stranger.insecure_clone();
    let to = stranger.pubkey();
    assert_err(env.draw_as(&stranger, &to, 1 * USDC), "NotAgent");

    // Even the agent can't send pocket money to someone else's account.
    let agent = env.agent.insecure_clone();
    assert!(env.draw_as(&agent, &to, 1 * USDC).is_err());
    assert_eq!(env.balance(&env.vault), 10 * USDC);
}

#[test]
fn owner_stays_in_control() {
    let mut env = Env::new();
    env.open(DAILY, PER_TX).unwrap();

    // Anyone can top up, e.g. a friend gifting pocket money.
    env.top_up(&env.stranger.insecure_clone(), 4 * USDC).unwrap();
    env.top_up(&env.owner.insecure_clone(), 6 * USDC).unwrap();

    // Only the owner can take money out, change limits or freeze.
    let stranger = env.stranger.insecure_clone();
    assert!(env.withdraw_as(&stranger, 1 * USDC).is_err());
    assert!(env
        .owner_ix(&stranger, sunny_pocket::instruction::SetFrozen { frozen: true }.data())
        .is_err());

    let owner = env.owner.insecure_clone();
    assert_err(
        env.owner_ix(&owner, sunny_pocket::instruction::SetLimits { daily_limit: 2 * USDC, per_tx_limit: 3 * USDC }.data()),
        "InvalidLimits",
    );
    env.owner_ix(&owner, sunny_pocket::instruction::SetLimits { daily_limit: 2 * USDC, per_tx_limit: 1 * USDC }.data())
        .unwrap();
    assert_err(env.draw(2 * USDC), "OverPerPaymentLimit");

    let before = env.balance(&env.ata(&owner.pubkey()));
    env.withdraw_as(&owner, 10 * USDC).unwrap();
    assert_eq!(env.balance(&env.vault), 0);
    assert_eq!(env.balance(&env.ata(&owner.pubkey())), before + 10 * USDC);

    let new_agent = Pubkey::new_unique();
    env.owner_ix(&owner, sunny_pocket::instruction::SetAgent { agent: new_agent }.data()).unwrap();
    assert_eq!(env.state().agent, new_agent);
}

#[test]
fn rejects_bad_limits_on_open() {
    let mut env = Env::new();
    assert_err(env.open(5 * USDC, 6 * USDC), "InvalidLimits");
    assert_err(env.open(5 * USDC, 0), "InvalidLimits");
    env.open(DAILY, PER_TX).unwrap();
    let state = env.state();
    assert_eq!(state.owner, env.owner.pubkey());
    assert_eq!(state.agent, env.agent.pubkey());
    assert!(!state.frozen);
}
