import { Account, actions, JsonRpcProvider } from "near-api-js";
import type { KeyPairString } from "near-api-js";
import dotenv from "dotenv";
import express, { Request, Response } from "express";
import axios from "axios";

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
app.use(express.json());

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

function getOracleAccount(): Account {
    if (!ORACLE_ACCOUNT_ID) {
        throw new Error("ORACLE_ACCOUNT_ID is not set");
    }
    if (!ORACLE_PRIVATE_KEY) {
        throw new Error("ORACLE_PRIVATE_KEY is not set");
    }
    return new Account(ORACLE_ACCOUNT_ID, NEAR_RPC_URL, ORACLE_PRIVATE_KEY);
}

function getProvider(): JsonRpcProvider {
    return new JsonRpcProvider({ url: NEAR_RPC_URL });
}

// --- API ROUTES ---

app.get("/config", (_req: Request, res: Response) => {
    res.json({
        networkId: NETWORK_ID,
        rpcUrl: NEAR_RPC_URL,
        oracleAccountId: ORACLE_ACCOUNT_ID,
        contractId: CONTRACT_ID,
        aiServiceUrl: AI_SERVICE_URL,
    });
});

app.get("/passport/summary/:accountId", async (req: Request, res: Response): Promise<void> => {
    try {
        const { accountId } = req.params;
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
        if (!CONTRACT_ID) {
            res.status(500).json({ error: "CONTRACT_ID is not set" });
            return;
        }
        const oracleAccount = getOracleAccount();
        const businessId = String(req.body?.businessId || `BIZ-${Date.now()}`);
        const verificationHash = String(req.body?.verificationHash || `init_${Date.now()}`);
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
        res.json({ success: true, businessId, verificationHash, explorerUrl });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message || "Failed to create passport" });
    }
});

app.post("/passport/public", async (req: Request, res: Response): Promise<void> => {
    try {
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
        res.json({ success: true, enabled, explorerUrl });
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

        // 2. Hubungkan ke NEAR
        const oracleAccount = getOracleAccount();

        // 3. Panggil Smart Contract (update_credit_score)
        const verificationHash = `ai_verified_${Date.now()}_${credit_score}`;

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
