"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBalancesAndRelativeValues = void 0;
const web3_js_1 = require("@solana/web3.js");
const anchor_1 = require("@project-serum/anchor");
const spl_token_1 = require("@solana/spl-token");
const buffer_1 = require("buffer");
const web3_js_2 = require("@solana/web3.js");
function createWalletFromBase64(base64PrivateKey) {
    const privateKeyBytes = buffer_1.Buffer.from(base64PrivateKey, 'base64');
    const keypair = web3_js_1.Keypair.fromSecretKey(privateKeyBytes);
    return new anchor_1.Wallet(keypair);
}
function getTokenDecimals(connection, mintAddress) {
    return __awaiter(this, void 0, void 0, function* () {
        const info = yield connection.getParsedAccountInfo(mintAddress);
        if (info.value && info.value.data && "parsed" in info.value.data) {
            return info.value.data.parsed.info.decimals;
        }
        else {
            throw new Error("Failed to retrieve or parse token decimals.");
        }
    });
}
function getBalancesAndRelativeValues(senderPrivateKeyBase64, splTokenMintAddress) {
    return __awaiter(this, void 0, void 0, function* () {
        const connection = new web3_js_1.Connection('https://maximum-holy-arrow.solana-mainnet.quiknode.pro/61014782ec5a4688657111e0af0040634fdfeb19/', 'confirmed');
        const senderPrivateKeyBytes = buffer_1.Buffer.from(senderPrivateKeyBase64, 'base64');
        const senderKeypair = web3_js_1.Keypair.fromSecretKey(senderPrivateKeyBytes);
        const tokenMintPublicKey = new web3_js_1.PublicKey(splTokenMintAddress);
        try {
            // Get or create the associated token account for the sender
            const senderTokenAccount = yield (0, spl_token_1.getOrCreateAssociatedTokenAccount)(connection, senderKeypair, tokenMintPublicKey, senderKeypair.publicKey);
            // Fetch and decode token balance
            const senderTokenAccountInfo = yield connection.getAccountInfo(senderTokenAccount.address);
            if (!senderTokenAccountInfo)
                throw new Error("Sender's SPL token account not found.");
            const tokenDecimals = yield getTokenDecimals(connection, tokenMintPublicKey);
            const splLamp = senderTokenAccountInfo.lamports;
            const senderTokenBalance = senderTokenAccountInfo.lamports / Math.pow(10, tokenDecimals);
            // Fetch SOL balance
            const senderSOLAccountInfo = yield connection.getAccountInfo(senderKeypair.publicKey);
            if (!senderSOLAccountInfo) {
                throw new Error("Sender SOL account not found.");
            }
            const solLamp = senderSOLAccountInfo.lamports;
            const solBalance = solLamp / web3_js_2.LAMPORTS_PER_SOL;
            // Calculate relative values based on token and SOL balances
            const totalValueInSol = solBalance + (senderTokenBalance * (Math.pow(10, tokenDecimals) / web3_js_2.LAMPORTS_PER_SOL));
            const relativeSol = solBalance / totalValueInSol;
            const relativeSplToken = (senderTokenBalance * (Math.pow(10, tokenDecimals) / web3_js_2.LAMPORTS_PER_SOL)) / totalValueInSol;
            console.log(`Sender token balance: ${senderTokenBalance}`);
            console.log(`Sender SOL balance (SOL): ${solBalance}`);
            console.log(`Relative SOL: ${relativeSol.toFixed(4)}, Relative SPL Token: ${relativeSplToken.toFixed(4)}`);
            return {
                solBalance,
                splTokenBalance: senderTokenBalance,
                relativeSol,
                relativeSplToken,
                totalValueInSol,
                splLamp,
                solLamp,
                tokenDecimals,
            };
        }
        catch (error) {
            console.error("Error fetching data:", error);
            throw error;
        }
    });
}
exports.getBalancesAndRelativeValues = getBalancesAndRelativeValues;
