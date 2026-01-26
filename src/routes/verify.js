// src/routes/verify.js
// Domain verification endpoints for Croutons-as-a-Service

import crypto from 'crypto';
import dns from 'dns/promises';
import { pool } from '../db.js';

// Generate verification token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// POST /v1/verify/initiate
export async function initiateVerification(req, res) {
  try {
    const { domain } = req.body;
    
    if (!domain) {
      return res.status(400).json({ error: 'Domain is required' });
    }

    // Check if already verified
    const existing = await pool.query(
      'SELECT verified_at FROM verified_domains WHERE domain = $1',
      [domain]
    );
    
    if (existing.rows.length > 0 && existing.rows[0].verified_at) {
      return res.status(409).json({ 
        error: 'Domain already verified',
        domain,
        verified_at: existing.rows[0].verified_at
      });
    }

    const token = generateToken();
    
    // Upsert verification record
    await pool.query(`
      INSERT INTO verified_domains (domain, verification_token)
      VALUES ($1, $2)
      ON CONFLICT (domain) 
      DO UPDATE SET 
        verification_token = EXCLUDED.verification_token,
        updated_at = NOW()
    `, [domain, token]);

    const txtRecord = `croutons-verification=${token}`;

    res.json({
      domain,
      verification_token: token,
      txt_record: txtRecord,
      instructions: {
        step1: `Add this DNS TXT record to your domain:`,
        record: txtRecord,
        step2: `Wait 2-5 minutes for DNS propagation`,
        step3: `Call POST /v1/verify/check to confirm`
      }
    });

  } catch (error) {
    console.error('Verification initiation error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    });
  }
}

// POST /v1/verify/check
export async function checkVerification(req, res) {
  try {
    const { domain } = req.body;
    
    if (!domain) {
      return res.status(400).json({ error: 'Domain is required' });
    }

    // Get verification token from database
    const record = await pool.query(
      'SELECT verification_token, verified_at FROM verified_domains WHERE domain = $1',
      [domain]
    );
    
    if (record.rows.length === 0) {
      return res.status(404).json({ error: 'Verification not initiated' });
    }

    const { verification_token, verified_at } = record.rows[0];
    
    // Already verified
    if (verified_at) {
      return res.json({
        domain,
        status: 'already_verified',
        verified_at
      });
    }

    // Check DNS TXT record first (primary method)
    let verified = false;
    let method = null;
    
    try {
      const txtRecords = await dns.resolveTxt(domain);
      const expectedRecord = `croutons-verification=${verification_token}`;
      
      // DNS.resolveTxt returns array of arrays, flatten it
      const flatRecords = txtRecords.flat();
      const found = flatRecords.some(record => record === expectedRecord);
      
      if (found) {
        verified = true;
        method = 'dns';
      }
    } catch (dnsError) {
      // DNS failed, try HTTP well-known fallback
      console.log(`[verify] DNS check failed for ${domain}, trying HTTP fallback`);
    }

    // HTTP well-known fallback (if DNS didn't work)
    if (!verified) {
      try {
        const wellKnownUrl = `https://${domain}/.well-known/croutons-verification.txt`;
        const response = await fetch(wellKnownUrl, {
          headers: { 'User-Agent': 'Croutons-Verifier/1.0' },
          signal: AbortSignal.timeout(5000)
        });

        if (response.ok) {
          const content = await response.text();
          if (content.trim() === verification_token) {
            verified = true;
            method = 'http';
          }
        }
      } catch (httpError) {
        // HTTP fallback also failed
      }
    }

    if (!verified) {
      return res.status(400).json({
        domain,
        status: 'failed',
        error: 'Verification failed',
        details: 'Neither DNS TXT record nor HTTP well-known file matched',
        instructions: {
          dns: `Add DNS TXT record: croutons-verification=${verification_token}`,
          http: `Or create file at https://${domain}/.well-known/croutons-verification.txt with content: ${verification_token}`
        }
      });
    }

    // Mark as verified
    await pool.query(
      'UPDATE verified_domains SET verified_at = NOW(), updated_at = NOW() WHERE domain = $1',
      [domain]
    );

    res.json({
      domain,
      status: 'verified',
      method,
      verified_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Verification check error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    });
  }
}
