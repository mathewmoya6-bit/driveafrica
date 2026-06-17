// routes/index.js - Add this to your main routes file
import mpesaRoutes from './mpesaRoutes.js';

// In your main app, add:
app.use('/api/mpesa', mpesaRoutes);

// Or if you prefer /api/payments/mpesa:
// app.use('/api/payments/mpesa', mpesaRoutes);
