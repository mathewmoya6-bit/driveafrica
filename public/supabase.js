// ============================================
// MEI DRIVE AFRICA - SUPABASE SINGLE SOURCE OF TRUTH
// ============================================

const SUPABASE_URL = 'https://qpqkmmkrzxlhcpccefjn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwcWttbWtyenhsaGNwY2NlZmpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MjU0NzIsImV4cCI6MjA5NTEwMTQ3Mn0.Vw1hexN3NKoF_y9VFBFs_NUhJgFNNMwuyzDjImUcM6s';
const BACKEND_URL = 'https://meidriveafrica-backend.onrender.com';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// COURSES API
// ============================================
const CoursesAPI = {
    async getAll() {
        const { data, error } = await supabase.from('courses').select('*').order('id');
        if (error) throw error;
        return data;
    },
    
    async getById(id) {
        const { data, error } = await supabase.from('courses').select('*').eq('id', id).single();
        if (error) throw error;
        return data;
    },
    
    subscribe(callback) {
        return supabase
            .channel('courses-changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'courses' }, callback)
            .subscribe();
    }
};

// ============================================
// ENROLLMENTS API
// ============================================
const EnrollmentsAPI = {
    async getUserEnrollments(userId) {
        const { data, error } = await supabase
            .from('enrollments')
            .select('course_id')
            .eq('user_id', userId)
            .eq('status', 'active');
        if (error) throw error;
        return data || [];
    },
    
    async isEnrolled(userId, courseId) {
        const { data, error } = await supabase
            .from('enrollments')
            .select('id')
            .eq('user_id', userId)
            .eq('course_id', courseId)
            .eq('status', 'active')
            .maybeSingle();
        if (error) throw error;
        return !!data;
    },
    
    async create(userId, courseId, amountPaid = 0, transactionId = null) {
        const alreadyEnrolled = await this.isEnrolled(userId, courseId);
        if (alreadyEnrolled) {
            return { success: true, alreadyEnrolled: true };
        }
        
        const { error } = await supabase.from('enrollments').insert({
            user_id: userId,
            course_id: courseId,
            amount_paid: amountPaid,
            transaction_id: transactionId,
            status: 'active',
            enrolled_at: new Date().toISOString()
        });
        
        if (error && error.code === '23505') {
            return { success: true, alreadyEnrolled: true };
        }
        if (error) throw error;
        
        return { success: true };
    },
    
    subscribe(callback) {
        return supabase
            .channel('enrollments-changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'enrollments' }, callback)
            .subscribe();
    }
};

// ============================================
// AUTH API
// ============================================
const AuthAPI = {
    async signUp(email, password, fullName) {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: { data: { full_name: fullName || email.split('@')[0] } }
        });
        if (error) throw error;
        
        // Create profile
        await supabase.from('user_profiles').upsert({
            id: data.user.id,
            email: email,
            full_name: fullName || email.split('@')[0],
            is_admin: email === 'admin@meidriveafrica.com'
        });
        
        return { success: true, user: data.user };
    },
    
    async signIn(email, password) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return { success: true, user: data.user };
    },
    
    async signOut() {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        return { success: true };
    },
    
    async getCurrentUser() {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return null;
        
        const { data: profile } = await supabase
            .from('user_profiles')
            .select('is_admin, full_name')
            .eq('id', user.id)
            .maybeSingle();
        
        return {
            id: user.id,
            email: user.email,
            full_name: profile?.full_name || user.email?.split('@')[0],
            is_admin: profile?.is_admin || false
        };
    }
};

// ============================================
// PAYMENT API (REAL M-PESA)
// ============================================
const PaymentAPI = {
    async initiate(phoneNumber, amount, courseId, userId, email, courseName) {
        let formattedPhone = phoneNumber.replace(/\D/g, '');
        if (formattedPhone.startsWith('0')) {
            formattedPhone = '254' + formattedPhone.slice(1);
        } else if (formattedPhone.startsWith('+254')) {
            formattedPhone = formattedPhone.substring(1);
        } else if (!formattedPhone.startsWith('254')) {
            formattedPhone = '254' + formattedPhone;
        }
        
        if (!formattedPhone.startsWith('254') || formattedPhone.length !== 12) {
            throw new Error('Invalid phone number. Use format: 0712345678');
        }
        
        const response = await fetch(`${BACKEND_URL}/api/payments/mpesa/initiate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phoneNumber: formattedPhone,
                amount: Math.round(amount),
                courseId,
                userId,
                email,
                accountReference: `C${courseId}`,
                transactionDesc: `MEI DRIVE - ${courseName}`
            })
        });
        
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Payment failed');
        
        return data;
    },
    
    async checkStatus(checkoutRequestID) {
        const response = await fetch(`${BACKEND_URL}/api/payments/mpesa/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checkoutRequestID })
        });
        
        return await response.json();
    }
};

// ============================================
// EXPORT SINGLE SOURCE OF TRUTH
// ============================================
window.MEIDrive = {
    courses: CoursesAPI,
    enrollments: EnrollmentsAPI,
    auth: AuthAPI,
    payment: PaymentAPI,
    supabase
};

console.log('✅ MEI DRIVE AFRICA - Single Source of Truth Loaded');
console.log('💰 M-Pesa: REAL PRODUCTION MODE');
console.log(`📞 Paybill: 4095377`);
