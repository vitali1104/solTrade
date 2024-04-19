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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.transactionSenderAndConfirmationWaiter = void 0;
const web3_js_1 = require("@solana/web3.js");
const promise_retry_1 = __importDefault(require("promise-retry"));
const wait_1 = require("./wait");
const SEND_OPTIONS = {
    skipPreflight: true,
};
function transactionSenderAndConfirmationWaiter(_a) {
    return __awaiter(this, arguments, void 0, function* ({ connection, serializedTransaction, blockhashWithExpiryBlockHeight, }) {
        const txid = yield connection.sendRawTransaction(serializedTransaction, SEND_OPTIONS);
        const controller = new AbortController();
        const abortSignal = controller.signal;
        const abortableResender = () => __awaiter(this, void 0, void 0, function* () {
            while (true) {
                yield (0, wait_1.wait)(2000);
                if (abortSignal.aborted)
                    return;
                try {
                    yield connection.sendRawTransaction(serializedTransaction, SEND_OPTIONS);
                }
                catch (e) {
                    console.warn(`Failed to resend transaction: ${e}`);
                }
            }
        });
        try {
            abortableResender();
            const lastValidBlockHeight = blockhashWithExpiryBlockHeight.lastValidBlockHeight - 150;
            // this would throw TransactionExpiredBlockheightExceededError
            yield Promise.race([
                connection.confirmTransaction(Object.assign(Object.assign({}, blockhashWithExpiryBlockHeight), { lastValidBlockHeight, signature: txid, abortSignal }), "confirmed"),
                new Promise((resolve) => __awaiter(this, void 0, void 0, function* () {
                    var _b;
                    // in case ws socket died
                    while (!abortSignal.aborted) {
                        yield (0, wait_1.wait)(2000);
                        const tx = yield connection.getSignatureStatus(txid, {
                            searchTransactionHistory: false,
                        });
                        if (((_b = tx === null || tx === void 0 ? void 0 : tx.value) === null || _b === void 0 ? void 0 : _b.confirmationStatus) === "confirmed") {
                            resolve(tx);
                        }
                    }
                })),
            ]);
        }
        catch (e) {
            if (e instanceof web3_js_1.TransactionExpiredBlockheightExceededError) {
                // we consume this error and getTransaction would return null
                return null;
            }
            else {
                // invalid state from web3.js
                throw e;
            }
        }
        finally {
            controller.abort();
        }
        // in case rpc is not synced yet, we add some retries
        const response = (0, promise_retry_1.default)((retry) => __awaiter(this, void 0, void 0, function* () {
            const response = yield connection.getTransaction(txid, {
                commitment: "confirmed",
                maxSupportedTransactionVersion: 0,
            });
            if (!response) {
                retry(response);
            }
            return response;
        }), {
            retries: 5,
            minTimeout: 1e3,
        });
        return response;
    });
}
exports.transactionSenderAndConfirmationWaiter = transactionSenderAndConfirmationWaiter;
