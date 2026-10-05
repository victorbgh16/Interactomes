// src/database/initDB.js
import sequelize from './config.js';
import Organelle from '../models/Organelle.js';
const wait = (ms)=>new Promise(r=>setTimeout(r,ms));

const DEFAULT_ORGANELLES = [
  'Cilia', 'Mitochondrion', 'Chloroplast', 'Nucleus',
  'Peroxisome', 'Golgi apparatus', 'Lysosome', 
  'Endoplasmic reticulum', 'Vacuole', 'Cytosol', 'allCell'
];

export async function seedOrganelles() {
  const records = DEFAULT_ORGANELLES.map(name => ({ name }));
  await Organelle.bulkCreate(records, { ignoreDuplicates: true });
  console.log('🌱 Organelles seeded');
}

(async () => {
    for (let i=1;i<=20;i++){
        try {
            console.log('Connecting to the database...');
            console.log('🌱 ENV:', process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD);
            await sequelize.authenticate();
            console.log('✅ DB connected');
            await sequelize.sync({ alter: true });
            await seedOrganelles();
            console.log('✅ Tables synced');
            return;
        } catch (e) {
            console.error(`❌ Connection error: ${e}`);
            await wait(1500);
        }
    }
    console.error('⚠️ DB unavailable after retries, API will still start, but DB routes will fail.');
})();



