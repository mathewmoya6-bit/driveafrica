import { Router } from 'express';
import { authenticateUser } from '../middleware/auth.js';
import { supabaseAdmin } from '../services/supabase.js';

const router = Router();

// Get current user profile
router.get('/me', authenticateUser, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('*')
    .eq('id', req.user.id)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Update profile
router.put('/me', authenticateUser, async (req, res) => {
  const { full_name, phone_number } = req.body;
  const { error } = await supabaseAdmin
    .from('user_profiles')
    .update({ full_name, phone_number })
    .eq('id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

export default router;
