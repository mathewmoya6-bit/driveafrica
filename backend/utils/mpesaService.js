// services/mpesaService.js
import axios from 'axios';
import { MPESA_CONFIG, TRANSACTION_TYPES, RESULT_CODES } from '../config/mpesaConfig.js';
import {
    getTimestamp,
    formatPhoneNumber,
    generatePassword,
    validateAmount,
    validateCheckoutRequestId,
    formatTransactionResponse,
    parseCallbackMetadata,
    getTransactionStatus,
    generateTransactionReference
} from '../utils/mpesaUtils.js';

class MpesaService {
    constructor() {
        this.accessToken = null;
        this.tokenExpiry = null;
        this.transactions = new Map(); // In-memory store, use Redis in production
    }

    /**
     * Get OAuth access token from Safaricom
     */
    async getAccessToken() {
        // Check if token is still valid
        if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
            console.log('✅ Using cached access token');
            return this.accessToken;
        }

        const auth = Buffer.from(`${MPESA_CONFIG.CONSUMER_KEY}:${MPESA_CONFIG.CONSUMER_SECRET}`).toString('base64');
        const url = `${MPESA_CONFIG.API_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`;
        
        console.log('🔑 Requesting new access token from Safaricom...');
        
        try {
            const response = await axios.get(url, {
                headers: { Authorization: `Basic ${auth}` },
                timeout: 30000
            });
            
            if (!response.data.access_token) {
                throw new Error('No access token received');
            }
            
            this.accessToken = response.data.access_token;
            // Token expires in 3600 seconds (1 hour), set expiry 10 minutes early
            this.tokenExpiry = Date.now() + (response.data.expires_in - 600) * 1000;
            
            console.log('✅ Access token obtained successfully');
            return this.accessToken;
        } catch (error) {
            console.error('❌ Failed to get access token:', error.message);
            throw new Error(`Authentication failed: ${error.response?.data?.errorMessage || error.message}`);
        }
    }

    /**
     * Initiate STK Push (Lipa Na M-Pesa Online)
     */
    async initiateStkPush({ phoneNumber, amount, accountReference, transactionDesc, courseId, userId, email }) {
        console.log('💰 Initiating STK Push...');
        console.log('   Phone:', phoneNumber);
        console.log('   Amount:', amount);
        
        try {
            const formattedPhone = formatPhoneNumber(phoneNumber);
            const validatedAmount = validateAmount(amount);
            const token = await this.getAccessToken();
            const timestamp = getTimestamp();
            const password = generatePassword(MPESA_CONFIG.SHORTCODE, MPESA_CONFIG.PASSKEY, timestamp);
            
            const requestBody = {
                BusinessShortCode: MPESA_CONFIG.SHORTCODE,
                Password: password,
                Timestamp: timestamp,
                TransactionType: TRANSACTION_TYPES.CUSTOMER_PAYBILL_ONLINE,
                Amount: validatedAmount,
                PartyA: formattedPhone,
                PartyB: MPESA_CONFIG.SHORTCODE,
                PhoneNumber: formattedPhone,
                CallBackURL: MPESA_CONFIG.CALLBACK_URL,
                AccountReference: accountReference || `MEI${courseId}`,
                TransactionDesc: transactionDesc || `MEI DRIVE - Course ${courseId}`
            };
            
            console.log('📤 Sending STK Push to Safaricom...');
            
            const response = await axios.post(
                `${MPESA_CONFIG.API_BASE_URL}/mpesa/stkpush/v1/processrequest`,
                requestBody,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 35000
                }
            );
            
            console.log('📡 STK Push response:', response.data);
            
            if (response.data.ResponseCode !== '0') {
                throw new Error(response.data.ResponseDescription || 'STK Push failed');
            }
            
            // Store transaction for tracking
            const checkoutRequestID = response.data.CheckoutRequestID;
            this.transactions.set(checkoutRequestID, {
                status: 'pending',
                userId,
                courseId,
                amount: validatedAmount,
                email,
                phone: formattedPhone,
                createdAt: new Date().toISOString(),
                checkoutRequestID
            });
            
            console.log(`✅ STK Push successful! CheckoutRequestID: ${checkoutRequestID}`);
            
            return {
                success: true,
                checkoutRequestID,
                merchantRequestID: response.data.MerchantRequestID,
                responseCode: response.data.ResponseCode,
                responseDescription: response.data.ResponseDescription
            };
        } catch (error) {
            console.error('❌ STK Push error:', error.message);
            throw new Error(error.response?.data?.errorMessage || error.message);
        }
    }

    /**
     * Query payment status
     */
    async queryPaymentStatus(checkoutRequestID) {
        console.log(`🔍 Querying payment status for: ${checkoutRequestID}`);
        
        try {
            validateCheckoutRequestId(checkoutRequestID);
            const token = await this.getAccessToken();
            const timestamp = getTimestamp();
            const password = generatePassword(MPESA_CONFIG.SHORTCODE, MPESA_CONFIG.PASSKEY, timestamp);
            
            const requestBody = {
                BusinessShortCode: MPESA_CONFIG.SHORTCODE,
                Password: password,
                Timestamp: timestamp,
                CheckoutRequestID: checkoutRequestID
            };
            
            const response = await axios.post(
                `${MPESA_CONFIG.API_BASE_URL}/mpesa/stkpushquery/v1/query`,
                requestBody,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );
            
            const isCompleted = response.data.ResultCode === RESULT_CODES.SUCCESS;
            const transaction = this.transactions.get(checkoutRequestID);
            
            if (isCompleted && transaction) {
                transaction.status = 'completed';
                if (response.data.CallbackMetadata) {
                    const metadata = parseCallbackMetadata(response.data.CallbackMetadata);
                    transaction.transactionId = metadata.MpesaReceiptNumber;
                    transaction.completedAmount = metadata.Amount;
                }
            }
            
            console.log(`📊 Status: ${isCompleted ? 'COMPLETED' : 'PENDING'}`);
            
            return {
                success: true,
                status: getTransactionStatus(response.data.ResultCode),
                resultCode: response.data.ResultCode,
                resultDesc: response.data.ResultDesc,
                transactionId: response.data.CallbackMetadata?.Item?.find(i => i.Name === 'MpesaReceiptNumber')?.Value
            };
        } catch (error) {
            console.error('❌ Status query error:', error.message);
            throw new Error(error.response?.data?.errorMessage || error.message);
        }
    }

    /**
     * Handle M-Pesa callback
     */
    handleCallback(callbackData) {
        console.log('📞 Processing M-Pesa callback...');
        
        const { Body } = callbackData;
        if (!Body || !Body.stkCallback) {
            console.log('⚠️ Invalid callback structure');
            return { success: false, message: 'Invalid callback' };
        }
        
        const { ResultCode, ResultDesc, CheckoutRequestID, CallbackMetadata } = Body.stkCallback;
        const transaction = this.transactions.get(CheckoutRequestID);
        
        if (ResultCode === RESULT_CODES.SUCCESS && CallbackMetadata) {
            const metadata = parseCallbackMetadata(CallbackMetadata);
            
            if (transaction) {
                transaction.status = 'completed';
                transaction.transactionId = metadata.MpesaReceiptNumber;
                transaction.completedAmount = metadata.Amount;
                transaction.completedPhone = metadata.PhoneNumber;
                transaction.completedAt = new Date().toISOString();
            }
            
            console.log(`✅ Payment successful!`);
            console.log(`   Receipt: ${metadata.MpesaReceiptNumber}`);
            console.log(`   Amount: KES ${metadata.Amount}`);
            console.log(`   Phone: ${metadata.PhoneNumber}`);
            
            return {
                success: true,
                status: 'completed',
                transactionId: metadata.MpesaReceiptNumber,
                amount: metadata.Amount,
                phone: metadata.PhoneNumber,
                checkoutRequestID: CheckoutRequestID
            };
        } else {
            if (transaction) {
                transaction.status = 'failed';
                transaction.failureReason = ResultDesc;
            }
            
            console.log(`❌ Payment failed: ${ResultDesc}`);
            return {
                success: false,
                status: 'failed',
                message: ResultDesc,
                checkoutRequestID: CheckoutRequestID
            };
        }
    }

    /**
     * Get transaction by checkout request ID
     */
    getTransaction(checkoutRequestID) {
        return this.transactions.get(checkoutRequestID) || null;
    }

    /**
     * Get all pending transactions
     */
    getPendingTransactions() {
        const pending = [];
        for (const [id, transaction] of this.transactions) {
            if (transaction.status === 'pending') {
                pending.push({ checkoutRequestID: id, ...transaction });
            }
        }
        return pending;
    }

    /**
     * Test M-Pesa connection
     */
    async testConnection() {
        try {
            await this.getAccessToken();
            return { success: true, message: 'M-Pesa API connection successful', shortcode: MPESA_CONFIG.SHORTCODE };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

export default new MpesaService();
