#!/usr/bin/env node

const crypto = require('crypto');

// Generate a 32-byte (256-bit) random key
const key = crypto.randomBytes(32).toString('hex');

console.log('🔑 Generated Encryption Key:');
console.log('------------------');
console.log(key);
console.log('\n⚠️ Save this key securely! You will need it to run the application.');
console.log('Add it to your .env file as:');
console.log(`ENCRYPTION_KEY=${key}`);
