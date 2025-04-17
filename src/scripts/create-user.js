#!/usr/bin/env node

const readline = require('readline');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Use the auth service for secure storage
const authService = require('../services/auth.service');

function generateSecurePassword(length = 12) {
  const charset =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset[values[i] % charset.length];
  }
  return password;
}

async function createUser(username, password, role = 'admin') {
  const users = await authService.getUsers();

  // Check if user already exists
  if (users.some((user) => user.username === username)) {
    console.error('❌ Error: Username already exists');
    process.exit(1);
  }

  // Hash password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const newUser = {
    id: crypto.randomUUID(),
    username,
    password: hashedPassword,
    role,
    createdAt: new Date().toISOString(),
    lastLogin: null,
    failedAttempts: 0,
    lockedUntil: null,
  };

  users.push(newUser);
  await authService.saveUsers(users);
  return newUser;
}

function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function main() {
  console.log('📝 Create New Admin User');
  console.log('------------------');

  const username = await prompt('Username: ');
  if (!username) {
    console.error('❌ Error: Username is required');
    process.exit(1);
  }

  // Generate a secure random password
  const password = generateSecurePassword();

  try {
    const user = await createUser(username, password, 'admin');
    console.log('\n✅ Admin user created successfully!');
    console.log('------------------');
    console.log(`Username: ${user.username}`);
    console.log(`Password: ${password}`);
    console.log(`Role: ${user.role}`);
    console.log(`ID: ${user.id}`);
    console.log(`Created: ${new Date(user.createdAt).toLocaleString()}`);
    console.log('\n⚠️ Please save this password as it will not be shown again!');
  } catch (error) {
    console.error('❌ Error creating user:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
