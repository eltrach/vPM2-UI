const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const discordService = require('./discord.service');

class AuthService {
  constructor() {
    // Store in a more secure location outside web root
    this.dataDir = path.join(process.cwd(), '..', 'secure_data');
    this.usersFile = path.join(this.dataDir, 'users.enc');

    // Get encryption key from environment or generate a new one
    this.encryptionKey = process.env.ENCRYPTION_KEY;

    if (!this.encryptionKey) {
      console.error('❌ Error: ENCRYPTION_KEY environment variable is not set');
      console.error('Please run: bun run generate-key');
      console.error('And add the generated key to your .env file');
      process.exit(1);
    }

    // Validate key length (must be 64 hex characters for 32 bytes)
    if (this.encryptionKey.length !== 64) {
      console.error('❌ Error: Invalid encryption key length');
      console.error('Key must be 64 hexadecimal characters (32 bytes)');
      console.error('Please run: bun run generate-key');
      console.error('And add the generated key to your .env file');
      process.exit(1);
    }

    this.ensureSecureStorage();
  }

  ensureSecureStorage() {
    // Create secure directory with restricted permissions
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    }

    // Set directory permissions to be more restrictive
    fs.chmodSync(this.dataDir, 0o700);

    // Create initial encrypted file if it doesn't exist
    if (!fs.existsSync(this.usersFile)) {
      this.encryptAndSaveData({ users: [] });
    }

    // Set file permissions to be more restrictive
    fs.chmodSync(this.usersFile, 0o600);
  }

  encryptData(data) {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(
        'aes-256-gcm',
        Buffer.from(this.encryptionKey, 'hex'),
        iv
      );
      let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag();
      return {
        iv: iv.toString('hex'),
        encryptedData: encrypted,
        authTag: authTag.toString('hex'),
      };
    } catch (error) {
      console.error('❌ Error encrypting data:', error.message);
      throw new Error('Failed to encrypt data');
    }
  }

  decryptData(encryptedData) {
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        Buffer.from(this.encryptionKey, 'hex'),
        Buffer.from(encryptedData.iv, 'hex')
      );
      decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
      let decrypted = decipher.update(encryptedData.encryptedData, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return JSON.parse(decrypted);
    } catch (error) {
      console.error('❌ Error decrypting data:', error.message);
      throw new Error('Failed to decrypt data');
    }
  }

  encryptAndSaveData(data) {
    const encrypted = this.encryptData(data);
    fs.writeFileSync(this.usersFile, JSON.stringify(encrypted));
  }

  async getUsers() {
    try {
      const encryptedData = JSON.parse(fs.readFileSync(this.usersFile, 'utf8'));
      const data = this.decryptData(encryptedData);
      return data.users;
    } catch (error) {
      console.error('❌ Error reading users file:', error.message);
      return [];
    }
  }

  async saveUsers(users) {
    const data = { users };
    this.encryptAndSaveData(data);
  }

  async createUser(username, password, role = 'user') {
    const users = await this.getUsers();
    if (users.some((user) => user.username === username)) {
      throw new Error('Username already exists');
    }

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
    await this.saveUsers(users);
    return newUser;
  }

  async validateUser(username, password, ipAddress) {
    const users = await this.getUsers();
    const user = users.find((u) => u.username === username);

    if (!user) {
      await discordService.sendNotification({
        title: '🔒 Failed Login Attempt',
        description: 'Someone attempted to log in with invalid credentials',
        color: discordService.colors.error,
        fields: [
          {
            name: 'Username',
            value: username,
            inline: true,
          },
          {
            name: 'IP Address',
            value: ipAddress,
            inline: true,
          },
          {
            name: 'Status',
            value: 'Invalid Username',
            inline: true,
          },
        ],
      });
      throw new Error('Invalid credentials');
    }

    // Check if account is locked
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      await discordService.sendNotification({
        title: '🔒 Account Locked',
        description: 'Someone attempted to log in to a locked account',
        color: discordService.colors.warning,
        fields: [
          {
            name: 'Username',
            value: username,
            inline: true,
          },
          {
            name: 'IP Address',
            value: ipAddress,
            inline: true,
          },
          {
            name: 'Locked Until',
            value: new Date(user.lockedUntil).toLocaleString(),
            inline: true,
          },
        ],
      });
      throw new Error('Account is locked. Please try again later.');
    }

    const isValid = await bcrypt.compare(password, user.password);

    if (!isValid) {
      // Update failed attempts
      user.failedAttempts = (user.failedAttempts || 0) + 1;

      // Lock account after 5 failed attempts for 15 minutes
      if (user.failedAttempts >= 5) {
        user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await discordService.sendNotification({
          title: '🔒 Account Locked',
          description: 'An account has been locked due to multiple failed login attempts',
          color: discordService.colors.warning,
          fields: [
            {
              name: 'Username',
              value: username,
              inline: true,
            },
            {
              name: 'IP Address',
              value: ipAddress,
              inline: true,
            },
            {
              name: 'Failed Attempts',
              value: user.failedAttempts.toString(),
              inline: true,
            },
            {
              name: 'Locked Until',
              value: new Date(user.lockedUntil).toLocaleString(),
              inline: true,
            },
          ],
        });
      } else {
        await discordService.sendNotification({
          title: '🔒 Failed Login Attempt',
          description: 'Someone attempted to log in with invalid credentials',
          color: discordService.colors.error,
          fields: [
            {
              name: 'Username',
              value: username,
              inline: true,
            },
            {
              name: 'IP Address',
              value: ipAddress,
              inline: true,
            },
            {
              name: 'Failed Attempts',
              value: user.failedAttempts.toString(),
              inline: true,
            },
          ],
        });
      }

      await this.saveUsers(users);
      throw new Error('Invalid credentials');
    }

    // Reset failed attempts on successful login
    user.failedAttempts = 0;
    user.lockedUntil = null;
    user.lastLogin = new Date().toISOString();
    await this.saveUsers(users);

    await discordService.sendNotification({
      title: '🔐 Successful Login',
      description: 'A user has successfully logged in',
      color: discordService.colors.success,
      fields: [
        {
          name: 'Username',
          value: username,
          inline: true,
        },
        {
          name: 'IP Address',
          value: ipAddress,
          inline: true,
        },
        {
          name: 'Role',
          value: user.role,
          inline: true,
        },
      ],
    });

    return {
      id: user.id,
      username: user.username,
      role: user.role,
    };
  }

  async changePassword(username, oldPassword, newPassword) {
    const users = await this.getUsers();
    const user = users.find((u) => u.username === username);

    if (!user) {
      throw new Error('User not found');
    }

    const isValid = await bcrypt.compare(oldPassword, user.password);
    if (!isValid) {
      throw new Error('Current password is incorrect');
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await this.saveUsers(users);
  }

  async deleteUser(username) {
    const users = await this.getUsers();
    const filteredUsers = users.filter((u) => u.username !== username);
    await this.saveUsers(filteredUsers);
  }
}

module.exports = new AuthService();
