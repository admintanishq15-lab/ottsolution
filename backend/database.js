const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { User, Product, Setting } = require('./models');

// Load environment variables
require('dotenv').config();

const mongoURI = process.env.MONGO_URI;

if (!mongoURI) {
  console.error('[Database] ERROR: MONGO_URI is not defined in the environment!');
  process.exit(1);
}

console.log('[Database] Connecting to MongoDB...');
mongoose.connect(mongoURI)
  .then(async () => {
    console.log('[Database] Connected successfully to MongoDB.');
    await seedDefaultData();
  })
  .catch(err => {
    console.error('[Database] MongoDB connection error:', err);
  });

async function seedDefaultData() {
  try {
    // 1. Seed Default Admin
    const defaultAdminEmail = process.env.ADMIN_EMAIL || 'admin@ott.com';
    const defaultAdminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const adminExists = await User.findOne({ email: defaultAdminEmail });
    if (!adminExists) {
      const adminHash = bcrypt.hashSync(defaultAdminPassword, 10);
      await new User({
        email: defaultAdminEmail,
        password_hash: adminHash,
        role: 'admin'
      }).save();
      console.log(`[Database] Seeded default admin: ${defaultAdminEmail}`);
    }

    // 2. Seed Default User
    const userExists = await User.findOne({ email: 'user@ott.com' });
    if (!userExists) {
      const userHash = bcrypt.hashSync('user123', 10);
      await new User({
        email: 'user@ott.com',
        password_hash: userHash,
        role: 'user'
      }).save();
      console.log('[Database] Seeded default user: user@ott.com / user123');
    }

    // 3. Seed Default Products
    const productCount = await Product.countDocuments();
    if (productCount === 0) {
      const defaultProducts = [
        {
          name: 'Netflix Premium (1 Month)',
          description: '4K Ultra HD screen subscription. Direct account credentials delivered instantly after payment verification.',
          price: 4.99,
          currency: '$',
          category: 'OTT Subscriptions',
          platform: 'Netflix',
          image_url: 'https://images.unsplash.com/photo-1574375927938-d5a98e8edd86?w=400&q=80'
        },
        {
          name: 'Spotify Premium (3 Months)',
          description: 'Ad-free offline music streaming. Individual account upgrade or invite link delivery.',
          price: 399.00,
          currency: '₹',
          category: 'Music Subscriptions',
          platform: 'Spotify',
          image_url: 'https://images.unsplash.com/photo-1614680376593-902f74fa0d41?w=400&q=80'
        },
        {
          name: 'Steam $20 Wallet Gift Card',
          description: 'US Region Steam wallet top-up code. Redeem directly on your Steam client.',
          price: 18.50,
          currency: '$',
          category: 'Gift Cards',
          platform: 'Steam',
          image_url: 'https://images.unsplash.com/photo-1593305841991-05c297ba4575?w=400&q=80'
        },
        {
          name: 'Canva Pro Yearly Private Account',
          description: 'Exclusive Canva Pro subscription. Access premium design templates and brand kits for 1 full year.',
          price: 1499.00,
          currency: '₹',
          category: 'SaaS Tools',
          platform: 'Canva',
          image_url: 'https://images.unsplash.com/photo-1626785774573-4b799315345d?w=400&q=80'
        },
        {
          name: 'NordVPN Plus (1 Year)',
          description: 'Secure browsing with threat protection. Dedicated account access for up to 6 devices simultaneously.',
          price: 12.00,
          currency: '€',
          category: 'SaaS Tools',
          platform: 'NordVPN',
          image_url: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?w=400&q=80'
        },
        {
          name: 'Microsoft Office 365 Personal (1 Year)',
          description: 'Includes Word, Excel, PowerPoint, and 1TB OneDrive cloud storage. Private login details.',
          price: 12.99,
          currency: '$',
          category: 'SaaS Tools',
          platform: 'Microsoft',
          image_url: 'https://images.unsplash.com/photo-1625014020903-e329f586c990?w=400&q=80'
        }
      ];

      await Product.insertMany(defaultProducts);
      console.log('[Database] Seeded 6 default products');
    }

    // 4. Seed Default Settings
    const upiIdExists = await Setting.findOne({ key: 'upi_id' });
    if (!upiIdExists) {
      await new Setting({ key: 'upi_id', value: process.env.UPI_ID || 'pay@ottsolution' }).save();
    } else if (upiIdExists.value.includes('nexus') || upiIdExists.value.includes('nexsus')) {
      upiIdExists.value = process.env.UPI_ID || 'pay@ottsolution';
      await upiIdExists.save();
      console.log(`[Database] Updated legacy upi_id to: ${upiIdExists.value}`);
    }
    const upiQrExists = await Setting.findOne({ key: 'upi_qr_url' });
    if (!upiQrExists) {
      await new Setting({ key: 'upi_qr_url', value: '' }).save();
    }
    const resendApiKeyExists = await Setting.findOne({ key: 'resend_api_key' });
    if (!resendApiKeyExists) {
      await new Setting({ key: 'resend_api_key', value: process.env.RESEND_API_KEY || 're_5QnNPj5o_7ZfBx2aWVZsgz7hVJyVJTmKP' }).save();
    }
    const emailFromExists = await Setting.findOne({ key: 'email_from' });
    if (!emailFromExists) {
      await new Setting({ key: 'email_from', value: process.env.EMAIL_FROM || 'onboarding@resend.dev' }).save();
    }
    console.log('[Database] Seeded default settings');

  } catch (err) {
    console.error('[Database] Seeding error:', err);
  }
}

module.exports = mongoose;
