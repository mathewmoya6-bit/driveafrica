// controllers/mpesaController.js
import mpesaService from '../services/mpesaService.js';

/**
 * Initiate STK Push payment
 * POST /api/mpesa/stkpush
 */
export async function initiatePayment(req, res) {
    const startTime = Date.now();
    
    try {
        const { phoneNumber, amount, courseId, userId, email, courseName } = req.body;
        
        // Validate required fields
        if (!phoneNumber) {
            return res.status(400).json({ success: false, error: 'Phone number is required' });
        }
        
        if (!amount || amount < 1) {
            return res.status(400).json({ success: false, error: 'Valid amount is required' });
        }
        
        if (!courseId) {
            return res.status(400).json({ success: false, error: 'Course ID is required' });
        }
        
        console.log('========================================');
        console.log('💰 STK PUSH INITIATION REQUEST');
        console.log('========================================');
        console.log('Phone:', phoneNumber);
        console.log('Amount:', amount);
        console.log('Course ID:', courseId);
        console.log('User ID:', userId);
        console.log('Email:', email);
        console.log('========================================');
        
        const result = await mpesaService.initiateStkPush({
            phoneNumber,
            amount,
            accountReference: `MEI${courseId}`,
            transactionDesc: `MEI DRIVE - ${courseName || `Course ${courseId}`}`,
            courseId,
            userId,
            email
        });
        
        console.log(`✅ Payment initiated in ${Date.now() - startTime}ms`);
        
        res.json({
            success: true,
            checkoutRequestID: result.checkoutRequestID,
            message: 'STK Push sent. Check your phone for M-Pesa prompt.',
            warning: '⚠️ REAL MONEY will be deducted from your M-Pesa account'
        });
        
    } catch (error) {
        console.error('❌ Payment initiation error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            code: 'MPESA_ERROR'
        });
    }
}

/**
 * Check payment status
 * POST /api/mpesa/status
 */
export async function checkPaymentStatus(req, res) {
    try {
        const { checkoutRequestID } = req.body;
        
        if (!checkoutRequestID) {
            return res.status(400).json({ success: false, error: 'CheckoutRequestID is required' });
        }
        
        const result = await mpesaService.queryPaymentStatus(checkoutRequestID);
        
        res.json({
            success: true,
            status: result.status,
            resultCode: result.resultCode,
            resultDesc: result.resultDesc,
            transactionId: result.transactionId
        });
        
    } catch (error) {
        console.error('❌ Status check error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            status: 'error'
        });
    }
}

/**
 * Handle M-Pesa callback (webhook)
 * POST /api/mpesa/callback
 */
export async function handleMpesaCallback(req, res) {
    console.log('📞 M-Pesa callback received at:', new Date().toISOString());
    
    try {
        const result = mpesaService.handleCallback(req.body);
        
        // Here you would typically:
        // 1. Update your database with payment status
        // 2. Trigger enrollment if payment successful
        // 3. Send notification to user
        
        if (result.success) {
            console.log(`✅ Payment processed: ${result.transactionId}`);
            // TODO: Update enrollment in database
        }
        
        res.json({ ResultCode: 0, ResultDesc: 'Success' });
        
    } catch (error) {
        console.error('❌ Callback processing error:', error.message);
        res.json({ ResultCode: 1, ResultDesc: 'Internal error' });
    }
}

/**
 * Get transaction details
 * GET /api/mpesa/transaction/:checkoutRequestID
 */
export async function getTransaction(req, res) {
    try {
        const { checkoutRequestID } = req.params;
        const transaction = mpesaService.getTransaction(checkoutRequestID);
        
        if (!transaction) {
            return res.status(404).json({ success: false, error: 'Transaction not found' });
        }
        
        res.json({ success: true, transaction });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Get pending transactions (admin)
 * GET /api/mpesa/pending
 */
export async function getPendingTransactions(req, res) {
    try {
        const pending = mpesaService.getPendingTransactions();
        res.json({ success: true, count: pending.length, transactions: pending });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Test M-Pesa connection
 * GET /api/mpesa/test
 */
export async function testMpesaConnection(req, res) {
    const result = await mpesaService.testConnection();
    res.json({
        ...result,
        mode: 'PRODUCTION',
        shortcode: '4095377',
        warning: '⚠️ REAL MONEY will be deducted in production'
    });
}
