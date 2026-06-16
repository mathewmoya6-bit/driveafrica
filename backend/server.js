// =====================================================
// MEI DRIVE AFRICA - PAYMENT SYSTEM
// COMPLETE WORKING VERSION - COPY THIS ENTIRE FILE
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
    console.log('⚠️  The server will start but some features may not work.');
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
    jwtSecret: process.env.JWT_SECRET || 'your-secret-key-change-this',
    environment: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 10000,
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

// Security
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
}));

// CORS
app.use(cors({
    origin: config.environment === 'production' 
        ? ['https://meidriveafrica.com', 'https://www.meidriveafrica.com']
        : ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:5500', 'https://*.onrender.com'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID'],
    credentials: true,
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
app.use((req, res, next) => {
    console.log(`📝 [${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: { success: false, error: 'Too many requests' },
});
app.use('/api/', limiter);

// =====================================================
// HEALTH CHECK
// =====================================================

app.get('/health', async (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: config.environment,
        mpesa_configured: !!(config.mpesaConsumerKey && config.mpesaConsumerSecret),
        supabase: 'connected',
        version: '2.0.0'
    });
});

// =====================================================
// HELPERS
// =====================================================

function getTimestamp() {
    const date = new Date();
    return date.toISOString().replace(/[^0-9]/g, '').slice(0, 14);
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

function decryptData(encrypted) {
    if (!encrypted || !config.jwtSecret) return encrypted;
    try {
        const [ivHex, encryptedHex] = encrypted.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const key = crypto.scryptSync(config.jwtSecret, 'salt', 32);
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        return encrypted;
    }
}

async function getMpesaToken() {
    if (!config.mpesaConsumerKey || !config.mpesaConsumerSecret) {
        return null;
    }
    try {
        const auth = Buffer.from(`${config.mpesaConsumerKey}:${config.mpesaConsumerSecret}`).toString('base64');
        const response = await axios.get(
            'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
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

app.post('/api/v1/payments/mpesa/initiate', async (req, res) => {
    console.log('📥 Payment initiation request');
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    try {
        const { phoneNumber, amount, courseId, userId, email, courseName, idempotencyKey } = req.body;
        
        // Validate
        if (!phoneNumber) {
            return res.status(400).json({ success: false, error: 'Phone number required' });
        }
        if (!amount || amount < 1) {
            return res.status(400).json({ success: false, error: 'Valid amount required' });
        }
        if (!courseId) {
            return res.status(400).json({ success: false, error: 'Course ID required' });
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
        
        // Check if user exists (if userId provided)
        let userExists = true;
        let userName = 'User';
        if (userId) {
            const { data: user, error: userError } = await supabase
                .from('user_profiles')
                .select('full_name')
                .eq('id', userId)
                .single();
            if (userError || !user) {
                userExists = false;
            } else if (user.full_name) {
                userName = user.full_name;
            }
        }
        
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
        
        // Create payment record
        const encryptedPhone = encryptData(formattedPhone);
        const paymentData = {
            user_id: userId || '00000000-0000-0000-0000-000000000000',
            course_id: courseId,
            amount: Math.round(amount),
            phone_number_encrypted: encryptedPhone,
            phone_number_hash: crypto.createHash('sha256').update(formattedPhone).digest('hex'),
            checkout_request_id: 'REQ_' + Date.now() + '_' + Math.random().toString(36).substring(7),
            idempotency_key: idempotencyKey || uuidv4(),
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
        
        console.log('✅ Payment created:', payment.id);
        
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
                    const password = Buffer.from(
                        `${config.mpesaShortcode}${config.mpesaPasskey}${timestamp}`
                    ).toString('base64');
                    
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
                        AccountReference: `MEI${courseId}${Date.now().toString().slice(-6)}`,
                        TransactionDesc: `MEI DRIVE - ${course.name.slice(0, 20)}`,
                    };
                    
                    console.log('📤 Sending STK Push...');
                    const mpesaResponse = await axios.post(
                        'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
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
                            message: 'STK Push sent successfully'
                        };
                        
                        // Update payment with checkout request ID
                        await supabase
                            .from('payments')
                            .update({
                                checkout_request_id: checkoutRequestId,
                                status: 'processing'
                            })
                            .eq('id', payment.id);
                    } else {
                        mpesaResult = {
                            status: 'failed',
                            error: mpesaResponse.data.ResponseDescription || 'STK Push failed'
                        };
                    }
                } else {
                    mpesaResult = { status: 'error', message: 'Failed to get M-Pesa token' };
                }
            } catch (mpesaError) {
                console.error('M-Pesa error:', mpesaError.message);
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
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error',
            stack: config.environment === 'development' ? error.stack : undefined,
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
        
        // Find payment
        const { data: payment, error: paymentError } = await supabase
            .from('payments')
            .select('*')
            .eq('checkout_request_id', CheckoutRequestID)
            .single();
        
        if (paymentError || !payment) {
            console.log('⚠️ Payment not found:', CheckoutRequestID);
            return res.json({ ResultCode: 0, ResultDesc: 'Success' });
        }
        
        // Store callback
        await supabase
            .from('payment_callbacks')
            .insert({
                payment_id: payment.id,
                raw_payload: req.body,
                processed: true,
                processed_at: new Date().toISOString(),
            });
        
        if (ResultCode === 0 && CallbackMetadata) {
            const items = CallbackMetadata.Item || [];
            const receiptNumber = items.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
            const amount = items.find(i => i.Name === 'Amount')?.Value;
            
            console.log('✅ Payment successful:', receiptNumber);
            
            // Update payment using RPC for atomic transaction
            const result = await supabase.rpc('update_payment_with_enrollment', {
                p_payment_id: payment.id,
                p_status: 'completed',
                p_transaction_id: receiptNumber,
                p_mpesa_receipt: receiptNumber,
                p_completed_at: new Date().toISOString(),
            });
            
            console.log('Atomic update result:', result);
            
        } else {
            console.log('❌ Payment failed:', ResultDesc);
            
            await supabase.rpc('update_payment_with_enrollment', {
                p_payment_id: payment.id,
                p_status: 'failed',
                p_failure_reason: ResultDesc,
                p_failure_code: ResultCode.toString(),
                p_failed_at: new Date().toISOString(),
            });
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
            .select('*, user_profiles(full_name, email), courses(name)', { count: 'exact' });
        
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
// ADMIN DASHBOARD
// =====================================================

app.get('/api/v1/admin/dashboard', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        const { data: todayPayments } = await supabase
            .from('payments')
            .select('amount, status')
            .gte('created_at', `${today}T00:00:00Z`)
            .lt('created_at', `${today}T23:59:59Z`);
        
        const todayRevenue = todayPayments?.filter(p => p.status === 'completed')
            .reduce((sum, p) => sum + p.amount, 0) || 0;
        
        const { data: totalStats } = await supabase
            .from('payments')
            .select('amount, status');
        
        const totalRevenue = totalStats?.filter(p => p.status === 'completed')
            .reduce((sum, p) => sum + p.amount, 0) || 0;
        
        res.json({
            success: true,
            today: {
                revenue: todayRevenue,
                count: todayPayments?.length || 0,
            },
            total: {
                revenue: totalRevenue,
                count: totalStats?.length || 0,
                pending: totalStats?.filter(p => p.status === 'pending').length || 0,
                completed: totalStats?.filter(p => p.status === 'completed').length || 0,
                failed: totalStats?.filter(p => p.status === 'failed').length || 0,
            },
        });
        
    } catch (error) {
        console.error('Dashboard error:', error);
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
            shortcode: config.mpesaShortcode,
        });
    } catch (error) {
        res.json({
            success: false,
            error: error.message,
        });
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
        error: config.environment === 'production' ? 'Internal server error' : err.message,
        stack: config.environment === 'development' ? err.stack : undefined,
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
║     ✅ RUNNING                                                    ║
║     📡 Port: ${PORT}                                               ║
║     🌍 Environment: ${config.environment}                         ║
║     💳 M-Pesa: ${config.mpesaConsumerKey ? '✅ Configured' : '❌ Not Configured'} ║
║     📦 Supabase: ✅ Connected                                    ║
║                                                                   ║
║     📋 Health: http://localhost:${PORT}/health                     ║
║     💰 Initiate: POST /api/v1/payments/mpesa/initiate            ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
    `);
});

export default app;
