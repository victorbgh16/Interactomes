// backend/src/scripts/seedOrganelles.js
import 'dotenv/config';
import { sequelize, Organelle } from '../models/index.js';

const ORGANELLES = [
    'Whole cell',
    'Mitochondrion',
    'Golgi apparatus',
    'Endoplasmic reticulum',
    'Nucleus',
    'Lysosome',
    'Peroxisome',
    'Vesicles',
    'Cytoplasm',
    'Centrioles',
    'Cytoskeleton',
    'Cell wall',
    'Chloroplasts',
    'Vacuole',
    'Cilia and flagella',
    'Nucleolus',
    'Plasma membrane',
    'Plastids',
];

function normalizeName(s) {
    return s.trim().replace(/\s+/g, ' ');
}

async function main() {
    try {
        console.log('🔌 Connecting DB…');
        await sequelize.authenticate();

        // s’assure que la table existe (au cas où le backend n’a pas encore sync)
        await Organelle.sync();

        const rows = ORGANELLES
            .map(normalizeName)
            .filter(Boolean)
            .map(name => ({ name }));

        // insert en ignorant les doublons (name est UNIQUE dans ton modèle)
        const result = await Organelle.bulkCreate(rows, { ignoreDuplicates: true });

        // Sequelize ne renvoie pas toujours le nombre d’inserts effectifs → on recompte
        const count = await Organelle.count();
        console.log(`✅ Seed organelles finished. Total in DB: ${count}`);
    } catch (e) {
        console.error('❌ Seed organelles error:', e?.message || e);
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
}

main();
