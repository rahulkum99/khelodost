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
    const name = process.env.SUPER_ADMIN_NAME || 'Super Admin';
    const password = process.env.SUPER_ADMIN_PASSWORD || 'Admin@123';
    const mobileNumber = process.env.SUPER_ADMIN_MOBILE || '+1234567890';

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
      console.log(`Name: ${existingAdmin.name}`);
      process.exit(0);
    }

    // Default commission structures
    const defaultRollingCommission = {
      fancy: 0,
      matka: 0,
      casino: 0,
      binary: 0,
      sportbook: 0,
      line: 0,
      bookmaker: 0,
      virtualSports: 0,
      cricket: 0,
      tennis: 0,
      soccer: 0
    };

    // Create super admin
    const superAdmin = await User.create({
      username,
      name,
      email,
      password,
      mobileNumber,
      commission: 0,
      rollingCommission: defaultRollingCommission,
      agentRollingCommission: defaultRollingCommission,
      currency: 'INR',
      exposureLimit: 9999999999,
      role: ROLES.SUPER_ADMIN,
      isActive: true,
      isEmailVerified: true
    });

    console.log('✅ Super admin created successfully!');
    console.log(`Username: ${superAdmin.username}`);
    console.log(`Name: ${superAdmin.name}`);
    console.log(`Email: ${superAdmin.email}`);
    console.log(`Mobile: ${superAdmin.mobileNumber}`);
    console.log(`Role: ${superAdmin.role}`);
    console.log('\n⚠️ Please change the default password after first login!');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating super admin:', error.message);
    process.exit(1);
  }
};

createSuperAdmin();
