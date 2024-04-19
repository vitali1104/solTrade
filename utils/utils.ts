import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { Wallet } from '@project-serum/anchor';
import { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount, AccountLayout } from '@solana/spl-token';
import { Buffer } from 'buffer';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

function createWalletFromBase64(base64PrivateKey: string): Wallet {
    const privateKeyBytes = Buffer.from(base64PrivateKey, 'base64');
    const keypair = Keypair.fromSecretKey(privateKeyBytes);
    return new Wallet(keypair);
}

async function getTokenDecimals(connection: Connection, mintAddress: PublicKey): Promise<number> {
    const info = await connection.getParsedAccountInfo(mintAddress);
    if (info.value && info.value.data && "parsed" in info.value.data) {
        return info.value.data.parsed.info.decimals;
    } else {
        throw new Error("Failed to retrieve or parse token decimals.");
    }
}

export async function getBalancesAndRelativeValues(senderPrivateKeyBase64: string, splTokenMintAddress: string) {
    const connection = new Connection('https://maximum-holy-arrow.solana-mainnet.quiknode.pro/61014782ec5a4688657111e0af0040634fdfeb19/', 'confirmed');
    const senderPrivateKeyBytes = Buffer.from(senderPrivateKeyBase64, 'base64');
    const senderKeypair = Keypair.fromSecretKey(senderPrivateKeyBytes);

    const tokenMintPublicKey = new PublicKey(splTokenMintAddress);

    try {
        // Get or create the associated token account for the sender
        const senderTokenAccount = await getOrCreateAssociatedTokenAccount(
            connection,
            senderKeypair,
            tokenMintPublicKey,
            senderKeypair.publicKey
        );

        // Fetch and decode token balance
        const senderTokenAccountInfo = await connection.getAccountInfo(senderTokenAccount.address);
        if (!senderTokenAccountInfo) throw new Error("Sender's SPL token account not found.");
        const tokenDecimals = await getTokenDecimals(connection, tokenMintPublicKey);
        const splLamp = senderTokenAccountInfo.lamports
        const senderTokenBalance = senderTokenAccountInfo.lamports / Math.pow(10, tokenDecimals);

        // Fetch SOL balance
        const senderSOLAccountInfo = await connection.getAccountInfo(senderKeypair.publicKey);
        if (!senderSOLAccountInfo) {
            throw new Error("Sender SOL account not found.");
        }
        const solLamp = senderSOLAccountInfo.lamports
        const solBalance = solLamp / LAMPORTS_PER_SOL;

        // Calculate relative values based on token and SOL balances
        const totalValueInSol = solBalance + (senderTokenBalance * (Math.pow(10, tokenDecimals) / LAMPORTS_PER_SOL));
        const relativeSol = solBalance / totalValueInSol;
        const relativeSplToken = (senderTokenBalance * (Math.pow(10, tokenDecimals) / LAMPORTS_PER_SOL)) / totalValueInSol;

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

    } catch (error) {
        console.error("Error fetching data:", error);
        throw error;
    }
}
