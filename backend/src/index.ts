import { Account, actions, JsonRpcProvider } from "near-api-js";
import type { KeyPairString } from "near-api-js";
import dotenv from "dotenv";
import express, { Request, Response } from "express";
import axios from "axios";
import { createInMemoryStore } from "./data-gateway/store.js";
import { handleIngest, handleListEvents, handleStream, handleSummary } from "./data-gateway/gateway.js";
import type { SourceType, TransactionEvent } from "./data-gateway/types.js";
import { engineerTransactionFeatures } from "./features/feature-engineering.js";
import { computePassportHash } from "./credit-passport/passport-hash.js";

dotenv.config();

const app = express();
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    if (req.method === "OPTIONS") {
        res.status(204).end();
        return;
    }
    next();
});
app.use(
    express.json({
        verify: (req, _res, buf) => {
            (req as any).rawBody = buf.toString("utf8");
        },
    })
);

const PORT = process.env.PORT || 3000;
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:5000";

// --- KONFIGURASI NEAR ---
const NETWORK_ID = process.env.NEAR_NETWORK || "testnet";
const ORACLE_ACCOUNT_ID = process.env.ORACLE_ACCOUNT_ID || "";
// Private Key Oracle (Simpan di .env untuk keamanan)
const ORACLE_PRIVATE_KEY = (process.env.ORACLE_PRIVATE_KEY || "") as KeyPairString | "";
const CONTRACT_ID = process.env.CONTRACT_ID || "";
const NEAR_RPC_URL =
    process.env.NEAR_RPC_URL ||
    process.env.NEAR_NODE_URL ||
    (NETWORK_ID === "testnet" ? "https://rpc.testnet.fastnear.com" : `https://rpc.${NETWORK_ID}.near.org`);

function isSkipOnchain(): boolean {
    const v = String(process.env.SKIP_ONCHAIN_UPDATE || "").toLowerCase();
    return v === "1" || v === "true";
}

function validateOraclePrivateKey(): void {
    if (!ORACLE_PRIVATE_KEY) return;
    const key = String(ORACLE_PRIVATE_KEY);
    const prefix = "ed25519:";
    if (!key.startsWith(prefix)) return;
    const body = key.slice(prefix.length);
    if (!body.length) {
        throw new Error("ORACLE_PRIVATE_KEY is invalid (empty after ed25519:)");
    }
    const base58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
    if (!base58.test(body)) {
        throw new Error("ORACLE_PRIVATE_KEY is invalid (must be base58 after ed25519:; do not use '_' or other symbols)");
    }
}

type LocalPassport = {
    business_id: string;
    owner: string;
    credit_score: number;
    risk_level: string;
    verification_hash: string;
    last_updated: number;
    is_public: boolean;
};

const localPassports = new Map<string, LocalPassport>();

function getOrInitLocalPassport(ownerId: string, businessId: string): LocalPassport {
    const existing = localPassports.get(ownerId);
    if (existing) return existing;
    const p: LocalPassport = {
        business_id: businessId,
        owner: ownerId,
        credit_score: 0,
        risk_level: "unknown",
        verification_hash: `init_${Date.now()}`,
        last_updated: Date.now(),
        is_public: false,
    };
    localPassports.set(ownerId, p);
    return p;
}

function getOracleAccount(): Account {
    if (!ORACLE_ACCOUNT_ID) {
        throw new Error("ORACLE_ACCOUNT_ID is not set");
    }
    if (!ORACLE_PRIVATE_KEY) {
        throw new Error("ORACLE_PRIVATE_KEY is not set");
    }
    validateOraclePrivateKey();
    return new Account(ORACLE_ACCOUNT_ID, NEAR_RPC_URL, ORACLE_PRIVATE_KEY);
}

function getProvider(): JsonRpcProvider {
    return new JsonRpcProvider({ url: NEAR_RPC_URL });
}

// --- API ROUTES ---

class GatewayBus {
    private listeners = new Set<(event: TransactionEvent) => void>();
    on(cb: (event: TransactionEvent) => void) {
        this.listeners.add(cb);
    }
    off(cb: (event: TransactionEvent) => void) {
        this.listeners.delete(cb);
    }
    emit(event: TransactionEvent) {
        for (const cb of this.listeners) cb(event);
    }
}

const gatewayStore = createInMemoryStore();
const gatewayBus = new GatewayBus();
(app as any).locals.gatewayBus = gatewayBus;

const sourceSecrets: Partial<Record<SourceType, string>> = {
    qris: process.env.SOURCE_SECRET_QRIS,
    marketplace: process.env.SOURCE_SECRET_MARKETPLACE,
    ewallet: process.env.SOURCE_SECRET_EWALLET,
    bank: process.env.SOURCE_SECRET_BANK,
};

const gatewayDeps = {
    store: gatewayStore,
    env: { secrets: sourceSecrets },
    publish: (event: TransactionEvent) => gatewayBus.emit(event),
};

app.get("/config", (_req: Request, res: Response) => {
    res.json({
        networkId: NETWORK_ID,
        rpcUrl: NEAR_RPC_URL,
        oracleAccountId: ORACLE_ACCOUNT_ID,
        contractId: CONTRACT_ID,
        aiServiceUrl: AI_SERVICE_URL,
    });
});

app.post("/ingest/qris", handleIngest("qris", gatewayDeps));
app.post("/ingest/marketplace", handleIngest("marketplace", gatewayDeps));
app.post("/ingest/ewallet", handleIngest("ewallet", gatewayDeps));
app.post("/ingest/bank", handleIngest("bank", gatewayDeps));

app.get("/gateway/events", handleListEvents(gatewayDeps));
app.get("/gateway/summary", handleSummary(gatewayDeps));
app.get("/gateway/stream", handleStream(gatewayDeps));

app.get("/gateway/features", (req: Request, res: Response) => {
    const merchantId = typeof req.query.merchantId === "string" ? req.query.merchantId : null;
    const windowDays = Number(req.query.windowDays ?? 90) || 90;
    if (!merchantId) {
        res.status(400).json({ error: "merchantId is required" });
        return;
    }
    const events = gatewayStore.events.filter((e) => e.merchant_id === merchantId);
    const features = engineerTransactionFeatures({ events, windowDays });
    res.json({ merchantId, features });
});

app.post("/calculate-score-from-gateway", async (req: Request, res: Response): Promise<void> => {
    try {
        const { accountId, merchantId, windowDays } = req.body ?? {};
        if (!accountId || !merchantId) {
            res.status(400).json({ error: "Missing accountId or merchantId" });
            return;
        }

        const events = gatewayStore.events.filter((e) => e.merchant_id === String(merchantId));
        const features = engineerTransactionFeatures({ events, windowDays: Number(windowDays ?? 90) || 90 });

        const aiResp = await axios.post(`${AI_SERVICE_URL}/score-features`, { feature_version: features.feature_version, features });
        const ai = aiResp.data as {
            credit_score: number;
            risk_category: string;
            probability_of_default: number;
            model_version: string;
            feature_version: string;
        };

        const passportPayload = {
            passport_version: "v1",
            owner_account_id: String(accountId),
            merchant_id: String(merchantId),
            data_window: features.window,
            features,
            ai_score: {
                credit_score: ai.credit_score,
                risk_category: ai.risk_category,
                probability_of_default: ai.probability_of_default,
                model_version: ai.model_version,
                feature_version: ai.feature_version,
            },
            sources: {
                sources: features.sources,
                channels: features.channels,
            },
        };

        const verificationHash = computePassportHash(passportPayload);

        const skipOnchain = isSkipOnchain();
        if (skipOnchain) {
            const ownerId = String(accountId);
            const p = getOrInitLocalPassport(ownerId, `BIZ-${String(merchantId)}`);
            p.credit_score = ai.credit_score;
            p.risk_level = ai.risk_category;
            p.verification_hash = verificationHash;
            p.last_updated = Date.now();
            localPassports.set(ownerId, p);
            res.json({
                success: true,
                passport: passportPayload,
                verificationHash,
                explorerUrl: null,
                onchainUpdated: false,
            });
            return;
        }

        const oracleAccount = getOracleAccount();
        if (!CONTRACT_ID) {
            res.status(500).json({ success: false, error: "CONTRACT_ID is not set" });
            return;
        }

        const outcome = await oracleAccount.signAndSendTransaction({
            receiverId: CONTRACT_ID,
            actions: [
                actions.functionCall(
                    "update_credit_score",
                    {
                        owner_id: accountId,
                        new_score: ai.credit_score,
                        new_risk_level: ai.risk_category,
                        new_verification_hash: verificationHash,
                    },
                    BigInt("30000000000000"),
                    BigInt(0)
                ),
            ],
        });

        const txHash =
            (outcome as any)?.transaction?.hash ||
            (outcome as any)?.transaction_outcome?.id ||
            (outcome as any)?.transaction?.transaction?.hash;
        const explorerUrl = txHash ? `https://testnet.nearblocks.io/txns/${txHash}` : null;

        res.json({
            success: true,
            passport: passportPayload,
            verificationHash,
            explorerUrl,
            onchainUpdated: true,
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message || "Internal Server Error" });
    }
});

app.post("/verify-passport-hash", async (req: Request, res: Response): Promise<void> => {
    try {
        const { accountId, passport, expectedHash } = req.body ?? {};
        if (!accountId || !passport) {
            res.status(400).json({ error: "Missing accountId or passport" });
            return;
        }
        const computed = computePassportHash(passport);
        const match = expectedHash ? String(expectedHash) === computed : null;

        res.json({ accountId, computedHash: computed, matchesExpected: match });
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Internal Server Error" });
    }
});

app.get("/passport/summary/:accountId", async (req: Request, res: Response): Promise<void> => {
    try {
        const { accountId } = req.params;
        if (isSkipOnchain()) {
            const ownerId = String(accountId);
            res.json({ accountId: ownerId, summary: localPassports.get(ownerId) ?? null });
            return;
        }
        if (!CONTRACT_ID) {
            res.status(500).json({ error: "CONTRACT_ID is not set" });
            return;
        }
        const provider = getProvider();
        const result = await provider.callFunction({
            contractId: CONTRACT_ID,
            method: "get_credit_passport_summary",
            args: { account_id: accountId },
        });
        res.json({ accountId, summary: result ?? null });
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Failed to fetch summary" });
    }
});

app.get("/passport/public/:accountId", async (req: Request, res: Response): Promise<void> => {
    try {
        const { accountId } = req.params;
        if (isSkipOnchain()) {
            const ownerId = String(accountId);
            const p = localPassports.get(ownerId) ?? null;
            if (!p || !p.is_public) {
                res.json({ accountId: ownerId, public: null });
                return;
            }
            res.json({
                accountId: ownerId,
                public: {
                    business_id: p.business_id,
                    owner: p.owner,
                    credit_score: p.credit_score,
                    risk_level: p.risk_level,
                    last_updated: p.last_updated,
                },
            });
            return;
        }
        if (!CONTRACT_ID) {
            res.status(500).json({ error: "CONTRACT_ID is not set" });
            return;
        }
        const provider = getProvider();
        const result = await provider.callFunction({
            contractId: CONTRACT_ID,
            method: "get_credit_passport_public",
            args: { account_id: accountId },
        });
        res.json({ accountId, public: result ?? null });
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Failed to fetch public passport" });
    }
});

app.post("/passport/create", async (req: Request, res: Response): Promise<void> => {
    try {
        if (isSkipOnchain()) {
            const ownerId = String(req.body?.accountId || ORACLE_ACCOUNT_ID || "");
            if (!ownerId) {
                res.status(400).json({ success: false, error: "Missing accountId" });
                return;
            }
            const businessId = String(req.body?.businessId || `BIZ-${Date.now()}`);
            const verificationHash = String(req.body?.verificationHash || `init_${Date.now()}`);
            const p = getOrInitLocalPassport(ownerId, businessId);
            p.business_id = businessId;
            p.verification_hash = verificationHash;
            p.last_updated = Date.now();
            localPassports.set(ownerId, p);
            res.json({ success: true, businessId, verificationHash, explorerUrl: null, onchainUpdated: false });
            return;
        }
        if (!CONTRACT_ID) {
            res.status(500).json({ error: "CONTRACT_ID is not set" });
            return;
        }
        const oracleAccount = getOracleAccount();
        const businessId = String(req.body?.businessId || `BIZ-${Date.now()}`);
        const verificationHash = String(req.body?.verificationHash || `init${Date.now()}`);
        const outcome = await oracleAccount.signAndSendTransaction({
            receiverId: CONTRACT_ID,
            actions: [
                actions.functionCall(
                    "create_credit_passport",
                    { business_id: businessId, verification_hash: verificationHash },
                    BigInt("30000000000000"),
                    BigInt(0)
                ),
            ],
        });

        const txHash =
            (outcome as any)?.transaction?.hash ||
            (outcome as any)?.transaction_outcome?.id ||
            (outcome as any)?.transaction?.transaction?.hash;
        const explorerUrl = txHash ? `https://testnet.nearblocks.io/txns/${txHash}` : null;
        res.json({ success: true, businessId, verificationHash, explorerUrl, onchainUpdated: true });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message || "Failed to create passport" });
    }
});

app.post("/passport/public", async (req: Request, res: Response): Promise<void> => {
    try {
        if (isSkipOnchain()) {
            const ownerId = String(req.body?.accountId || ORACLE_ACCOUNT_ID || "");
            if (!ownerId) {
                res.status(400).json({ success: false, error: "Missing accountId" });
                return;
            }
            const enabled = Boolean(req.body?.enabled);
            const p = localPassports.get(ownerId);
            if (!p) {
                res.status(404).json({ success: false, error: "Credit Passport not found" });
                return;
            }
            p.is_public = enabled;
            p.last_updated = Date.now();
            localPassports.set(ownerId, p);
            res.json({ success: true, enabled, explorerUrl: null, onchainUpdated: false });
            return;
        }
        if (!CONTRACT_ID) {
            res.status(500).json({ error: "CONTRACT_ID is not set" });
            return;
        }
        const enabled = Boolean(req.body?.enabled);
        const oracleAccount = getOracleAccount();
        const outcome = await oracleAccount.signAndSendTransaction({
            receiverId: CONTRACT_ID,
            actions: [actions.functionCall("set_passport_public", { enabled }, BigInt("30000000000000"), BigInt(0))],
        });

        const txHash =
            (outcome as any)?.transaction?.hash ||
            (outcome as any)?.transaction_outcome?.id ||
            (outcome as any)?.transaction?.transaction?.hash;
        const explorerUrl = txHash ? `https://testnet.nearblocks.io/txns/${txHash}` : null;
        res.json({ success: true, enabled, explorerUrl, onchainUpdated: true });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message || "Failed to set public flag" });
    }
});

// Endpoint untuk Frontend meminta scoring
app.post("/calculate-score", async (req: Request, res: Response): Promise<void> => {
    try {
        const { accountId, financialData } = req.body;

        if (!accountId || !financialData) {
            res.status(400).json({ error: "Missing accountId or financialData" });
            return;
        }

        console.log(`Received scoring request for: ${accountId}`);
        console.log("Financial Data:", financialData);

        // 1. Panggil AI Service (Python)
        console.log("Calling AI Service...");
        let aiResult;
        try {
            // Mapping input frontend ke format model Python
            // Frontend mungkin kirim: { monthlyIncome: 5000, age: 30, ... }
            // Model butuh: person_income, person_age, dll.
            const modelInput = {
                person_age: financialData.age || 30,
                person_income: financialData.monthlyIncome * 12 || 60000, // Asumsi monthly -> annual
                person_home_ownership: financialData.homeOwnership || 'RENT',
                person_emp_length: financialData.empLength || 2.0,
                loan_intent: financialData.loanIntent || 'PERSONAL',
                loan_grade: financialData.loanGrade || 'B',
                loan_amnt: financialData.loanAmount || 1000,
                loan_int_rate: financialData.loanIntRate || 10.0,
                loan_percent_income: (financialData.loanAmount || 1000) / (financialData.monthlyIncome * 12 || 60000),
                cb_person_default_on_file: financialData.defaultHistory ? 'Y' : 'N',
                cb_person_cred_hist_length: financialData.creditHistoryLen || 2
            };

            const response = await axios.post(`${AI_SERVICE_URL}/predict-score`, modelInput);
            aiResult = response.data;
            console.log("AI Result:", aiResult);
        } catch (error) {
            console.error("Failed to call AI Service:", error);
            // Fallback jika AI service mati (untuk demo tetap jalan)
            aiResult = { credit_score: 300, risk_level: "Unknown (AI Error)", verification_hash: "error" };
        }

        const { credit_score, risk_level } = aiResult;

        const verificationHash = computePassportHash({
            passport_version: "v1",
            owner_account_id: String(accountId),
            legacy_model: true,
            ai_score: { credit_score, risk_level },
            ts: Date.now(),
        });

        if (isSkipOnchain()) {
            const ownerId = String(accountId);
            const p = getOrInitLocalPassport(ownerId, `BIZ-${ownerId}`);
            p.credit_score = credit_score;
            p.risk_level = risk_level;
            p.verification_hash = verificationHash;
            p.last_updated = Date.now();
            localPassports.set(ownerId, p);
            res.json({
                success: true,
                score: credit_score,
                risk: risk_level,
                verificationHash,
                explorerUrl: null,
                onchainUpdated: false,
                aiDetails: aiResult,
            });
            return;
        }

        const oracleAccount = getOracleAccount();

        console.log("Sending transaction to NEAR blockchain...");
        
        if (!CONTRACT_ID) {
            res.status(500).json({ success: false, error: "CONTRACT_ID is not set" });
            return;
        }

        const outcome = await oracleAccount.signAndSendTransaction({
            receiverId: CONTRACT_ID,
            actions: [
                actions.functionCall(
                    "update_credit_score",
                    {
                        owner_id: accountId,
                        new_score: credit_score,
                        new_risk_level: risk_level,
                        new_verification_hash: verificationHash
                    },
                    BigInt("30000000000000"),
                    BigInt(0)
                )
            ]
        });

        console.log("Transaction successful!");
        
        const txHash =
            (outcome as any)?.transaction?.hash ||
            (outcome as any)?.transaction_outcome?.id ||
            (outcome as any)?.transaction?.transaction?.hash;
        const explorerUrl = txHash ? `https://testnet.nearblocks.io/txns/${txHash}` : null;

        res.json({
            success: true,
            score: credit_score,
            risk: risk_level,
            verificationHash,
            explorerUrl,
            onchainUpdated: true,
            aiDetails: aiResult
        });

    } catch (error: any) {
        console.error("Error processing score:", error);
        res.status(500).json({ 
            success: false, 
            error: error.message || "Internal Server Error" 
        });
    }
});

app.get("/", (_req, res) => {
    res.json({
        status: "ok",
        service: "credit-passport-ai-oracle",
        routes: ["/config", "/passport/summary/:accountId", "/passport/public/:accountId", "/passport/create", "/passport/public", "/calculate-score"],
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Oracle Account: ${ORACLE_ACCOUNT_ID}`);
    console.log(`Contract ID: ${CONTRACT_ID}`);
    console.log("Routes enabled: /config, /passport/*, /calculate-score");
});
