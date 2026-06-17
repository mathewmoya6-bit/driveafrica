// config/mpesaConfig.js
import dotenv from 'dotenv';
dotenv.config();

// M-Pesa Production Credentials
const MPESA_CONFIG = {
    // API Endpoints
    API_BASE_URL: 'https://api.safaricom.co.ke',
    SANDBOX_API_BASE_URL: 'https://sandbox.safaricom.co.ke',
    
    // Authentication
    CONSUMER_KEY: process.env.MPESA_CONSUMER_KEY || 'LI2gcJZEheN8qCfXHEXV4gdYXvOBHVnv',
    CONSUMER_SECRET: process.env.MPESA_CONSUMER_SECRET || 'aGGo8AuPJVpsZLcs',
    
    // STK Push (Lipa Na M-Pesa Online)
    PASSKEY: process.env.MPESA_PASSKEY || '7eb17a031bdfd5b4251863a1ddb72c5b9cd14f3385aa6a258c1442a0116e8277',
    SHORTCODE: process.env.MPESA_SHORTCODE || '4095377',
    
    // Callback URLs
    CALLBACK_URL: process.env.MPESA_CALLBACK_URL || 'https://meidriveafrica-backend.onrender.com/api/mpesa/callback',
    RESULT_URL: process.env.MPESA_RESULT_URL || 'https://meidriveafrica-backend.onrender.com/api/mpesa/result',
    TIMEOUT_URL: process.env.MPESA_TIMEOUT_URL || 'https://meidriveafrica-backend.onrender.com/api/mpesa/timeout',
    
    // Other
    ENVIRONMENT: process.env.NODE_ENV || 'production',
    IS_PRODUCTION: true  // Set to true for live transactions
};

// Transaction types
const TRANSACTION_TYPES = {
    CUSTOMER_PAYBILL_ONLINE: 'CustomerPayBillOnline',
    CUSTOMER_BUYGOODS_ONLINE: 'CustomerBuyGoodsOnline',
    BUSINESS_PAYBILL: 'BusinessPayBill',
    BUSINESS_BUYGOODS: 'BusinessBuyGoods'
};

// Result codes
const RESULT_CODES = {
    SUCCESS: '0',
    PENDING: '1',
    FAILED: '1037'
};

export { MPESA_CONFIG, TRANSACTION_TYPES, RESULT_CODES };
