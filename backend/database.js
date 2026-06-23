const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { User, Product, Setting, OttPlatform } = require('./models');

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
    const defaultAdminEmail = process.env.ADMIN_EMAIL || 'admin@getsubscribed.online';
    const defaultAdminPassword = process.env.ADMIN_PASSWORD || 'admintanishq007';
    const adminExists = await User.findOne({ email: defaultAdminEmail });
    if (!adminExists) {
      const adminHash = bcrypt.hashSync(defaultAdminPassword, 10);
      await new User({
        email: defaultAdminEmail,
        password_hash: adminHash,
        role: 'admin'
      }).save();
      console.log(`[Database] Seeded default admin: ${defaultAdminEmail}`);
    } else {
      const isPasswordSame = bcrypt.compareSync(defaultAdminPassword, adminExists.password_hash);
      if (!isPasswordSame) {
        adminExists.password_hash = bcrypt.hashSync(defaultAdminPassword, 10);
        await adminExists.save();
        console.log(`[Database] Updated existing admin password to match .env config.`);
      }
    }

    // 2. Seed Default User
    const userExists = await User.findOne({ email: 'user@getsubscribed.online' });
    if (!userExists) {
      const userHash = bcrypt.hashSync('user123', 10);
      await new User({
        email: 'user@getsubscribed.online',
        password_hash: userHash,
        role: 'user'
      }).save();
      console.log('[Database] Seeded default user: user@getsubscribed.online / user123');
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
      await new Setting({ key: 'upi_id', value: process.env.UPI_ID || 'pay@getsubscribed' }).save();
    } else if (upiIdExists.value.includes('nexus') || upiIdExists.value.includes('nexsus')) {
      upiIdExists.value = process.env.UPI_ID || 'pay@getsubscribed';
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
    const showBankTransferExists = await Setting.findOne({ key: 'show_bank_transfer' });
    if (!showBankTransferExists) {
      await new Setting({ key: 'show_bank_transfer', value: 'true' }).save();
    }
    const bankDetailsInrExists = await Setting.findOne({ key: 'bank_details_inr' });
    if (!bankDetailsInrExists) {
      await new Setting({ 
        key: 'bank_details_inr', 
        value: "Bank Name: Getsubscribed Bank (India)\nAccount Name: Getsubscribed Subscriptions Ltd\nAccount No: 9900887766\nIFSC Code: GSUB000123" 
      }).save();
    }
    const bankDetailsEurExists = await Setting.findOne({ key: 'bank_details_eur' });
    if (!bankDetailsEurExists) {
      await new Setting({ 
        key: 'bank_details_eur', 
        value: "Bank Name: Getsubscribed Europe Bank\nIBAN: BE89 3704 0044 0532 0130\nBIC / SWIFT: GSUBBE22XXX\nAccount Name: Getsubscribed Subscriptions Ltd" 
      }).save();
    }
    const bankDetailsUsdExists = await Setting.findOne({ key: 'bank_details_usd' });
    if (!bankDetailsUsdExists) {
      await new Setting({ 
        key: 'bank_details_usd', 
        value: "Bank Name: Getsubscribed US Bank\nRouting No: 021000021\nAccount No: 123456789012\nSwift Code: GSUBUS33XXX\nBeneficiary: Getsubscribed Subscriptions LLC" 
      }).save();
    }
    console.log('[Database] Seeded default settings');

    // 5. Seed OTT Platforms from unique platforms in products
    const platformCount = await OttPlatform.countDocuments();
    if (platformCount === 0) {
      const uniquePlatforms = await Product.distinct('platform');
      const platformsToSeed = uniquePlatforms.length > 0 ? uniquePlatforms : ['Netflix', 'Spotify', 'Canva', 'Steam', 'NordVPN', 'Microsoft'];
      const newPlatforms = platformsToSeed.map(p => ({ name: p }));
      await OttPlatform.insertMany(newPlatforms);
      console.log(`[Database] Seeded ${platformsToSeed.length} OTT platforms:`, platformsToSeed);
    }

  } catch (err) {
    console.error('[Database] Seeding error:', err);
  }
}

module.exports = mongoose;
