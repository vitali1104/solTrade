import { clusterApiUrl, Connection, PublicKey, Keypair, AccountInfo } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, transfer, TOKEN_PROGRAM_ID, AccountLayout } from '@solana/spl-token';
import { Buffer } from 'buffer';

export async function sendToken(
    tokenMintAddress: string,
    senderPrivateKeyBase64: string,
    recipientAddress: string,
    amount: bigint,
    useMax: boolean
): Promise<string> {
    const connection = new Connection('https://maximum-holy-arrow.solana-mainnet.quiknode.pro/61014782ec5a4688657111e0af0040634fdfeb19/', 'confirmed');

    const senderPrivateKeyBytes = Buffer.from(senderPrivateKeyBase64, 'base64');
    const senderKeypair = Keypair.fromSecretKey(senderPrivateKeyBytes);

    const recipientPublicKey = new PublicKey(recipientAddress);
    const tokenMintPublicKey = new PublicKey(tokenMintAddress);

    const senderTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        senderKeypair,
        tokenMintPublicKey,
        senderKeypair.publicKey
    );

    const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        senderKeypair,
        tokenMintPublicKey,
        recipientPublicKey,
        true
    );

    const senderAccountInfo = await connection.getAccountInfo(senderTokenAccount.address);
    if (!senderAccountInfo) throw new Error("Failed to fetch sender's token account info.");

    const decoded = AccountLayout.decode(senderAccountInfo.data);
    const initialBalance = senderAccountInfo.lamports;

    let amountToSend = amount;
    if (useMax) {
        amountToSend = BigInt(initialBalance);
        console.log('Using max amount to send:', amountToSend.toString());
    } else if (initialBalance < amountToSend) {
        throw new Error("Insufficient balance to perform the transaction.");
    }
    console.log("send ammount:", amountToSend);
    const MAX_RETRIES = 3;
    let lastError = null;
    let lastSignature: string | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            console.log("tranfer attempt")
            lastSignature = await transfer(
                connection,
                senderKeypair,
                senderTokenAccount.address,
                recipientTokenAccount.address,
                senderKeypair.publicKey,
                amountToSend
            );
            console.log("try:", attempt)
            await connection.confirmTransaction(lastSignature, 'confirmed');
            return lastSignature;
        } catch (sendError) {
            const updatedSenderInfo = await connection.getAccountInfo(senderTokenAccount.address);
            if (updatedSenderInfo) {
                const updatedDecoded = AccountLayout.decode(updatedSenderInfo.data);
                if (updatedDecoded.amount < initialBalance) {
                    console.log("Transaction may have been successful despite errors; balance has decreased.");
                    if (lastSignature !== null) {
                        return lastSignature;  // Return the last attempted signature
                    } else {
                        throw new Error("Transaction seems successful, but no signature was captured.");
                    }
                }
            }
            lastError = sendError;
            console.log("send Error")
        }
    }

    throw new Error(`Transaction failed after ${MAX_RETRIES} attempts due to: ${lastError}`);
}
