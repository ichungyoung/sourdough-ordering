/* ═══════════════════════════════════════════
   Karen's Kitchen — Backend Server  ·  server.js
   ═══════════════════════════════════════════ */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const DAILY_CAPACITY = 2;

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("FATAL: MONGODB_URI environment variable is not defined.");
  process.exit(1);
}

// Connect to MongoDB Atlas
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB Atlas'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

/* ── Mongoose Models ── */

const orderSchema = new mongoose.Schema({
  customerName: { type: String, required: true },
  customerEmail: { type: String },
  customerPhone: { type: String },
  flavor: { type: String, required: true },
  flavorName: { type: String },
  flavorEmoji: { type: String },
  date: { type: String, required: true }, // Format: YYYY-MM-DD
  quantity: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'fulfilled', 'cancelled'], default: 'pending' },
  orderTimestamp: { type: Date, default: Date.now }
}, {
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
    }
  }
});

const Order = mongoose.model('Order', orderSchema);

const flavorSchema = new mongoose.Schema({
  category: { type: String, required: true },
  startDate: { type: String, required: true }, // Format: YYYY-MM-DD
  emoji: { type: String },
  name: { type: String, required: true },
  description: { type: String, required: true }
}, {
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
    }
  }
});

const Flavor = mongoose.model('Flavor', flavorSchema);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ── Authentication Middleware ── */

function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }
  const token = authHeader.split(' ')[1];
  if (token !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Forbidden: Invalid token' });
  }
  next();
}

/* ── API Endpoints ── */

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ token: ADMIN_PASSWORD });
  } else {
    res.status(401).json({ error: 'Incorrect password' });
  }
});

// Public: Get aggregated active loaves count per date (Privacy Preserving)
app.get('/api/availability', async (req, res) => {
  try {
    const activeOrders = await Order.find({ status: { $ne: 'cancelled' } });
    const availability = {};
    for (const o of activeOrders) {
      availability[o.date] = (availability[o.date] || 0) + o.quantity;
    }
    res.json(availability);
  } catch (err) {
    console.error("Error loading availability:", err);
    res.status(500).json({ error: 'Failed to load availability' });
  }
});

// Public: Get flavor overrides
app.get('/api/flavors', async (req, res) => {
  try {
    const flavors = await Flavor.find();
    res.json(flavors);
  } catch (err) {
    console.error("Error loading flavors:", err);
    res.status(500).json({ error: 'Failed to load flavors' });
  }
});

// Public: Place Order
app.post('/api/orders', async (req, res) => {
  const { customerName, customerEmail, customerPhone, cart } = req.body;

  const name = (customerName || '').trim();
  const email = (customerEmail || '').trim();
  const phone = (customerPhone || '').trim();

  if (!name) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  if (!email && !phone) {
    return res.status(400).json({ error: 'Please provide either an email or phone number.' });
  }
  if (email && !email.includes('@')) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }
  if (phone && phone.replace(/\D/g, '').length < 7) {
    return res.status(400).json({ error: 'Please provide a valid phone number.' });
  }
  if (!Array.isArray(cart) || cart.length === 0) {
    return res.status(400).json({ error: 'Your cart is empty.' });
  }

  try {
    // Capacity checking for each date in cart
    for (const item of cart) {
      const dateISO = item.date;
      const qty = parseInt(item.qty, 10);
      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({ error: 'Invalid quantity.' });
      }

      // Check current orders in database
      const existingOrders = await Order.find({ date: dateISO, status: { $ne: 'cancelled' } });
      const dbOrdered = existingOrders.reduce((sum, o) => sum + o.quantity, 0);

      // Check items in this client's cart for the same date (in case of multiples)
      const cartOrdered = cart
        .filter(c => c.date === dateISO)
        .reduce((sum, c) => sum + parseInt(c.qty, 10), 0);

      if (dbOrdered + cartOrdered > DAILY_CAPACITY) {
        return res.status(400).json({
          error: `Oops — The date ${dateISO} does not have enough availability for ${cartOrdered} loaf/loaves.`
        });
      }
    }

    // Save orders
    const newOrders = [];
    for (const item of cart) {
      const orderData = {
        customerName: name,
        customerEmail: email,
        customerPhone: phone,
        flavor: item.flavorCategory,
        flavorName: item.flavorName,
        flavorEmoji: item.flavorEmoji,
        date: item.date,
        quantity: parseInt(item.qty, 10),
        status: 'pending',
        orderTimestamp: new Date()
      };
      const order = new Order(orderData);
      await order.save();
      newOrders.push(order);
    }

    res.json({ success: true, orders: newOrders });
  } catch (err) {
    console.error("Error placing order:", err);
    res.status(500).json({ error: 'Failed to place order.' });
  }
});

// Admin: Get all orders
app.get('/api/orders', requireAdmin, async (req, res) => {
  try {
    const orders = await Order.find();
    res.json(orders);
  } catch (err) {
    console.error("Error reading orders:", err);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

// Admin: Fulfill order
app.post('/api/orders/:id/fulfill', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    order.status = 'fulfilled';
    await order.save();
    res.json({ success: true, order });
  } catch (err) {
    console.error("Error fulfilling order:", err);
    res.status(500).json({ error: 'Failed to fulfill order' });
  }
});

// Admin: Cancel order
app.post('/api/orders/:id/cancel', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    order.status = 'cancelled';
    await order.save();
    res.json({ success: true, order });
  } catch (err) {
    console.error("Error cancelling order:", err);
    res.status(500).json({ error: 'Failed to cancel order' });
  }
});

// Admin: Clean past orders
app.post('/api/orders/clean', requireAdmin, async (req, res) => {
  try {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const todayISO = `${y}-${m}-${d}`;

    const result = await Order.deleteMany({ date: { $lt: todayISO } });
    res.json({ success: true, removed: result.deletedCount });
  } catch (err) {
    console.error("Error cleaning orders:", err);
    res.status(500).json({ error: 'Failed to clean past orders' });
  }
});

// Admin: Create flavor override
app.post('/api/flavors', requireAdmin, async (req, res) => {
  const { category, startDate, emoji, name, description } = req.body;
  if (!category || !startDate || !name || !description) {
    return res.status(400).json({ error: 'Missing required override details.' });
  }

  try {
    const emojiVal = emoji || (category === 'Sweet' ? '🍯' : '🌿');
    
    // Update if existing category and startDate, else insert
    const flavor = await Flavor.findOneAndUpdate(
      { category, startDate },
      { emoji: emojiVal, name, description },
      { new: true, upsert: true }
    );

    res.json({ success: true, flavor });
  } catch (err) {
    console.error("Error setting flavor override:", err);
    res.status(500).json({ error: 'Failed to set flavor override.' });
  }
});

// Admin: Delete flavor override
app.delete('/api/flavors/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await Flavor.findByIdAndDelete(id);
    if (!result) {
      return res.status(404).json({ error: 'Override not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting flavor override:", err);
    res.status(500).json({ error: 'Failed to delete flavor override.' });
  }
});

// Wildcard: Serve index.html for SPA behavior (optional but good practice)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`Karen's Kitchen backend running on http://localhost:${PORT}`);
});
