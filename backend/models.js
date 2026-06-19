const mongoose = require('mongoose');

// User Schema
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password_hash: { type: String, required: true },
  role: { type: String, required: true, default: 'user' },
  is_banned: { type: Boolean, default: false }
});

// Product Schema
const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, required: true },
  price: { type: Number, required: true },
  currency: { type: String, required: true, default: '$' },
  category: { type: String, required: true },
  platform: { type: String, required: true },
  image_url: { type: String, required: true },
  setup_type: { type: String, default: '' },
  duration: { type: String, default: '' },
  stock_type: { type: String, default: 'code' }
});

// Order Schema
const orderSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  amount: { type: Number, required: true },
  currency: { type: String, required: true, default: '$' },
  utr_number: { type: String, required: true, unique: true, trim: true },
  screenshot_path: { type: String, default: null },
  status: { type: String, required: true, default: 'pending' },
  is_verified: { type: String, required: true, default: 'unchecked' },
  rejection_reason: { type: String, default: null },
  created_at: { type: Date, default: Date.now }
});

// ProductKey Schema (Stock / Invites)
const productKeySchema = new mongoose.Schema({
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  key_value: { type: String, required: true },
  type: { type: String, required: true, default: 'code' }, // 'code', 'credentials', 'link'
  email: { type: String, default: '' },
  password: { type: String, default: '' },
  is_used: { type: Boolean, required: true, default: false },
  order_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null }
});

// Setting Schema
const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: String, default: '' }
});

// Notification Schema
const notificationSchema = new mongoose.Schema({
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, required: true }, // 'new_product', 'price_update', 'back_in_stock', 'out_of_stock', 'purchase', 'new_order', 'order_approved', 'order_rejected'
  isAdminOnly: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now }
});

// OTT Platform Schema
const ottPlatformSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true }
});

// Visit Schema (Visitor traffic analytics)
const visitSchema = new mongoose.Schema({
  ip: { type: String, default: '' },
  created_at: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Product = mongoose.model('Product', productSchema);
const Order = mongoose.model('Order', orderSchema);
const ProductKey = mongoose.model('ProductKey', productKeySchema);
const Setting = mongoose.model('Setting', settingSchema);
const Notification = mongoose.model('Notification', notificationSchema);
const OttPlatform = mongoose.model('OttPlatform', ottPlatformSchema);
const Visit = mongoose.model('Visit', visitSchema);

module.exports = {
  User,
  Product,
  Order,
  ProductKey,
  Setting,
  Notification,
  OttPlatform,
  Visit
};
