// src/index.js  — MODE SAFE
import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import authRoutes from './routes/auth.js';
import uploadsRoutes from './routes/upload.js';
import organellesRoutes from './routes/organelles.js';
import datasetsRoutes from './routes/datasets.js';
import crosslinksRoutes from './routes/crosslinks.js';
import sequelize from './database/config.js';

const app = express();

// Logs d’erreurs globales
process.on('unhandledRejection', (r) => console.error('UNHANDLED REJECTION', r));
process.on('uncaughtException', (e) => console.error('UNCAUGHT EXCEPTION', e));

// Log chaque requête pour savoir si on arrive au serveur
app.use((req, res, next) => {
    const t0 = Date.now();
    res.on('finish', () => {
        console.log(`[${res.statusCode}] ${req.method} ${req.originalUrl} ${Date.now()-t0}ms`);
    });
    next();
});
const RAW_ORIGIN = process.env.URL || 'http://localhost:5173';
const ORIGIN = RAW_ORIGIN.replace(/\/+$/, ''); // retire slash final

app.use(cors({
    origin(origin, cb) {
        // Autorise curl / health (sans Origin) et locaux
        if (!origin) return cb(null, true);
        const allowed = [ORIGIN, 'http://127.0.0.1:5173', 'http://localhost:5173'];
        return allowed.includes(origin) ? cb(null, true)
            : cb(new Error('Origin not allowed: ' + origin));
    },
    methods: ['GET','POST','PATCH','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization'],
    optionsSuccessStatus: 204,
}));

// IMPORTANT: gérer les pré-requêtes SANS utiliser '*'
app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204); // les headers CORS ont déjà été posés par cors()
    }
    next();
});

// ── Middlewares
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

import './database/initDB.js';
import './models/index.js';

import { QueryTypes } from 'sequelize'; // Import QueryTypes if using ES modules

app.get('/api-test-db', async (req, res) => {
    try {
        // Option A: Official Sequelize connection test
        await sequelize.authenticate();

        // Option B: Raw query with QueryTypes.SELECT
        const results = await sequelize.query('SELECT 1 + 1 AS result', {
            type: QueryTypes.SELECT
        });

        return res.json({ ok: true, message: 'DB Connected successfully!', results });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.use('/auth', authRoutes);
app.use('/organelles', organellesRoutes);
app.use('/uploads', uploadsRoutes);
app.use('/datasets', datasetsRoutes);
app.use('/', crosslinksRoutes);


// Health ultra-simple
app.get('/health', (req, res) => {
    res.status(200).json({ ok: true, ts: new Date().toISOString() });
});

// 404 + error handler simples
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
// Error handler — respecte les codes BodyParser
app.use((err, req, res, next) => {
    // JSON invalide envoyé par le client
    if (err?.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'Invalid JSON body' });
    }
    // Si le middleware précédent a déjà mis un code
    if (typeof err?.status === 'number' || typeof err?.statusCode === 'number') {
        const code = err.statusCode || err.status || 500;
        return res.status(code).json({ error: err.message || 'Error' });
    }
    console.error('[ERR]', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`SAFE server listening on :${PORT}`);
});
