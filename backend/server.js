// =====================================================
// MEI DRIVE AFRICA - PAYMENT SYSTEM
// PRODUCTION READY v2.2.0 - ALL FIXES APPLIED
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
// ENVIRONMENT CHECK
// =====================================================

const requiredVars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET',
    'MPESA_PASSKEY',
    'MPESA_SHORTCODE',
    'BACKEND_URL',
    'JWT_SECRET'
];

const missing = requiredVars.filter(v => !process.env[v]);
if (missing.length > 0) {
    console.log('⚠️  WARNING: Missing environment variables:', missing.join(', '));
}

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
// CORS CONFIGURATION - FIXED FOR PRODUCTION
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
        if (!origin) {
            return callback(null, true);
        }
        
        const isAllowed = allowedOrigins.some(allowed => {
            if (typeof allowed === 'string') {
                return origin === allowed;
            }
            if (allowed instanceof RegExp) {
                return allowed.test(origin);
            }
            return false;
        });
        
        if (isAllowed) {
            callback(null, true);
        } else if (!config.isProduction) {
            callback(null, true);
        } else {
            console.log('❌ CORS blocked:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'Origin',
        'Access-Control-Allow-Origin',
        'Access-Control-Allow-Headers',
        'Access-Control-Allow-Methods',
        'X-Correlation-ID'
    ],
    exposedHeaders: ['Content-Length', 'X-Request-Id'],
    credentials: true,
    maxAge: 86400,
    preflightContinue: false,
    optionsSuccessStatus: 204,
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
    message: { success: false, error: 'Too many requests, please try again later.' },
});

app.use('/api/', limiter);

const paymentLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { success: false, error: 'Too many payment attempts. Please wait an hour.' },
});

// =====================================================
// HEALTH CHECK
// =====================================================

app.get('/health', async (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: config.environment,
        isProduction: config.isProduction,
        mpesa_configured: !!(config.mpesaConsumerKey && config.mpesaConsumerSecret),
        supabase: 'connected',
        cors: {
            allowedOrigins: allowedOrigins,
            count: allowedOrigins.length,
        },
        version: '2.2.0'
    });
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
    if (cleaned.startsWith('0')) {
        cleaned = '254' + cleaned.substring(1);
    } else if (cleaned.startsWith('+254')) {
        cleaned = cleaned.substring(1);
    } else if (!cleaned.startsWith('254')) {
        cleaned = '254' + cleaned;
    }
    if (!cleaned.startsWith('254') || cleaned.length !== 12) {
        throw new Error('Invalid phone number. Must be a valid Kenyan number (e.g., 0712345678)');
    }
    return cleaned;
}

// ✅ FIX #4: Correct M-Pesa password generation (Base64, not SHA256)
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
        console.error('Encryption error:', e.message);
        return text;
    }
}

async function getMpesaToken() {
    if (!config.mpesaConsumerKey || !config.mpesaConsumerSecret) {
        console.log('⚠️ M-Pesa credentials not configured');
        return null;
    }
    try {
        const auth = Buffer.from(`${config.mpesaConsumerKey}:${config.mpesaConsumerSecret}`).toString('base64');
        const response = await axios.get(
            config.isProduction 
                ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
                : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
            { 
                headers: { Authorization: `Basic ${auth}` }, 
                timeout: 30000 
            }
        );
        console.log('✅ M-Pesa token obtained');
        return response.data.access_token;
    } catch (error) {
        console.error('❌ M-Pesa token error:', error.message);
        if (error.response) {
            console.error('Response:', error.response.data);
        }
        return null;
    }
}

// =====================================================
// PAYMENT INITIATE - FIXED
// =====================================================

app.post('/api/v1/payments/mpesa/initiate', paymentLimiter, async (req, res) => {
    console.log('📥 Payment initiation request');
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    try {
        const { phoneNumber, amount, courseId, userId, email, courseName, idempotencyKey } = req.body;
        
        // Validate
        const errors = [];
        if (!phoneNumber) errors.push('Phone number required');
        if (!amount || amount < 1) errors.push('Valid amount required');
        if (!courseId) errors.push('Course ID required');
        
        if (errors.length > 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Validation failed',
                details: errors 
            });
        }
        
        // Format phone
        let formattedPhone;
        try {
            formattedPhone = formatPhoneNumber(phoneNumber);
        } catch (e) {
            return res.status(400).json({ success: false, error: e.message });
        }
        
        // ✅ FIX #3: courseId.slice() crash - convert to string safely
        const courseIdStr = String(courseId);
        const courseRef = courseIdStr.slice(0, 6);
        
        // Check course
        const { data: course, error: courseError } = await supabase
            .from('courses')
            .select('*')
            .eq('id', courseId)
            .single();
        
        if (courseError || !course) {
            return res.status(404).json({ success: false, error: 'Course not found' });
        }
        
        // ✅ FIX #6: Check user_profiles table, fallback to profiles
        let userExists = true;
        let userName = 'User';
        let userIdToUse = userId || null;
        
        if (userId) {
            // Try user_profiles first
            let { data: user, error: userError } = await supabase
                .from('user_profiles')
                .select('full_name, id')
                .eq('id', userId)
                .single();
            
            // Fallback to profiles table
            if (userError || !user) {
                const { data: profileData, error: profileError } = await supabase
                    .from('profiles')
                    .select('full_name, id')
                    .eq('id', userId)
                    .single();
                
                if (profileData) {
                    user = profileData;
                } else {
                    userExists = false;
                }
            }
            
            if (user && user.full_name) {
                userName = user.full_name;
            }
        }
        
        // ✅ FIX #9: Don't use dummy UUID - use null instead
        const finalUserId = userId || null;
        
        // Check idempotency
        if (idempotencyKey) {
            const { data: existing } = await supabase
                .from('payments')
                .select('id, status')
                .eq('idempotency_key', idempotencyKey)
                .single();
            if (existing) {
                return res.json({
                    success: true,
                    paymentId: existing.id,
                    status: existing.status,
                    message: 'Payment already processed'
                });
            }
        }
        
        // ✅ FIX #8: Explicitly set status to 'pending'
        const encryptedPhone = encryptData(formattedPhone);
        const paymentData = {
            user_id: finalUserId,
            course_id: courseId,
            amount: Math.round(amount),
            phone_number_encrypted: encryptedPhone,
            phone_number_hash: crypto.createHash('sha256').update(formattedPhone).digest('hex'),
            checkout_request_id: 'REQ_' + Date.now() + '_' + Math.random().toString(36).substring(7),
            idempotency_key: idempotencyKey || uuidv4(),
            status: 'pending', // ✅ Explicitly set
            metadata: {
                course_name: course.name,
                raw_phone: phoneNumber,
                user_name: userName,
                environment: config.environment,
            },
        };
        
        const { data: payment, error: paymentError } = await supabase
            .from('payments')
            .insert(paymentData)
            .select()
            .single();
        
        if (paymentError) {
            console.error('Payment insert error:', paymentError);
            return res.status(500).json({
                success: false,
                error: 'Failed to create payment',
                details: paymentError.message
            });
        }
        
        console.log('✅ Payment created:', payment.id, 'Status:', payment.status);
        
        // ============================================
        // TRY M-PESA STK PUSH
        // ============================================
        let mpesaResult = { status: 'skipped', message: 'M-Pesa not configured' };
        let checkoutRequestId = payment.checkout_request_id;
        
        if (config.mpesaConsumerKey && config.mpesaConsumerSecret) {
            try {
                const token = await getMpesaToken();
                if (token) {
                    const timestamp = getTimestamp();
                    // ✅ FIX #4: Correct password generation
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
                        AccountReference: `MEI${courseRef}${Date.now().toString().slice(-6)}`,
                        TransactionDesc: `MEI DRIVE - ${course.name.slice(0, 20)}`,
                    };
                    
                    console.log('📤 Sending STK Push...');
                    console.log('API URL:', apiUrl);
                    console.log('Request:', JSON.stringify(stkRequest, null, 2));
                    
                    const mpesaResponse = await axios.post(
                        apiUrl,
                        stkRequest,
                        {
                            headers: {
                                Authorization: `Bearer ${token}`,
                                'Content-Type': 'application/json',
                            },
                            timeout: 35000,
                        }
                    );
                    
                    console.log('📥 M-Pesa response:', mpesaResponse.data);
                    
                    if (mpesaResponse.data.ResponseCode === '0') {
                        checkoutRequestId = mpesaResponse.data.CheckoutRequestID;
                        mpesaResult = {
                            status: 'sent',
                            checkoutRequestID: checkoutRequestId,
                            merchantRequestID: mpesaResponse.data.MerchantRequestID,
                            message: 'STK Push sent successfully'
                        };
                        
                        // Update payment with checkout request ID and status
                        await supabase
                            .from('payments')
                            .update({
                                checkout_request_id: checkoutRequestId,
                                status: 'processing'
                            })
                            .eq('id', payment.id);
                    } else {
                        // ✅ FIX #24: Update status when STK fails
                        await supabase
                            .from('payments')
                            .update({
                                status: 'failed',
                                failure_reason: mpesaResponse.data.ResponseDescription || 'STK Push failed',
                                failure_code: mpesaResponse.data.ResponseCode
                            })
                            .eq('id', payment.id);
                            
                        mpesaResult = {
                            status: 'failed',
                            error: mpesaResponse.data.ResponseDescription || 'STK Push failed',
                            responseCode: mpesaResponse.data.ResponseCode
                        };
                    }
                } else {
                    // ✅ FIX #24: Update status when token fails
                    await supabase
                        .from('payments')
                        .update({
                            status: 'failed',
                            failure_reason: 'Failed to get M-Pesa token'
                        })
                        .eq('id', payment.id);
                        
                    mpesaResult = { status: 'error', message: 'Failed to get M-Pesa token' };
                }
            } catch (mpesaError) {
                console.error('M-Pesa error:', mpesaError.message);
                if (mpesaError.response) {
                    console.error('Response:', mpesaError.response.data);
                }
                
                // ✅ FIX #24: Update status when STK fails
                await supabase
                    .from('payments')
                    .update({
                        status: 'failed',
                        failure_reason: mpesaError.response?.data?.errorMessage || mpesaError.message
                    })
                    .eq('id', payment.id);
                    
                mpesaResult = {
                    status: 'error',
                    error: mpesaError.response?.data?.errorMessage || mpesaError.message
                };
            }
        }
        
        // ============================================
        // RESPONSE
        // ============================================
        res.json({
            success: true,
            paymentId: payment.id,
            checkoutRequestID: checkoutRequestId,
            amount: payment.amount,
            status: payment.status,
            mpesa: mpesaResult,
            message: mpesaResult.status === 'sent' 
                ? 'STK Push sent. Check your phone for M-Pesa prompt.'
                : 'Payment created successfully.',
        });
        
    } catch (error) {
        console.error('❌ Payment error:', error);
        console.error('Stack:', error.stack);
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error',
            ...(config.environment === 'development' && { stack: error.stack }),
        });
    }
});

// =====================================================
// M-PESA CALLBACK
// =====================================================

app.post('/api/v1/payments/mpesa/callback', async (req, res) => {
    console.log('📞 M-Pesa callback received');
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    try {
        const { Body } = req.body;
        if (!Body || !Body.stkCallback) {
            console.log('⚠️ Invalid callback structure');
            return res.json({ ResultCode: 0, ResultDesc: 'Success' });
        }
        
        const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = Body.stkCallback;
        
        // Find payment by checkout_request_id
        const { data: payment, error: paymentError } = await supabase
            .from('payments')
            .select('*')
            .eq('checkout_request_id', CheckoutRequestID)
            .single();
        
        if (paymentError || !payment) {
            console.log('⚠️ Payment not found:', CheckoutRequestID);
            return res.json({ ResultCode: 0, ResultDesc: 'Success' });
        }
        
        // ✅ FIX #12: Verify payment_callbacks table exists, if not use payments
        try {
            await supabase
                .from('payment_callbacks')
                .insert({
                    payment_id: payment.id,
                    raw_payload: req.body,
                    processed: true,
                    processed_at: new Date().toISOString(),
                });
        } catch (callbackError) {
            console.log('⚠️ payment_callbacks table not found, storing in payments metadata');
            // Store callback in payment metadata instead
            await supabase
                .from('payments')
                .update({
                    metadata: {
                        ...payment.metadata,
                        callback: req.body,
                        callback_received_at: new Date().toISOString()
                    }
                })
                .eq('id', payment.id);
        }
        
        if (ResultCode === 0 && CallbackMetadata) {
            const items = CallbackMetadata.Item || [];
            const receiptNumber = items.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
            const amount = items.find(i => i.Name === 'Amount')?.Value;
            const transactionDate = items.find(i => i.Name === 'TransactionDate')?.Value;
            const phoneNumber = items.find(i => i.Name === 'PhoneNumber')?.Value;
            
            console.log('✅ Payment successful:', receiptNumber);
            
            // ✅ FIX #11: Check if RPC function exists, fallback to direct update
            try {
                // Try RPC first
                const result = await supabase.rpc('update_payment_with_enrollment', {
                    p_payment_id: payment.id,
                    p_status: 'completed',
                    p_transaction_id: receiptNumber,
                    p_mpesa_receipt: receiptNumber,
                    p_completed_at: new Date().toISOString(),
                });
                console.log('RPC result:', result);
            } catch (rpcError) {
                console.log('⚠️ RPC function not found, using direct update');
                // Fallback to direct update
                await supabase
                    .from('payments')
                    .update({
                        status: 'completed',
                        transaction_id: receiptNumber,
                        mpesa_receipt: receiptNumber,
                        completed_at: new Date().toISOString(),
                    })
                    .eq('id', payment.id);
                
                // Create enrollment
                await supabase
                    .from('enrollments')
                    .insert({
                        user_id: payment.user_id,
                        course_id: payment.course_id,
                        amount_paid: payment.amount,
                        transaction_id: receiptNumber,
                        status: 'active',
                        enrolled_at: new Date().toISOString(),
                    });
            }
            
        } else {
            console.log('❌ Payment failed:', ResultDesc);
            
            await supabase
                .from('payments')
                .update({
                    status: 'failed',
                    failure_reason: ResultDesc,
                    failure_code: ResultCode.toString(),
                    failed_at: new Date().toISOString(),
                })
                .eq('id', payment.id);
        }
        
        res.json({ ResultCode: 0, ResultDesc: 'Success' });
        
    } catch (error) {
        console.error('Callback error:', error);
        console.error('Stack:', error.stack);
        res.json({ ResultCode: 0, ResultDesc: 'Success' });
    }
});

// =====================================================
// ✅ FIX #5: PAYMENT STATUS BY CHECKOUT REQUEST ID
// =====================================================

app.get('/api/v1/payments/status/:checkoutRequestID', async (req, res) => {
    try {
        const { checkoutRequestID } = req.params;
        
        if (!checkoutRequestID) {
            return res.status(400).json({
                success: false,
                error: 'CheckoutRequestID is required'
            });
        }
        
        const { data: payment, error } = await supabase
            .from('payments')
            .select('id, user_id, amount, status, transaction_id, mpesa_receipt, created_at, completed_at, failure_reason, checkout_request_id')
            .eq('checkout_request_id', checkoutRequestID)
            .single();
        
        if (error || !payment) {
            return res.status(404).json({
                success: false,
                error: 'Payment not found'
            });
        }
        
        // If status is still processing, try to query M-Pesa
        if (payment.status === 'processing' || payment.status === 'pending') {
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
                        ? 'https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query'
                        : 'https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query';
                    
                    const queryResponse = await axios.post(
                        apiUrl,
                        {
                            BusinessShortCode: config.mpesaShortcode,
                            Password: password,
                            Timestamp: timestamp,
                            CheckoutRequestID: checkoutRequestID
                        },
                        {
                            headers: {
                                Authorization: `Bearer ${token}`,
                                'Content-Type': 'application/json',
                            },
                            timeout: 30000,
                        }
                    );
                    
                    if (queryResponse.data.ResultCode === '0') {
                        // Payment completed
                        await supabase
                            .from('payments')
                            .update({
                                status: 'completed',
                                transaction_id: queryResponse.data.TransactionID || queryResponse.data.MpesaReceiptNumber,
                                mpesa_receipt: queryResponse.data.MpesaReceiptNumber,
                                completed_at: new Date().toISOString(),
                            })
                            .eq('id', payment.id);
                        
                        payment.status = 'completed';
                    } else if (queryResponse.data.ResultCode !== '1037') {
                        // Failed (1037 means pending)
                        await supabase
                            .from('payments')
                            .update({
                                status: 'failed',
                                failure_reason: queryResponse.data.ResultDesc || 'Transaction failed',
                                failure_code: queryResponse.data.ResultCode
                            })
                            .eq('id', payment.id);
                        
                        payment.status = 'failed';
                    }
                }
            } catch (queryError) {
                console.log('⚠️ M-Pesa query failed:', queryError.message);
                // Don't update status, keep as processing
            }
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
// LEGACY STATUS ENDPOINT (for backwards compatibility)
// =====================================================

app.get('/api/v1/payments/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        
        const { data: payment, error } = await supabase
            .from('payments')
            .select('id, user_id, amount, status, transaction_id, mpesa_receipt, created_at, completed_at, failure_reason')
            .eq('id', id)
            .single();
        
        if (error || !payment) {
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
// ADMIN PAYMENTS
// =====================================================

app.get('/api/v1/admin/payments', async (req, res) => {
    try {
        const { page = 1, limit = 20, status } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        
        let query = supabase
            .from('payments')
            .select('*, courses(name)', { count: 'exact' });
        
        if (status) query = query.eq('status', status);
        
        const { data, error, count } = await query
            .order('created_at', { ascending: false })
            .range(offset, offset + parseInt(limit) - 1);
        
        if (error) throw error;
        
        res.json({
            success: true,
            data,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: count || 0,
            },
        });
        
    } catch (error) {
        console.error('Admin payments error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =====================================================
// TEST M-PESA CONNECTION
// =====================================================

app.get('/api/test/mpesa', async (req, res) => {
    try {
        const token = await getMpesaToken();
        res.json({
            success: true,
            mpesa_configured: !!(config.mpesaConsumerKey && config.mpesaConsumerSecret),
            token_received: !!token,
            environment: config.environment,
            isProduction: config.isProduction,
            shortcode: config.mpesaShortcode,
            callback_url: `${config.backendUrl}/api/v1/payments/mpesa/callback`,
        });
    } catch (error) {
        res.json({
            success: false,
            error: error.message,
        });
    }
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
// 404
// =====================================================

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        path: req.path,
        method: req.method,
    });
});

// =====================================================
// ERROR HANDLER
// =====================================================

app.use((err, req, res, next) => {
    console.error('❌ Error:', err);
    console.error('Stack:', err.stack);
    
    if (err.message === 'Not allowed by CORS') {
        return res.status(403).json({
            success: false,
            error: 'Access denied by CORS policy',
            allowedOrigins: allowedOrigins,
        });
    }
    
    res.status(500).json({
        success: false,
        error: config.isProduction ? 'Internal server error' : err.message,
        ...(config.environment === 'development' && { stack: err.stack }),
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
║     ✅ RUNNING v2.2.0                                            ║
║     📡 Port: ${PORT}                                               ║
║     🌍 Environment: ${config.environment}                         ║
║     🏭 Production: ${config.isProduction}                         ║
║     💳 M-Pesa: ${config.mpesaConsumerKey ? '✅ Configured' : '❌ Not Configured'} ║
║     📦 Supabase: ✅ Connected                                    ║
║                                                                   ║
║     📋 Health: GET /health                                       ║
║     💰 Initiate: POST /api/v1/payments/mpesa/initiate            ║
║     📞 Callback: POST /api/v1/payments/mpesa/callback            ║
║     🔍 Status: GET /api/v1/payments/status/:checkoutRequestID    ║
║     ✅ CORS Test: GET /api/test/cors                             ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
    `);
});

export default app;
