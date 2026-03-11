import { connect, KeyPair, keyStores, utils, Contract } from "near-api-js";
import dotenv from "dotenv";
import express, { Request, Response } from "express";
import path from "path";
import os from "os";
import axios from "axios";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:5000";

// --- KONFIGURASI NEAR ---
const CREDENTIALS_DIR = path.join(os.homedir(), ".near-credentials");
const NETWORK_ID = process.env.NEAR_NETWORK || "testnet";
const ORACLE_ACCOUNT_ID = process.env.ORACLE_ACCOUNT_ID || "";
// Private Key Oracle (Simpan di .env untuk keamanan)
const ORACLE_PRIVATE_KEY = process.env.ORACLE_PRIVATE_KEY || "";
const CONTRACT_ID = process.env.CONTRACT_ID || "";

// --- NEAR CONNECTION ---
async function initNear() {
    const keyStore = new keyStores.InMemoryKeyStore();
    // Tambahkan key oracle ke keystore
    if (ORACLE_ACCOUNT_ID && ORACLE_PRIVATE_KEY) {
        const keyPair = KeyPair.fromString(ORACLE_PRIVATE_KEY);
        await keyStore.setKey(NETWORK_ID, ORACLE_ACCOUNT_ID, keyPair);
    }

    const config = {
        networkId: NETWORK_ID,
        keyStore,
        nodeUrl: `https://rpc.${NETWORK_ID}.near.org`,
        walletUrl: `https://wallet.${NETWORK_ID}.near.org`,
        helperUrl: `https://helper.${NETWORK_ID}.near.org`,
    };

    return await connect(config);
}

// --- API ROUTES ---

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
        const near = await initNear();
        const oracleAccount = await near.account(ORACLE_ACCOUNT_ID);

        // 3. Panggil Smart Contract (update_credit_score)
        const verificationHash = `ai_verified_${Date.now()}_${credit_score}`;

        console.log("Sending transaction to NEAR blockchain...");
        
        const outcome = await oracleAccount.functionCall({
            contractId: CONTRACT_ID,
            methodName: "update_credit_score",
            args: {
                owner_id: accountId,
                new_score: credit_score,
                new_risk_level: risk_level,
                new_verification_hash: verificationHash
            },
            gas: BigInt("30000000000000"), // 30 Tgas
            attachedDeposit: BigInt("0") // 0 NEAR
        });

        console.log("Transaction successful!");
        
        const explorerUrl = `https://explorer.${NETWORK_ID}.near.org/transactions/${outcome.transaction.hash}`;

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

app.get("/", (req, res) => {
    res.send("Credit Passport AI Oracle is Running!");
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Oracle Account: ${ORACLE_ACCOUNT_ID}`);
    console.log(`Contract ID: ${CONTRACT_ID}`);
});
