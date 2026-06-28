/* ═══════════════════════════════════════════
   Karen's Kitchen — Artisan Sourdough  ·  app.js
   ═══════════════════════════════════════════ */

(() => {
  'use strict';

  /* ── Constants ── */
  const BACKEND_URL_PREFIX = '__BACKEND_URL_PREFIX__'.startsWith('__') ? '' : '__BACKEND_URL_PREFIX__';
  const PRICE = 15;
  const DAILY_CAPACITY = 2;
  const LEAD_DAYS = 2;
  const WINDOW_DAYS = 14;
  const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const DEFAULT_FLAVORS = {
    Sweet: {
      name: "Sweet",
      desc: "Brown sugar & cinnamon swirl",
      emoji: "🍯"
    },
    Savory: {
      name: "Savory",
      desc: "Rosemary, garlic & sea salt",
      emoji: "🌿"
    }
  };

  /* ── State ── */
  let cart = [];       // { id, date, flavorCategory, flavorName, flavorEmoji, qty }
  let selectedDate = null;
  let selectedFlavor = null;    // "Sweet" or "Savory"
  let selectedQty = 1;
  let isAdmin = false;
  let availability = {};       // { [dateISO]: count }
  let flavorOverrides = [];     // [ flavor override objects ]

  /* ── DOM refs ── */
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const calendarGrid = $('#calendarGrid');
  const flavorSelector = $('#flavorSelector');
  const selectedDayLbl = $('#selectedDayLabel');
  const flavorSweet = $('#flavorSweet');
  const flavorSavory = $('#flavorSavory');
  const qtyValue = $('#qtyValue');
  const qtyMinus = $('#qtyMinus');
  const qtyPlus = $('#qtyPlus');
  const qtyNote = $('#qtyNote');
  const qtyRow = $('#qtyRow');
  const btnAdd = $('#btnAddToOrder');
  const orderSummary = $('#orderSummary');
  const orderItemsList = $('#orderItems');
  const orderTotal = $('#orderTotal');
  const custName = $('#custName');
  const custEmail = $('#custEmail');
  const custPhone = $('#custPhone');
  const btnPlace = $('#btnPlaceOrder');
  const btnClear = $('#btnClearOrder');
  const successOverlay = $('#successOverlay');
  const successDetail = $('#successDetail');
  const btnSuccessClose = $('#btnSuccessClose');
  const customerView = $('#customerView');
  const adminView = $('#adminView');
  const adminContent = $('#adminContent');
  const btnToggle = $('#btnToggleView');
  const btnCleanOld = $('#btnCleanOld');
  const toastContainer = $('#toastContainer');

  // Admin Auth DOM refs
  const adminAuthOverlay = $('#adminAuthOverlay');
  const adminPasswordInput = $('#adminPasswordInput');
  const btnCancelAdminAuth = $('#btnCancelAdminAuth');
  const btnSubmitAdminAuth = $('#btnSubmitAdminAuth');

  // Flavor Override DOM refs
  const flavorOverrideForm = $('#flavorOverrideForm');
  const flavorCategory = $('#flavorCategory');
  const flavorStartDate = $('#flavorStartDate');
  const flavorEmoji = $('#flavorEmoji');
  const flavorName = $('#flavorName');
  const flavorDesc = $('#flavorDesc');
  const activeFlavorsList = $('#activeFlavorsList');

  /* ══════════════════════════════════════════
     UTILITIES
     ══════════════════════════════════════════ */

  /** Fetch flavor overrides from the backend */
  async function fetchFlavors() {
    try {
      const res = await fetch(`${BACKEND_URL_PREFIX}/api/flavors`);
      flavorOverrides = await res.json();
    } catch (err) {
      console.error("Failed to fetch flavors", err);
    }
  }

  /** Fetch active order availability mapping from the backend */
  async function fetchAvailability() {
    try {
      const res = await fetch(`${BACKEND_URL_PREFIX}/api/availability`);
      availability = await res.json();
    } catch (err) {
      console.error("Failed to fetch availability", err);
      toast("Could not load bread availability. Please refresh.", "error");
    }
  }

  /** Resolves the flavor details for a specific category on a specific date */
  function getFlavorForDate(category, dateISO) {
    // Filter overrides matching category where startDate <= dateISO
    const matches = flavorOverrides.filter(o => o.category === category && o.startDate <= dateISO);
    if (matches.length > 0) {
      // Sort descending by startDate to get the latest active override
      matches.sort((a, b) => b.startDate.localeCompare(a.startDate));
      return {
        name: matches[0].name,
        desc: matches[0].description,
        emoji: matches[0].emoji
      };
    }
    return DEFAULT_FLAVORS[category];
  }

  /** Return local YYYY-MM-DD string for a Date object */
  function toLocalISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** Parse a YYYY-MM-DD string into a local Date at midnight */
  function parseLocalDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  /** Pretty format: "Sat, Jun 20" */
  function prettyDate(iso) {
    const d = parseLocalDate(iso);
    return `${DAY_NAMES_SHORT[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
  }

  /** Generate a unique ID */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** Count active (non-cancelled) loaves for a given date ISO string */
  function countLoavesForDate(dateISO) {
    const orderedCount = availability[dateISO] || 0;
    // Also count loaves in the current cart
    let cartCount = 0;
    for (const c of cart) {
      if (c.date === dateISO) {
        cartCount += c.qty;
      }
    }
    return orderedCount + cartCount;
  }

  /** Remaining capacity (excluding cart, for display on calendar) */
  function remainingCapacity(dateISO, excludeCart = false) {
    const orderedCount = availability[dateISO] || 0;
    let cartCount = 0;
    if (!excludeCart) {
      for (const c of cart) {
        if (c.date === dateISO) {
          cartCount += c.qty;
        }
      }
    }
    return DAILY_CAPACITY - (orderedCount + cartCount);
  }

  /* ── Toast notification ── */
  function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => {
      el.classList.add('removing');
      setTimeout(() => el.remove(), 300);
    }, 2800);
  }

  /* ══════════════════════════════════════════
     CALENDAR
     ══════════════════════════════════════════ */

  function getAvailableDates() {
    const dates = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = LEAD_DAYS; i < LEAD_DAYS + WINDOW_DAYS; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      dates.push(toLocalISO(d));
    }
    return dates;
  }

  function renderCalendar() {
    calendarGrid.innerHTML = '';
    const dates = getAvailableDates();
    dates.forEach((iso) => {
      const d = parseLocalDate(iso);
      const remaining = remainingCapacity(iso);
      const used = DAILY_CAPACITY - remaining;

      let statusClass, statusText;
      if (remaining <= 0) { statusClass = 'status-full'; statusText = 'Sold Out'; }
      else if (remaining === 1) { statusClass = 'status-limited'; statusText = `${remaining} left`; }
      else { statusClass = 'status-available'; statusText = `${remaining} left`; }

      const card = document.createElement('div');
      card.className = `day-card ${statusClass}${selectedDate === iso ? ' selected' : ''}`;
      card.dataset.date = iso;
      card.innerHTML = `
        <div class="day-name">${DAY_NAMES_SHORT[d.getDay()]}</div>
        <div class="day-date">${d.getDate()}</div>
        <div class="day-month">${MONTH_NAMES[d.getMonth()]}</div>
        <div class="avail-bar"><div class="avail-fill" style="width:${(used / DAILY_CAPACITY) * 100}%"></div></div>
        <div class="avail-text">${statusText}</div>
      `;
      if (remaining > 0) {
        card.addEventListener('click', () => selectDay(iso));
      }
      calendarGrid.appendChild(card);
    });
  }

  function selectDay(iso) {
    selectedDate = iso;
    selectedFlavor = null;
    selectedQty = 1;
    // UI
    flavorSweet.classList.remove('active');
    flavorSavory.classList.remove('active');
    qtyValue.textContent = '1';
    updateQtyBounds();

    // Dynamically update card content based on resolved flavor for that date
    const sweetInfo = getFlavorForDate('Sweet', iso);
    flavorSweet.querySelector('.flavor-emoji').textContent = sweetInfo.emoji;
    flavorSweet.querySelector('.flavor-name').textContent = sweetInfo.name;
    flavorSweet.querySelector('.flavor-desc').textContent = sweetInfo.desc;

    const savoryInfo = getFlavorForDate('Savory', iso);
    flavorSavory.querySelector('.flavor-emoji').textContent = savoryInfo.emoji;
    flavorSavory.querySelector('.flavor-name').textContent = savoryInfo.name;
    flavorSavory.querySelector('.flavor-desc').textContent = savoryInfo.desc;

    selectedDayLbl.textContent = prettyDate(iso);
    flavorSelector.classList.remove('hidden');
    // Re-trigger animation
    flavorSelector.style.animation = 'none';
    // force reflow
    void flavorSelector.offsetHeight;
    flavorSelector.style.animation = '';
    renderCalendar();
    flavorSelector.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ══════════════════════════════════════════
     FLAVOR + QUANTITY
     ══════════════════════════════════════════ */

  function chooseFlavor(flavor) {
    selectedFlavor = flavor;
    flavorSweet.classList.toggle('active', flavor === 'Sweet');
    flavorSavory.classList.toggle('active', flavor === 'Savory');
    updateQtyBounds();
  }

  function updateQtyBounds() {
    if (!selectedDate) return;
    const rem = remainingCapacity(selectedDate);
    const maxQty = Math.max(0, Math.min(rem, DAILY_CAPACITY));
    qtyNote.textContent = `(${rem} available)`;
    qtyMinus.disabled = selectedQty <= 1;
    qtyPlus.disabled = selectedQty >= maxQty;
    if (selectedQty > maxQty) {
      selectedQty = Math.max(1, maxQty);
      qtyValue.textContent = selectedQty;
    }
  }

  flavorSweet.addEventListener('click', () => chooseFlavor('Sweet'));
  flavorSavory.addEventListener('click', () => chooseFlavor('Savory'));

  qtyMinus.addEventListener('click', () => {
    if (selectedQty > 1) {
      selectedQty--;
      qtyValue.textContent = selectedQty;
      updateQtyBounds();
    }
  });
  qtyPlus.addEventListener('click', () => {
    const rem = remainingCapacity(selectedDate);
    if (selectedQty < Math.min(rem, DAILY_CAPACITY)) {
      selectedQty++;
      qtyValue.textContent = selectedQty;
      updateQtyBounds();
    }
  });

  /* ══════════════════════════════════════════
     CART
     ══════════════════════════════════════════ */

  btnAdd.addEventListener('click', () => {
    if (!selectedDate) return toast('Please select a day.', 'error');
    if (!selectedFlavor) return toast('Please choose a flavor.', 'error');
    const rem = remainingCapacity(selectedDate);
    if (selectedQty > rem || rem <= 0) return toast('Not enough availability.', 'error');

    // Check if same date+flavor category already in cart → merge
    const existing = cart.find(c => c.date === selectedDate && c.flavorCategory === selectedFlavor);
    if (existing) {
      existing.qty += selectedQty;
    } else {
      const flavorInfo = getFlavorForDate(selectedFlavor, selectedDate);
      cart.push({
        id: uid(),
        date: selectedDate,
        flavorCategory: selectedFlavor,
        flavorName: flavorInfo.name,
        flavorEmoji: flavorInfo.emoji,
        qty: selectedQty
      });
    }

    const resolvedFlavor = getFlavorForDate(selectedFlavor, selectedDate);
    toast(`Added ${selectedQty}× ${resolvedFlavor.name} for ${prettyDate(selectedDate)}`, 'success');

    // Reset selector
    selectedFlavor = null;
    selectedQty = 1;
    flavorSweet.classList.remove('active');
    flavorSavory.classList.remove('active');
    qtyValue.textContent = '1';
    flavorSelector.classList.add('hidden');
    selectedDate = null;
    renderCalendar();
    renderCart();
  });

  btnClear.addEventListener('click', () => {
    cart = [];
    renderCart();
    renderCalendar();
    flavorSelector.classList.add('hidden');
    selectedDate = null;
  });

  function renderCart() {
    if (cart.length === 0) {
      orderSummary.classList.add('hidden');
      return;
    }
    orderSummary.classList.remove('hidden');
    orderItemsList.innerHTML = '';
    let total = 0;
    cart.forEach((item, idx) => {
      const sub = item.qty * PRICE;
      total += sub;
      const li = document.createElement('li');
      li.className = 'order-item';
      li.innerHTML = `
        <div class="order-item-info">
          <span class="item-label">${item.flavorEmoji} ${item.flavorName} × ${item.qty}</span>
          <span class="item-sub">${prettyDate(item.date)}</span>
        </div>
        <div class="order-item-right">
          <span class="order-item-price">$${sub}</span>
          <button class="item-remove" data-idx="${idx}" title="Remove">✕</button>
        </div>
      `;
      orderItemsList.appendChild(li);
    });
    // remove buttons
    orderItemsList.querySelectorAll('.item-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        cart.splice(Number(btn.dataset.idx), 1);
        renderCart();
        renderCalendar();
      });
    });
    orderTotal.textContent = `$${total}`;
  }

  /* ══════════════════════════════════════════
     PLACE ORDER
     ══════════════════════════════════════════ */

  btnPlace.addEventListener('click', async () => {
    // Validate
    const name = custName.value.trim();
    const email = custEmail.value.trim();
    const phone = custPhone.value.trim();
    let valid = true;

    custName.classList.remove('error');
    custEmail.classList.remove('error');
    custPhone.classList.remove('error');

    if (!name) { custName.classList.add('error'); valid = false; }

    // Either phone number or email is required. At least one must be filled out.
    if (!email && !phone) {
      custEmail.classList.add('error');
      custPhone.classList.add('error');
      valid = false;
      toast('Please provide either an email or phone number.', 'error');
      return;
    } else {
      if (email && !email.includes('@')) { custEmail.classList.add('error'); valid = false; }
      if (phone && phone.replace(/\D/g, '').length < 7) { custPhone.classList.add('error'); valid = false; }
    }

    if (cart.length === 0) { toast('Your cart is empty.', 'error'); return; }
    if (!valid) { toast('Please fill in your details correctly.', 'error'); return; }

    btnPlace.disabled = true;

    // Send order to backend API
    try {
      const res = await fetch(`${BACKEND_URL_PREFIX}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: name,
          customerEmail: email,
          customerPhone: phone,
          cart: cart.map(c => ({
            date: c.date,
            flavorCategory: c.flavorCategory,
            flavorName: c.flavorName,
            flavorEmoji: c.flavorEmoji,
            qty: c.qty
          }))
        })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to place order.');
      }

      const totalLoaves = cart.reduce((s, c) => s + c.qty, 0);

      // Show success
      successDetail.textContent = `${totalLoaves} loaf${totalLoaves > 1 ? 'es' : ''} · $${totalLoaves * PRICE}`;
      successOverlay.classList.remove('hidden');

      // Reset
      cart = [];
      custName.value = '';
      custEmail.value = '';
      custPhone.value = '';
      renderCart();
      await fetchAvailability();
      renderCalendar();
      flavorSelector.classList.add('hidden');
      selectedDate = null;
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btnPlace.disabled = false;
    }
  });

  btnSuccessClose.addEventListener('click', () => {
    successOverlay.classList.add('hidden');
  });

  /* ══════════════════════════════════════════
     ADMIN VIEW
     ══════════════════════════════════════════ */

  // Handle Admin Access Button click
  btnToggle.addEventListener('click', async () => {
    if (!isAdmin) {
      // Prompt for password if not authenticated in session
      if (sessionStorage.getItem('karenskitchen_admin_token')) {
        await enterAdminView();
      } else {
        showAdminAuthModal();
      }
    } else {
      // Exit admin view directly
      exitAdminView();
    }
  });

  function showAdminAuthModal() {
    adminPasswordInput.value = '';
    adminPasswordInput.classList.remove('error');
    adminAuthOverlay.classList.remove('hidden');
    adminPasswordInput.focus();
  }

  function hideAdminAuthModal() {
    adminAuthOverlay.classList.add('hidden');
    adminPasswordInput.value = '';
  }

  async function enterAdminView() {
    isAdmin = true;
    customerView.classList.remove('active');
    adminView.classList.add('active');
    btnToggle.textContent = '← Back to Ordering';
    await renderAdmin();
    renderFlavorOverrides();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function exitAdminView() {
    isAdmin = false;
    customerView.classList.add('active');
    adminView.classList.remove('active');
    btnToggle.textContent = 'Admin Access';
    renderCalendar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Cancel Admin Auth
  btnCancelAdminAuth.addEventListener('click', hideAdminAuthModal);

  // Submit Admin Auth
  async function submitAdminAuth() {
    const pw = adminPasswordInput.value;
    try {
      const res = await fetch(`${BACKEND_URL_PREFIX}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw })
      });
      if (!res.ok) {
        throw new Error('Incorrect password. Please try again.');
      }
      const data = await res.json();
      sessionStorage.setItem('karenskitchen_admin_token', data.token);
      hideAdminAuthModal();
      await enterAdminView();
      toast('Welcome back, Karen!', 'success');
    } catch (err) {
      adminPasswordInput.classList.add('error');
      toast(err.message, 'error');
      adminPasswordInput.focus();
      adminPasswordInput.select();

      // Remove error outline class on type/change
      adminPasswordInput.addEventListener('input', function onInput() {
        adminPasswordInput.classList.remove('error');
        adminPasswordInput.removeEventListener('input', onInput);
      });
    }
  }

  btnSubmitAdminAuth.addEventListener('click', submitAdminAuth);

  adminPasswordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      submitAdminAuth();
    }
  });

  async function renderAdmin() {
    const token = sessionStorage.getItem('karenskitchen_admin_token');
    if (!token) return;

    let orders = [];
    try {
      const res = await fetch(`${BACKEND_URL_PREFIX}/api/orders`, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (res.status === 401 || res.status === 403) {
        toast("Session expired or unauthorized. Please log in again.", "error");
        exitAdminView();
        return;
      }
      orders = await res.json();
    } catch (err) {
      console.error("Error fetching orders:", err);
      toast("Failed to load orders.", "error");
      return;
    }

    // Group by date
    const grouped = {};
    for (const o of orders) {
      if (!grouped[o.date]) grouped[o.date] = [];
      grouped[o.date].push(o);
    }

    // Sort dates
    const sortedDates = Object.keys(grouped).sort();

    if (sortedDates.length === 0) {
      adminContent.innerHTML = `
        <div class="admin-empty">
          <span>🍞</span>
          No orders yet. Time to spread the word!
        </div>`;
      renderFlavorOverrides();
      return;
    }

    let html = '';
    sortedDates.forEach((dateISO, di) => {
      const dayOrders = grouped[dateISO];
      const activeOrders = dayOrders.filter(o => o.status !== 'cancelled');
      const used = activeOrders.reduce((s, o) => s + o.quantity, 0);
      const remaining = DAILY_CAPACITY - used;
      let color;
      if (remaining <= 0) color = 'red';
      else if (remaining === 1) color = 'yellow';
      else color = 'green';

      html += `
        <div class="admin-day-card" style="animation-delay:${di * .08}s">
          <div class="admin-day-header">
            <div class="adh-left">
              <div class="adh-dot ${color}"></div>
              <span class="adh-date">${prettyDate(dateISO)}</span>
            </div>
            <span class="adh-capacity ${color}">${used} / ${DAILY_CAPACITY} loaves</span>
          </div>
          <div class="admin-orders">`;

      dayOrders.forEach(o => {
        const orderTime = new Date(o.orderTimestamp);
        const timeStr = orderTime.toLocaleString('en-US', {
          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
        });

        const statusClass = o.status;
        const showActions = o.status === 'pending';

        html += `
            <div class="admin-order-row" data-id="${o.id}">
              <div class="aor-info">
                <div class="aor-name">${escapeHtml(o.customerName)}</div>
                <div class="aor-email">
                  ${o.customerEmail ? escapeHtml(o.customerEmail) : ''}
                  ${o.customerEmail && o.customerPhone ? ' · ' : ''}
                  ${o.customerPhone ? escapeHtml(o.customerPhone) : ''}
                </div>
              </div>
              <div class="aor-meta">
                <span class="aor-flavor">${o.flavorEmoji || (o.flavor === 'Sweet' ? '🍯' : '🌿')} ${o.flavorName || o.flavor}</span>
                <span class="aor-qty">× ${o.quantity}</span>
                <span class="aor-time">📅 ${timeStr}</span>
                <span class="aor-status ${statusClass}">${o.status}</span>
              </div>
              <div class="aor-actions">
                ${showActions ? `
                  <button class="btn-fulfill" data-id="${o.id}">✓ Fulfill</button>
                  <button class="btn-cancel-order" data-id="${o.id}">✕ Cancel</button>
                ` : ''}
              </div>
            </div>`;
      });

      html += `</div></div>`;
    });

    adminContent.innerHTML = html;

    // Attach action listeners
    adminContent.querySelectorAll('.btn-fulfill').forEach(btn => {
      btn.addEventListener('click', () => fulfillOrder(btn.dataset.id));
    });
    adminContent.querySelectorAll('.btn-cancel-order').forEach(btn => {
      btn.addEventListener('click', () => cancelOrder(btn.dataset.id));
    });

    // Render overrides in case it was triggered from here
    renderFlavorOverrides();
  }

  async function fulfillOrder(id) {
    const token = sessionStorage.getItem('karenskitchen_admin_token');
    try {
      const res = await fetch(`${BACKEND_URL_PREFIX}/api/orders/${id}/fulfill`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!res.ok) throw new Error('Failed to fulfill order.');
      toast(`Order fulfilled.`, 'success');
      await renderAdmin();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function cancelOrder(id) {
    if (!confirm("Cancel this order? The customer's loaf slot will be freed up.")) return;
    const token = sessionStorage.getItem('karenskitchen_admin_token');
    try {
      const res = await fetch(`${BACKEND_URL_PREFIX}/api/orders/${id}/cancel`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!res.ok) throw new Error('Failed to cancel order.');
      toast(`Order cancelled.`, 'info');
      await fetchAvailability();
      await renderAdmin();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ── Clean old orders ── */
  btnCleanOld.addEventListener('click', async () => {
    const token = sessionStorage.getItem('karenskitchen_admin_token');
    try {
      const res = await fetch(`${BACKEND_URL_PREFIX}/api/orders/clean`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!res.ok) throw new Error('Failed to clean old orders.');
      const result = await res.json();
      toast(`Cleaned ${result.removed} past orders.`, 'info');
      await fetchAvailability();
      await renderAdmin();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  /* ══════════════════════════════════════════
     FLAVOR OVERRIDES MANAGEMENT
     ══════════════════════════════════════════ */

  function renderFlavorOverrides() {
    // Sort overrides by date
    flavorOverrides.sort((a, b) => a.startDate.localeCompare(b.startDate));

    if (flavorOverrides.length === 0) {
      activeFlavorsList.innerHTML = `<li class="override-item" style="color: var(--charcoal-mid); font-size: 0.82rem; justify-content: center;">No active overrides. Default flavors apply.</li>`;
      return;
    }

    activeFlavorsList.innerHTML = flavorOverrides.map(o => `
      <li class="override-item">
        <div class="override-item-info">
          <div class="override-item-title">
            <span>${o.emoji}</span>
            <strong>${escapeHtml(o.name)}</strong>
            <span class="pill" style="padding: 0.15rem 0.4rem; font-size: 0.65rem; margin-left: 0.25rem;">${o.category}</span>
          </div>
          <div class="override-item-desc">${escapeHtml(o.description)}</div>
          <div class="override-item-date">Starts: ${prettyDate(o.startDate)}</div>
        </div>
        <button class="btn-delete-override" data-id="${o.id}" title="Remove override">✕</button>
      </li>
    `).join('');

    activeFlavorsList.querySelectorAll('.btn-delete-override').forEach(btn => {
      btn.addEventListener('click', () => {
        deleteFlavorOverride(btn.dataset.id);
      });
    });
  }

  async function deleteFlavorOverride(id) {
    if (!confirm("Are you sure you want to remove this flavor override? Subsequent orders on or after its start date will revert to defaults or the next matching override rule.")) return;
    const token = sessionStorage.getItem('karenskitchen_admin_token');
    try {
      const res = await fetch(`${BACKEND_URL_PREFIX}/api/flavors/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!res.ok) throw new Error('Failed to delete flavor override.');
      toast("Flavor override removed.", "info");
      await fetchFlavors();
      renderFlavorOverrides();
      await fetchAvailability();
      renderCalendar();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  flavorOverrideForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const category = flavorCategory.value;
    const startDate = flavorStartDate.value;
    const emoji = flavorEmoji.value.trim() || (category === 'Sweet' ? '🍯' : '🌿');
    const name = flavorName.value.trim();
    const desc = flavorDesc.value.trim();

    if (!startDate) return toast("Please select a starting date.", "error");
    if (!name || !desc) return toast("Please fill in flavor details.", "error");

    const token = sessionStorage.getItem('karenskitchen_admin_token');
    try {
      const res = await fetch(`${BACKEND_URL_PREFIX}/api/flavors`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ category, startDate, emoji, name, description: desc })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to set flavor override.');
      }

      toast(`Override set: ${name} starting ${prettyDate(startDate)}`, "success");

      // Reset form fields
      flavorEmoji.value = '';
      flavorName.value = '';
      flavorDesc.value = '';

      await fetchFlavors();
      renderFlavorOverrides();
      await fetchAvailability();
      renderCalendar();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  /* ══════════════════════════════════════════
     VIEW TOGGLE
     ══════════════════════════════════════════ */
  // Remove focus outline on click, keep for keyboard
  document.addEventListener('mousedown', () => document.body.classList.add('using-mouse'));
  document.addEventListener('keydown', () => document.body.classList.remove('using-mouse'));

  /* ══════════════════════════════════════════
     INIT
     ══════════════════════════════════════════ */
  // Setup date picker min limit
  const minDate = new Date();
  minDate.setDate(minDate.getDate() + LEAD_DAYS);
  flavorStartDate.min = toLocalISO(minDate);
  flavorStartDate.value = toLocalISO(minDate);

  (async () => {
    await fetchAvailability();
    await fetchFlavors();
    renderCalendar();
  })();
})();
