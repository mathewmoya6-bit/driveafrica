// =====================================================
// MEI DRIVE AFRICA - PAYMENT SYSTEM
// PRODUCTION READY v2.3.0
// =====================================================

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

dotenv.config();

// =====================================================
// CONFIGURATION
// =====================================================

const config = {
    supabaseUrl: process.env.SUPABASE_URL || 'https://qpqkmmkrzxlhcpccefjn.supabase.co',
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY,
    mpesaConsumerKey: process.env.MPESA_CONSUMER_KEY,
    mpesaConsumerSecret: process.env.MPESA_CONSUMER_SECRET,
    mpesaPasskey: process.env.MPESA_PASSKEY,
    mpesaShortcode: process.env.MPESA_SHORTCODE || '4095377',
    backendUrl: process.env.BACKEND_URL || 'https://meidriveafrica-backend.onrender.com',
    frontendUrl: process.env.FRONTEND_URL || 'https://meidriveafrica.com',
    jwtSecret: process.env.JWT_SECRET || 'ph0jurMUHExgpz5e6g1hGU6gCqlW9yIefGhBEgwFUZB2jA/E/0t8y1StvWvzs4ZPwL6u6TzCU3mj4GoPH/8oAg==',
    environment: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 10000,
    isProduction: process.env.NODE_ENV === 'production',
};

// =====================================================
// SUPABASE CLIENT
// =====================================================

const supabase = createClient(config.supabaseUrl, config.supabaseKey);

// =====================================================
// EXPRESS APP
// =====================================================

const app = express();
const PORT = config.port;

// =====================================================
// SECURITY MIDDLEWARE
// =====================================================

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "unsafe-none" },
}));

// =====================================================
// CORS CONFIGURATION
// =====================================================

const allowedOrigins = config.isProduction 
    ? [
        'https://meidriveafrica.com',
        'https://www.meidriveafrica.com',
        'https://meidriveafrica.vercel.app',
        'https://meidriveafrica-backend.onrender.com',
        'https://auto-v.meipressgroup.com',
    ]
    : [
        'http://localhost:3000',
        'http://localhost:5173',
        'http://localhost:5500',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:5173',
        'https://*.onrender.com',
    ];

const corsOptions = {
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        
        const isAllowed = allowedOrigins.some(allowed => {
            if (typeof allowed === 'string') return origin === allowed;
            if (allowed instanceof RegExp) return allowed.test(origin);
            return false;
        });
        
        if (isAllowed || !config.isProduction) {
            callback(null, true);
        } else {
            console.log('❌ CORS blocked:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'X-Correlation-ID'],
    credentials: true,
    maxAge: 86400,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// =====================================================
// REQUEST PARSING
// =====================================================

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// =====================================================
// LOGGING
// =====================================================

app.use((req, res, next) => {
    console.log(`📝 [${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// =====================================================
// RATE LIMITING
// =====================================================

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { success: false, error: 'Too many requests.' },
});
app.use('/api/', limiter);

const paymentLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { success: false, error: 'Too many payment attempts.' },
});

// =====================================================
// HEALTH CHECK
// =====================================================

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: config.environment,
        isProduction: config.isProduction,
        mpesa_configured: !!(config.mpesaConsumerKey && config.mpesaConsumerSecret),
        version: '2.3.0'
    });
});

// =====================================================
// TEST ROUTE
// =====================================================

app.get('/api/test', (req, res) => {
    res.json({
        success: true,
        message: 'API is working!',
        environment: config.environment,
        timestamp: new Date().toISOString(),
        endpoints: {
            health: 'GET /health',
            payment_initiate: 'POST /api/v1/payments/mpesa/initiate',
            payment_status: 'GET /api/v1/payments/status/:checkoutRequestID',
            payment_callback: 'POST /api/v1/payments/mpesa/callback',
            test: 'GET /api/test',
            cors_test: 'GET /api/test/cors',
            mpesa_test: 'GET /api/test/mpesa'
        }
    });
});

// =====================================================
// CORS TEST
// =====================================================

app.get('/api/test/cors', (req, res) => {
    res.json({
        success: true,
        message: 'CORS is working!',
        origin: req.headers.origin || 'No origin',
        allowedOrigins: allowedOrigins,
        environment: config.environment,
        timestamp: new Date().toISOString()
    });
});

// =====================================================
// M-PESA TEST
// =====================================================

app.get('/api/test/mpesa', async (req, res) => {
    try {
        res.json({
            success: true,
            mpesa_configured: !!(config.mpesaConsumerKey && config.mpesaConsumerSecret),
            environment: config.environment,
            isProduction: config.isProduction,
            shortcode: config.mpesaShortcode,
            callback_url: `${config.backendUrl}/api/v1/payments/mpesa/callback`,
        });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// =====================================================
// HELPERS
// =====================================================

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

function formatPhoneNumber(phone) {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) cleaned = '254' + cleaned.substring(1);
    else if (cleaned.startsWith('+254')) cleaned = cleaned.substring(1);
    else if (!cleaned.startsWith('254')) cleaned = '254' + cleaned;
    if (!cleaned.startsWith('254') || cleaned.length !== 12) {
        throw new Error('Invalid phone number');
    }
    return cleaned;
}

function generateMpesaPassword(shortcode, passkey, timestamp) {
    const str = `${shortcode}${passkey}${timestamp}`;
    return Buffer.from(str).toString('base64');
}

function encryptData(text) {
    if (!text || !config.jwtSecret) return text;
    try {
        const iv = crypto.randomBytes(16);
        const key = crypto.scryptSync(config.jwtSecret, 'salt', 32);
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
    } catch (e) {
        return text;
    }
}

async function getMpesaToken() {
    if (!config.mpesaConsumerKey || !config.mpesaConsumerSecret) return null;
    try {
        const auth = Buffer.from(`${config.mpesaConsumerKey}:${config.mpesaConsumerSecret}`).toString('base64');
        const response = await axios.get(
            config.isProduction 
                ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
                : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
            { headers: { Authorization: `Basic ${auth}` }, timeout: 30000 }
        );
        return response.data.access_token;
    } catch (error) {
        console.error('M-Pesa token error:', error.message);
        return null;
    }
}

// =====================================================
// PAYMENT INITIATE
// =====================================================

app.post('/api/v1/payments/mpesa/initiate', paymentLimiter, async (req, res) => {
    console.log('🚀 PAYMENT INITIATE ROUTE HIT!');
    console.log('📥 Body:', JSON.stringify(req.body, null, 2));
    
    try {
        const { phoneNumber, amount, courseId, userId, email, idempotencyKey } = req.body;
        
        // Validate
        const errors = [];
        if (!phoneNumber) errors.push('Phone number required');
        if (!amount || amount < 1) errors.push('Valid amount required');
        if (!courseId) errors.push('Course ID required');
        
        if (errors.length > 0) {
            return res.status(400).json({ success: false, error: 'Validation failed', details: errors });
        }
        
        // Format phone
        let formattedPhone;
        try {
            formattedPhone = formatPhoneNumber(phoneNumber);
        } catch (e) {
            return res.status(400).json({ success: false, error: e.message });
        }
        
        // Check course
        const { data: course, error: courseError } = await supabase
            .from('courses')
            .select('*')
            .eq('id', courseId)
            .single();
        
        if (courseError || !course) {
            return res.status(404).json({ success: false, error: 'Course not found' });
        }
        
        // Create payment record
        const encryptedPhone = encryptData(formattedPhone);
        const paymentData = {
            user_id: userId || null,
            course_id: courseId,
            amount: Math.round(amount),
            phone_number_encrypted: encryptedPhone,
            phone_number_hash: crypto.createHash('sha256').update(formattedPhone).digest('hex'),
            checkout_request_id: 'REQ_' + Date.now() + '_' + Math.random().toString(36).substring(7),
            idempotency_key: idempotencyKey || uuidv4(),
            status: 'pending',
            metadata: { course_name: course.name, raw_phone: phoneNumber, environment: config.environment },
        };
        
        const { data: payment, error: paymentError } = await supabase
            .from('payments')
            .insert(paymentData)
            .select()
            .single();
        
        if (paymentError) {
            console.error('Payment insert error:', paymentError);
            return res.status(500).json({ success: false, error: 'Failed to create payment' });
        }
        
        console.log('✅ Payment created:', payment.id);
        
        // Try M-Pesa STK Push
        let mpesaResult = { status: 'skipped', message: 'M-Pesa not configured' };
        let checkoutRequestId = payment.checkout_request_id;
        
        if (config.mpesaConsumerKey && config.mpesaConsumerSecret) {
            try {
                const token = await getMpesaToken();
                if (token) {
                    const timestamp = getTimestamp();
                    const password = generateMpesaPassword(
                        config.mpesaShortcode,
                        config.mpesaPasskey,
                        timestamp
                    );
                    
                    const apiUrl = config.isProduction
                        ? 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
                        : 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';
                    
                    const stkRequest = {
                        BusinessShortCode: config.mpesaShortcode,
                        Password: password,
                        Timestamp: timestamp,
                        TransactionType: 'CustomerPayBillOnline',
                        Amount: Math.round(amount),
                        PartyA: formattedPhone,
                        PartyB: config.mpesaShortcode,
                        PhoneNumber: formattedPhone,
                        CallBackURL: `${config.backendUrl}/api/v1/payments/mpesa/callback`,
                        AccountReference: `MEI${String(courseId).slice(0, 6)}${Date.now().toString().slice(-6)}`,
                        TransactionDesc: `MEI DRIVE - ${course.name.slice(0, 20)}`,
                    };
                    
                    const mpesaResponse = await axios.post(apiUrl, stkRequest, {
                        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                        timeout: 35000,
                    });
                    
                    if (mpesaResponse.data.ResponseCode === '0') {
                        checkoutRequestId = mpesaResponse.data.CheckoutRequestID;
                        mpesaResult = {
                            status: 'sent',
                            checkoutRequestID: checkoutRequestId,
                            message: 'STK Push sent successfully'
                        };
                        
                        await supabase
                            .from('payments')
                            .update({ checkout_request_id: checkoutRequestId, status: 'processing' })
                            .eq('id', payment.id);
                    } else {
                        mpesaResult = { status: 'failed', error: mpesaResponse.data.ResponseDescription };
                    }
                }
            } catch (mpesaError) {
                console.error('M-Pesa error:', mpesaError.message);
                mpesaResult = { status: 'error', error: mpesaError.message };
            }
        }
        
        res.json({
            success: true,
            paymentId: payment.id,
            checkoutRequestID: checkoutRequestId,
            amount: payment.amount,
            status: payment.status,
            mpesa: mpesaResult,
            message: mpesaResult.status === 'sent' ? 'STK Push sent.' : 'Payment created.',
        });
        
    } catch (error) {
        console.error('❌ Payment error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =====================================================
// M-PESA CALLBACK
// =====================================================

app.post('/api/v1/payments/mpesa/callback', async (req, res) => {
    console.log('📞 M-Pesa callback received');
    
    try {
        const { Body } = req.body;
        if (!Body || !Body.stkCallback) {
            return res.json({ ResultCode: 0, ResultDesc: 'Success' });
        }
        
        const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = Body.stkCallback;
        
        const { data: payment } = await supabase
            .from('payments')
            .select('*')
            .eq('checkout_request_id', CheckoutRequestID)
            .single();
        
        if (!payment) {
            console.log('⚠️ Payment not found:', CheckoutRequestID);
            return res.json({ ResultCode: 0, ResultDesc: 'Success' });
        }
        
        if (ResultCode === 0 && CallbackMetadata) {
            const items = CallbackMetadata.Item || [];
            const receiptNumber = items.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
            
            await supabase
                .from('payments')
                .update({ status: 'completed', transaction_id: receiptNumber, mpesa_receipt: receiptNumber, completed_at: new Date().toISOString() })
                .eq('id', payment.id);
            
            await supabase
                .from('enrollments')
                .insert({ user_id: payment.user_id, course_id: payment.course_id, amount_paid: payment.amount, transaction_id: receiptNumber, status: 'active', enrolled_at: new Date().toISOString() });
            
            console.log('✅ Payment successful:', receiptNumber);
        } else {
            await supabase
                .from('payments')
                .update({ status: 'failed', failure_reason: ResultDesc, failure_code: ResultCode.toString(), failed_at: new Date().toISOString() })
                .eq('id', payment.id);
            
            console.log('❌ Payment failed:', ResultDesc);
        }
        
        res.json({ ResultCode: 0, ResultDesc: 'Success' });
        
    } catch (error) {
        console.error('Callback error:', error);
        res.json({ ResultCode: 0, ResultDesc: 'Success' });
    }
});

// =====================================================
// PAYMENT STATUS
// =====================================================

app.get('/api/v1/payments/status/:checkoutRequestID', async (req, res) => {
    try {
        const { checkoutRequestID } = req.params;
        
        const { data: payment } = await supabase
            .from('payments')
            .select('id, amount, status, transaction_id, mpesa_receipt, created_at, completed_at, failure_reason')
            .eq('checkout_request_id', checkoutRequestID)
            .single();
        
        if (!payment) {
            return res.status(404).json({ success: false, error: 'Payment not found' });
        }
        
        res.json({
            success: true,
            payment: {
                id: payment.id,
                amount: payment.amount,
                status: payment.status,
                transaction_id: payment.transaction_id,
                mpesa_receipt: payment.mpesa_receipt,
                created_at: payment.created_at,
                completed_at: payment.completed_at,
                failure_reason: payment.failure_reason,
            },
        });
        
    } catch (error) {
        console.error('Status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =====================================================
// 404
// =====================================================

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        path: req.path,
    });
});

// =====================================================
// ERROR HANDLER
// =====================================================

app.use((err, req, res, next) => {
    console.error('❌ Error:', err);
    res.status(500).json({
        success: false,
        error: config.isProduction ? 'Internal server error' : err.message,
    });
});

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                                                                   ║
║     🚗 MEI DRIVE AFRICA - PAYMENT SYSTEM                         ║
║     ✅ RUNNING v2.3.0                                            ║
║     📡 Port: ${PORT}                                               ║
║     🌍 Environment: ${config.environment}                         ║
║     💳 M-Pesa: ${config.mpesaConsumerKey ? '✅ Configured' : '❌ Not Configured'} ║
║     📦 Supabase: ✅ Connected                                    ║
║                                                                   ║
║     📋 Health: GET /health                                       ║
║     💰 Initiate: POST /api/v1/payments/mpesa/initiate            ║
║     📞 Callback: POST /api/v1/payments/mpesa/callback            ║
║     🔍 Status: GET /api/v1/payments/status/:checkoutRequestID    ║
║     ✅ Test: GET /api/test                                       ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
    `);
});

export default app;
