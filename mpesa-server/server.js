// server.js - M-Pesa STK Push Integration for MEI Drive Africa
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// MIDDLEWARE
// ============================================================
const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',');
app.use(cors({
    origin: corsOrigins,
    credentials: process.env.CORS_CREDENTIALS === 'true'
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================
// LOGGING
// ============================================================
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
function log(level, message, data = null) {
    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    if (levels[level] <= levels[LOG_LEVEL]) {
        console.log(`[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`);
        if (data) console.log(data);
    }
}

// ============================================================
// CONFIGURATION (from .env)
// ============================================================
const config = {
    // Primary Credentials (Automat EA)
    consumerKey: process.env.MPESA_CONSUMER_KEY,
    consumerSecret: process.env.MPESA_CONSUMER_SECRET,
    
    // Secondary Backup Credentials (Masika Benevolent)
    consumerKeyBackup: process.env.MPESA_CONSUMER_KEY_BACKUP,
    consumerSecretBackup: process.env.MPESA_CONSUMER_SECRET_BACKUP,
    
    // Paybill
    shortCode: process.env.MPESA_SHORTCODE,
    passkey: process.env.MPESA_PASSKEY,
    
    // Environment
    environment: process.env.MPESA_ENVIRONMENT || 'sandbox',
    
    // Callback URLs
    callbackUrl: process.env.MPESA_CALLBACK_URL,
    timeoutUrl: process.env.MPESA_TIMEOUT_URL,
    resultUrl: process.env.MPESA_RESULT_URL,
    confirmationUrl: process.env.MPESA_CONFIRMATION_URL,
    validationUrl: process.env.MPESA_VALIDATION_URL,
    
    // Test data
    testPhone: process.env.MPESA_TEST_PHONE,
    testPin: process.env.MPESA_TEST_PIN,
    
    // Feature flags
    enableMpesa: process.env.ENABLE_MPESA === 'true',
    enableStkPush: process.env.ENABLE_STK_PUSH === 'true',
    
    // Webhook security
    webhookSecret: process.env.MPESA_WEBHOOK_SECRET,
    
    // API URLs
    apiUrls: {
        sandbox: {
            auth: 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
            stkPush: 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
            stkQuery: 'https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query',
            stkPushStatus: 'https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query',
            c2bSimulate: 'https://sandbox.safaricom.co.ke/mpesa/c2b/v1/simulate',
            accountBalance: 'https://sandbox.safaricom.co.ke/mpesa/accountbalance/v1/query',
            transactionStatus: 'https://sandbox.safaricom.co.ke/mpesa/transactionstatus/v1/query',
            reversal: 'https://sandbox.safaricom.co.ke/mpesa/reversal/v1/request',
            b2c: 'https://sandbox.safaricom.co.ke/mpesa/b2c/v1/paymentrequest'
        },
        production: {
            auth: 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
            stkPush: 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
            stkQuery: 'https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query',
            stkPushStatus: 'https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query',
            c2bSimulate: 'https://api.safaricom.co.ke/mpesa/c2b/v1/simulate',
            accountBalance: 'https://api.safaricom.co.ke/mpesa/accountbalance/v1/query',
            transactionStatus: 'https://api.safaricom.co.ke/mpesa/transactionstatus/v1/query',
            reversal: 'https://api.safaricom.co.ke/mpesa/reversal/v1/request',
            b2c: 'https://api.safaricom.co.ke/mpesa/b2c/v1/paymentrequest'
        }
    }
};

const currentApi = config.apiUrls[config.environment];

// Validate required config
if (!config.enableMpesa) {
    log('warn', 'M-Pesa is disabled. Set ENABLE_MPESA=true to enable');
}

if (!config.consumerKey || !config.consumerSecret) {
    log('error', 'Missing M-Pesa credentials. Check your .env file');
}

log('info', `M-Pesa Configuration loaded`, {
    environment: config.environment,
    shortCode: config.shortCode,
    enableStkPush: config.enableStkPush,
    callbackUrl: config.callbackUrl
});

// ============================================================
// TOKEN MANAGEMENT (with caching and backup)
// ============================================================
let accessToken = null;
let tokenExpiry = null;
let currentCredentialsIndex = 0; // 0 = primary, 1 = backup

async function getAccessToken() {
    // Return cached token if still valid
    if (accessToken && tokenExpiry && tokenExpiry > Date.now()) {
        log('debug', 'Using cached access token');
        return accessToken;
    }

    // Try primary credentials first, then backup if available
    const credentials = [
        { key: config.consumerKey, secret: config.consumerSecret, name: 'primary' },
        { key: config.consumerKeyBackup, secret: config.consumerSecretBackup, name: 'backup' }
    ].filter(c => c.key && c.secret);

    for (let i = currentCredentialsIndex; i < credentials.length; i++) {
        const cred = credentials[i];
        try {
            log('info', `Fetching new access token using ${cred.name} credentials...`);
            const auth = Buffer.from(`${cred.key}:${cred.secret}`).toString('base64');

            const response = await axios.get(currentApi.auth, {
                headers: { Authorization: `Basic ${auth}` },
                timeout: 10000
            });

            accessToken = response.data.access_token;
            tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
            currentCredentialsIndex = i;
            log('info', `Token obtained successfully using ${cred.name} credentials`);
            return accessToken;
        } catch (error) {
            log('error', `Failed with ${cred.name} credentials:`, error.response?.data || error.message);
            if (i === credentials.length - 1) {
                throw new Error('All authentication attempts failed');
            }
            log('info', 'Failing over to backup credentials...');
        }
    }

    throw new Error('No valid credentials available');
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================
function getTimestamp() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

function getPassword(shortCode, passkey, timestamp) {
    const str = `${shortCode}${passkey}${timestamp}`;
    return Buffer.from(str).toString('base64');
}

function formatPhoneNumber(phone) {
    let formatted = phone.replace(/\D/g, '');
    if (formatted.startsWith('0')) {
        formatted = '254' + formatted.substring(1);
    } else if (formatted.startsWith('+254')) {
        formatted = '254' + formatted.substring(4);
    } else if (formatted.length === 9) {
        formatted = '254' + formatted;
    }
    return formatted;
}

// ============================================================
// STK PUSH (Lipa Na M-Pesa)
// ============================================================
async function stkPush(phoneNumber, amount, accountReference, transactionDesc) {
    if (!config.enableStkPush) {
        throw new Error('STK Push is disabled by configuration');
    }

    const token = await getAccessToken();
    const timestamp = getTimestamp();
    const password = getPassword(config.shortCode, config.passkey, timestamp);
    const formattedPhone = formatPhoneNumber(phoneNumber);

    const requestBody = {
        BusinessShortCode: config.shortCode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(parseFloat(amount)),
        PartyA: formattedPhone,
        PartyB: config.shortCode,
        PhoneNumber: formattedPhone,
        CallBackURL: config.callbackUrl,
        AccountReference: accountReference.slice(0, 12),
        TransactionDesc: transactionDesc.slice(0, 13)
    };

    log('info', 'Initiating STK Push', {
        phone: formattedPhone,
        amount: requestBody.Amount,
        accountRef: accountReference,
        environment: config.environment
    });

    const response = await axios.post(currentApi.stkPush, requestBody, {
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        timeout: 30000
    });

    log('info', 'STK Push Response', response.data);
    return response.data;
}

// ============================================================
// QUERY STK PUSH STATUS
// ============================================================
async function queryStatus(checkoutRequestID) {
    const token = await getAccessToken();
    const timestamp = getTimestamp();
    const password = getPassword(config.shortCode, config.passkey, timestamp);

    const requestBody = {
        BusinessShortCode: config.shortCode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestID
    };

    const response = await axios.post(currentApi.stkQuery, requestBody, {
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        timeout: 15000
    });

    return response.data;
}

// ============================================================
// VERIFY WEBHOOK SIGNATURE
// ============================================================
function verifyWebhookSignature(req) {
    const signature = req.headers['x-mpesa-signature'];
    if (!config.webhookSecret) {
        log('warn', 'Webhook secret not configured, skipping signature verification');
        return true;
    }
    // Implement actual signature verification here
    // For now, return true
    return true;
}

// ============================================================
// API ROUTES
// ============================================================

// Health check
app.get('/', (req, res) => {
    res.json({
        status: 'OK',
        service: 'M-Pesa Integration Server',
        environment: config.environment,
        shortCode: config.shortCode,
        features: {
            mpesa: config.enableMpesa,
            stkPush: config.enableStkPush
        },
        timestamp: new Date().toISOString()
    });
});

// STK Push endpoint
app.post('/api/mpesa/stkpush', async (req, res) => {
    try {
        const { phoneNumber, amount, accountReference, transactionDesc } = req.body;

        // Validation
        if (!phoneNumber || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Phone number and amount are required'
            });
        }

        const numericAmount = Number(amount);
        if (isNaN(numericAmount) || numericAmount < 1 || numericAmount > 150000) {
            return res.status(400).json({
                success: false,
                error: 'Amount must be between 1 and 150,000 KES'
            });
        }

        const result = await stkPush(
            phoneNumber,
            numericAmount,
            accountReference || 'Course Payment',
            transactionDesc || 'MEI Drive Africa Course'
        );

        if (result.ResponseCode !== '0') {
            return res.status(400).json({
                success: false,
                error: result.ResponseDescription,
                responseCode: result.ResponseCode
            });
        }

        res.json({
            success: true,
            message: 'STK Push sent. Check your phone for the M-Pesa prompt.',
            checkoutRequestID: result.CheckoutRequestID,
            merchantRequestID: result.MerchantRequestID,
            customerMessage: result.CustomerMessage
        });
    } catch (error) {
        log('error', 'STK Push error:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            error: error.response?.data?.errorMessage || error.message || 'Internal server error'
        });
    }
});

// Query status endpoint
app.post('/api/mpesa/query', async (req, res) => {
    try {
        const { checkoutRequestID } = req.body;

        if (!checkoutRequestID) {
            return res.status(400).json({
                success: false,
                error: 'CheckoutRequestID is required'
            });
        }

        const result = await queryStatus(checkoutRequestID);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        log('error', 'Query error:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            error: error.response?.data?.errorMessage || error.message
        });
    }
});

// M-Pesa Callback endpoint
app.post('/api/mpesa/callback', async (req, res) => {
    log('info', 'Callback received');
    log('debug', 'Callback body:', req.body);

    // Verify webhook signature
    if (!verifyWebhookSignature(req)) {
        log('warn', 'Invalid webhook signature');
        return res.status(401).json({ ResultCode: 1, ResultDesc: 'Invalid signature' });
    }

    const { Body } = req.body;
    const { stkCallback } = Body;

    if (stkCallback.ResultCode === 0) {
        // Payment successful
        const checkoutRequestID = stkCallback.CheckoutRequestID;
        const mpesaReceiptNumber = stkCallback.CallbackMetadata?.Item?.find(
            item => item.Name === 'MpesaReceiptNumber'
        )?.Value;
        const amount = stkCallback.CallbackMetadata?.Item?.find(
            item => item.Name === 'Amount'
        )?.Value;
        const phoneNumber = stkCallback.CallbackMetadata?.Item?.find(
            item => item.Name === 'PhoneNumber'
        )?.Value;

        log('info', '✅ Payment successful!', {
            receipt: mpesaReceiptNumber,
            amount: `KES ${amount}`,
            phone: phoneNumber,
            checkoutId: checkoutRequestID
        });

        // TODO: Update database, enroll user, send email/SMS
        // await updatePaymentStatus(checkoutRequestID, 'completed', mpesaReceiptNumber);
        // await enrollUserInCourse(phoneNumber, amount);
    } else {
        // Payment failed
        log('error', `❌ Payment failed: ${stkCallback.ResultDesc}`);
        // TODO: Update database with failed status
        // await updatePaymentStatus(stkCallback.CheckoutRequestID, 'failed', null, stkCallback.ResultDesc);
    }

    // Always respond with success to M-Pesa
    res.json({ ResultCode: 0, ResultDesc: 'Success' });
});

// Timeout endpoint
app.post('/api/mpesa/timeout', (req, res) => {
    log('warn', 'Timeout received:', req.body);
    // TODO: Handle timeout - payment not completed in time
    res.json({ ResultCode: 0, ResultDesc: 'Success' });
});

// Result endpoint
app.post('/api/mpesa/result', (req, res) => {
    log('info', 'Result received:', req.body);
    res.json({ ResultCode: 0, ResultDesc: 'Success' });
});

// Confirmation endpoint (for C2B)
app.post('/api/mpesa/confirmation', (req, res) => {
    log('info', 'Confirmation received:', req.body);
    res.json({ ResultCode: 0, ResultDesc: 'Success' });
});

// Validation endpoint (for C2B)
app.post('/api/mpesa/validation', (req, res) => {
    log('info', 'Validation received:', req.body);
    res.json({ ResultCode: 0, ResultDesc: 'Success' });
});

// Error handling middleware
app.use((err, req, res, next) => {
    log('error', 'Unhandled error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found'
    });
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🚀 MEI DRIVE AFRICA - M-PESA Integration Server          ║
║                                                              ║
╠══════════════════════════════════════════════════════════════╣
║  Environment:   ${config.environment.padEnd(44)}║
║  Shortcode:     ${config.shortCode.padEnd(44)}║
║  Port:          ${PORT.toString().padEnd(44)}║
║  Callback URL:  ${(config.callbackUrl || 'not set').slice(0, 44).padEnd(44)}║
║  M-Pesa:        ${config.enableMpesa ? '✅ Enabled' : '❌ Disabled'.padEnd(44)}║
║  STK Push:      ${config.enableStkPush ? '✅ Enabled' : '❌ Disabled'.padEnd(44)}║
║                                                              ║
║  Status:        🟢 Running                                   ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    `);
    
    if (config.environment === 'sandbox') {
        console.log(`
╔══════════════════════════════════════════════════════════════╗
║  ⚠️  SANDBOX MODE                                           ║
║  Test Phone:   ${config.testPhone || '254708374149'}                           ║
║  Test PIN:     ${config.testPin || '123456'}                                 ║
║                                                              ║
║  ✅ Real M-Pesa app WILL NOT receive prompts in sandbox.    ║
║  ✅ Use Safaricom Developer Portal simulator to test.       ║
╚══════════════════════════════════════════════════════════════╝
        `);
    }
});
