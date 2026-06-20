require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Connect Mongoose
const mongoose = require('./database');
const { User, Product, Order, ProductKey, Setting, Notification, OttPlatform, Visit } = require('./models');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust reverse proxy (Render) to support secure session cookies
app.set('trust proxy', 1);

// Enable CORS for cross-origin API calls (Cloudflare Pages -> Render)
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // Allow server-to-server or local script requests
      
      const allowedOrigins = [
        'http://localhost:5173',
        'http://localhost:3000',
        'https://ottsolution.online',
        'https://ottsolution.pages.dev'
      ];
      
      if (process.env.FRONTEND_URL) {
        allowedOrigins.push(process.env.FRONTEND_URL);
      }
      
      const isAllowed = allowedOrigins.includes(origin) || 
                        origin.endsWith('.pages.dev') || 
                        origin.endsWith('.online');
                        
      if (isAllowed) {
        return callback(null, true);
      } else {
        return callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: true
  })
);

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// 1. Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve payment screenshots static directory
app.use('/uploads', express.static(uploadsDir));

// Serve React front-end production build
app.use(express.static(path.join(__dirname, 'dist')));

// Configure Sessions with MongoDB Persistence
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'ott-marketplace-super-secret-key-129837',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      collectionName: 'sessions'
    }),
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
    }
  })
);

// --- SSE Live Notification Support ---
let sseClients = [];

async function broadcastNotification(notificationData) {
  try {
    const notification = new Notification({
      title: notificationData.title,
      message: notificationData.message,
      type: notificationData.type,
      isAdminOnly: !!notificationData.isAdminOnly
    });
    await notification.save();

    const payload = JSON.stringify({
      id: notification._id.toString(),
      title: notification.title,
      message: notification.message,
      type: notification.type,
      isAdminOnly: notification.isAdminOnly,
      created_at: notification.created_at
    });

    sseClients.forEach(client => {
      // If notification is admin-only, only send to admin clients
      if (notificationData.isAdminOnly && !client.isAdmin) {
        return;
      }
      client.res.write(`data: ${payload}\n\n`);
    });
  } catch (err) {
    console.error('[Notification Broadcast Error]:', err);
  }
}

const cloudinary = require('cloudinary').v2;

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure Multer to use memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Helper to upload file buffer to Cloudinary (or local filesystem fallback)
const handleImageUpload = async (reqFile, folder = 'general', customPrefix = 'file') => {
  if (!reqFile) return null;

  const isCloudinaryConfigured = 
    process.env.CLOUDINARY_CLOUD_NAME && 
    process.env.CLOUDINARY_API_KEY && 
    process.env.CLOUDINARY_API_SECRET;

  if (isCloudinaryConfigured) {
    try {
      return await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          { folder: `ott_nexus/${folder}` },
          (error, result) => {
            if (error) {
              console.error('[Cloudinary Upload Error]:', error);
              return reject(error);
            }
            resolve(result.secure_url);
          }
        );
        uploadStream.end(reqFile.buffer);
      });
    } catch (err) {
      console.error('[Cloudinary Stream Exception]:', err);
      throw err;
    }
  } else {
    // Local fallback storage
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const fileExt = path.extname(reqFile.originalname) || '.jpg';
    const filename = `${customPrefix}-${uniqueSuffix}${fileExt}`;
    const destinationPath = path.join(uploadsDir, filename);

    await fs.promises.writeFile(destinationPath, reqFile.buffer);
    console.log(`[Storage Fallback] Saved file locally: ${filename}`);
    return `/uploads/${filename}`;
  }
};

// Authentication Guards
const { requireAuth, requireAdmin } = require('./authMiddleware');

// 2. Serializers / Mapping helpers for frontend compatibility
const serializeProduct = async (p) => {
  if (!p) return null;
  const activeKeysCount = await ProductKey.countDocuments({ product_id: p._id, is_used: false });
  return {
    id: p._id.toString(),
    name: p.name,
    description: p.description,
    price: p.price,
    currency: p.currency,
    category: p.category,
    platform: p.platform,
    image_url: p.image_url,
    setup_type: p.setup_type || '',
    duration: p.duration || '',
    stock_type: p.stock_type || 'code',
    stock_count: activeKeysCount
  };
};

const serializeOrder = async (o) => {
  if (!o) return null;
  
  // Find claimed key/link if approved
  let keyVal = null;
  let keyType = null;
  if (o.status === 'approved') {
    const keyDoc = await ProductKey.findOne({ order_id: o._id });
    if (keyDoc) {
      keyVal = keyDoc.key_value;
      keyType = keyDoc.type || 'code';
    }
  }

  return {
    id: o._id.toString(),
    user_id: o.user_id?._id ? o.user_id._id.toString() : o.user_id?.toString(),
    user_email: o.user_id?.email || '',
    product_id: o.product_id?._id ? o.product_id._id.toString() : o.product_id?.toString(),
    product_name: o.product_id?.name || '',
    platform: o.product_id?.platform || '',
    image_url: o.product_id?.image_url || '',
    amount: o.amount,
    currency: o.currency,
    utr_number: o.utr_number,
    screenshot_path: o.screenshot_path,
    status: o.status,
    is_verified: o.is_verified || 'unchecked',
    rejection_reason: o.rejection_reason,
    created_at: o.created_at,
    key_value: keyVal,
    key_type: keyType
  };
};

// 3. Email & Stock Allocation Helpers
async function getResendConfig() {
  const apiKeySetting = await Setting.findOne({ key: 'resend_api_key' });
  const emailFromSetting = await Setting.findOne({ key: 'email_from' });
  return {
    apiKey: apiKeySetting?.value || process.env.RESEND_API_KEY || 're_5QnNPj5o_7ZfBx2aWVZsgz7hVJyVJTmKP',
    emailFrom: emailFromSetting?.value || process.env.EMAIL_FROM || 'onboarding@resend.dev'
  };
}

async function sendInviteEmail(toEmail, inviteLink, productName, currency, price) {
  try {
    const { apiKey, emailFrom } = await getResendConfig();

    if (!apiKey) {
      console.log(`[Email] Skipping email (no API Key configured). Deliverable: ${inviteLink}`);
      return;
    }

    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 30px; border: 1px solid #e4e4e7; border-radius: 8px; background-color: #ffffff; color: #18181b;">
        <h2 style="font-size: 20px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #18181b; padding-bottom: 15px; margin-top: 0; color: #000000;">
          OTT<span style="color: #71717a;">Solution</span>
        </h2>
        <p style="font-size: 15px; line-height: 1.5; color: #3f3f46; margin-top: 20px;">
          Thank you for your order! Your payment has been successfully verified, and your digital access is ready.
        </p>
        <div style="background-color: #f4f4f5; border: 1px solid #e4e4e7; border-radius: 4px; padding: 15px; margin: 20px 0;">
          <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
            <tr>
              <td style="color: #71717a; padding: 4px 0;">Product:</td>
              <td style="font-weight: bold; text-align: right; padding: 4px 0;">${productName}</td>
            </tr>
            <tr>
              <td style="color: #71717a; padding: 4px 0;">Amount Paid:</td>
              <td style="font-weight: bold; text-align: right; padding: 4px 0;">${currency}${price.toFixed(2)}</td>
            </tr>
          </table>
        </div>
        
        <p style="font-size: 14px; color: #3f3f46; margin: 25px 0 10px 0;">
          Click the button below to join your Premium group subscription or claim your access key:
        </p>
        
        <a href="${inviteLink}" target="_blank" style="display: block; text-align: center; background-color: #000000; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 24px; border-radius: 4px; margin: 20px 0 30px 0;">
          Claim Access / Join Family Group
        </a>
        
        <p style="font-size: 12px; color: #71717a; line-height: 1.4; margin-bottom: 0;">
          If the button above does not work, copy and paste this link into your browser:<br/>
          <a href="${inviteLink}" style="color: #18181b; word-break: break-all;">${inviteLink}</a>
        </p>
        <hr style="border: 0; border-top: 1px solid #e4e4e7; margin: 30px 0 20px 0;" />
        <p style="font-size: 11px; text-align: center; color: #a1a1aa; margin: 0;">
          OTT Solution Subscriptions Ltd. Secured Digital Delivery.
        </p>
      </div>
    `;

    console.log(`[Email] Sending Resend email to ${toEmail} using sender ${emailFrom}...`);

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: `OTT Solution <${emailFrom}>`,
        to: toEmail,
        subject: `Your ${productName} Invitation / Key - OTT Solution`,
        html: emailHtml
      })
    });

    const resData = await response.json();
    if (!response.ok) {
      throw new Error(resData.message || 'Resend request failed');
    }
    console.log('[Email] Resend email sent successfully! Msg ID:', resData.id);
  } catch (err) {
    console.error('[Email] Failed to send email via Resend API:', err.message);
  }
}

async function allocateKeyForOrder(orderId, productId) {
  try {
    const product = await Product.findById(productId);
    if (product && product.stock_type === 'login_code') {
      const mockKey = new ProductKey({
        product_id: productId,
        key_value: 'Direct WhatsApp Activation',
        type: 'login_code',
        is_used: true,
        order_id: orderId
      });
      await mockKey.save();
      console.log(`[Stock] Generated mock login_code key for order ${orderId}`);
      return mockKey.key_value;
    }

    const availableKey = await ProductKey.findOne({ product_id: productId, is_used: false });
    if (availableKey) {
      availableKey.is_used = true;
      availableKey.order_id = orderId;
      await availableKey.save();
      console.log(`[Stock] Claimed key ${availableKey._id} for order ${orderId}`);
      return availableKey.key_value;
    }
    console.log(`[Stock] Out of stock for product ${productId}. No key allocated.`);
    return null;
  } catch (err) {
    console.error('[Stock] Error allocating key:', err);
    return null;
  }
}

// 4. Authentication API Endpoints
app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ error: 'Email is already registered.' });
    }

    const hash = bcrypt.hashSync(password, 10);
    const user = new User({
      email: email.toLowerCase(),
      password_hash: hash,
      role: 'user'
    });
    await user.save();

    req.session.userId = user._id;
    req.session.role = user.role;
    req.session.email = user.email;

    res.status(201).json({
      message: 'Registration successful',
      user: { id: user._id.toString(), email: user.email, role: user.role }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    if (user.is_banned) {
      return res.status(403).json({ error: 'Forbidden. Your account has been banned.' });
    }

    const passwordMatch = bcrypt.compareSync(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    req.session.userId = user._id;
    req.session.role = user.role;
    req.session.email = user.email;

    res.json({
      message: 'Login successful',
      user: { id: user._id.toString(), email: user.email, role: user.role }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ error: 'Failed to log out.' });
    }
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out successfully' });
  });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null });
  }
  res.json({
    user: {
      id: req.session.userId,
      email: req.session.email,
      role: req.session.role
    }
  });
});

// 5. Products API
app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find();
    const serialized = await Promise.all(products.map(serializeProduct));
    res.json(serialized);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch products.' });
  }
});

app.post('/api/products', requireAdmin, upload.single('product_image'), async (req, res) => {
  const { name, description, price, currency, category, platform, image_url, setup_type, duration, stock_type } = req.body;

  let finalImageUrl = image_url;
  if (req.file) {
    try {
      finalImageUrl = await handleImageUpload(req.file, 'products', 'product');
    } catch (uploadErr) {
      return res.status(500).json({ error: 'Failed to upload product image.' });
    }
  }

  if (!name || !description || !price || !category || !platform || !finalImageUrl) {
    return res.status(400).json({ error: 'All fields are required. Provide an image URL or upload an image.' });
  }

  const currencySymbol = currency ? currency.trim() : '$';

  try {
    const product = new Product({
      name,
      description,
      price: parseFloat(price),
      currency: currencySymbol,
      category,
      platform,
      image_url: finalImageUrl,
      setup_type: setup_type || '',
      duration: duration || '',
      stock_type: stock_type || 'code'
    });
    await product.save();

    // Broadcast new product notification
    await broadcastNotification({
      title: 'New Product Available!',
      message: `${product.name} is now available in our store for only ${product.currency}${product.price}!`,
      type: 'new_product',
      isAdminOnly: false
    });

    res.status(201).json({
      message: 'Product added successfully',
      productId: product._id.toString()
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create product.' });
  }
});

app.delete('/api/products/:id', requireAdmin, async (req, res) => {
  try {
    const result = await Product.findByIdAndDelete(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Product not found.' });
    }
    // Also clean up any keys associated with this product
    await ProductKey.deleteMany({ product_id: req.params.id });

    res.json({ message: 'Product deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete product.' });
  }
});

app.put('/api/products/:id', requireAdmin, upload.single('product_image'), async (req, res) => {
  const { name, description, price, currency, category, platform, image_url, setup_type, duration, stock_type } = req.body;
  const productId = req.params.id;

  let finalImageUrl = image_url;
  if (req.file) {
    try {
      finalImageUrl = await handleImageUpload(req.file, 'products', 'product');
    } catch (uploadErr) {
      return res.status(500).json({ error: 'Failed to upload product image.' });
    }
  }

  if (!name || !description || !price || !category || !platform || !finalImageUrl) {
    return res.status(400).json({ error: 'All fields are required. Provide an image URL or upload an image.' });
  }

  const currencySymbol = currency ? currency.trim() : '$';

  try {
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    const oldPrice = product.price;
    const newPrice = parseFloat(price);
    const priceChanged = oldPrice !== newPrice;

    product.name = name;
    product.description = description;
    product.price = newPrice;
    product.currency = currencySymbol;
    product.category = category;
    product.platform = platform;
    product.image_url = finalImageUrl;
    product.setup_type = setup_type || '';
    product.duration = duration || '';
    product.stock_type = stock_type || 'code';

    await product.save();

    if (priceChanged) {
      await broadcastNotification({
        title: 'Price Update Alert!',
        message: `The price of ${product.name} has been updated to ${product.currency}${product.price} (previously ${product.currency}${oldPrice}).`,
        type: 'price_update',
        isAdminOnly: false
      });
    }

    res.json({ message: 'Product updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update product.' });
  }
});

// 6. Checkout and Orders API (Users)
// 6. Checkout and Orders API (Users)
app.post('/api/checkout', requireAuth, upload.single('screenshot'), async (req, res) => {
  const { product_id, utr_number } = req.body;

  if (!product_id || !utr_number) {
    return res.status(400).json({ error: 'Product ID and UTR number are required.' });
  }

  const utrClean = utr_number.trim();
  if (utrClean.length < 12) {
    return res.status(400).json({ error: 'Please enter a valid Transaction ID/UTR (minimum 12 characters).' });
  }

  try {
    // Check if user already has an existing pending or rejected order for this product
    const existingOrder = await Order.findOne({
      user_id: req.session.userId,
      product_id: product_id,
      status: { $in: ['pending', 'rejected'] }
    });

    // Check if the UTR is already used by ANOTHER order
    const duplicate = await Order.findOne({ utr_number: utrClean });
    if (duplicate) {
      if (!existingOrder || duplicate._id.toString() !== existingOrder._id.toString()) {
        return res.status(400).json({ error: 'This UTR has already been submitted for another order. Re-use is not allowed.' });
      } else {
        return res.status(400).json({ error: 'This UTR has already been submitted. Please enter a different, valid UTR or contact support.' });
      }
    }

    // Get product details
    const product = await Product.findById(product_id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    let screenshotPath = null;
    if (req.file) {
      try {
        screenshotPath = await handleImageUpload(req.file, 'screenshots', 'screenshot');
      } catch (uploadErr) {
        return res.status(500).json({ error: 'Failed to upload payment screenshot.' });
      }
    }

    if (existingOrder) {
      // Clean up old screenshot if we have a new one (only if it was local)
      if (screenshotPath && existingOrder.screenshot_path && existingOrder.screenshot_path.startsWith('/uploads/')) {
        const oldFilename = path.basename(existingOrder.screenshot_path);
        const oldLocalPath = path.join(uploadsDir, oldFilename);
        fs.unlink(oldLocalPath, (err) => {
          if (err && err.code !== 'ENOENT') {
            console.error(`Failed to delete old screenshot: ${oldLocalPath}`, err);
          }
        });
      }

      // Update existing order
      existingOrder.utr_number = utrClean;
      if (screenshotPath) {
        existingOrder.screenshot_path = screenshotPath;
      }
      existingOrder.status = 'pending';
      existingOrder.is_verified = 'unchecked';
      existingOrder.rejection_reason = null;
      existingOrder.created_at = Date.now();
      await existingOrder.save();

      // Broadcast admin-only notification of an updated order submission
      await broadcastNotification({
        title: 'Order UTR Updated',
        message: `Order UTR has been updated for ${product.name} by ${req.session.email} | UTR: ${utrClean}`,
        type: 'new_order',
        isAdminOnly: true
      });

      return res.status(200).json({
        message: 'Order UTR updated successfully. Verification is pending.',
        orderId: existingOrder._id.toString()
      });
    } else {
      // Create new order
      const order = new Order({
        user_id: req.session.userId,
        product_id: product._id,
        amount: product.price,
        currency: product.currency || '$',
        utr_number: utrClean,
        screenshot_path: screenshotPath,
        status: 'pending'
      });
      await order.save();

      // Broadcast admin-only notification of a new checkout submission
      await broadcastNotification({
        title: 'New Order Placed',
        message: `A new order has been submitted for ${product.name} by ${req.session.email} | UTR: ${utrClean}`,
        type: 'new_order',
        isAdminOnly: true
      });

      res.status(201).json({
        message: 'Order submitted successfully. Verification is pending.',
        orderId: order._id.toString()
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to process checkout.' });
  }
});

app.get('/api/orders', requireAuth, async (req, res) => {
  try {
    const orders = await Order.find({ user_id: req.session.userId })
      .populate('product_id')
      .sort({ created_at: -1 });

    const serialized = await Promise.all(orders.map(serializeOrder));
    res.json(serialized);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch your orders.' });
  }
});

// 7. Admin Verification & Management API
app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  try {
    const orders = await Order.find()
      .populate('product_id user_id')
      .sort({ created_at: -1 });

    const serialized = await Promise.all(orders.map(serializeOrder));
    res.json(serialized);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch all orders.' });
  }
});

app.post('/api/admin/orders/:id/verify', requireAdmin, async (req, res) => {
  const { status, rejection_reason } = req.body;
  const orderId = req.params.id;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: "Invalid status. Must be 'approved' or 'rejected'." });
  }

  try {
    const order = await Order.findById(orderId).populate('product_id user_id');
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    order.status = status;
    order.rejection_reason = status === 'rejected' ? rejection_reason : null;
    await order.save();

    let inviteLink = null;
    if (status === 'approved') {
      // Allocate key/link
      inviteLink = await allocateKeyForOrder(order._id, order.product_id._id);

      // Send email notification
      if (inviteLink) {
        await sendInviteEmail(
          order.user_id.email,
          inviteLink,
          order.product_id.name,
          order.currency,
          order.amount
        );
      }

      // Broadcast public purchase alert (social proof)
      await broadcastNotification({
        title: 'New Purchase!',
        message: `Someone just purchased ${order.product_id.name}!`,
        type: 'purchase',
        isAdminOnly: false
      });

      // Broadcast admin-only order verification details
      await broadcastNotification({
        title: 'Order Approved',
        message: `Order approved for ${order.user_id.email} | Product: ${order.product_id.name} | UTR: ${order.utr_number}`,
        type: 'order_approved',
        isAdminOnly: true
      });

      // Check if product is now out of stock
      const remainingKeys = await ProductKey.countDocuments({ product_id: order.product_id._id, is_used: false });
      if (remainingKeys === 0) {
        await broadcastNotification({
          title: 'Out of Stock',
          message: `${order.product_id.name} is now out of stock.`,
          type: 'out_of_stock',
          isAdminOnly: false
        });
      }
    } else if (status === 'rejected') {
      // Broadcast admin-only rejection details
      await broadcastNotification({
        title: 'Order Rejected',
        message: `Order rejected for ${order.user_id.email} | Product: ${order.product_id.name} | Reason: ${rejection_reason || 'No reason specified'}`,
        type: 'order_rejected',
        isAdminOnly: true
      });
    }

    res.json({
      message: `Order has been successfully ${status}`,
      invite_link: inviteLink
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update order status.' });
  }
});

app.delete('/api/admin/orders/:id', requireAdmin, async (req, res) => {
  try {
    const orderId = req.params.id;
    const order = await Order.findByIdAndDelete(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }
    
    // Also release any key allocated to this order back to the pool
    await ProductKey.updateMany({ order_id: orderId }, { $set: { is_used: false, order_id: null } });
    
    res.json({ message: 'Order has been successfully deleted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete order.' });
  }
});

app.put('/api/admin/orders/:id/utr', requireAdmin, async (req, res) => {
  const { utr_number } = req.body;
  const orderId = req.params.id;

  if (!utr_number) {
    return res.status(400).json({ error: 'UTR number is required.' });
  }

  const utrClean = utr_number.trim();
  if (utrClean.length < 12) {
    return res.status(400).json({ error: 'Please enter a valid Transaction ID/UTR (minimum 12 characters).' });
  }

  try {
    // Check duplicate UTR across other orders
    const duplicate = await Order.findOne({ utr_number: utrClean, _id: { $ne: orderId } });
    if (duplicate) {
      return res.status(400).json({ error: 'This UTR has already been submitted for another order. Re-use is not allowed.' });
    }

    const order = await Order.findById(orderId).populate('product_id user_id');
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    order.utr_number = utrClean;
    order.is_verified = 'unchecked';
    
    // Reset status to pending if previously rejected
    if (order.status === 'rejected') {
      order.status = 'pending';
      order.rejection_reason = null;
    }
    await order.save();

    res.json({ 
      message: 'Order UTR updated successfully.', 
      order: await serializeOrder(order) 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update order UTR.' });
  }
});

// 8. Bulk UTR Reconciliation API (Admin-only)
app.post('/api/admin/reconcile-utrs', requireAdmin, async (req, res) => {
  const { utr_list } = req.body;
  if (!utr_list) {
    return res.status(400).json({ error: 'UTR list is required.' });
  }

  // Extract 8 to 20 digit transaction reference/UTR numbers
  const matches = utr_list.match(/\b\d{8,20}\b/g) || [];
  const uniqueUtrs = Array.from(new Set(matches));

  if (uniqueUtrs.length === 0) {
    return res.json({
      message: 'No valid transaction references or UTR numbers were found in the submitted text.',
      verifiedCount: 0,
      unverifiedCount: 0,
      verifiedOrders: [],
      unverifiedOrders: []
    });
  }

  try {
    const pendingOrders = await Order.find({ status: 'pending' }).populate('product_id user_id');

    let verifiedCount = 0;
    let unverifiedCount = 0;
    const verifiedOrders = [];
    const unverifiedOrders = [];

    for (const order of pendingOrders) {
      const matchFound = uniqueUtrs.includes(order.utr_number);
      order.is_verified = matchFound ? 'verified' : 'unverified';
      await order.save();

      const orderDetails = {
        id: order._id.toString(),
        user_email: order.user_id?.email || '',
        product_name: order.product_id?.name || '',
        amount: order.amount,
        currency: order.currency,
        utr_number: order.utr_number
      };

      if (matchFound) {
        verifiedCount++;
        verifiedOrders.push(orderDetails);
      } else {
        unverifiedCount++;
        unverifiedOrders.push(orderDetails);
      }
    }

    res.json({
      message: `Reconciliation scan complete: ${verifiedCount} orders marked as verified (matched), ${unverifiedCount} orders marked as unverified (no match).`,
      verifiedCount,
      unverifiedCount,
      verifiedOrders,
      unverifiedOrders
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during UTR reconciliation.' });
  }
});

// 9. Key/Stock Management API (Admin-only)
app.get('/api/admin/products/:id/keys', requireAdmin, async (req, res) => {
  try {
    const keys = await ProductKey.find({ product_id: req.params.id }).populate('order_id');
    const formattedKeys = keys.map(async (k) => {
      let orderUser = null;
      if (k.order_id) {
        const userDoc = await User.findById(k.order_id.user_id);
        orderUser = userDoc ? userDoc.email : null;
      }

      return {
        id: k._id.toString(),
        key_value: k.key_value,
        type: k.type || 'code',
        is_used: k.is_used,
        order_id: k.order_id?._id?.toString() || null,
        order_utr: k.order_id?.utr_number || null,
        order_user: orderUser
      };
    });

    const resolvedKeys = await Promise.all(formattedKeys);
    res.json(resolvedKeys);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch keys.' });
  }
});

app.post('/api/admin/products/:id/keys', requireAdmin, async (req, res) => {
  const { keys_text, type } = req.body;
  if (!keys_text) {
    return res.status(400).json({ error: 'Keys text is required.' });
  }

  const keys = keys_text.split('\n')
    .map(k => k.trim())
    .filter(k => k.length > 0);

  if (keys.length === 0) {
    return res.status(400).json({ error: 'Please enter at least one valid key/link.' });
  }

  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    const activeKeysBefore = await ProductKey.countDocuments({ product_id: product._id, is_used: false });

    const newKeys = keys.map(k => ({
      product_id: product._id,
      key_value: k,
      type: type || 'code',
      is_used: false
    }));

    await ProductKey.insertMany(newKeys);

    if (activeKeysBefore === 0) {
      await broadcastNotification({
        title: 'Back in Stock!',
        message: `${product.name} is now back in stock! Grab yours before it runs out.`,
        type: 'back_in_stock',
        isAdminOnly: false
      });
    }

    res.status(201).json({ message: `Successfully added ${keys.length} keys/invite links to inventory.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add keys.' });
  }
});

app.delete('/api/admin/keys/:keyId', requireAdmin, async (req, res) => {
  try {
    const result = await ProductKey.findByIdAndDelete(req.params.keyId);
    if (!result) {
      return res.status(404).json({ error: 'Key not found.' });
    }
    res.json({ message: 'Key deleted successfully from inventory.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete key.' });
  }
});

app.put('/api/admin/keys/:keyId', requireAdmin, async (req, res) => {
  const { key_value, type } = req.body;
  try {
    const keyDoc = await ProductKey.findById(req.params.keyId);
    if (!keyDoc) {
      return res.status(404).json({ error: 'Key not found.' });
    }
    if (key_value !== undefined) {
      keyDoc.key_value = key_value.trim();
    }
    if (type !== undefined) {
      keyDoc.type = type;
    }
    await keyDoc.save();
    res.json({ message: 'Key updated successfully from inventory.', key: keyDoc });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update key.' });
  }
});

app.post('/api/visits', async (req, res) => {
  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const visit = new Visit({ ip });
    await visit.save();
    res.status(201).json({ message: 'Visit logged' });
  } catch (err) {
    console.error('Failed to log visit:', err);
    res.status(500).json({ error: 'Failed to log visit' });
  }
});

app.get('/api/admin/analytics', requireAdmin, async (req, res) => {
  try {
    const totalVisits = await Visit.countDocuments();
    const totalUsers = await User.countDocuments();
    const totalOrders = await Order.countDocuments();
    
    const approvedOrders = await Order.find({ status: 'approved' });
    const totalRevenue = approvedOrders.reduce((sum, order) => sum + (order.amount || 0), 0);

    res.json({
      visits: totalVisits,
      users: totalUsers,
      orders: totalOrders,
      revenue: totalRevenue
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch analytics.' });
  }
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await User.find().sort({ email: 1 });
    const serializedUsers = users.map(u => ({
      id: u._id.toString(),
      email: u.email,
      role: u.role,
      is_banned: !!u.is_banned
    }));
    res.json(serializedUsers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users list.' });
  }
});

app.post('/api/admin/users/:id/ban', requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    if (user.role === 'admin') {
      return res.status(400).json({ error: 'Cannot ban an admin user.' });
    }
    user.is_banned = true;
    await user.save();
    res.json({ message: `User ${user.email} has been successfully banned.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to ban user.' });
  }
});

app.post('/api/admin/users/:id/unban', requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    user.is_banned = false;
    await user.save();
    res.json({ message: `User ${user.email} has been successfully unbanned.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to unban user.' });
  }
});

// 10. Settings API (Public read, Admin-only write)
app.get('/api/settings', async (req, res) => {
  try {
    const rows = await Setting.find();
    const settingsObj = {};
    rows.forEach(r => {
      // Do not expose sensitive Resend API Key to general users
      if (r.key !== 'resend_api_key') {
        settingsObj[r.key] = r.value;
      }
    });
    res.json(settingsObj);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch settings.' });
  }
});

app.get('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    const rows = await Setting.find();
    const settingsObj = {};
    rows.forEach(r => {
      settingsObj[r.key] = r.value;
    });
    res.json(settingsObj);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch settings.' });
  }
});

app.put('/api/admin/settings', requireAdmin, upload.single('qr_image'), async (req, res) => {
  const { upi_id, upi_qr_url, resend_api_key, email_from } = req.body;

  try {
    if (upi_id !== undefined) {
      await Setting.findOneAndUpdate({ key: 'upi_id' }, { value: upi_id.trim() }, { upsert: true });
    }

    let finalQrUrl = upi_qr_url;
    if (req.file) {
      try {
        finalQrUrl = await handleImageUpload(req.file, 'qrcodes', 'qr');
      } catch (uploadErr) {
        return res.status(500).json({ error: 'Failed to upload QR code image.' });
      }
    }

    if (finalQrUrl !== undefined) {
      await Setting.findOneAndUpdate({ key: 'upi_qr_url' }, { value: finalQrUrl.trim() }, { upsert: true });
    }

    if (resend_api_key !== undefined) {
      await Setting.findOneAndUpdate({ key: 'resend_api_key' }, { value: resend_api_key.trim() }, { upsert: true });
    }

    if (email_from !== undefined) {
      await Setting.findOneAndUpdate({ key: 'email_from' }, { value: email_from.trim() }, { upsert: true });
    }

    res.json({ message: 'Settings updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update settings.' });
  }
});

// --- SSE Notification Endpoints ---
app.get('/api/notifications/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const isAdmin = req.session && req.session.role === 'admin';
  const client = { res, isAdmin };
  sseClients.push(client);

  res.write(': heartbeat\n\n');

  const interval = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(interval);
    sseClients = sseClients.filter(c => c.res !== res);
  });
});

app.get('/api/notifications', async (req, res) => {
  try {
    const isAdmin = req.session && req.session.role === 'admin';
    let query = {};
    if (!isAdmin) {
      query = { isAdminOnly: false, type: { $ne: 'purchase' } };
    }
    
    const notifications = await Notification.find(query)
      .sort({ created_at: -1 })
      .limit(50);
      
    res.json(notifications.map(n => ({
      id: n._id.toString(),
      title: n.title,
      message: n.message,
      type: n.type,
      created_at: n.created_at
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch notifications.' });
  }
});

// --- OTT Platforms Endpoints ---
app.get('/api/admin/ott-platforms', requireAdmin, async (req, res) => {
  try {
    const platforms = await OttPlatform.find().sort({ name: 1 });
    res.json(platforms.map(p => ({ id: p._id.toString(), name: p.name })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch OTT platforms.' });
  }
});

app.post('/api/admin/ott-platforms', requireAdmin, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Platform name is required.' });
  }
  try {
    const trimmedName = name.trim();
    const exists = await OttPlatform.findOne({ name: { $regex: new RegExp(`^${trimmedName}$`, 'i') } });
    if (exists) {
      return res.status(400).json({ error: 'Platform already exists.' });
    }
    const newPlatform = new OttPlatform({ name: trimmedName });
    await newPlatform.save();
    res.status(201).json({ message: 'OTT platform added successfully', platform: { id: newPlatform._id.toString(), name: newPlatform.name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create OTT platform.' });
  }
});

// Serve the index.html for SPA router on all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// 11. Start Server
app.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
});
