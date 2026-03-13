use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    ed25519_program,
    entrypoint,
    entrypoint::ProgramResult,
    hash::hashv,
    instruction::Instruction,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    system_program,
    sysvar::{
        instructions::{load_current_index_checked, load_instruction_at_checked},
        Sysvar,
    },
};

solana_program::declare_id!("3sUkfLW4jtwSQFgdtWyEj8FPedtvKfXSB1J16PMUZhMG");

const POLICY_SEED: &[u8] = b"policy";
const SESSION_SEED: &[u8] = b"session";
const VAULT_SEED: &[u8] = b"vault";
const VAULT_MARKER: &[u8; 8] = b"PRKTVLT0";
const POLICY_STATE_VERSION: u8 = 1;
const SESSION_STATE_VERSION: u8 = 1;
const POLICY_HEADER_LEN: usize = 100;
const SESSION_STATE_LEN: usize = 155;
const ED25519_HEADER_LEN: usize = 16;
const U16_NONE: u16 = u16::MAX;
const SECONDS_PER_DAY: i64 = 86_400;
const MAX_ALLOWLIST_ITEMS: usize = 64;

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let (&opcode, payload) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    match opcode {
        0 => process_initialize_policy(program_id, accounts, payload),
        1 => process_set_kill_switch(program_id, accounts, payload),
        2 => process_open_session(program_id, accounts, payload),
        3 => process_close_session(program_id, accounts, payload),
        4 => process_execute_transfer(program_id, accounts, payload),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn process_initialize_policy(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    payload: &[u8],
) -> ProgramResult {
    let mut payload_cursor = 0usize;
    let session_ttl_minutes = read_u32(payload, &mut payload_cursor)?;
    let daily_spend_limit = read_u64(payload, &mut payload_cursor)?;
    let verifier = read_pubkey(payload, &mut payload_cursor)?;
    let allowed_programs = read_pubkey_vec(payload, &mut payload_cursor)?;
    let allowed_recipients = read_pubkey_vec(payload, &mut payload_cursor)?;

    if session_ttl_minutes == 0 {
        return Err(guard_error(GuardError::InvalidSessionTtl));
    }

    let account_info_iter = &mut accounts.iter();
    let owner_info = next_account_info(account_info_iter)?;
    let policy_info = next_account_info(account_info_iter)?;
    let vault_info = next_account_info(account_info_iter)?;
    let system_program_info = next_account_info(account_info_iter)?;

    if !owner_info.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if *system_program_info.key != system_program::id() {
        return Err(ProgramError::InvalidAccountData);
    }

    let (expected_policy, policy_bump) =
        Pubkey::find_program_address(&[POLICY_SEED, owner_info.key.as_ref()], program_id);
    if expected_policy != *policy_info.key {
        return Err(guard_error(GuardError::PolicyPdaMismatch));
    }

    let (expected_vault, vault_bump) =
        Pubkey::find_program_address(&[VAULT_SEED, policy_info.key.as_ref()], program_id);
    if expected_vault != *vault_info.key {
        return Err(guard_error(GuardError::VaultPdaMismatch));
    }

    if !policy_info.data_is_empty() || !vault_info.data_is_empty() {
        return Err(guard_error(GuardError::AlreadyInitialized));
    }

    let policy_space =
        PolicyState::space_for(allowed_programs.len(), allowed_recipients.len())?;
    create_program_account(
        owner_info,
        policy_info,
        system_program_info,
        policy_space,
        program_id,
        &[POLICY_SEED, owner_info.key.as_ref(), &[policy_bump]],
    )?;
    create_program_account(
        owner_info,
        vault_info,
        system_program_info,
        VAULT_MARKER.len(),
        program_id,
        &[VAULT_SEED, policy_info.key.as_ref(), &[vault_bump]],
    )?;

    {
        let mut vault_data = vault_info.try_borrow_mut_data()?;
        vault_data.copy_from_slice(VAULT_MARKER);
    }

    let clock = Clock::get()?;
    let state = PolicyState {
        version: POLICY_STATE_VERSION,
        bump: policy_bump,
        vault_bump,
        kill_switch_active: false,
        session_ttl_minutes,
        daily_spend_limit,
        spent_today: 0,
        last_reset_day: current_day_bucket(clock.unix_timestamp),
        owner: *owner_info.key,
        verifier,
        allowed_programs,
        allowed_recipients,
    };
    state.pack(&mut policy_info.try_borrow_mut_data()?)?;

    Ok(())
}

fn process_set_kill_switch(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    payload: &[u8],
) -> ProgramResult {
    if payload.len() != 1 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let active = payload[0] != 0;

    let account_info_iter = &mut accounts.iter();
    let owner_info = next_account_info(account_info_iter)?;
    let policy_info = next_account_info(account_info_iter)?;

    if !owner_info.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut state = PolicyState::unpack(&policy_info.try_borrow_data()?)?;
    let (expected_policy, _) =
        Pubkey::find_program_address(&[POLICY_SEED, owner_info.key.as_ref()], program_id);
    if expected_policy != *policy_info.key || state.owner != *owner_info.key {
        return Err(guard_error(GuardError::PolicyPdaMismatch));
    }

    state.kill_switch_active = active;
    state.pack(&mut policy_info.try_borrow_mut_data()?)?;
    Ok(())
}

fn process_open_session(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    payload: &[u8],
) -> ProgramResult {
    if payload.len() != 32 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let session_id: [u8; 32] = payload
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let account_info_iter = &mut accounts.iter();
    let owner_info = next_account_info(account_info_iter)?;
    let policy_info = next_account_info(account_info_iter)?;
    let session_info = next_account_info(account_info_iter)?;
    let system_program_info = next_account_info(account_info_iter)?;

    if !owner_info.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if *system_program_info.key != system_program::id() {
        return Err(ProgramError::InvalidAccountData);
    }

    let policy = PolicyState::unpack(&policy_info.try_borrow_data()?)?;
    if policy.owner != *owner_info.key {
        return Err(guard_error(GuardError::UnauthorizedOwner));
    }

    let (expected_policy, _) =
        Pubkey::find_program_address(&[POLICY_SEED, owner_info.key.as_ref()], program_id);
    if expected_policy != *policy_info.key {
        return Err(guard_error(GuardError::PolicyPdaMismatch));
    }

    let (expected_session, session_bump) = Pubkey::find_program_address(
        &[SESSION_SEED, policy_info.key.as_ref(), &session_id],
        program_id,
    );
    if expected_session != *session_info.key {
        return Err(guard_error(GuardError::SessionPdaMismatch));
    }

    if !session_info.data_is_empty() {
        return Err(guard_error(GuardError::AlreadyInitialized));
    }

    create_program_account(
        owner_info,
        session_info,
        system_program_info,
        SESSION_STATE_LEN,
        program_id,
        &[SESSION_SEED, policy_info.key.as_ref(), &session_id, &[session_bump]],
    )?;

    let now = Clock::get()?.unix_timestamp;
    let session = SessionState {
        version: SESSION_STATE_VERSION,
        bump: session_bump,
        active: true,
        policy: *policy_info.key,
        owner: *owner_info.key,
        session_id,
        opened_at: now,
        expires_at: now + i64::from(policy.session_ttl_minutes) * 60,
        next_nonce: 0,
        last_verified_digest: [0u8; 32],
    };
    session.pack(&mut session_info.try_borrow_mut_data()?)?;
    Ok(())
}

fn process_close_session(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    payload: &[u8],
) -> ProgramResult {
    if payload.len() != 32 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let session_id: [u8; 32] = payload
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let account_info_iter = &mut accounts.iter();
    let owner_info = next_account_info(account_info_iter)?;
    let policy_info = next_account_info(account_info_iter)?;
    let session_info = next_account_info(account_info_iter)?;

    if !owner_info.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let policy = PolicyState::unpack(&policy_info.try_borrow_data()?)?;
    let mut session = SessionState::unpack(&session_info.try_borrow_data()?)?;

    if policy.owner != *owner_info.key {
        return Err(guard_error(GuardError::UnauthorizedOwner));
    }
    let (expected_policy, _) =
        Pubkey::find_program_address(&[POLICY_SEED, owner_info.key.as_ref()], program_id);
    if expected_policy != *policy_info.key {
        return Err(guard_error(GuardError::PolicyPdaMismatch));
    }
    let (expected_session, _) = Pubkey::find_program_address(
        &[SESSION_SEED, policy_info.key.as_ref(), &session_id],
        program_id,
    );
    if expected_session != *session_info.key || session.session_id != session_id {
        return Err(guard_error(GuardError::SessionPdaMismatch));
    }

    session.active = false;
    session.pack(&mut session_info.try_borrow_mut_data()?)?;
    Ok(())
}

fn process_execute_transfer(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    payload: &[u8],
) -> ProgramResult {
    let transfer = ExecuteTransferPayload::unpack(payload)?;

    let account_info_iter = &mut accounts.iter();
    let policy_info = next_account_info(account_info_iter)?;
    let vault_info = next_account_info(account_info_iter)?;
    let session_info = next_account_info(account_info_iter)?;
    let recipient_info = next_account_info(account_info_iter)?;
    let instructions_info = next_account_info(account_info_iter)?;

    let mut policy = PolicyState::unpack(&policy_info.try_borrow_data()?)?;
    let mut session = SessionState::unpack(&session_info.try_borrow_data()?)?;

    let (expected_policy, _) =
        Pubkey::find_program_address(&[POLICY_SEED, policy.owner.as_ref()], program_id);
    if expected_policy != *policy_info.key {
        return Err(guard_error(GuardError::PolicyPdaMismatch));
    }
    let (expected_vault, _) =
        Pubkey::find_program_address(&[VAULT_SEED, policy_info.key.as_ref()], program_id);
    if expected_vault != *vault_info.key {
        return Err(guard_error(GuardError::VaultPdaMismatch));
    }
    let (expected_session, _) = Pubkey::find_program_address(
        &[SESSION_SEED, policy_info.key.as_ref(), &transfer.session_id],
        program_id,
    );
    if expected_session != *session_info.key || session.session_id != transfer.session_id {
        return Err(guard_error(GuardError::SessionPdaMismatch));
    }
    if *recipient_info.key != transfer.recipient {
        return Err(guard_error(GuardError::RecipientMismatch));
    }

    if !session.active {
        return Err(guard_error(GuardError::SessionClosed));
    }
    if policy.kill_switch_active {
        return Err(guard_error(GuardError::KillSwitchActive));
    }

    let now = Clock::get()?.unix_timestamp;
    if now > session.expires_at || now > transfer.expires_at {
        return Err(guard_error(GuardError::SessionExpired));
    }
    if transfer.timestamp > now + 60 {
        return Err(guard_error(GuardError::TimestampInFuture));
    }
    if transfer.nonce != session.next_nonce {
        return Err(guard_error(GuardError::NonceMismatch));
    }

    refresh_daily_spend(&mut policy, now);

    if !policy.allowed_programs.is_empty()
        && !policy
            .allowed_programs
            .iter()
            .any(|entry| *entry == transfer.target_program)
    {
        return Err(guard_error(GuardError::ProgramNotAllowed));
    }
    if !policy.allowed_recipients.is_empty()
        && !policy
            .allowed_recipients
            .iter()
            .any(|entry| *entry == transfer.recipient)
    {
        return Err(guard_error(GuardError::RecipientNotAllowed));
    }

    let new_spend = policy
        .spent_today
        .checked_add(transfer.amount_lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    if new_spend > policy.daily_spend_limit {
        return Err(guard_error(GuardError::DailyLimitExceeded));
    }

    let current_index = load_current_index_checked(instructions_info)?;
    if current_index == 0 {
        return Err(guard_error(GuardError::MissingEd25519Instruction));
    }
    let previous = load_instruction_at_checked((current_index - 1) as usize, instructions_info)?;
    verify_ed25519_instruction(&previous, &policy.verifier, payload)?;

    let digest = hashv(&[payload]).to_bytes();
    session.last_verified_digest = digest;
    session.next_nonce = session
        .next_nonce
        .checked_add(1)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    policy.spent_today = new_spend;

    transfer_lamports(vault_info, recipient_info, transfer.amount_lamports)?;

    policy.pack(&mut policy_info.try_borrow_mut_data()?)?;
    session.pack(&mut session_info.try_borrow_mut_data()?)?;

    msg!(
        "verified transfer policy={} session={} recipient={} amount={}",
        policy_info.key,
        hex_32(&transfer.session_id),
        recipient_info.key,
        transfer.amount_lamports
    );

    Ok(())
}

fn create_program_account<'a>(
    payer_info: &AccountInfo<'a>,
    new_account_info: &AccountInfo<'a>,
    system_program_info: &AccountInfo<'a>,
    space: usize,
    owner: &Pubkey,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    let lamports = Rent::get()?.minimum_balance(space);
    invoke_signed(
        &system_instruction::create_account(
            payer_info.key,
            new_account_info.key,
            lamports,
            space as u64,
            owner,
        ),
        &[
            payer_info.clone(),
            new_account_info.clone(),
            system_program_info.clone(),
        ],
        &[signer_seeds],
    )
}

fn transfer_lamports(
    vault_info: &AccountInfo,
    recipient_info: &AccountInfo,
    amount_lamports: u64,
) -> ProgramResult {
    if !vault_info.is_writable || !recipient_info.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }

    let vault_balance = **vault_info.lamports.borrow();
    if vault_balance < amount_lamports {
        return Err(guard_error(GuardError::VaultInsufficientFunds));
    }

    **vault_info.try_borrow_mut_lamports()? = vault_balance - amount_lamports;
    **recipient_info.try_borrow_mut_lamports()? = recipient_info
        .lamports()
        .checked_add(amount_lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    Ok(())
}

fn refresh_daily_spend(policy: &mut PolicyState, now: i64) {
    let current_bucket = current_day_bucket(now);
    if current_bucket != policy.last_reset_day {
        policy.spent_today = 0;
        policy.last_reset_day = current_bucket;
    }
}

fn current_day_bucket(timestamp: i64) -> i64 {
    timestamp.div_euclid(SECONDS_PER_DAY)
}

fn verify_ed25519_instruction(
    instruction: &Instruction,
    expected_verifier: &Pubkey,
    expected_message: &[u8],
) -> ProgramResult {
    if instruction.program_id != ed25519_program::id() {
        return Err(guard_error(GuardError::MissingEd25519Instruction));
    }
    if instruction.data.len() < ED25519_HEADER_LEN || instruction.data[0] != 1 {
        return Err(guard_error(GuardError::MalformedEd25519Instruction));
    }

    let signature_instruction_index = read_u16_at(&instruction.data, 4)?;
    let public_key_instruction_index = read_u16_at(&instruction.data, 8)?;
    let message_instruction_index = read_u16_at(&instruction.data, 14)?;

    if signature_instruction_index != U16_NONE
        || public_key_instruction_index != U16_NONE
        || message_instruction_index != U16_NONE
    {
        return Err(guard_error(GuardError::MalformedEd25519Instruction));
    }

    let public_key_offset = read_u16_at(&instruction.data, 6)? as usize;
    let message_offset = read_u16_at(&instruction.data, 10)? as usize;
    let message_size = read_u16_at(&instruction.data, 12)? as usize;

    let public_key_bytes = instruction
        .data
        .get(public_key_offset..public_key_offset + 32)
        .ok_or(guard_error(GuardError::MalformedEd25519Instruction))?;
    let public_key = Pubkey::new_from_array(
        public_key_bytes
            .try_into()
            .map_err(|_| guard_error(GuardError::MalformedEd25519Instruction))?,
    );
    if &public_key != expected_verifier {
        return Err(guard_error(GuardError::VerifierMismatch));
    }

    let message = instruction
        .data
        .get(message_offset..message_offset + message_size)
        .ok_or(guard_error(GuardError::MalformedEd25519Instruction))?;
    if message != expected_message {
        return Err(guard_error(GuardError::ProofMessageMismatch));
    }

    Ok(())
}

fn read_u16_at(data: &[u8], index: usize) -> Result<u16, ProgramError> {
    let bytes = data
        .get(index..index + 2)
        .ok_or(ProgramError::InvalidInstructionData)?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn read_u8(data: &[u8], cursor: &mut usize) -> Result<u8, ProgramError> {
    let value = *data
        .get(*cursor)
        .ok_or(ProgramError::InvalidInstructionData)?;
    *cursor += 1;
    Ok(value)
}

fn read_u16(data: &[u8], cursor: &mut usize) -> Result<u16, ProgramError> {
    let bytes = data
        .get(*cursor..*cursor + 2)
        .ok_or(ProgramError::InvalidInstructionData)?;
    *cursor += 2;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn read_u32(data: &[u8], cursor: &mut usize) -> Result<u32, ProgramError> {
    let bytes = data
        .get(*cursor..*cursor + 4)
        .ok_or(ProgramError::InvalidInstructionData)?;
    *cursor += 4;
    Ok(u32::from_le_bytes(bytes.try_into().map_err(|_| ProgramError::InvalidInstructionData)?))
}

fn read_u64(data: &[u8], cursor: &mut usize) -> Result<u64, ProgramError> {
    let bytes = data
        .get(*cursor..*cursor + 8)
        .ok_or(ProgramError::InvalidInstructionData)?;
    *cursor += 8;
    Ok(u64::from_le_bytes(bytes.try_into().map_err(|_| ProgramError::InvalidInstructionData)?))
}

fn read_i64(data: &[u8], cursor: &mut usize) -> Result<i64, ProgramError> {
    let bytes = data
        .get(*cursor..*cursor + 8)
        .ok_or(ProgramError::InvalidInstructionData)?;
    *cursor += 8;
    Ok(i64::from_le_bytes(bytes.try_into().map_err(|_| ProgramError::InvalidInstructionData)?))
}

fn read_fixed_32(data: &[u8], cursor: &mut usize) -> Result<[u8; 32], ProgramError> {
    let bytes = data
        .get(*cursor..*cursor + 32)
        .ok_or(ProgramError::InvalidInstructionData)?;
    *cursor += 32;
    bytes
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)
}

fn read_pubkey(data: &[u8], cursor: &mut usize) -> Result<Pubkey, ProgramError> {
    Ok(Pubkey::new_from_array(read_fixed_32(data, cursor)?))
}

fn read_pubkey_vec(data: &[u8], cursor: &mut usize) -> Result<Vec<Pubkey>, ProgramError> {
    let count = read_u16(data, cursor)? as usize;
    if count > MAX_ALLOWLIST_ITEMS {
        return Err(guard_error(GuardError::TooManyAllowlistItems));
    }
    let mut values = Vec::with_capacity(count);
    for _ in 0..count {
        values.push(read_pubkey(data, cursor)?);
    }
    Ok(values)
}

fn write_u16(buffer: &mut Vec<u8>, value: u16) {
    buffer.extend_from_slice(&value.to_le_bytes());
}

fn write_u32(buffer: &mut Vec<u8>, value: u32) {
    buffer.extend_from_slice(&value.to_le_bytes());
}

fn write_u64(buffer: &mut Vec<u8>, value: u64) {
    buffer.extend_from_slice(&value.to_le_bytes());
}

fn write_i64(buffer: &mut Vec<u8>, value: i64) {
    buffer.extend_from_slice(&value.to_le_bytes());
}

fn write_pubkey(buffer: &mut Vec<u8>, value: &Pubkey) {
    buffer.extend_from_slice(value.as_ref());
}

fn write_pubkey_vec(buffer: &mut Vec<u8>, values: &[Pubkey]) {
    write_u16(buffer, values.len() as u16);
    for value in values {
        write_pubkey(buffer, value);
    }
}

fn hex_32(bytes: &[u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(64);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn guard_error(error: GuardError) -> ProgramError {
    ProgramError::Custom(error as u32)
}

#[repr(u32)]
enum GuardError {
    AlreadyInitialized = 1,
    DailyLimitExceeded = 2,
    InvalidSessionTtl = 3,
    KillSwitchActive = 4,
    MalformedEd25519Instruction = 5,
    MissingEd25519Instruction = 6,
    NonceMismatch = 7,
    PolicyPdaMismatch = 8,
    ProgramNotAllowed = 9,
    ProofMessageMismatch = 10,
    RecipientMismatch = 11,
    RecipientNotAllowed = 12,
    SessionClosed = 13,
    SessionExpired = 14,
    SessionPdaMismatch = 15,
    TimestampInFuture = 16,
    TooManyAllowlistItems = 17,
    UnauthorizedOwner = 18,
    VaultInsufficientFunds = 19,
    VaultPdaMismatch = 20,
    VerifierMismatch = 21,
}

struct PolicyState {
    version: u8,
    bump: u8,
    vault_bump: u8,
    kill_switch_active: bool,
    session_ttl_minutes: u32,
    daily_spend_limit: u64,
    spent_today: u64,
    last_reset_day: i64,
    owner: Pubkey,
    verifier: Pubkey,
    allowed_programs: Vec<Pubkey>,
    allowed_recipients: Vec<Pubkey>,
}

impl PolicyState {
    fn space_for(
        allowed_programs: usize,
        allowed_recipients: usize,
    ) -> Result<usize, ProgramError> {
        let allowlist_items = allowed_programs
            .checked_add(allowed_recipients)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        if allowlist_items > MAX_ALLOWLIST_ITEMS {
            return Err(guard_error(GuardError::TooManyAllowlistItems));
        }
        Ok(POLICY_HEADER_LEN + allowlist_items * 32)
    }

    fn unpack(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() < POLICY_HEADER_LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        let mut cursor = 0usize;
        let version = read_u8(data, &mut cursor)?;
        let bump = read_u8(data, &mut cursor)?;
        let vault_bump = read_u8(data, &mut cursor)?;
        let kill_switch_active = read_u8(data, &mut cursor)? != 0;
        let session_ttl_minutes = read_u32(data, &mut cursor)?;
        let daily_spend_limit = read_u64(data, &mut cursor)?;
        let spent_today = read_u64(data, &mut cursor)?;
        let last_reset_day = read_i64(data, &mut cursor)?;
        let owner = read_pubkey(data, &mut cursor)?;
        let verifier = read_pubkey(data, &mut cursor)?;
        let allowed_programs = read_pubkey_vec(data, &mut cursor)?;
        let allowed_recipients = read_pubkey_vec(data, &mut cursor)?;

        Ok(Self {
            version,
            bump,
            vault_bump,
            kill_switch_active,
            session_ttl_minutes,
            daily_spend_limit,
            spent_today,
            last_reset_day,
            owner,
            verifier,
            allowed_programs,
            allowed_recipients,
        })
    }

    fn pack(&self, destination: &mut [u8]) -> ProgramResult {
        let expected_len =
            PolicyState::space_for(self.allowed_programs.len(), self.allowed_recipients.len())?;
        if destination.len() != expected_len {
            return Err(ProgramError::AccountDataTooSmall);
        }

        let mut buffer = Vec::with_capacity(destination.len());
        buffer.push(self.version);
        buffer.push(self.bump);
        buffer.push(self.vault_bump);
        buffer.push(u8::from(self.kill_switch_active));
        write_u32(&mut buffer, self.session_ttl_minutes);
        write_u64(&mut buffer, self.daily_spend_limit);
        write_u64(&mut buffer, self.spent_today);
        write_i64(&mut buffer, self.last_reset_day);
        write_pubkey(&mut buffer, &self.owner);
        write_pubkey(&mut buffer, &self.verifier);
        write_pubkey_vec(&mut buffer, &self.allowed_programs);
        write_pubkey_vec(&mut buffer, &self.allowed_recipients);

        destination.copy_from_slice(&buffer);
        Ok(())
    }
}

struct SessionState {
    version: u8,
    bump: u8,
    active: bool,
    policy: Pubkey,
    owner: Pubkey,
    session_id: [u8; 32],
    opened_at: i64,
    expires_at: i64,
    next_nonce: u64,
    last_verified_digest: [u8; 32],
}

impl SessionState {
    fn unpack(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() != SESSION_STATE_LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        let mut cursor = 0usize;
        let version = read_u8(data, &mut cursor)?;
        let bump = read_u8(data, &mut cursor)?;
        let active = read_u8(data, &mut cursor)? != 0;
        let policy = read_pubkey(data, &mut cursor)?;
        let owner = read_pubkey(data, &mut cursor)?;
        let session_id = read_fixed_32(data, &mut cursor)?;
        let opened_at = read_i64(data, &mut cursor)?;
        let expires_at = read_i64(data, &mut cursor)?;
        let next_nonce = read_u64(data, &mut cursor)?;
        let last_verified_digest = read_fixed_32(data, &mut cursor)?;

        Ok(Self {
            version,
            bump,
            active,
            policy,
            owner,
            session_id,
            opened_at,
            expires_at,
            next_nonce,
            last_verified_digest,
        })
    }

    fn pack(&self, destination: &mut [u8]) -> ProgramResult {
        if destination.len() != SESSION_STATE_LEN {
            return Err(ProgramError::AccountDataTooSmall);
        }

        let mut buffer = Vec::with_capacity(SESSION_STATE_LEN);
        buffer.push(self.version);
        buffer.push(self.bump);
        buffer.push(u8::from(self.active));
        write_pubkey(&mut buffer, &self.policy);
        write_pubkey(&mut buffer, &self.owner);
        buffer.extend_from_slice(&self.session_id);
        write_i64(&mut buffer, self.opened_at);
        write_i64(&mut buffer, self.expires_at);
        write_u64(&mut buffer, self.next_nonce);
        buffer.extend_from_slice(&self.last_verified_digest);

        destination.copy_from_slice(&buffer);
        Ok(())
    }
}

struct ExecuteTransferPayload {
    session_id: [u8; 32],
    nonce: u64,
    amount_lamports: u64,
    timestamp: i64,
    expires_at: i64,
    target_program: Pubkey,
    recipient: Pubkey,
    intent_hash: [u8; 32],
}

impl ExecuteTransferPayload {
    fn unpack(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() != 160 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut cursor = 0usize;
        let session_id = read_fixed_32(data, &mut cursor)?;
        let nonce = read_u64(data, &mut cursor)?;
        let amount_lamports = read_u64(data, &mut cursor)?;
        let timestamp = read_i64(data, &mut cursor)?;
        let expires_at = read_i64(data, &mut cursor)?;
        let target_program = read_pubkey(data, &mut cursor)?;
        let recipient = read_pubkey(data, &mut cursor)?;
        let intent_hash = read_fixed_32(data, &mut cursor)?;

        Ok(Self {
            session_id,
            nonce,
            amount_lamports,
            timestamp,
            expires_at,
            target_program,
            recipient,
            intent_hash,
        })
    }
}
