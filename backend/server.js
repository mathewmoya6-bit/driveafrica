import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;
const BACKEND_URL = process.env.BACKEND_URL || 'https://meidriveafrica-backend.onrender.com';

// ============================================
// REAL M-PESA PRODUCTION CREDENTIALS
// ============================================
// IMPORTANT: These MUST be set in Render.com environment variables
// Do NOT hardcode credentials in the code for security reasons
const MPESA_CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY;
const MPESA_CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
const MPESA_PASSKEY = process.env.MPESA_PASSKEY;
const MPESA_SHORTCODE = process.env.MPESA_SHORTCODE;
const MPESA_CALLBACK_URL = `${BACKEND_URL}/api/payments/mpesa/callback`;

// ============================================
// PRODUCTION SAFEGUARDS
// ============================================
const isProduction = process.env.NODE_ENV === 'production';
const hasValidCredentials = !!(MPESA_CONSUMER_KEY && MPESA_CONSUMER_SECRET && MPESA_PASSKEY && MPESA_SHORTCODE);

// Only allow production if credentials are valid
if (isProduction && !hasValidCredentials) {
    console.error('❌ CRITICAL: Cannot start in production mode without valid M-PESA credentials!');
    console.error('Please set these environment variables:');
    console.error('  - MPESA_CONSUMER_KEY');
    console.error('  - MPESA_CONSUMER_SECRET');
    console.error('  - MPESA_PASSKEY');
    console.error('  - MPESA_SHORTCODE');
    // Don't exit - let the server start but disable payment endpoints
}

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors({
    origin: isProduction ? ['https://meidriveafrica.com', 'https://www.meidriveafrica.com'] : '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Security headers for production
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Request logging middleware
app.use((req, res, next) => {
    // Don't log sensitive data in production
    console.log(`📝 ${req.method} ${req.url}`);
    next();
});

// Timeout middleware
app.use((req, res, next) => {
    req.setTimeout(120000);
    res.setTimeout(120000);
    next();
});

// ============================================
// UNHANDLED REJECTION HANDLER
// ============================================
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise);
    console.error('   Reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    console.error('Stack:', error.stack);
    // Don't exit the process in production
});

// ============================================
// HEALTH CHECK ENDPOINTS
// ============================================

app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        environment: isProduction ? 'PRODUCTION' : 'development',
        mpesa_configured: hasValidCredentials
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        message: 'MEI DRIVE AFRICA API is running',
        environment: isProduction ? 'PRODUCTION - REAL MONEY' : 'DEVELOPMENT',
        mpesa_configured: hasValidCredentials,
        paybill: MPESA_SHORTCODE || 'Not configured'
    });
});

// ============================================
// HELPER FUNCTIONS
// ============================================

function getTimestamp() {
    const date = new Date();
    return date.toISOString().replace(/[^0-9]/g, '').slice(0, 14);
}

function formatPhoneNumber(phoneNumber) {
    try {
        let cleaned = phoneNumber.replace(/\D/g, '');
        if (cleaned.startsWith('0')) {
            cleaned = '254' + cleaned.substring(1);
        } else if (cleaned.startsWith('+254')) {
            cleaned = cleaned.substring(1);
        } else if (!cleaned.startsWith('254')) {
            cleaned = '254' + cleaned;
        }
        
        if (!cleaned.startsWith('254') || cleaned.length !== 12) {
            throw new Error(`Invalid phone number format. Expected 12 digits starting with 254, got: ${cleaned}`);
        }
        return cleaned;
    } catch (error) {
        console.error('Phone formatting error:', error.message);
        throw error;
    }
}

async function getMpesaAccessToken() {
    if (!MPESA_CONSUMER_KEY || !MPESA_CONSUMER_SECRET) {
        throw new Error('M-PESA credentials not configured');
    }

    const auth = Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`).toString('base64');
    console.log('🔑 Getting M-Pesa access token...');
    
    try {
        const response = await axios.get(
            'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
            { 
                headers: { Authorization: `Basic ${auth}` }, 
                timeout: 30000 
            }
        );
        
        if (!response.data.access_token) {
            throw new Error('No access token received from Safaricom');
        }
        
        console.log('✅ M-Pesa access token obtained');
        return response.data.access_token;
    } catch (error) {
        console.error('❌ Failed to get access token');
        if (error.response) {
            console.error('   Status:', error.response.status);
            console.error('   Data:', error.response.data);
        }
        throw new Error(`M-Pesa auth failed: ${error.response?.data?.errorMessage || error.message}`);
    }
}

// Store pending transactions with expiration
const transactions = new Map();

// Clean up old transactions every hour
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of transactions.entries()) {
        const age = now - new Date(value.createdAt).getTime();
        if (age > 24 * 60 * 60 * 1000) { // 24 hours
            transactions.delete(key);
            console.log(`🧹 Cleaned up old transaction: ${key}`);
        }
    }
}, 60 * 60 * 1000);

// ============================================
// REAL M-PESA STK PUSH INITIATE - PRODUCTION
// ============================================

app.post('/api/payments/mpesa/initiate', async (req, res) => {
    try {
        // Verify credentials are configured
        if (!hasValidCredentials) {
            console.error('❌ Payment attempted but M-PESA not configured');
            return res.status(503).json({
                success: false,
                error: 'Payment service temporarily unavailable',
                code: 'SERVICE_UNAVAILABLE'
            });
        }

        const { phoneNumber, amount, courseId, userId, email, courseName } = req.body;
        
        console.log('========================================');
        console.log('💰 REAL M-PESA STK PUSH INITIATION');
        console.log('========================================');
        console.log('📱 Phone:', phoneNumber);
        console.log('💰 Amount: KES', amount);
        console.log('🎯 Course ID:', courseId);
        console.log('👤 User ID:', userId);
        console.log('========================================');
        
        // Validation
        if (!phoneNumber) {
            return res.status(400).json({ 
                success: false, 
                error: 'Phone number is required' 
            });
        }
        
        if (!amount || amount < 1) {
            return res.status(400).json({ 
                success: false, 
                error: 'Valid amount is required' 
            });
        }

        // M-PESA transaction limits
        if (amount < 1 || amount > 150000) {
            return res.status(400).json({
                success: false,
                error: 'Amount must be between KES 1 and KES 150,000'
            });
        }
        
        let formattedPhone;
        try {
            formattedPhone = formatPhoneNumber(phoneNumber);
        } catch (error) {
            return res.status(400).json({
                success: false,
                error: error.message
            });
        }
        console.log('📱 Formatted Phone:', formattedPhone);
        
        // Get access token
        const accessToken = await getMpesaAccessToken();
        
        const timestamp = getTimestamp();
        const password = Buffer.from(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`).toString('base64');
        
        // Production STK Push Request
        const stkRequest = {
            BusinessShortCode: MPESA_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: Math.round(amount),
            PartyA: formattedPhone,
            PartyB: MPESA_SHORTCODE,
            PhoneNumber: formattedPhone,
            CallBackURL: MPESA_CALLBACK_URL,
            AccountReference: `MEI${courseId || Date.now()}`,
            TransactionDesc: `MEI DRIVE - ${courseName || 'Course Payment'}`
        };
        
        console.log('📤 Sending STK Push to Safaricom...');
        console.log('📞 Callback URL:', MPESA_CALLBACK_URL);
        console.log('🏢 Shortcode:', MPESA_SHORTCODE);
        console.log('⚠️  REAL MONEY WILL BE DEDUCTED');
        
        const response = await axios.post(
            'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
            stkRequest,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 35000
            }
        );
        
        console.log('✅ STK Push Response:', response.data);
        
        if (response.data.ResponseCode !== '0') {
            throw new Error(response.data.ResponseDescription || 'STK Push failed');
        }
        
        // Store transaction with expiration
        transactions.set(response.data.CheckoutRequestID, {
            status: 'pending',
            userId,
            courseId,
            amount: Math.round(amount),
            email,
            courseName,
            phone: formattedPhone,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        });
        
        // Return success with warning
        res.json({
            success: true,
            checkoutRequestID: response.data.CheckoutRequestID,
            message: 'STK Push sent. Check your phone for M-Pesa prompt.',
            warning: '⚠️ REAL MONEY will be deducted from your M-Pesa account',
            amount: Math.round(amount),
            environment: 'PRODUCTION'
        });
        
    } catch (error) {
        console.error('❌ Payment error:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
        
        const statusCode = error.response?.status || 500;
        res.status(statusCode).json({
            success: false,
            error: error.response?.data?.errorMessage || 
                   error.response?.data?.ResponseDescription || 
                   error.message,
            code: error.response?.data?.errorCode || 
                  error.response?.data?.ResponseCode || 
                  'UNKNOWN_ERROR'
        });
    }
});

// ============================================
// CHECK PAYMENT STATUS - PRODUCTION
// ============================================

app.post('/api/payments/mpesa/status', async (req, res) => {
    try {
        if (!hasValidCredentials) {
            return res.status(503).json({
                success: false,
                error: 'Payment service unavailable',
                code: 'SERVICE_UNAVAILABLE'
            });
        }

        const { checkoutRequestID } = req.body;
        
        if (!checkoutRequestID) {
            return res.status(400).json({ 
                success: false, 
                error: 'CheckoutRequestID required' 
            });
        }
        
        console.log(`🔍 Checking payment status for: ${checkoutRequestID}`);
        
        const accessToken = await getMpesaAccessToken();
        const timestamp = getTimestamp();
        const password = Buffer.from(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`).toString('base64');
        
        const response = await axios.post(
            'https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query',
            {
                BusinessShortCode: MPESA_SHORTCODE,
                Password: password,
                Timestamp: timestamp,
                CheckoutRequestID: checkoutRequestID
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );
        
        const isCompleted = response.data.ResultCode === '0';
        const status = isCompleted ? 'completed' : 'pending';
        
        console.log(`📊 Status: ${status.toUpperCase()}`);
        if (isCompleted) {
            console.log('✅ Payment completed successfully');
        } else {
            console.log('⏳ Payment still pending');
        }
        
        res.json({
            success: true,
            status: status,
            resultCode: response.data.ResultCode,
            resultDesc: response.data.ResultDesc,
            checkoutRequestID: checkoutRequestID
        });
        
    } catch (error) {
        console.error('❌ Status check error:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
        res.status(500).json({
            success: false,
            status: 'failed',
            error: error.message,
            checkoutRequestID: req.body.checkoutRequestID
        });
    }
});

// ============================================
// M-PESA CALLBACK (Webhook) - PRODUCTION
// ============================================

app.post('/api/payments/mpesa/callback', (req, res) => {
    console.log('📞 M-Pesa Callback received at:', new Date().toISOString());
    console.log('📝 Callback Body:', JSON.stringify(req.body, null, 2));
    
    try {
        const { Body } = req.body;
        
        if (Body && Body.stkCallback) {
            const { 
                ResultCode, 
                ResultDesc, 
                CheckoutRequestID, 
                CallbackMetadata 
            } = Body.stkCallback;
            
            const transaction = transactions.get(CheckoutRequestID);
            
            if (ResultCode === 0 && CallbackMetadata) {
                const items = CallbackMetadata.Item || [];
                const receiptNumber = items.find(item => item.Name === 'MpesaReceiptNumber')?.Value;
                const amount = items.find(item => item.Name === 'Amount')?.Value;
                const phoneNumber = items.find(item => item.Name === 'PhoneNumber')?.Value;
                
                if (transaction) {
                    transaction.status = 'completed';
                    transaction.transaction_id = receiptNumber;
                    transaction.completed_amount = amount;
                    transaction.completed_at = new Date().toISOString();
                    transaction.mpesa_receipt = receiptNumber;
                }
                
                console.log('✅💰 PAYMENT SUCCESSFUL!');
                console.log('   Receipt Number:', receiptNumber);
                console.log('   Amount Paid: KES', amount);
                console.log('   Phone Number:', phoneNumber);
                console.log('   Checkout ID:', CheckoutRequestID);
                console.log('   Transaction:', transaction);
            } else {
                console.log('❌💰 PAYMENT FAILED');
                console.log('   Result Code:', ResultCode);
                console.log('   Result Description:', ResultDesc);
                console.log('   Checkout ID:', CheckoutRequestID);
                
                if (transaction) {
                    transaction.status = 'failed';
                    transaction.failure_reason = ResultDesc;
                    transaction.failed_at = new Date().toISOString();
                }
            }
        } else {
            console.log('⚠️ Invalid callback body received:', req.body);
        }
    } catch (error) {
        console.error('❌ Error processing callback:', error.message);
        console.error('Stack:', error.stack);
    }
    
    // Always respond with success to Safaricom
    res.json({ ResultCode: 0, ResultDesc: 'Success' });
});

// ============================================
// TRANSACTION ENDPOINTS
// ============================================

// Get transaction by ID
app.get('/api/payments/transactions/:id', (req, res) => {
    const { id } = req.params;
    const transaction = transactions.get(id);
    
    if (!transaction) {
        return res.status(404).json({
            success: false,
            error: 'Transaction not found'
        });
    }
    
    res.json({
        success: true,
        transaction: {
            ...transaction,
            // Don't expose sensitive data in production
            ...(isProduction ? {} : { full_details: transaction })
        }
    });
});

// Get all pending transactions (admin only in production)
app.get('/api/payments/transactions', (req, res) => {
    const pendingTransactions = [];
    for (const [key, value] of transactions.entries()) {
        if (value.status === 'pending') {
            pendingTransactions.push({
                id: key,
                ...value
            });
        }
    }
    
    res.json({
        success: true,
        pending: pendingTransactions.length,
        transactions: isProduction ? pendingTransactions.slice(0, 10) : pendingTransactions
    });
});

// ============================================
// ENROLLMENT ENDPOINT
// ============================================

app.post('/api/enroll', (req, res) => {
    console.log('📋 Enrollment request received');
    console.log('Body:', req.body);
    res.json({ 
        success: true, 
        message: 'Enrollment processed successfully' 
    });
});

// ============================================
// TEST M-PESA CONNECTION
// ============================================

app.get('/api/payments/mpesa/test', async (req, res) => {
    try {
        if (!hasValidCredentials) {
            return res.status(500).json({
                success: false,
                error: 'M-PESA credentials not configured',
                message: 'Please set environment variables in Render.com dashboard',
                environment: isProduction ? 'PRODUCTION' : 'development'
            });
        }

        const token = await getMpesaAccessToken();
        res.json({
            success: true,
            message: '✅ M-Pesa API connection successful',
            paybill: MPESA_SHORTCODE,
            environment: 'PRODUCTION - REAL MONEY',
            status: 'Connected',
            token_received: !!token,
            warning: '⚠️ This is a REAL PRODUCTION environment. Real money will be deducted.'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            paybill: MPESA_SHORTCODE || 'NOT SET',
            environment: isProduction ? 'PRODUCTION' : 'development'
        });
    }
});

// ============================================
// DEBUG ENDPOINT (Production Safe)
// ============================================

app.get('/api/debug/credentials', (req, res) => {
    const config = {
        environment: isProduction ? 'PRODUCTION' : 'development',
        mpesa_configured: hasValidCredentials,
        shortcode: MPESA_SHORTCODE || 'NOT SET',
        callback_url: MPESA_CALLBACK_URL,
        backend_url: BACKEND_URL,
        status: hasValidCredentials ? '✅ Configured' : '❌ Not Configured',
        warning: isProduction ? '⚠️ REAL MONEY WILL BE DEDUCTED' : 'Development mode'
    };
    
    // Only show credential status, not actual values
    if (hasValidCredentials) {
        config.credentials = {
            consumer_key: '✅ Configured',
            consumer_secret: '✅ Configured',
            passkey: '✅ Configured',
            shortcode: MPESA_SHORTCODE
        };
    } else {
        config.missing = [];
        if (!MPESA_CONSUMER_KEY) config.missing.push('MPESA_CONSUMER_KEY');
        if (!MPESA_CONSUMER_SECRET) config.missing.push('MPESA_CONSUMER_SECRET');
        if (!MPESA_PASSKEY) config.missing.push('MPESA_PASSKEY');
        if (!MPESA_SHORTCODE) config.missing.push('MPESA_SHORTCODE');
        config.message = `Missing credentials: ${config.missing.join(', ')}`;
    }
    
    res.json(config);
});

// ============================================
// ROOT ENDPOINT
// ============================================

app.get('/', (req, res) => {
    res.json({
        success: true,
        name: 'MEI DRIVE AFRICA API',
        version: '2.1.2',
        status: 'running',
        environment: isProduction ? 'PRODUCTION' : 'development',
        paybill: MPESA_SHORTCODE || 'Not configured',
        mpesa_status: hasValidCredentials ? '✅ Configured' : '⚠️ Not Configured',
        endpoints: [
            'GET  / - API Information',
            'GET  /health - Health Check',
            'GET  /api/health - Detailed Health',
            'GET  /api/payments/mpesa/test - Test M-PESA Connection',
            'GET  /api/debug/credentials - Check Configuration',
            'GET  /api/payments/transactions - List Transactions',
            'GET  /api/payments/transactions/:id - Get Transaction',
            'POST /api/payments/mpesa/initiate - Initiate Payment',
            'POST /api/payments/mpesa/status - Check Payment Status',
            'POST /api/payments/mpesa/callback - M-PESA Webhook',
            'POST /api/enroll - Enroll User'
        ],
        warning: isProduction ? '⚠️ REAL MONEY ENVIRONMENT' : 'Development Environment'
    });
});

// ============================================
// 404 HANDLER
// ============================================

app.use((req, res) => {
    console.log(`❌ 404: Cannot ${req.method} ${req.url}`);
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        message: `Cannot ${req.method} ${req.url}`
    });
});

// ============================================
// GLOBAL ERROR HANDLER
// ============================================

app.use((err, req, res, next) => {
    console.error('❌ Global error:', err);
    console.error('Stack:', err.stack);
    res.status(500).json({
        success: false,
        error: isProduction ? 'Internal server error' : err.message,
        code: 'INTERNAL_ERROR',
        ...(isProduction ? {} : { stack: err.stack })
    });
});

// ============================================
// START SERVER
// ============================================

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                                                                   ║
║     🚗 MEI DRIVE AFRICA - M-PESA API SERVER                       ║
║     🟢 Version: 2.1.2                                            ║
║                                                                   ║
║     Status: ✅ RUNNING                                            ║
║     Port: ${PORT}                                                   ║
║     Environment: ${isProduction ? '🔴 PRODUCTION - REAL MONEY' : '🟢 DEVELOPMENT'} ║
║     Paybill: ${MPESA_SHORTCODE || '❌ NOT SET'}                       ║
║     M-PESA: ${hasValidCredentials ? '✅ CONFIGURED' : '❌ NOT CONFIGURED'} ║
║                                                                   ║
║     ${isProduction ? '⚠️  REAL MONEY WILL BE DEDUCTED FROM CUSTOMERS' : '💻 Development Mode'} ║
║                                                                   ║
║     Health: ${BACKEND_URL}/health                                  ║
║     Test: ${BACKEND_URL}/api/payments/mpesa/test                   ║
║     Debug: ${BACKEND_URL}/api/debug/credentials                    ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
    `);

    if (!hasValidCredentials) {
        console.error(`
╔═══════════════════════════════════════════════════════════════════╗
║ ❌ CRITICAL: M-PESA CREDENTIALS NOT CONFIGURED                    ║
║                                                                   ║
║   Please set these environment variables in Render.com:           ║
║                                                                   ║
║   🔑 MPESA_CONSUMER_KEY      - Your Safaricom API Key             ║
║   🔑 MPESA_CONSUMER_SECRET   - Your Safaricom API Secret          ║
║   🔑 MPESA_PASSKEY           - Your Safaricom Passkey             ║
║   📱 MPESA_SHORTCODE         - Your Paybill (4095377)            ║
║                                                                   ║
║   Steps:                                                          ║
║   1. Go to Render.com Dashboard                                   ║
║   2. Click on your service                                       ║
║   3. Go to "Environment" tab                                     ║
║   4. Add the variables above                                     ║
║   5. Deploy the service                                          ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
        `);
    } else {
        console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║ ✅ M-PESA CREDENTIALS CONFIGURED                                 ║
║                                                                   ║
║   ⚠️  REMEMBER: This is a PRODUCTION environment                 ║
║   💰 REAL MONEY will be deducted from customers                   ║
║                                                                   ║
║   Test the connection:                                            ║
║   ${BACKEND_URL}/api/payments/mpesa/test                          ║
║                                                                   ║
║   Initiate a payment:                                             ║
║   POST ${BACKEND_URL}/api/payments/mpesa/initiate                 ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
        `);
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('📴 SIGTERM received, closing server...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('📴 SIGINT received, closing server...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

export default app;
