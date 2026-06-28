/* ═══════════════════════════════════════════
   Karen's Kitchen — Backend Server  ·  server.js
   ═══════════════════════════════════════════ */

const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const DAILY_CAPACITY = 2;

const DB_PATH = path.join(__dirname, 'data', 'db.json');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ── Database Helpers ── */

async function readDb() {
  try {
    const data = await fs.readFile(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    const initialDb = { orders: [], flavors: [] };
    await writeDb(initialDb);
    return initialDb;
  }
}

async function writeDb(db) {
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

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
    const db = await readDb();
    const availability = {};
    for (const o of db.orders) {
      if (o.status !== 'cancelled') {
        availability[o.date] = (availability[o.date] || 0) + (o.quantity || 0);
      }
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
    const db = await readDb();
    res.json(db.flavors || []);
  } catch (err) {
    console.error("Error loading flavors:", err);
    res.status(500).json({ error: 'Failed to load flavors' });
  }
});

// Public: Place Order
app.post('/api/orders', async (req, res) => {
  const { customerName, customerEmail, customerPhone, cart } = req.body;

  // Validation
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
    const db = await readDb();

    // Capacity checking for each date in cart
    for (const item of cart) {
      const dateISO = item.date;
      const qty = parseInt(item.qty, 10);
      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({ error: 'Invalid quantity.' });
      }

      // Check current orders in database
      const dbOrdered = db.orders
        .filter(o => o.date === dateISO && o.status !== 'cancelled')
        .reduce((sum, o) => sum + o.quantity, 0);

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
    const now = new Date().toISOString();
    const newOrders = [];
    for (const item of cart) {
      const order = {
        id: crypto.randomUUID(),
        customerName: name,
        customerEmail: email,
        customerPhone: phone,
        flavor: item.flavorCategory,
        flavorName: item.flavorName,
        flavorEmoji: item.flavorEmoji,
        date: item.date,
        quantity: parseInt(item.qty, 10),
        status: 'pending',
        orderTimestamp: now
      };
      db.orders.push(order);
      newOrders.push(order);
    }

    await writeDb(db);
    res.json({ success: true, orders: newOrders });
  } catch (err) {
    console.error("Error placing order:", err);
    res.status(500).json({ error: 'Failed to place order.' });
  }
});

// Admin: Get all orders
app.get('/api/orders', requireAdmin, async (req, res) => {
  try {
    const db = await readDb();
    res.json(db.orders || []);
  } catch (err) {
    console.error("Error reading orders:", err);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

// Admin: Fulfill order
app.post('/api/orders/:id/fulfill', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const db = await readDb();
    const order = db.orders.find(o => o.id === id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    order.status = 'fulfilled';
    await writeDb(db);
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
    const db = await readDb();
    const order = db.orders.find(o => o.id === id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    order.status = 'cancelled';
    await writeDb(db);
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

    const db = await readDb();
    const before = db.orders.length;
    db.orders = db.orders.filter(o => o.date >= todayISO);
    const removed = before - db.orders.length;

    await writeDb(db);
    res.json({ success: true, removed });
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
    const db = await readDb();
    if (!db.flavors) db.flavors = [];

    const existingIdx = db.flavors.findIndex(o => o.category === category && o.startDate === startDate);
    const newOverride = {
      id: crypto.randomUUID(),
      category,
      startDate,
      emoji: emoji || (category === 'Sweet' ? '🍯' : '🌿'),
      name,
      description
    };

    if (existingIdx !== -1) {
      db.flavors[existingIdx] = newOverride;
    } else {
      db.flavors.push(newOverride);
    }

    await writeDb(db);
    res.json({ success: true, flavor: newOverride });
  } catch (err) {
    console.error("Error setting flavor override:", err);
    res.status(500).json({ error: 'Failed to set flavor override.' });
  }
});

// Admin: Delete flavor override
app.delete('/api/flavors/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const db = await readDb();
    if (!db.flavors) db.flavors = [];

    const before = db.flavors.length;
    db.flavors = db.flavors.filter(o => o.id !== id);
    const removed = before - db.flavors.length;

    if (removed === 0) {
      return res.status(404).json({ error: 'Override not found' });
    }

    await writeDb(db);
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
