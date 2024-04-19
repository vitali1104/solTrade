import { Connection, PublicKey, Keypair, Transaction, SystemProgram } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, createTransferInstruction, TOKEN_PROGRAM_ID, AccountLayout } from '@solana/spl-token';
import { Buffer } from 'buffer';

export async function sendBoth(senderPrivateKeyBase64: string, tokenMintAddress: string, recipientPrivateKeyBase64: string, recipientAddress: string, totalAmountLamports: bigint, tokenAmount: bigint, useMaxSOL: boolean, useMaxToken: boolean): Promise<string> {
    const connection = new Connection('https://maximum-holy-arrow.solana-mainnet.quiknode.pro/61014782ec5a4688657111e0af0040634fdfeb19/', 'confirmed');
    const senderPrivateKeyBytes = Buffer.from(senderPrivateKeyBase64, 'base64');
    const reciepientPrivateKeyBytes = Buffer.from(recipientPrivateKeyBase64, 'base64');
    const senderKeypair = Keypair.fromSecretKey(senderPrivateKeyBytes);
    const recipientKeypair = Keypair.fromSecretKey(reciepientPrivateKeyBytes);
    const recipientPublicKey = new PublicKey(recipientAddress);
    const tokenMintPublicKey = new PublicKey(tokenMintAddress);

    try {
        console.log("Retrieving or creating sender token account...");
        const senderTokenAccount = await getOrCreateAssociatedTokenAccount(
            connection, 
            senderKeypair, 
            tokenMintPublicKey, 
            senderKeypair.publicKey
        );
        console.log("Sender token account address:", senderTokenAccount.address.toBase58());

        console.log("Retrieving or creating recipient token account...");
        console.log(recipientKeypair.publicKey);
        const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(
            connection, 
            recipientKeypair, 
            tokenMintPublicKey, 
            recipientKeypair.publicKey
        );
        console.log("Recipient token account address:", recipientTokenAccount.address.toBase58());

        if (!recipientTokenAccount) {
            throw new Error("Recipient token account could not be created or retrieved.");
        }

        const senderSOLAccountInfo = await connection.getAccountInfo(senderKeypair.publicKey);
        if (!senderSOLAccountInfo) {
            throw new Error("Sender SOL account not found.");
        }

        console.log("Sender SOL balance (lamports):", senderSOLAccountInfo.lamports);

        const initialSOLBalance = senderSOLAccountInfo.lamports;
        if (useMaxSOL) {
            totalAmountLamports = BigInt(initialSOLBalance);
        }

        const senderTokenAccountInfo = await connection.getAccountInfo(senderTokenAccount.address);
        if (!senderTokenAccountInfo) throw new Error("Failed to fetch sender's token account info.");

        const initialTokenBalance = senderTokenAccountInfo.lamports;
        console.log("Sender token balance:", initialTokenBalance.toString());

        let tokenAmountToSend = useMaxToken ? initialTokenBalance : tokenAmount;
        if (initialTokenBalance < tokenAmountToSend) throw new Error("Insufficient token balance to perform the transaction.");
        if (initialSOLBalance < totalAmountLamports) throw new Error("Insufficient SOL balance to perform the transaction.");

        let lastError = null;
        let signature = null;

        for (let attempt = 0; attempt < 3; attempt++) {
            console.log(`Transaction attempt ${attempt + 1}`);
            const transaction = new Transaction({
                feePayer: senderKeypair.publicKey,
                recentBlockhash: (await connection.getLatestBlockhash()).blockhash
            });

            if (totalAmountLamports > 0) {
                transaction.add(SystemProgram.transfer({
                    fromPubkey: senderKeypair.publicKey,
                    toPubkey: recipientPublicKey,
                    lamports: totalAmountLamports
                }));
                console.log(`Adding SOL transfer: ${totalAmountLamports} lamports`);
            }

            transaction.add(createTransferInstruction(
                senderTokenAccount.address,
                recipientTokenAccount.address,
                senderKeypair.publicKey,
                tokenAmountToSend,
                [],
                TOKEN_PROGRAM_ID
            ));
            console.log(`Adding SPL token transfer: ${tokenAmountToSend} tokens`);

            try {
                signature = await connection.sendTransaction(transaction, [senderKeypair], { skipPreflight: true, preflightCommitment: 'confirmed' });
                await connection.confirmTransaction(signature, 'confirmed');
                console.log("Transaction confirmed:", signature);
                return signature;
            } catch (error) {
                lastError = error;
                console.log(`Attempt ${attempt + 1} failed:`, error);
            }
        }

        throw new Error(`Transaction failed after 3 attempts: ${lastError}`);
    } catch (error) {
        console.error("Error during transaction setup or send:", error);
        throw error;
    }
}
