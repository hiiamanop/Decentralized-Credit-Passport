use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::{LookupMap, UnorderedSet};
use near_sdk::state::ContractState;
use near_sdk::{env, near_bindgen, AccountId, PanicOnDefault, BorshStorageKey};
use near_sdk::serde::{Deserialize, Serialize};

// Helper untuk log event
fn log_event(method: &str, data: String) {
    env::log_str(&format!("EVENT_JSON:{{\"standard\":\"nep171\",\"version\":\"1.0.0\",\"event\":\"{}\",\"data\":{}}}", method, data));
}

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    Passports,
    Oracles,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
#[borsh(crate = "near_sdk::borsh")]
pub struct CreditPassport {
    pub business_id: String,
    pub owner: AccountId,
    pub credit_score: u32,
    pub risk_level: String,
    pub verification_hash: String,
    pub last_updated: u64,
    pub authorized_viewers: Vec<AccountId>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct PublicCreditPassport {
    pub business_id: String,
    pub owner: AccountId,
    pub credit_score: u32,
    pub risk_level: String,
    pub last_updated: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct CreditPassportSummary {
    pub business_id: String,
    pub owner: AccountId,
    pub last_updated: u64,
    pub is_public: bool,
}

fn public_flag_storage_key(account_id: &AccountId) -> Vec<u8> {
    let mut key = b"PUBLIC_PASSPORT:".to_vec();
    key.extend_from_slice(account_id.as_bytes());
    key
}

fn read_public_flag(account_id: &AccountId) -> bool {
    env::storage_read(&public_flag_storage_key(account_id))
        .as_deref()
        .is_some_and(|v| v == [1u8])
}

fn write_public_flag(account_id: &AccountId, enabled: bool) {
    let key = public_flag_storage_key(account_id);
    if enabled {
        env::storage_write(&key, &[1u8]);
    } else {
        env::storage_remove(&key);
    }
}

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Contract {
    // Mapping dari AccountId pemilik ke CreditPassport mereka
    passports: LookupMap<AccountId, CreditPassport>,
    // Daftar akun (oracle/backend) yang boleh mengupdate skor kredit
    authorized_oracles: UnorderedSet<AccountId>,
}

impl ContractState for Contract {}

#[near_bindgen]
impl Contract {
    #[init]
    pub fn new(oracle_id: AccountId) -> Self {
        let mut authorized_oracles = UnorderedSet::new(StorageKey::Oracles);
        authorized_oracles.insert(&oracle_id);
        
        Self {
            passports: LookupMap::new(StorageKey::Passports),
            authorized_oracles,
        }
    }

    // --- Core Features ---

    /// MSME membuat identitas kredit baru
    pub fn create_credit_passport(
        &mut self, 
        business_id: String, 
        verification_hash: String
    ) {
        let owner = env::predecessor_account_id();
        
        // Cek apakah passport sudah ada
        if self.passports.contains_key(&owner) {
            env::panic_str("Credit Passport already exists for this account");
        }

        let passport = CreditPassport {
            business_id: business_id.clone(),
            owner: owner.clone(),
            credit_score: 0, // Default awal
            risk_level: "Unassessed".to_string(),
            verification_hash,
            last_updated: env::block_timestamp(),
            authorized_viewers: Vec::new(),
        };

        self.passports.insert(&owner, &passport);

        // Log event creation
        env::log_str(&format!("Credit Passport created for business: {}", business_id));
    }

    /// Oracle/Backend mengupdate skor kredit setelah perhitungan AI off-chain
    pub fn update_credit_score(
        &mut self, 
        owner_id: AccountId, 
        new_score: u32, 
        new_risk_level: String,
        new_verification_hash: String
    ) {
        let caller = env::predecessor_account_id();
        
        // Access Control: Hanya oracle yang boleh update
        if !self.authorized_oracles.contains(&caller) {
            env::panic_str("Unauthorized: Only oracles can update credit scores");
        }

        let mut passport = self.passports.get(&owner_id).expect("Credit Passport not found");

        passport.credit_score = new_score;
        passport.risk_level = new_risk_level;
        passport.verification_hash = new_verification_hash;
        passport.last_updated = env::block_timestamp();

        self.passports.insert(&owner_id, &passport);

        env::log_str(&format!("Credit Score updated for account: {}", owner_id));
    }

    /// MSME memberikan izin kepada lender/bank untuk melihat passport mereka
    pub fn grant_access(&mut self, viewer_id: AccountId) {
        let owner = env::predecessor_account_id();
        let mut passport = self.passports.get(&owner).expect("Credit Passport not found");

        if !passport.authorized_viewers.contains(&viewer_id) {
            passport.authorized_viewers.push(viewer_id.clone());
            self.passports.insert(&owner, &passport);
            env::log_str(&format!("Access granted to: {}", viewer_id));
        }
    }

    /// Mengambil data Credit Passport (Hanya Owner atau Authorized Viewer)
    pub fn get_credit_passport(&self, account_id: AccountId) -> Option<CreditPassport> {
        let caller = env::predecessor_account_id();
        let passport = self.passports.get(&account_id)?;

        // Logika Privasi:
        // 1. Jika caller adalah pemilik passport -> OK
        // 2. Jika caller ada di list authorized_viewers -> OK
        // 3. Jika caller adalah oracle (opsional, untuk debugging) -> OK
        // Jika tidak, return None atau panic. Di sini kita return None untuk keamanan.
        
        let is_owner = caller == passport.owner;
        let is_authorized = passport.authorized_viewers.contains(&caller);
        let is_oracle = self.authorized_oracles.contains(&caller);

        if is_owner || is_authorized || is_oracle {
            Some(passport)
        } else {
            env::panic_str("Unauthorized: You do not have permission to view this Credit Passport");
        }
    }

    /// Fungsi publik untuk mengecek apakah passport valid (tanpa melihat detail sensitif skor jika tidak diizinkan)
    /// Mengembalikan true jika passport ada.
    pub fn verify_passport_existence(&self, account_id: AccountId) -> bool {
        self.passports.contains_key(&account_id)
    }

    /// Verifikasi hash passport tanpa membuka data sensitif.
    /// Mengembalikan true jika passport ada dan hash cocok.
    pub fn verify_credit_passport(&self, account_id: AccountId, expected_verification_hash: String) -> bool {
        let passport = match self.passports.get(&account_id) {
            Some(p) => p,
            None => return false,
        };
        passport.verification_hash == expected_verification_hash
    }

    pub fn set_passport_public(&mut self, enabled: bool) {
        let owner = env::predecessor_account_id();
        self.passports.get(&owner).expect("Credit Passport not found");
        write_public_flag(&owner, enabled);
    }

    pub fn is_passport_public(&self, account_id: AccountId) -> bool {
        read_public_flag(&account_id)
    }

    pub fn get_credit_passport_public(&self, account_id: AccountId) -> Option<PublicCreditPassport> {
        if !read_public_flag(&account_id) {
            return None;
        }
        let passport = self.passports.get(&account_id)?;
        Some(PublicCreditPassport {
            business_id: passport.business_id,
            owner: passport.owner,
            credit_score: passport.credit_score,
            risk_level: passport.risk_level,
            last_updated: passport.last_updated,
        })
    }

    pub fn get_credit_passport_summary(&self, account_id: AccountId) -> Option<CreditPassportSummary> {
        let passport = self.passports.get(&account_id)?;
        Some(CreditPassportSummary {
            business_id: passport.business_id,
            owner: passport.owner,
            last_updated: passport.last_updated,
            is_public: read_public_flag(&account_id),
        })
    }

    // --- Admin Functions ---

    pub fn add_oracle(&mut self, oracle_id: AccountId) {
        // Dalam implementasi nyata, ini harus dibatasi hanya untuk admin kontrak/DAO
        // Untuk hackathon, kita asumsikan oracle pertama (deployer) bisa menambah yang lain
        // atau kita sederhanakan siapa saja bisa memanggil (TIDAK AMAN untuk prod, tapi ok untuk demo cepat jika dijelaskan)
        // Disini saya akan membatasi hanya oracle yang sudah ada yang bisa menambah oracle baru.
        let caller = env::predecessor_account_id();
        if !self.authorized_oracles.contains(&caller) {
             env::panic_str("Unauthorized");
        }
        self.authorized_oracles.insert(&oracle_id);
    }
}

/*
 * The rest of this file holds the inline tests for the code above
 * Learn more about Rust tests: https://doc.rust-lang.org/book/ch11-01-writing-tests.html
 */
#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn get_context(predecessor_account_id: AccountId) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(accounts(0))
            .signer_account_id(predecessor_account_id.clone())
            .predecessor_account_id(predecessor_account_id);
        builder
    }

    #[test]
    fn test_create_passport() {
        let mut context = get_context(accounts(1));
        testing_env!(context.build());
        
        let mut contract = Contract::new(accounts(0)); // accounts(0) is oracle
        
        contract.create_credit_passport("BIZ-123".to_string(), "hash_abc".to_string());
        
        let passport = contract.get_credit_passport(accounts(1)).unwrap();
        assert_eq!(passport.business_id, "BIZ-123");
        assert_eq!(passport.credit_score, 0);
    }

    #[test]
    fn test_update_score_by_oracle() {
        // 1. User creates passport
        let mut context = get_context(accounts(1));
        testing_env!(context.build());
        let mut contract = Contract::new(accounts(0)); // accounts(0) is oracle
        contract.create_credit_passport("BIZ-123".to_string(), "hash_abc".to_string());

        // 2. Oracle updates score
        testing_env!(context.predecessor_account_id(accounts(0)).build());
        contract.update_credit_score(accounts(1), 750, "Low Risk".to_string(), "hash_updated".to_string());

        // 3. Verify update
        testing_env!(context.predecessor_account_id(accounts(1)).build()); // Back to user to view
        let passport = contract.get_credit_passport(accounts(1)).unwrap();
        assert_eq!(passport.credit_score, 750);
        assert_eq!(passport.risk_level, "Low Risk");
    }

    #[test]
    #[should_panic(expected = "Unauthorized: Only oracles can update credit scores")]
    fn test_update_score_unauthorized() {
        let mut context = get_context(accounts(1));
        testing_env!(context.build());
        let mut contract = Contract::new(accounts(0));
        contract.create_credit_passport("BIZ-123".to_string(), "hash_abc".to_string());

        // Attacker tries to update
        testing_env!(context.predecessor_account_id(accounts(2)).build());
        contract.update_credit_score(accounts(1), 999, "Fake Risk".to_string(), "fake_hash".to_string());
    }

    #[test]
    fn test_grant_access() {
        let mut context = get_context(accounts(1)); // Owner
        testing_env!(context.build());
        let mut contract = Contract::new(accounts(0));
        contract.create_credit_passport("BIZ-123".to_string(), "hash_abc".to_string());

        // Grant access to Lender (accounts(2))
        contract.grant_access(accounts(2));

        // Switch to Lender context
        testing_env!(context.predecessor_account_id(accounts(2)).build());
        let passport = contract.get_credit_passport(accounts(1));
        assert!(passport.is_some());
    }

    #[test]
    #[should_panic(expected = "Unauthorized: You do not have permission to view this Credit Passport")]
    fn test_view_unauthorized() {
        let mut context = get_context(accounts(1)); // Owner
        testing_env!(context.build());
        let mut contract = Contract::new(accounts(0));
        contract.create_credit_passport("BIZ-123".to_string(), "hash_abc".to_string());

        // Random user (accounts(3)) tries to view
        testing_env!(context.predecessor_account_id(accounts(3)).build());
        contract.get_credit_passport(accounts(1));
    }

    #[test]
    fn test_view_public_summary() {
        let mut context = get_context(accounts(1));
        testing_env!(context.build());
        let mut contract = Contract::new(accounts(0));
        contract.create_credit_passport("BIZ-123".to_string(), "hash_abc".to_string());

        let public_before = contract.get_credit_passport_public(accounts(1));
        assert!(public_before.is_none());

        contract.set_passport_public(true);

        let public_after = contract.get_credit_passport_public(accounts(1)).unwrap();
        assert_eq!(public_after.business_id, "BIZ-123");
        assert_eq!(public_after.credit_score, 0);

        let summary = contract.get_credit_passport_summary(accounts(1)).unwrap();
        assert!(summary.is_public);
    }
}
