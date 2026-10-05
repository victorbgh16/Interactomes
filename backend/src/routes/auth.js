import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const router = express.Router();

function signToken(u) {
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET missing');
    }
    return jwt.sign({ id: u.id, email: u.email }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    });
}

// POST /auth/register
router.post('/register', async (req, res) => {
    try {
        const { email, first_name, last_name, password } = req.body || {};
        if (!email || !first_name || !last_name || !password) {
            return res.status(400).json({ error: 'Required fields are missing' });
        }
        console.log('Checking if user exists...');
        const exist = await User.findOne({ where: { email } });
        console.log('User lookup finished with result: ', exist ? 'Found' : 'Not found');

        if (exist) return res.status(409).json({ error: 'Email already in use' });

        const password_hash = await bcrypt.hash(password, 12);
        
        console.log('Creating user in DB...');
        const user = await User.create({
            email, first_name, last_name, password_hash,
            created_at: new Date(), updated_at: new Date()
        });
        console.log('User created successfully.')

        const token = signToken(user);
        res.status(201).json({
            token,
            user: {
                id: user.id, email, first_name, last_name,
                created_at: user.created_at
            }
        });
    } catch (e) {
        console.error('POST /auth/register ERROR:', e);
        return res.status(500).json({ error: 'Server Error' });
    }
});

// POST /auth/login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body || {};


        // 1) Validation stricte du body
        if (typeof email !== 'string' || typeof password !== 'string' ||
            email.trim() === '' || password === '') {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        const user = await User.findOne({ where: { email } });
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

        // 4) Signe le token uniquement si SECRET est là
        if (!process.env.JWT_SECRET) {
            console.error('JWT_SECRET missing');
            return res.status(500).json({ error: 'Incorrect server configuration' });
        }

        const token = signToken(user);
        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                first_name: user.first_name,
                last_name: user.last_name
            }
        });
    } catch {
        console.error('POST /auth/login ERROR:', e);
        return res.status(500).json({ error: 'Server Error' });
    }
});

// GET /auth/me
router.get('/me', async (req, res) => {
    try {
        const hdr = req.headers.authorization || '';
        const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
        if (!token) return res.status(401).json({ error: 'Missing token' });
        const p = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findByPk(p.id, {
            attributes: ['id', 'email', 'first_name', 'last_name', 'created_at']
        });
        if (!user) return res.status(404).json({ error: 'Not found' });
        res.json({ user });
    } catch {
        res.status(401).json({ error: 'Invalid token' });
    }
});

export default router;
