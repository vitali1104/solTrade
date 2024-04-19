// dbClient.ts - Singleton MongoDB Client
import { MongoClient, WithId, Document } from 'mongodb';

const uri = "mongodb+srv://Admin:admin@cluster0.g6rtlxh.mongodb.net/";
let client: MongoClient | null = null;

export function getMongoClient(): MongoClient {
    if (!client) {
        client = new MongoClient(uri);
        client.connect();
    }
    return client;
}

// trade_executer.ts - Main script
import { single_trade } from './single_trade';
import { sendSOL } from './send_sol';
import { sendToken } from './send_spl';
import { sendBoth } from './send_sol_and_spl';
import { getBalancesAndRelativeValues } from './utils/utils'

import { PublicKey, Keypair, LAMPORTS_PER_SOL, Connection } from '@solana/web3.js';
import bs58 from 'bs58';
import { assert } from 'console';

const dbName = 'orbitt';
const collectionName = 'orders';

interface TradeOrder {
    orderId: string;
    publicKey: string;
    privateKey: string;
    token1Address: string;
    token2Address: string;
    orderSize: number;
    status: string;
}

interface OrderExec {
    orderId: string;
    keyPairs: Array<string>;
}

async function createOrderEntry(order: TradeOrder): Promise<void> {
    const client = getMongoClient();
    const database = client.db(dbName);
    const orders = database.collection(collectionName);
    const result = await orders.insertOne(order);
    console.log(`New order created with the following id: ${result.insertedId}`);
}

async function getOrderEntry(orderId: string): Promise<TradeOrder | null> {
    const client = getMongoClient();
    const database = client.db(dbName);
    const orders = database.collection(collectionName);
    const order = await orders.findOne({ orderId: orderId }) as TradeOrder | null;
    if (order) {
        console.log('Order Found:', order);
        return order;
    } else {
        console.log('No order found with ID:', orderId);
        return null;
    }
}

async function getNextOrderId(): Promise<number> {
    const client = getMongoClient();
    const database = client.db(dbName);
    const orders = database.collection('orders');
    const lastOrder = await orders.find().sort({ orderId: -1 }).limit(1).toArray();
    return lastOrder.length === 0 ? 1 : parseInt(lastOrder[0].orderId, 10) + 1;
}

async function createNewOrder() {
    const newKeypair = Keypair.generate();
    const publicKey = newKeypair.publicKey.toBase58();
    const privateKey = Buffer.from(newKeypair.secretKey).toString('base64');
    const orderId = await getNextOrderId();
    const newOrder = {
        orderId: orderId.toString(),
        publicKey: publicKey,
        privateKey: privateKey,
        token1Address: 'Token1Address',
        token2Address: 'Token2Address',
        orderSize: 100,
        status: 'Pending'
    };
    await createOrderEntry(newOrder);
    console.log('New order created with order ID:', orderId);
}

createNewOrder().catch(console.error);

async function createOrderExecEntry(orderExec: OrderExec): Promise<void> {
    const client = getMongoClient();
    const database = client.db(dbName);
    const orderExecs = database.collection('orderExec');
    await orderExecs.insertOne(orderExec);
}

async function getOrderExecEntry(orderId: string): Promise<OrderExec | null> {
    const client = getMongoClient();
    const database = client.db(dbName);
    const orderExecs = database.collection('orderExec');
    const orderExecDocument = await orderExecs.findOne<WithId<Document>>({ orderId: orderId });

    if (orderExecDocument) {
        console.log('OrderExec Found:', orderExecDocument);
        // Convert WithId<Document> to OrderExec
        const orderExec: OrderExec = {
            orderId: orderExecDocument.orderId,
            keyPairs: orderExecDocument.keyPairs,
        };
        return orderExec;
    } else {
        console.log('No OrderExec found with ID:', orderId);
        return null;
    }
}

async function generateKeyPairs(amount: number): Promise<Array<string>> {
    let keyPairs = [];
    for (let i = 0; i < amount; i++) {
        const keypair = Keypair.generate();
        const secretKeyBase64 = Buffer.from(keypair.secretKey).toString('base64');
        keyPairs.push(secretKeyBase64);
    }
    return keyPairs;
}

async function sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });
}


async function runTransactionLoop(orderId: string) {
    const connection = new Connection('https://maximum-holy-arrow.solana-mainnet.quiknode.pro/61014782ec5a4688657111e0af0040634fdfeb19/', 'confirmed');
    const orderData = await getOrderEntry(orderId);
    if (!orderData) {
        console.error('Order not found');
        return;
    }

    // Attempt to retrieve existing OrderExec entry
    const existingOrderExec = await getOrderExecEntry(orderId);

    let keyPairObjects: Keypair[] = [];
    // if (existingOrderExec) {
    //     console.log("Using existing key pairs from OrderExec entry...");
    //     keyPairObjects = existingOrderExec.keyPairs.map(secretKeyBase64 => Keypair.fromSecretKey(Buffer.from(secretKeyBase64, 'base64')));
    // } else {
    console.log("No existing key pairs found, generating new key pairs...");
    const keyPairs = await generateKeyPairs(5);
    await createOrderExecEntry({ orderId, keyPairs });
    keyPairObjects = keyPairs.map(kp => Keypair.fromSecretKey(Buffer.from(kp, 'base64')));
    // }
    // Ensure the original order's keypair is always included
    keyPairObjects.unshift(Keypair.fromSecretKey(Buffer.from(orderData.privateKey, 'base64')));

    async function sendNext(index: number, tradePercentage: number = 10) {
        if (!orderData) {
            console.error('Order not found');
            return;
        }
        const sender = keyPairObjects[index];
        const recipient = keyPairObjects[(index + 1) % keyPairObjects.length];
        const balanceDetails = await getBalancesAndRelativeValues(Buffer.from(sender.secretKey).toString('base64'), orderData.token1Address);

        if (!balanceDetails) {
            console.error('Failed to retrieve balance details.');
            setTimeout(() => sendNext(index), 60000);
            return;
        }
        const { solBalance, splTokenBalance, tokenDecimals } = balanceDetails;

        console.log(`Balance for sender at index ${index}: SOL = ${balanceDetails.solBalance}, Token = ${balanceDetails.splTokenBalance}`);
        console.log(`Relative SOL: ${balanceDetails.relativeSol}, Relative SPL Token: ${balanceDetails.relativeSplToken}`);

        let action = decideAction(balanceDetails.relativeSol, balanceDetails.relativeSplToken);
        console.log(`Action decided: ${action}`);

        if (action !== 'hold') {
            const tradeToken = action === 'buy' ? wSOL : orderData.token1Address;
            const receiveToken = action === 'buy' ? orderData.token1Address : wSOL;

            // Calculate the amount based on the percentage of the available balance
            let amountToTrade = action === 'buy' ?
                Math.floor(balanceDetails.solBalance * tradePercentage / 100 * LAMPORTS_PER_SOL) : // For buying, use SOL balance
                Math.floor(balanceDetails.splTokenBalance * tradePercentage / 100 * Math.pow(10, tokenDecimals)); // For selling, use SPL token balance

            // Ensure the amount does not exceed JavaScript's safe integer limit
            if (amountToTrade > Number.MAX_SAFE_INTEGER) {
                console.error('Calculated trade amount exceeds safe integer limit. Adjusting to maximum safe amount.');
                amountToTrade = Number.MAX_SAFE_INTEGER;
            }

            try {
                await single_trade(Buffer.from(sender.secretKey).toString('base64'), tradeToken, receiveToken, amountToTrade, 50);
                console.log(`${action} trade executed.`);
            } catch (error) {
                console.error('Trade execution failed:', error);
            }
        }

        // Ensure a small delay to allow state updates
        await sleep(3000);

        const updatedBalances = await getBalancesAndRelativeValues(Buffer.from(sender.secretKey).toString('base64'), orderData.token1Address);
        if (!updatedBalances) {
            console.error('Failed to retrieve updated balances.');
            setTimeout(() => sendNext(index), 60000);
            return;
        }

        try {
            const amountSol = BigInt(Math.floor(updatedBalances.solLamp * 0.9));
            const amountToken = BigInt(Math.floor(updatedBalances.splLamp * 0.9));
            console.log("key:", Buffer.from(sender.secretKey).toString('base64'), "token address:", orderData.token1Address, "recipient:", recipient.publicKey.toBase58(), "SOL amount:", amountSol, "Token amount:", amountToken);
            await sendBoth(Buffer.from(sender.secretKey).toString('base64'), orderData.token1Address, Buffer.from(recipient.secretKey).toString('base64'), recipient.publicKey.toBase58(), amountSol, amountToken, false, false);
            console.log(`Funds and tokens forwarded to next account: ${recipient.publicKey.toBase58()}`);
        } catch (error) {
            console.error(`Failed to forward funds and tokens: ${error}`);
            setTimeout(() => sendNext(index), 60000);
            return;
        }

        setTimeout(() => sendNext((index + 1) % keyPairObjects.length), 60000);
    }

    sendNext(0);
}


function decideAction(relativeSol: number, relativeSplToken: number) {
    // Example decision logic
    console.log("deciding action")
    const lowerThreshold = 0.3; // 30%
    const upperThreshold = 0.5; // 70%
    if (relativeSol < lowerThreshold) {
        console.log("action sell")
        return 'sell';
    } else if (relativeSol > upperThreshold) {
        console.log("action buy")
        return 'buy';
    }
    return 'sell';
}


runTransactionLoop("13").catch(console.error);

const privateKey1 = 'tjrvvz+8QqEDclRkGiC8xmAUZrZ/TC/V0tNdu3dq7oYWRCmGoepC3pOJf9saCk6j6HBmqtBn9Jyhlkm5jo2Xig=='
const reciver1 = 'FhU9qtRAR1Zhw6KRf3onPEb92vExVuRHikfAZ71dWwjg'
const amount1 = BigInt(566976)
const amount2 = BigInt(1000)
const token1 = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const wSOL = 'So11111111111111111111111111111111111111112'
const bpsStandard = 50

async function sendSol(privatKey: string, reciver: string, amount: bigint, all: boolean) {


    try {
        const transactionSignature = await sendSOL(
            privatKey,
            reciver,
            amount,
            all
        );
        console.log("Transaction successful, signature:", transactionSignature);
    } catch (error) {
        console.error("Failed to send tokens:", error);
    }
}


async function send(token: string, privateKey: string, reciver: string, amount: bigint, all: boolean) {


    try {
        const transactionSignature = await sendToken(
            token,
            privateKey,
            reciver,
            amount,
            all
        );
        console.log("Transaction successful, signature:", transactionSignature);
    } catch (error) {
        console.error("Failed to send tokens:", error);
    }
}

//sendSol(privateKey1, reciver1, BigInt(600000), true)

//send(token1, privateKey1, reciver1, BigInt(1000000), true)

async function sendSolandSPL(senderPrivateKey: string, token: string, receiverPrvateKey: string, reciever: string, amountSol: bigint, amountToken: bigint, allSol: boolean, allToken: boolean) {

    try {
        const transactionSignature = await sendBoth(
            senderPrivateKey,
            token,
            receiverPrvateKey,
            reciever,
            amountSol,
            amountToken,
            allSol,
            allToken
        );
        console.log("Transaction successful, signature:", transactionSignature);
    } catch (error) {
        console.error("Failed to send tokens:", error);
    }


}

//sendSolandSPL(privateKey1,token1, reciver1, amount1, amount2, false, false)

async function trade(privateKey: string, inToken: string, outToken: string, amount: number, bps: number) {

    try {
        const transactionSignature = await single_trade(

            privateKey,
            inToken,
            outToken,
            amount,
            bps,
        );
        console.log("Transaction successful, signature:", transactionSignature);
    } catch (error) {
        console.error("Failed to send tokens:", error);
    }


}

async function getAccountValue(privateKey: string, token: string) {

    try {
        const value = await getBalancesAndRelativeValues(
            privateKey,
            token,
        );
        console.log("Transaction successful, signature:", value);
    } catch (error) {
        console.error("Failed to send tokens:", error);
    }

}


//sendSol(privateKey1,reciver1,amount1, true).catch(console.error);
//getAccountValue(privateKey1,  token1)



//acumulation, Buy and Sells between 10 and 30% -> Capital allocation max 30/70 -> 70 SOL side
//pump phase, Buy trades arround 30-60% of capital value with simulations short sells around 20%. -> Capital allocation of to 50/50
// distribution,  Trades between 20 and 40% of capital , reducing over time until back at Capital allocation of arround 5/95