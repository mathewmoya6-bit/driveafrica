// =====================================================
// MEI DRIVE AFRICA - PAYMENT SYSTEM
// Production Ready v5.0
// =====================================================

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import NodeCache from 'node-cache';

dotenv.config();

// =====================================================
// CONFIGURATION & VALIDATION
// =====================================================

const requiredEnvVars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_ANON_KEY',
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET',
    'MPESA_PASSKEY',
    'MPESA_SHORTCODE',
    'BACKEND_URL',
    'JWT_SECRET',
    'ENCRYPTION_KEY',
    'REDIS_URL'
];

const missingVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(v => console.error(`   - ${v}`));
    process.exit(1);
}

const config = {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    mpesaConsumerKey: process.env.MPESA_CONSUMER_KEY,
    mpesaConsumerSecret: process.env.MPESA_CONSUMER_SECRET,
    mpesaPasskey: process.env.MPESA_PASSKEY,
    mpesaShortcode: process.env.MPESA_SHORTCODE,
    mpesaEnvironment: process.env.MPESA_ENVIRONMENT || 'sandbox',
    backendUrl: process.env.BACKEND_URL,
    jwtSecret: process.env.JWT_SECRET,
    encryptionKey: process.env.ENCRYPTION_KEY,
    environment: process.env.NODE_ENV || 'development',
    redisUrl: process.env.REDIS_URL,
    port: process.env.PORT || 10000,
};

// Validate encryption key
if (config.encryptionKey.length !== 64) {
    console.error('❌ ENCRYPTION_KEY must be 64 hex characters');
    console.error(`   Current length: ${config.encryptionKey.length}`);
    process.exit(1);
}

// =====================================================
// LOGGING
// =====================================================

const logger = pino({
    level: config.environment === 'production' ? 'info' : 'debug',
    redact: ['req.headers.authorization', '*.phoneNumber', '*.email'],
    timestamp: pino.stdTimeFunctions.isoTime,
});

// =====================================================
// SUPABASE CLIENTS
// =====================================================

const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
const supabaseAdmin = createClient(config.supabaseUrl, config.supabaseServiceKey);

// =====================================================
// ENCRYPTION HELPERS
// =====================================================

function encryptText(text) {
    if (!text) return null;
    const key = Buffer.from(config.encryptionKey, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decryptText(encryptedData) {
    if (!encryptedData) return null;
    try {
        const key = Buffer.from(config.encryptionKey, 'hex');
        const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        logger.error({ error: error.message }, 'Decryption failed');
        return null;
    }
}

function hashData(data) {
    if (!data) return null;
    return crypto.createHash('sha256').update(data).digest('hex');
}

// =====================================================
// HELPERS
// =====================================================

function getTimestamp() {
    const date = new Date();
    return date.toISOString().replace(/[^0-9]/g, '').slice(0, 14);
}

function formatPhoneNumber(phoneNumber) {
    let cleaned = phoneNumber.replace(/\D/g, '');
    if (cleaned.startsWith('0')) cleaned = '254' + cleaned.substring(1);
    else if (cleaned.startsWith('+254')) cleaned = cleaned.substring(1);
    else if (!cleaned.startsWith('254')) cleaned = '254' + cleaned;
    if (!cleaned.startsWith('254') || cleaned.length !== 12) {
        throw new Error('Invalid phone number');
    }
    const validPrefixes = ['2547', '2541'];
    if (!validPrefixes.some(p => cleaned.startsWith(p))) {
        throw new Error('Must be a Safaricom number');
    }
    return cleaned;
}

function maskPhone(phone) {
    if (!phone) return null;
    return phone.slice(0, 4) + '****' + phone.slice(-4);
}

// =====================================================
// MPESA API
// =====================================================

const MPESA_API = {
    sandbox: {
        auth: 'https://sandbox.safaricom.co.ke/oauth/v1/generate',
        stkPush: 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
        stkQuery: 'https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query',
        reversal: 'https://sandbox.safaricom.co.ke/mpesa/reversal/v1/request',
    },
    production: {
        auth: 'https://api.safaricom.co.ke/oauth/v1/generate',
        stkPush: 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
        stkQuery: 'https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query',
        reversal: 'https://api.safaricom.co.ke/mpesa/reversal/v1/request',
    }
};

function getMpesaApi() {
    return MPESA_API[config.mpesaEnvironment] || MPESA_API.sandbox;
}

// =====================================================
// REDIS & QUEUES
// =====================================================

let redis;
let redisAvailable = false;

async function initRedis() {
    try {
        redis = new Redis(config.redisUrl, {
            maxRetriesPerRequest: 3,
            retryStrategy: (times) => times > 3 ? null : Math.min(times * 100, 3000),
            lazyConnect: true,
        });
        await redis.connect();
        await redis.ping();
        redisAvailable = true;
        logger.info('✅ Redis connected');
    } catch (error) {
        logger.warn({ error: error.message }, 'Redis unavailable - running without cache');
        redisAvailable = false;
    }
}

let paymentQueue, retryQueue, reconciliationQueue;
let paymentWorker, retryWorker, reconciliationWorker;

async function initQueues() {
    if (!redisAvailable) {
        logger.warn('Queues disabled - Redis unavailable');
        return;
    }
    
    try {
        const connection = new Redis(config.redisUrl, {
            maxRetriesPerRequest: 3,
            retryStrategy: (times) => times > 3 ? null : Math.min(times * 100, 3000),
        });
        
        paymentQueue = new Queue('payment-processing', { connection });
        retryQueue = new Queue('payment-retry', { connection });
        reconciliationQueue = new Queue('reconciliation', { connection });
        
        // Payment Worker
        paymentWorker = new Worker('payment-processing', async (job) => {
            const { paymentId, action, data } = job.data;
            logger.info({ paymentId, action }, 'Processing job');
            
            try {
                if (action === 'process_callback') await processCallback(data);
                else if (action === 'reconcile') await reconcilePayment(paymentId);
                else if (action === 'timeout') await handlePaymentTimeout(paymentId);
                else if (action === 'query_status') await queryAndUpdateStatus(paymentId);
                return { success: true };
            } catch (error) {
                logger.error({ error: error.message, paymentId }, 'Job failed');
                if (job.attemptsMade < 3) {
                    await retryQueue.add(`retry-${paymentId}`, {
                        paymentId,
                        attempt: job.attemptsMade + 1,
                        error: error.message
                    }, { delay: 60000 * Math.pow(2, job.attemptsMade) });
                } else {
                    await supabaseAdmin.from('payment_dead_letter_queue').insert({
                        payment_id: paymentId,
                        error_message: error.message,
                        payload: job.data,
                        attempt_count: job.attemptsMade + 1,
                    });
                    await createAlert('payment_processing_failed', 'error',
                        `Payment ${paymentId} failed: ${error.message}`, paymentId);
                }
                throw error;
            }
        }, { connection, concurrency: 5 });
        
        paymentWorker.on('completed', (job) => logger.info({ jobId: job.id }, 'Job completed'));
        paymentWorker.on('failed', (job, err) => logger.error({ jobId: job.id, error: err.message }, 'Job failed'));
        
        // Retry Worker
        retryWorker = new Worker('payment-retry', async (job) => {
            await retryPayment(job.data.paymentId);
        }, { connection, concurrency: 3 });
        
        // Reconciliation Worker
        reconciliationWorker = new Worker('reconciliation', async (job) => {
            await runReconciliation(job.data.date || new Date().toISOString().split('T')[0]);
        }, { connection, concurrency: 1 });
        
        logger.info('✅ Queues initialized');
    } catch (error) {
        logger.error({ error: error.message }, 'Queue initialization failed');
    }
}

// =====================================================
// MPESA TOKEN CACHE
// =====================================================

const tokenCache = new NodeCache({ stdTTL: 3500 });

async function getMpesaAccessToken() {
    const cached = tokenCache.get('mpesa_token');
    if (cached) return cached;
    
    if (redisAvailable) {
        const redisToken = await redis.get('mpesa:access_token');
        if (redisToken) {
            tokenCache.set('mpesa_token', redisToken);
            return redisToken;
        }
    }
    
    const api = getMpesaApi();
    const auth = Buffer.from(`${config.mpesaConsumerKey}:${config.mpesaConsumerSecret}`).toString('base64');
    
    const response = await axios.post(
        api.auth,
        null,
        {
            params: { grant_type: 'client_credentials' },
            headers: { Authorization: `Basic ${auth}` },
            timeout: 30000,
        }
    );
    
    if (!response.data.access_token) {
        throw new Error('No access token received');
    }
    
    const token = response.data.access_token;
    tokenCache.set('mpesa_token', token);
    
    if (redisAvailable) {
        await redis.setex('mpesa:access_token', 3500, token);
    }
    
    return token;
}

// =====================================================
// DATABASE TRANSACTIONS
// =====================================================

async function updatePaymentWithEnrollment(paymentId, status, data = {}) {
    const result = await supabaseAdmin.rpc('update_payment_with_enrollment', {
        p_payment_id: paymentId,
        p_status: status,
        p_transaction_id: data.transactionId || null,
        p_mpesa_receipt: data.mpesaReceipt || null,
        p_completed_at: status === 'completed' ? new Date().toISOString() : null,
        p_failed_at: status === 'failed' ? new Date().toISOString() : null,
        p_refunded_at: status === 'refunded' ? new Date().toISOString() : null,
        p_failure_reason: data.failureReason || null,
        p_failure_code: data.failureCode || null,
    });
    
    if (result.error) {
        logger.error({ error: result.error, paymentId }, 'Atomic update failed');
        throw new Error('Payment update failed');
    }
    
    return result.data;
}

async function logAudit(paymentId, action, details = {}, userId = null) {
    try {
        await supabaseAdmin.from('payment_audit_logs').insert({
            payment_id: paymentId,
            action,
            details,
            user_id: userId,
        });
    } catch (error) {
        logger.error({ error: error.message }, 'Audit logging failed');
    }
}

async function createAlert(type, severity, message, paymentId = null) {
    try {
        await supabaseAdmin.from('payment_alerts').insert({
            alert_type: type,
            severity,
            message,
            payment_id: paymentId,
        });
    } catch (error) {
        logger.error({ error: error.message }, 'Alert creation failed');
    }
}

// =====================================================
// PAYMENT PROCESSING FUNCTIONS
// =====================================================

async function processCallback(data) {
    const { payment, stkCallback } = data;
    
    if (payment.webhook_received) {
        logger.info({ paymentId: payment.id }, 'Callback already processed');
        return { success: true, alreadyProcessed: true };
    }
    
    // Optimistic lock
    const { error: lockError } = await supabaseAdmin
        .from('payments')
        .update({
            webhook_received: true,
            webhook_processed_at: new Date().toISOString(),
        })
        .eq('id', payment.id)
        .eq('webhook_received', false);
    
    if (lockError) {
        logger.warn({ paymentId: payment.id }, 'Failed to acquire lock');
        return { success: false, error: 'Concurrent callback' };
    }
    
    if (stkCallback.ResultCode === 0) {
        const items = stkCallback.CallbackMetadata?.Item || [];
        const receiptNumber = items.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
        
        await updatePaymentWithEnrollment(payment.id, 'completed', {
            transactionId: receiptNumber,
            mpesaReceipt: receiptNumber,
        });
        
        await logAudit(payment.id, 'completed', {
            receiptNumber,
            checkoutRequestId: payment.checkout_request_id,
        });
        
        logger.info({ paymentId: payment.id, receiptNumber }, 'Payment completed');
    } else {
        await updatePaymentWithEnrollment(payment.id, 'failed', {
            failureReason: stkCallback.ResultDesc,
            failureCode: stkCallback.ResultCode.toString(),
        });
        
        await logAudit(payment.id, 'failed', {
            reason: stkCallback.ResultDesc,
            code: stkCallback.ResultCode,
        });
        
        if (stkCallback.ResultCode === 1032) {
            await supabaseAdmin.from('payment_retry_queue').insert({
                payment_id: payment.id,
                attempt_number: 1,
                scheduled_at: new Date(Date.now() + 300000).toISOString(),
            });
        }
        
        await createAlert('payment_failed', 'warning',
            `Payment ${payment.id} failed: ${stkCallback.ResultDesc}`, payment.id);
    }
    
    return { success: true };
}

async function retryPayment(paymentId) {
    const { data: payment, error } = await supabaseAdmin
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .single();
    
    if (error || !payment) throw new Error('Payment not found');
    if (payment.retry_count >= 3) {
        await supabaseAdmin.from('payments').update({
            status: 'failed',
            failure_reason: 'Max retries exceeded',
        }).eq('id', paymentId);
        return { success: false, reason: 'Max retries' };
    }
    
    const decryptedPhone = decryptText(payment.phone_number_encrypted);
    if (!decryptedPhone) throw new Error('Failed to decrypt phone');
    
    const accessToken = await getMpesaAccessToken();
    const timestamp = getTimestamp();
    const password = Buffer.from(`${config.mpesaShortcode}${config.mpesaPasskey}${timestamp}`).toString('base64');
    const api = getMpesaApi();
    
    const response = await axios.post(
        api.stkPush,
        {
            BusinessShortCode: config.mpesaShortcode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: payment.amount,
            PartyA: decryptedPhone,
            PartyB: config.mpesaShortcode,
            PhoneNumber: decryptedPhone,
            CallBackURL: `${config.backendUrl}/api/v1/payments/mpesa/callback`,
            AccountReference: `MEI${payment.course_id}${Date.now().toString().slice(-6)}`,
            TransactionDesc: 'MEI DRIVE - Retry',
        },
        {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 35000,
        }
    );
    
    if (response.data.ResponseCode !== '0') {
        throw new Error(response.data.ResponseDescription);
    }
    
    await supabaseAdmin.from('payments').update({
        checkout_request_id: response.data.CheckoutRequestID,
        retry_count: payment.retry_count + 1,
    }).eq('id', paymentId);
    
    return { success: true };
}

async function queryStkStatus(checkoutRequestId) {
    const accessToken = await getMpesaAccessToken();
    const timestamp = getTimestamp();
    const password = Buffer.from(`${config.mpesaShortcode}${config.mpesaPasskey}${timestamp}`).toString('base64');
    const api = getMpesaApi();
    
    const response = await axios.post(
        api.stkQuery,
        {
            BusinessShortCode: config.mpesaShortcode,
            Password: password,
            Timestamp: timestamp,
            CheckoutRequestID: checkoutRequestId,
        },
        {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 30000,
        }
    );
    
    return {
        resultCode: response.data.ResultCode,
        resultDesc: response.data.ResultDesc,
        data: response.data,
    };
}

async function queryAndUpdateStatus(paymentId) {
    const { data: payment, error } = await supabaseAdmin
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .single();
    
    if (error || !payment) throw new Error('Payment not found');
    if (payment.status !== 'pending') return { success: true, status: payment.status };
    
    const stkStatus = await queryStkStatus(payment.checkout_request_id);
    
    if (stkStatus.resultCode === '0') {
        const items = stkStatus.data?.CallbackMetadata?.Item || [];
        const receiptNumber = items.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
        
        await updatePaymentWithEnrollment(payment.id, 'completed', {
            transactionId: receiptNumber,
            mpesaReceipt: receiptNumber,
        });
        
        await logAudit(payment.id, 'completed_by_query', {
            receiptNumber,
            checkoutRequestId: payment.checkout_request_id,
        });
    } else if (stkStatus.resultCode === '1032' || stkStatus.resultCode === '2001') {
        await updatePaymentWithEnrollment(payment.id, 'failed', {
            failureReason: stkStatus.resultDesc,
            failureCode: stkStatus.resultCode,
        });
    }
    
    return { success: true };
}

async function handlePaymentTimeout(paymentId) {
    const { data: payment, error } = await supabaseAdmin
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .single();
    
    if (error || !payment) throw new Error('Payment not found');
    
    if (payment.status === 'pending') {
        await updatePaymentWithEnrollment(payment.id, 'failed', {
            failureReason: 'Payment timeout',
            failureCode: 'TIMEOUT',
        });
        
        await createAlert('payment_timeout', 'warning',
            `Payment ${paymentId} timed out`, paymentId);
    }
}

async function reconcilePayment(paymentId) {
    const { data: payment, error } = await supabaseAdmin
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .single();
    
    if (error || !payment) throw new Error('Payment not found');
    
    const stkStatus = await queryStkStatus(payment.checkout_request_id);
    
    if (stkStatus.resultCode === '0') {
        await supabaseAdmin.from('payments').update({
            reconciled_at: new Date().toISOString(),
        }).eq('id', paymentId);
        
        await supabaseAdmin.from('payment_reconciliation').insert({
            payment_id: paymentId,
            status: 'matched',
            reconciliation_date: new Date().toISOString(),
            mpesa_settlement_id: stkStatus.data?.ReceiptNumber || null,
        });
    } else {
        await supabaseAdmin.from('payment_reconciliation').insert({
            payment_id: paymentId,
            status: 'unmatched',
            reconciliation_date: new Date().toISOString(),
            notes: stkStatus.resultDesc,
        });
    }
}

async function runReconciliation(date) {
    const { data: existing } = await supabaseAdmin
        .from('payment_reconciliation_records')
        .select('id')
        .eq('reconciliation_date', date)
        .single();
    
    if (existing) {
        logger.info({ date }, 'Reconciliation already run');
        return;
    }
    
    const { data: payments } = await supabaseAdmin
        .from('payments')
        .select('*')
        .eq('status', 'completed')
        .gte('created_at', `${date}T00:00:00Z`)
        .lt('created_at', `${date}T23:59:59Z`);
    
    let matchedCount = 0, unmatchedCount = 0, totalAmount = 0;
    
    for (const payment of payments || []) {
        try {
            const stkStatus = await queryStkStatus(payment.checkout_request_id);
            if (stkStatus.resultCode === '0') {
                await supabaseAdmin.from('payment_reconciliation').insert({
                    payment_id: payment.id,
                    status: 'matched',
                    reconciliation_date: new Date().toISOString(),
                });
                matchedCount++;
                totalAmount += payment.amount;
            } else {
                await supabaseAdmin.from('payment_reconciliation').insert({
                    payment_id: payment.id,
                    status: 'unmatched',
                    reconciliation_date: new Date().toISOString(),
                    notes: stkStatus.resultDesc,
                });
                unmatchedCount++;
            }
        } catch (error) {
            unmatchedCount++;
        }
    }
    
    await supabaseAdmin.from('payment_reconciliation_records').insert({
        reconciliation_date: date,
        total_amount: totalAmount,
        matched_count: matchedCount,
        unmatched_count: unmatchedCount,
        status: 'completed',
    });
}

// =====================================================
// AUTH MIDDLEWARE
// =====================================================

const authenticateJWT = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'No token provided' });
        }
        
        const token = authHeader.split(' ')[1];
        const { data: { user }, error } = await supabase.auth.getUser(token);
        
        if (error || !user) {
            return res.status(401).json({ success: false, error: 'Invalid token' });
        }
        
        req.user = user;
        req.userId = user.id;
        next();
    } catch (error) {
        logger.error({ error: error.message }, 'Auth failed');
        return res.status(401).json({ success: false, error: 'Invalid token' });
    }
};

const requireAdmin = async (req, res, next) => {
    try {
        const { data: profile, error } = await supabase
            .from('user_profiles')
            .select('is_admin')
            .eq('id', req.userId)
            .single();
        
        if (error || !profile || !profile.is_admin) {
            return res.status(403).json({ success: false, error: 'Admin access required' });
        }
        
        next();
    } catch (error) {
        logger.error({ error: error.message }, 'Admin check failed');
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// =====================================================
// FRAUD ENGINE
// =====================================================

class FraudEngine {
    constructor() {
        this.rules = [];
        this.lastRefresh = 0;
        this.cache = new NodeCache({ stdTTL: 60 });
    }
    
    async loadRules() {
        if (this.rules.length > 0 && (Date.now() - this.lastRefresh) < 300000) return;
        
        const { data, error } = await supabaseAdmin
            .from('fraud_detection_rules')
            .select('*')
            .eq('is_active', true)
            .order('priority', { ascending: true });
        
        if (!error && data) {
            this.rules = data;
            this.lastRefresh = Date.now();
        }
    }
    
    async check(paymentData) {
        await this.loadRules();
        
        const cacheKey = `${paymentData.userId}:${paymentData.amount}`;
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;
        
        let totalScore = 0;
        const results = [];
        
        for (const rule of this.rules) {
            const result = await this.evaluateRule(rule, paymentData);
            if (result.flagged) {
                results.push(result);
                totalScore += result.score || 0;
            }
        }
        
        const result = {
            flagged: results.length > 0,
            results,
            score: totalScore,
            action: totalScore > 50 ? 'block' : totalScore > 25 ? 'review' : 'allow'
        };
        
        this.cache.set(cacheKey, result);
        return result;
    }
    
    async evaluateRule(rule, data) {
        let flagged = false, score = 0, reason = '';
        
        try {
            switch (rule.rule_type) {
                case 'amount_threshold': {
                    const maxAmount = rule.parameters?.max_amount || 50000;
                    if (data.amount > maxAmount) {
                        flagged = true;
                        score = 30;
                        reason = `Amount (${data.amount}) exceeds threshold`;
                    }
                    break;
                }
                case 'frequency_limit': {
                    const maxCount = rule.parameters?.max_count || 5;
                    const timeWindow = rule.parameters?.time_window || 3600;
                    
                    const { data: recent } = await supabaseAdmin
                        .from('payments')
                        .select('id')
                        .eq('user_id', data.userId)
                        .eq('status', 'pending')
                        .gte('created_at', new Date(Date.now() - timeWindow * 1000).toISOString());
                    
                    if (recent && recent.length >= maxCount) {
                        flagged = true;
                        score = 50;
                        reason = `${recent.length} payments in ${timeWindow}s`;
                    }
                    break;
                }
                case 'phone_pattern': {
                    const blocked = rule.parameters?.blocked_prefixes || [];
                    if (data.phoneNumber && blocked.some(p => data.phoneNumber.startsWith(p))) {
                        flagged = true;
                        score = 80;
                        reason = 'Phone number blocked';
                    }
                    break;
                }
                case 'time_restriction': {
                    const blockedHours = rule.parameters?.blocked_hours || [];
                    const hour = new Date().getHours();
                    if (blockedHours.includes(`${hour}:00`)) {
                        flagged = true;
                        score = 60;
                        reason = 'Restricted hours';
                    }
                    break;
                }
            }
        } catch (error) {
            logger.error({ error: error.message, rule: rule.rule_name }, 'Rule evaluation failed');
        }
        
        return { rule_name: rule.rule_name, flagged, score, reason, action: rule.parameters?.action || 'review' };
    }
}

// =====================================================
// EXPRESS APP
// =====================================================

const app = express();
const PORT = config.port;

// Security Headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
    },
    noSniff: true,
}));

// CORS
app.use(cors({
    origin: config.environment === 'production'
        ? ['https://meidriveafrica.com', 'https://www.meidriveafrica.com']
        : ['http://localhost:3000', 'http://localhost:5173'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID'],
    credentials: true,
}));

// Logging
app.use(pinoHttp({ logger, customProps: (req) => ({ correlationId: req.correlationId || uuidv4() }) }));

// Body Parser
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Correlation ID
app.use((req, res, next) => {
    req.correlationId = req.headers['x-correlation-id'] || uuidv4();
    res.setHeader('X-Correlation-ID', req.correlationId);
    next();
});

// Rate Limiting
const paymentLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, error: 'Too many requests' },
    keyGenerator: (req) => req.userId || req.ip,
});

const callbackLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 50,
    keyGenerator: (req) => req.ip,
});

// =====================================================
// ROUTES
// =====================================================

// Health Check
app.get('/health', async (req, res) => {
    let supabaseOk = false, redisOk = false, mpesaOk = false;
    
    try {
        const { error } = await supabase.from('payments').select('id').limit(1);
        supabaseOk = !error;
    } catch (e) { supabaseOk = false; }
    
    redisOk = redisAvailable;
    
    try {
        await getMpesaAccessToken();
        mpesaOk = true;
    } catch (e) { mpesaOk = false; }
    
    const healthy = supabaseOk && redisOk && mpesaOk;
    
    res.status(healthy ? 200 : 503).json({
        status: healthy ? 'healthy' : 'unhealthy',
        checks: { supabase: supabaseOk, redis: redisOk, mpesa: mpesaOk },
        environment: config.environment,
        version: '5.0.0',
    });
});

// Initiate Payment
app.post('/api/v1/payments/mpesa/initiate', authenticateJWT, paymentLimiter, async (req, res, next) => {
    try {
        const { phoneNumber, amount, courseId, email, courseName, idempotencyKey } = req.body;
        
        // Validate
        if (!phoneNumber || !amount || !courseId) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        
        if (amount < 1 || amount > 150000) {
            return res.status(400).json({ success: false, error: 'Invalid amount' });
        }
        
        // Idempotency
        if (idempotencyKey && redisAvailable) {
            const lock = await redis.set(`idempotent:${idempotencyKey}`, 'processing', 'NX', 'EX', 10);
            if (!lock) {
                const { data: existing } = await supabase
                    .from('payments')
                    .select('id, status')
                    .eq('idempotency_key', idempotencyKey)
                    .single();
                if (existing) {
                    return res.json({ success: true, paymentId: existing.id, status: existing.status });
                }
            }
        }
        
        // Verify user
        const { data: user, error: userError } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('id', req.userId)
            .single();
        if (userError || !user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        // Verify course
        const { data: course, error: courseError } = await supabase
            .from('courses')
            .select('*')
            .eq('id', courseId)
            .single();
        if (courseError || !course) {
            return res.status(404).json({ success: false, error: 'Course not found' });
        }
        
        // Format phone
        const formattedPhone = formatPhoneNumber(phoneNumber);
        
        // Fraud check
        const fraudEngine = new FraudEngine();
        const fraudCheck = await fraudEngine.check({
            userId: req.userId,
            amount,
            phoneNumber: formattedPhone,
        });
        
        if (fraudCheck.flagged && fraudCheck.score > 50) {
            await logAudit(null, 'fraud_detected', { userId: req.userId, amount, score: fraudCheck.score }, req.userId);
            return res.status(400).json({ success: false, error: 'Payment declined due to fraud detection' });
        }
        
        // M-Pesa STK Push
        const accessToken = await getMpesaAccessToken();
        const api = getMpesaApi();
        const timestamp = getTimestamp();
        const password = Buffer.from(`${config.mpesaShortcode}${config.mpesaPasskey}${timestamp}`).toString('base64');
        
        const stkRequest = {
            BusinessShortCode: config.mpesaShortcode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: amount,
            PartyA: formattedPhone,
            PartyB: config.mpesaShortcode,
            PhoneNumber: formattedPhone,
            CallBackURL: `${config.backendUrl}/api/v1/payments/mpesa/callback`,
            AccountReference: `MEI${courseId}${Date.now().toString().slice(-6)}`.slice(0, 12),
            TransactionDesc: `MEI DRIVE - ${(courseName || course.name).slice(0, 20)}`,
        };
        
        const response = await axios.post(api.stkPush, stkRequest, {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout
