require('dotenv').config();
const mongoose = require('mongoose');

async function fixNullEmails() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Remove null email fields (sparse index ignores documents without the field)
    const result1 = await mongoose.connection.collection('users').updateMany(
      { email: null },
      { $unset: { email: '' } }
    );
    console.log('Updated users with null email:', result1.modifiedCount);

    // Remove null mobileNumber fields
    const result2 = await mongoose.connection.collection('users').updateMany(
      { mobileNumber: null },
      { $unset: { mobileNumber: '' } }
    );
    console.log('Updated users with null mobileNumber:', result2.modifiedCount);

    console.log('Done!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixNullEmails();
