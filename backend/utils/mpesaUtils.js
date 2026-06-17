// utils/mpesaUtils.js

/**
 * Get current timestamp in required format (YYYYMMDDHHmmss)
 */
export function getTimestamp() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

/**
 * Format phone number for M-Pesa (254XXXXXXXXX)
 * Accepts: 0712345678, 712345678, +254712345678, 254712345678
 */
export function formatPhoneNumber(phoneNumber) {
    if (!phoneNumber) {
        throw new Error('Phone number is required');
    }
    
    let cleaned = phoneNumber.toString().replace(/\D/g, '');
    
    if (cleaned.startsWith('0')) {
        cleaned = '254' + cleaned.substring(1);
    } else if (cleaned.startsWith('+254')) {
        cleaned = cleaned.substring(1);
    } else if (cleaned.length === 9) {
        cleaned = '254' + cleaned;
    } else if (!cleaned.startsWith('254')) {
        cleaned = '254' + cleaned;
    }
    
    if (!cleaned.startsWith('254') || cleaned.length !== 12) {
        throw new Error('Invalid phone number. Please use format: 0712345678');
    }
    
    return cleaned;
}

/**
 * Generate password for STK Push
 */
export function generatePassword(shortcode, passkey, timestamp) {
    const str = `${shortcode}${passkey}${timestamp}`;
    return Buffer.from(str).toString('base64');
}

/**
 * Validate amount for M-Pesa transaction
 */
export function validateAmount(amount) {
    const num = Number(amount);
    if (isNaN(num) || num < 1) {
        throw new Error('Invalid amount. Minimum amount is 1 KES');
    }
    if (num > 150000) {
        throw new Error('Amount exceeds maximum limit of 150,000 KES');
    }
    return Math.round(num);
}

/**
 * Validate checkout request ID
 */
export function validateCheckoutRequestId(checkoutRequestID) {
    if (!checkoutRequestID || typeof checkoutRequestID !== 'string') {
        throw new Error('Valid CheckoutRequestID is required');
    }
    return checkoutRequestID;
}

/**
 * Format transaction response for client
 */
export function formatTransactionResponse(data) {
    return {
        success: true,
        checkoutRequestID: data.CheckoutRequestID,
        merchantRequestID: data.MerchantRequestID,
        responseCode: data.ResponseCode,
        responseDescription: data.ResponseDescription,
        customerMessage: data.CustomerMessage
    };
}

/**
 * Parse callback metadata
 */
export function parseCallbackMetadata(metadata) {
    if (!metadata || !metadata.Item) {
        return {};
    }
    
    const result = {};
    metadata.Item.forEach(item => {
        result[item.Name] = item.Value;
    });
    
    return result;
}

/**
 * Determine transaction status from result code
 */
export function getTransactionStatus(resultCode) {
    switch (resultCode) {
        case '0':
            return 'completed';
        case '1':
            return 'pending';
        case '1037':
            return 'failed';
        default:
            return 'unknown';
    }
}

/**
 * Generate random transaction reference
 */
export function generateTransactionReference(prefix = 'MEI') {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    return `${prefix}${timestamp}${random}`;
}

/**
 * Mask phone number for logging (show last 4 digits only)
 */
export function maskPhoneNumber(phone) {
    if (!phone) return 'unknown';
    const str = phone.toString();
    if (str.length <= 4) return '****';
    return `****${str.slice(-4)}`;
}

/**
 * Mask amount for logging
 */
export function maskAmount(amount) {
    return `KES ${amount}`;
}
