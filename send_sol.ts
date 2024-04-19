import { Connection, PublicKey, Keypair, Transaction, SystemProgram } from '@solana/web3.js';
import bs58 from 'bs58';

export async function sendSOL(senderPrivateKeyBase64: string, recipientAddress: string, totalAmountLamports: bigint, useBalance: boolean): Promise<string> {
    const connection = new Connection('https://maximum-holy-arrow.solana-mainnet.quiknode.pro/61014782ec5a4688657111e0af0040634fdfeb19/', 'confirmed');
    const senderPrivateKeyBytes = Buffer.from(senderPrivateKeyBase64, 'base64');
    const senderKeypair = Keypair.fromSecretKey(senderPrivateKeyBytes);
    const recipientPublicKey = new PublicKey(recipientAddress);
    const { blockhash, feeCalculator } = await connection.getRecentBlockhash('confirmed');

    const accountInfo = await connection.getAccountInfo(senderKeypair.publicKey);
    if (!accountInfo) throw new Error("Failed to fetch account info.");
    
    let initialBalance = accountInfo.lamports;
    if (useBalance) {
        totalAmountLamports = BigInt(initialBalance);
    }

    console.log("acccount ballance:", initialBalance)

    const tempTransaction = new Transaction();
    tempTransaction.recentBlockhash = blockhash;
    tempTransaction.add(SystemProgram.transfer({
        fromPubkey: senderKeypair.publicKey,
        toPubkey: recipientPublicKey,
        lamports: 10000 // Minimal amount for fee calculation
    }));
    tempTransaction.sign(senderKeypair);
    const feeInLamports = BigInt(feeCalculator.lamportsPerSignature) * BigInt(tempTransaction.signatures.length);
    console.log("fees:", feeInLamports)
    const sendAmountLamports = BigInt(totalAmountLamports) - feeInLamports;

    if (sendAmountLamports <= 0) {
        throw new Error("Insufficient funds to cover the transaction and fees.");
    }

    const MAX_RETRIES = 3;
    let lastError = null;
    let lastSignature: string | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const transaction = new Transaction();
            transaction.recentBlockhash = blockhash;
            transaction.add(SystemProgram.transfer({
                fromPubkey: senderKeypair.publicKey,
                toPubkey: recipientPublicKey,
                lamports: sendAmountLamports
            }));
            lastSignature = await connection.sendTransaction(transaction, [senderKeypair], { skipPreflight: false, preflightCommitment: 'confirmed' });
            await connection.confirmTransaction(lastSignature, 'confirmed');
            return lastSignature; // Successfully confirmed transaction
        } catch (sendError) {
            const updatedAccountInfo = await connection.getAccountInfo(senderKeypair.publicKey);
            if (updatedAccountInfo && updatedAccountInfo.lamports < initialBalance) {
                console.log("Transaction may have been successful despite errors; balance has decreased.");
                if (lastSignature !== null) {
                    return lastSignature; // Ensure we return a valid string, not null
                } else {
                    throw new Error("Transaction appears successful, but no signature was captured. This should be investigated.");
                }
            }
            lastError = sendError;
        }
    }

    throw new Error(`Transaction failed after ${MAX_RETRIES} attempts due to: ${lastError}`);
}
