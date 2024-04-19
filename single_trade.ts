import { createJupiterApiClient } from "@jup-ag/api";
import { Connection, Keypair, VersionedTransaction, PublicKey } from "@solana/web3.js";
import { Wallet } from "@project-serum/anchor";
import bs58 from "bs58";
import { transactionSenderAndConfirmationWaiter } from "./utils/transactionSender";
import { getSignature } from "./utils/getSignature";

async function getTokenDecimals(connection: Connection, mintAddress: string): Promise<number> {
  const mintPublicKey = new PublicKey(mintAddress);
  const mintInfo = await connection.getParsedAccountInfo(mintPublicKey, 'singleGossip');
  // Checking the structure and ensure `data` is parsed correctly
  if (!mintInfo.value) {
    throw new Error('Failed to find token mint information');
  }
  const info = mintInfo.value.data;
  if ('parsed' in info && 'info' in info.parsed && 'decimals' in info.parsed.info) {
    return info.parsed.info.decimals;
  } else {
    throw new Error('Failed to parse token decimals');
  }
}

// In single_trade.ts
export async function single_trade(senderPrivateKeyBase64: string, inToken: string, outToken: string, realAmount: number, slippageRate: number) {
  const jupiterQuoteApi = createJupiterApiClient();
  const senderPrivateKeyBytes = Buffer.from(senderPrivateKeyBase64, 'base64');
  const wallet = new Wallet(
    Keypair.fromSecretKey(senderPrivateKeyBytes)
  );
  console.log("Wallet:", wallet.publicKey.toBase58());

  const connection = new Connection('https://maximum-holy-arrow.solana-mainnet.quiknode.pro/61014782ec5a4688657111e0af0040634fdfeb19/', 'confirmed');

  const inTokenDecimals = await getTokenDecimals(connection, inToken);
  //const realAmount = Math.round(amount * Math.pow(10, inTokenDecimals));
  const slippageBps = Math.round(slippageRate * 10000); // Convert slippage rate to basis points

  // Get quote
  const quote = await jupiterQuoteApi.quoteGet({
    inputMint: inToken,
    outputMint: outToken,
    amount: realAmount,
    slippageBps: 50,
    onlyDirectRoutes:false,
    asLegacyTransaction: false,
  });

  if (!quote) {
    console.error("Unable to get quote");
    return;
  }

  const swapResult = await jupiterQuoteApi.swapPost({
    swapRequest: {
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toBase58(),
      dynamicComputeUnitLimit: false,
      prioritizationFeeLamports: "auto",
    },
  });

  console.dir(swapResult, { depth: null });

  const swapTransactionBuf = Buffer.from(swapResult.swapTransaction, "base64");
  var transaction = VersionedTransaction.deserialize(swapTransactionBuf);

  transaction.sign([wallet.payer]);
  const signature = getSignature(transaction);

  const { value: simulatedTransactionResponse } = await connection.simulateTransaction(transaction, {
    replaceRecentBlockhash: true,
    commitment: "processed",
  });
  const { err, logs } = simulatedTransactionResponse;

  if (err) {
    console.error("Simulation Error:", { err, logs });
    return;
  }

  const serializedTransaction = Buffer.from(transaction.serialize());
  const blockhash = transaction.message.recentBlockhash;

  const transactionResponse = await transactionSenderAndConfirmationWaiter({
    connection,
    serializedTransaction,
    blockhashWithExpiryBlockHeight: {
      blockhash,
      lastValidBlockHeight: swapResult.lastValidBlockHeight,
    },
  });

  if (!transactionResponse) {
    console.error("Transaction not confirmed");
    return;
  }

  if (transactionResponse.meta?.err) {
    console.error(transactionResponse.meta?.err);
  }

  console.log(`https://solscan.io/tx/${signature}`);
}
