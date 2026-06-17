// routes/mpesaRoutes.js
import express from 'express';
import {
    initiatePayment,
    checkPaymentStatus,
    handleMpesaCallback,
    getTransaction,
    getPendingTransactions,
    testMpesaConnection
} from '../controllers/mpesaController.js';

const router = express.Router();

// Public endpoints
router.post('/stkpush', initiatePayment);
router.post('/status', checkPaymentStatus);
router.post('/callback', handleMpesaCallback);
router.get('/test', testMpesaConnection);

// Protected endpoints (admin only - add auth middleware)
router.get('/transaction/:checkoutRequestID', getTransaction);
router.get('/pending', getPendingTransactions);

export default router;
