import { Router } from 'express';
import { supabaseAdmin } from '../services/supabase.js';

const router = Router();

// Get all active courses
router.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('courses')
    .select('*')
    .eq('is_active', true)
    .order('id');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Get single course
router.get('/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('courses')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(404).json({ error: 'Course not found' });
  res.json(data);
});

export default router;
