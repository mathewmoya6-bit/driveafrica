import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://jeksrwrzzrczamxijvwl.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impla3Nyd3J6enJjemFteGlqdndsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NzYyMjAsImV4cCI6MjA5NDI1MjIyMH0.1poYpJKNFEVe2NTBkXBTH2bIHGk2yT8aqCU-OlJc4vs';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function pushData() {
    console.log('🚀 Pushing data...\n');

    // First, check if courses exist
    console.log('📚 Checking existing courses...');
    const { data: existingCourses } = await supabase.from('courses').select('id');
    
    if (!existingCourses || existingCourses.length === 0) {
        console.log('No courses found. Inserting courses...');
        
        const courses = [
            { id: 1, title: 'Learner Hub', description: 'Complete driver training', type: 'premium', price: 5000 },
            { id: 2, title: 'PSV Training', description: 'Public service vehicle training', type: 'premium', price: 7500 },
            { id: 3, title: 'EV Course', description: 'Electric vehicle training', type: 'premium', price: 8000 },
            { id: 4, title: 'Boda Boda', description: 'Motorcycle training', type: 'premium', price: 5500 },
            { id: 5, title: 'Safety Library', description: 'Free safety resources', type: 'free', price: 0 },
            { id: 6, title: 'Quiz Bank', description: 'Practice questions', type: 'premium', price: 3000 }
        ];
        
        for (const course of courses) {
            const { error } = await supabase.from('courses').upsert(course, { onConflict: 'id' });
            if (error) console.error(`Error: ${error.message}`);
            else console.log(`✅ Course: ${course.title}`);
        }
    } else {
        console.log(`✅ Found ${existingCourses.length} courses`);
    }

    // Insert units for Learner Hub (course_id = 1)
    console.log('\n📖 Inserting units for Learner Hub...');
    
    const units = [
        { course_id: 1, unit_number: 1, title: 'Introduction to Driving', content: 'Learn the basics of driving and road safety.', duration: '2 hours' },
        { course_id: 1, unit_number: 2, title: 'Fundamental Driving Rules', content: 'Traffic Act, Highway Code, and road regulations.', duration: '3 hours' },
        { course_id: 1, unit_number: 3, title: 'Model Town', content: 'One-way roads, roundabouts, and parking rules.', duration: '4 hours' },
        { course_id: 1, unit_number: 4, title: 'Human Factors', content: 'Fatigue, alcohol, distractions, and safety.', duration: '3 hours' },
        { course_id: 1, unit_number: 5, title: 'Vehicle Controls', content: 'Steering, gears, pedals, and mirrors.', duration: '5 hours' }
    ];
    
    for (const unit of units) {
        const { error } = await supabase
            .from('course_units')
            .upsert(unit, { onConflict: 'course_id, unit_number' });
        
        if (error) console.error(`❌ Unit ${unit.unit_number}: ${error.message}`);
        else console.log(`✅ Unit ${unit.unit_number}: ${unit.title}`);
    }
    
    // Verify
    console.log('\n🔍 Verification:');
    const { data: courses } = await supabase.from('courses').select('id, title');
    const { data: courseUnits } = await supabase.from('course_units').select('unit_number, title').eq('course_id', 1);
    
    console.log(`Courses: ${courses?.length || 0}`);
    console.log(`Units for Learner Hub: ${courseUnits?.length || 0}`);
    
    console.log('\n🎉 Done!');
}

pushData();