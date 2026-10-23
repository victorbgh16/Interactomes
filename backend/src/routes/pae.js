import express from 'express';
import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import sequelize from '../database/config.js';
import { QueryTypes } from 'sequelize';
import Protein from '../models/Protein.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

router.post('/:uniprotId/pae', async (req, res) => {
    const { uniprotId } = req.params;
    const { cifUrl, paeDocUrl, crosslinks } = req.body;

    console.log("DEBUG: HIT PAE ROUTE FOR:", req.params.uniprotId);

    try {
        // 1. Check if the image path is already in the DB
        const protein = await Protein.findOne({ where: { uniprot_id: uniprotId } });

        if (protein && protein.pae_image_path) {
            // Verify the file *actually* exists on disk in the public folder
            const diskPath = path.join(__dirname, '../../public', protein.pae_image_path);
            
            // 2. If the PAE is already generated, return it
            if (fs.existsSync(diskPath)) {
                console.log(`DEBUG: Cache hit! Serving existing PAE image for ${uniprotId}`);
                return res.json({ paeImagePath: protein.pae_image_path });
            }
        }
        console.log(`DEBUG: Cache miss. Generating new PAE image for ${uniprotId}...`);

        // 3. If it doesn't exist (requested for the first time), generate using python
        const pythonExecutable = path.resolve(__dirname, '../python/env/bin/python3');
        const scriptPath = path.resolve(__dirname, '../python/generate_pae.py');
        const outputRelativePath = `/images/pae/${uniprotId}_pae.png`;
        const outputDiskPath = path.join(__dirname, '../../public', outputRelativePath);
        const crosslinksJsonStr = JSON.stringify(crosslinks || []);
        
        // TODO: implement way to change threshold (needs another list item after outputDiskPath)

        await new Promise((resolve, reject) => {
            execFile(pythonExecutable, [
                scriptPath,
                uniprotId,
                cifUrl,
                paeDocUrl,
                crosslinksJsonStr,
                outputDiskPath
            ], (error, stdout, stderr) => {
                if (error) return reject(new Error(stderr || error.message));
                resolve(stdout);
            });
        });

        // 3. SAVE TO DATABASE: Update the record with the new image path
        if (protein) {
            protein.pae_image_path = outputRelativePath;
            await protein.save();
        } else {
            // Optional: create the record if it doesn't exist yet
            await Protein.create({ uniprotId, pae_image_path: outputRelativePath });
        }

        return res.json({ paeImagePath: outputRelativePath });
        
        /*
        execFile(pythonExecutable, [scriptPath, uniprotId, cifUrl, paeDocUrl, crosslinksJsonStr, outputDiskPath], async (error, stdout, stderr) => {
            if (error) {
                console.error('DEBUG: FULL EXECFILE ERROR:', error);
                console.error('Python PAE generation error:', stderr);
                return res.status(500).json({ error: 'Failed to generate PAE plot' });
            }

            // Save the file path in the DB so future requests skip Python entirely
            await sequelize.query(
                'UPDATE proteins SET pae_image_path = ? WHERE uniprot_id = ?',
                { replacements: [relativeDbPath, uniprotId] }
            );

            res.json({ paeImagePath: relativeDbPath, source: 'generated' });
        });
        */

    } catch (err) {
        console.error("DEBUG: PAE ROUTE CRASHED:", err);
        res.status(500).json({ error: err.message });
    }
});

export default router;