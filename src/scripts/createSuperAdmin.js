require('dotenv').config();
const mongoose = require('mongoose');
const { User, ROLES } = require('../models/User');

const createSuperAdmin = async () => {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const email = process.env.SUPER_ADMIN_EMAIL || 'admin@example.com';
    const username = process.env.SUPER_ADMIN_USERNAME || 'superadmin';
    const password = process.env.SUPER_ADMIN_PASSWORD || 'Admin@123';

    // Check if super admin already exists
    const existingAdmin = await User.findOne({
      $or: [
        { email },
        { username },
        { role: ROLES.SUPER_ADMIN }
      ]
    });

    if (existingAdmin) {
      console.log('⚠️ Super admin already exists');
      console.log(`Email: ${existingAdmin.email}`);
      console.log(`Username: ${existingAdmin.username}`);
      process.exit(0);
    }

    // Create super admin
    const superAdmin = await User.create({
      username,
      email,
      password,
      role: ROLES.SUPER_ADMIN,
      isActive: true,
      isEmailVerified: true
    });

    console.log('✅ Super admin created successfully!');
    console.log(`Email: ${superAdmin.email}`);
    console.log(`Username: ${superAdmin.username}`);
    console.log(`Role: ${superAdmin.role}`);
    console.log('\n⚠️ Please change the default password after first login!');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating super admin:', error.message);
    process.exit(1);
  }
};

createSuperAdmin();

