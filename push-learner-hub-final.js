import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://jeksrwrzzrczamxijvwl.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impla3Nyd3J6enJjemFteGlqdndsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NzYyMjAsImV4cCI6MjA5NDI1MjIyMH0.1poYpJKNFEVe2NTBkXBTH2bIHGk2yT8aqCU-OlJc4vs';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// First, ensure course exists
const course = {
    id: 1,
    title: '🚗 Learner Hub',
    description: 'Complete NTSA-approved driver training for new drivers. Covers all 21 units from introduction to advanced driving techniques.',
    type: 'premium',
    price: 5000,
    duration: '40 hours',
    level: 'Beginner to Advanced',
    category: 'learner'
};

// Units data
const units = [
    {
        course_id: 1,
        unit_number: 1,
        title: 'Introduction to Driving',
        content: `# UNIT 1: INTRODUCTION TO DRIVING

## Overview
Motor vehicles are an important part of our day-to-day living and provide a means for people and goods to be transported from one location to another.

## Key Learning Objectives
- Understand the importance of driver training
- Learn about vehicle basics
- Understand driver responsibility on the road

## Course Content

### The Goal of Driver Training
The goal of driver training is to ensure that you, as the driver, are equipped with the right knowledge of how to handle your vehicle and how to act appropriately when using the road.

### Why Driver Training Matters
Most traffic accidents are caused by human error, however this can be easily prevented when the driver is adequately prepared for the traffic situation.

### Benefits of Proper Training
This training also ensures that you are prepared with the necessary skills to provide safe and efficient transport services for goods and for passengers.

## Key Takeaways
- Motor vehicles transport people and goods daily
- Driver training provides essential knowledge and skills
- Most accidents are caused by human error
- Proper preparation prevents accidents
- Trained drivers provide safer transport services

## Quiz Questions
1. What is the main goal of driver training?
2. What causes most traffic accidents?
3. How can accidents be prevented?`,
        duration: '2 hours',
        key_points: [
            'Motor vehicles transport people and goods',
            'Driver training provides knowledge and skills',
            'Most accidents caused by human error',
            'Proper preparation prevents accidents'
        ]
    },
    {
        course_id: 1,
        unit_number: 2,
        title: 'Fundamental Driving Rules',
        content: `# UNIT 2: FUNDAMENTAL DRIVING RULES

## Overview
The road is governed by rules and regulations that ensure order is maintained on the roads at all times.

## The Traffic Act
The Traffic Act sets out the laws that govern the use of roads and the expected conduct of road users.

## The Highway Code
The Highway Code is a set of information, advice, guides and mandatory rules for all road users in Kenya.

## Important Regulations

### Use of the Horn
- You may only use your car horn while your vehicle is moving
- Do not use the horn when stationary
- Do not use the horn aggressively
- Do not use your horn in no-hooting zones (hospitals, schools)

### Right-of-Way Rules
Give right-of-way to:
- Police cars
- Emergency vehicles (fire engines, ambulances) with sirens or flashing lights
- The presidential motorcade

## Key Takeaways
- Traffic Act and Highway Code govern road use
- Horn only for warning while moving
- Give way to emergency vehicles
- Pedestrians have right of way`,
        duration: '3 hours',
        key_points: [
            'Traffic Act and Highway Code govern road use',
            'Horn only for warning while moving',
            'Give way to emergency vehicles',
            'Pedestrians have right of way'
        ]
    },
    {
        course_id: 1,
        unit_number: 3,
        title: 'Model Town',
        content: `# UNIT 3: MODEL TOWN

## Model Town Features
1. One way traffic road
2. Two way traffic road
3. Roundabout
4. Parking zones
5. Yellow kerb
6. Pedestrian crossing
7. Stop sign
8. Give way sign

## One Way Traffic Road Rules
- White continuous line = no changing lanes or overtaking
- White broken line = overtaking allowed if safe
- Yellow kerb = no parking, no waiting, no stopping

## Two Way Traffic Road Rules
- Yellow continuous line = keep left, no overtaking
- Yellow broken line = overtaking allowed if clear

## Roundabout Rules
- No stopping
- No changing lanes
- No parking
- No overtaking
- Keep left and move clockwise

## Parking Types
- Angle Parking: Forward in, reverse out (small cars only)
- Flush Parking: Reverse in, forward out (all vehicles)`,
        duration: '4 hours',
        key_points: [
            'One-way roads: white lines, yellow kerb = no stopping',
            'Two-way roads: yellow lines, keep left',
            'Roundabout: keep left, no overtaking',
            'Angle parking: forward in, reverse out',
            'Flush parking: reverse in, forward out'
        ]
    },
    {
        course_id: 1,
        unit_number: 4,
        title: 'Human Factors in Traffic',
        content: `# UNIT 4: HUMAN FACTORS IN TRAFFIC

## Observation Rules
- Keep your eyes moving
- Get a wide view of what is ahead and behind
- Use all mirrors
- Watch for cyclists, motorcyclists, and pedestrians

## Fatigue Prevention
- Get quality sleep before driving
- Take regular breaks on long distances
- Eat balanced meals at regular intervals
- If tired, stop at a safe place

## Distractions to Avoid
- Handheld devices (cell phones)
- Adjusting radio while driving
- Grooming, smoking, eating while driving

## Effects of Alcohol
- Slows brain functions
- Reduces judgment of speed and distance
- Gives false confidence
- Affects balance

## Safety Equipment Required
- Reflector Triangle
- First Aid Kit
- Fire Extinguisher
- Spare tyre
- Tool box`,
        duration: '3 hours',
        key_points: [
            'Keep eyes moving, use all mirrors',
            'Fatigue: get quality sleep before driving',
            'No cell phones while driving',
            'Alcohol slows brain function',
            'Carry complete safety equipment'
        ]
    }
];

// Add more units 5-21 here (same pattern)

async function pushData() {
    console.log('🚀 Pushing Learner Hub data to Supabase...\n');
    
    // 1. Push course
    console.log('📚 Pushing course...');
    const { error: courseError } = await supabase
        .from('courses')
        .upsert(course, { onConflict: 'id' });
    
    if (courseError) {
        console.error('❌ Course error:', courseError.message);
    } else {
        console.log('✅ Course created/updated');
    }
    
    // 2. Push units
    console.log('\n📖 Pushing units...');
    for (const unit of units) {
        const { error } = await supabase
            .from('course_units')
            .upsert(unit, { onConflict: 'course_id, unit_number' });
        
        if (error) {
            console.error(`❌ Unit ${unit.unit_number}:`, error.message);
        } else {
            console.log(`✅ Unit ${unit.unit_number}: ${unit.title}`);
        }
    }
    
    // 3. Verify
    console.log('\n🔍 Verifying data...');
    const { data: verifyCourse } = await supabase
        .from('courses')
        .select('id, title')
        .eq('id', 1)
        .single();
    
    const { data: verifyUnits } = await supabase
        .from('course_units')
        .select('unit_number, title')
        .eq('course_id', 1)
        .order('unit_number');
    
    console.log('\n📊 Summary:');
    console.log(`   Course: ${verifyCourse?.title || 'Not found'}`);
    console.log(`   Units: ${verifyUnits?.length || 0} units loaded`);
    
    if (verifyUnits) {
        verifyUnits.forEach(u => console.log(`     - Unit ${u.unit_number}: ${u.title}`));
    }
    
    console.log('\n🎉 Done!');
}

pushData();