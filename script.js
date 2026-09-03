/* saffron & spoon — landing page behaviour.
   Vanilla JS, no dependencies, no inline handlers (the page ships a strict CSP).
   All prices come from data-* attributes rendered from server/src/data/menu.json. */
(function () {
  'use strict';

  // Business WhatsApp number, international format, digits only.
  var WHATSAPP_NUMBER = '15103999156';
  var APP_URL = '/saffronspoon/app/';

  var drawer = document.querySelector('.order-drawer');
  var backdrop = document.querySelector('.drawer-backdrop');
  var itemList = document.querySelector('.order-items');
  var totalEl = document.querySelector('.order-total');
  var countEl = document.querySelector('.order-count');
  var paymentModal = document.querySelector('.payment-modal');
  var paymentTotal = document.querySelector('.payment-total');
  var confirmPayment = document.querySelector('.confirm-payment');
  var paymentComplete = document.querySelector('.payment-complete');
  var requestButton = document.querySelector('.request-button');

  var items = [];
  var paymentConfirmed = false;

  function formatDollars(value) {
    return '$' + (Number(value) % 1 === 0 ? String(Number(value)) : Number(value).toFixed(2));
  }

  function orderTotal() {
    return items.reduce(function (sum, item) { return sum + item.price; }, 0);
  }

  function waLink(message) {
    return 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(message);
  }

  function renderOrder() {
    itemList.textContent = '';
    if (!items.length) {
      var empty = document.createElement('p');
      empty.className = 'empty-order';
      empty.textContent = 'Your table is waiting. Add a tray to get started.';
      itemList.appendChild(empty);
    } else {
      items.forEach(function (item, index) {
        var row = document.createElement('div');
        row.className = 'order-item';

        var name = document.createElement('span');
        name.textContent = item.name;

        var price = document.createElement('strong');
        price.textContent = formatDollars(item.price);

        var remove = document.createElement('button');
        remove.type = 'button';
        remove.setAttribute('data-remove', String(index));
        remove.setAttribute('aria-label', 'Remove ' + item.name);
        remove.textContent = '\u00d7';

        row.appendChild(name);
        row.appendChild(price);
        row.appendChild(remove);
        itemList.appendChild(row);
      });
    }

    var total = formatDollars(orderTotal());
    if (totalEl) totalEl.textContent = total;
    if (countEl) countEl.textContent = String(items.length);
    if (paymentTotal) paymentTotal.textContent = total;
    if (requestButton) {
      requestButton.disabled = !paymentConfirmed || !items.length;
      requestButton.textContent = paymentConfirmed
        ? 'Send order details on WhatsApp'
        : 'Pay with Zelle first';
    }
  }

  /* ---------- drawer ---------- */
  function openDrawer() {
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    backdrop.classList.add('visible');
    var closeBtn = drawer.querySelector('.close-drawer');
    if (closeBtn) closeBtn.focus();
  }

  function closeDrawer() {
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    backdrop.classList.remove('visible');
  }

  function openPayment() {
    if (paymentTotal && totalEl) paymentTotal.textContent = totalEl.textContent;
    paymentModal.classList.add('open');
    paymentModal.setAttribute('aria-hidden', 'false');
    var closeBtn = paymentModal.querySelector('.payment-close');
    if (closeBtn) closeBtn.focus();
  }

  function closePayment() {
    paymentModal.classList.remove('open');
    paymentModal.setAttribute('aria-hidden', 'true');
  }

  document.querySelectorAll('[data-open-order]').forEach(function (button) {
    button.addEventListener('click', openDrawer);
  });
  document.querySelectorAll('[data-close-order]').forEach(function (button) {
    button.addEventListener('click', closeDrawer);
  });
  document.querySelectorAll('[data-open-payment]').forEach(function (button) {
    button.addEventListener('click', openPayment);
  });
  document.querySelectorAll('[data-close-payment]').forEach(function (button) {
    button.addEventListener('click', closePayment);
  });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    if (paymentModal.classList.contains('open')) closePayment();
    else if (drawer.classList.contains('open')) closeDrawer();
  });

  /* ---------- add to order ---------- */
  document.querySelectorAll('.add-button').forEach(function (button) {
    button.addEventListener('click', function () {
      var action = button.closest('.tray-action');
      var select = action ? action.querySelector('.tray-select') : null;
      var size = select ? select.value : 'full';

      if (select && !size) {
        select.focus();
        select.setAttribute('aria-invalid', 'true');
        return;
      }
      if (select) select.removeAttribute('aria-invalid');

      var price = Number(button.getAttribute('data-' + size));
      if (!isFinite(price) || price <= 0) return;

      items.push({
        name: button.getAttribute('data-name') + ' (' + size + ' tray)',
        price: price
      });
      renderOrder();
      openDrawer();
    });
  });

  itemList.addEventListener('click', function (event) {
    var target = event.target;
    if (!(target instanceof HTMLElement)) return;
    var index = target.getAttribute('data-remove');
    if (index === null) return;
    items.splice(Number(index), 1);
    renderOrder();
  });

  /* ---------- payment ---------- */
  if (confirmPayment) {
    confirmPayment.addEventListener('click', function () {
      paymentConfirmed = true;
      confirmPayment.hidden = true;
      if (paymentComplete) paymentComplete.hidden = false;
      renderOrder();
    });
  }

  if (requestButton) {
    requestButton.addEventListener('click', function () {
      if (!paymentConfirmed || !items.length) return;
      var lines = items.map(function (item) {
        return '\u2022 ' + item.name + ' \u2014 ' + formatDollars(item.price);
      });
      var message =
        'Hi saffron & spoon! I have sent payment for this order:\n\n' +
        lines.join('\n') +
        '\n\nOrder total: ' + formatDollars(orderTotal());
      window.open(waLink(message), '_blank', 'noopener');
    });
  }

  /* ---------- WhatsApp order generator ---------- */
  var waForm = document.getElementById('whatsapp-form');
  if (waForm) {
    var guests = document.getElementById('wa-guests');
    var date = document.getElementById('wa-date');
    var notes = document.getElementById('wa-notes');
    var preview = document.getElementById('wa-preview');
    var link = document.getElementById('wa-link');

    var buildMessage = function () {
      var parts = ['Hi saffron & spoon! I would like a catering quote.'];
      var guestValue = guests && guests.value ? Number(guests.value) : 0;
      if (guestValue > 0) parts.push('Guests: ' + guestValue);
      if (date && date.value) parts.push('Event date: ' + date.value);
      if (notes && notes.value.trim()) parts.push('Notes: ' + notes.value.trim());
      if (items.length) {
        parts.push('Trays I have picked: ' + items.map(function (item) { return item.name; }).join(', '));
      }
      parts.push('Could you confirm availability and the tray plan?');
      return parts.join('\n');
    };

    var syncWhatsApp = function () {
      var message = buildMessage();
      if (preview) preview.textContent = message;
      if (link) link.setAttribute('href', waLink(message));
    };

    waForm.addEventListener('submit', function (event) { event.preventDefault(); syncWhatsApp(); });
    waForm.addEventListener('input', syncWhatsApp);
    syncWhatsApp();
  }

  /* ---------- mobile nav ---------- */
  var toggle = document.querySelector('.menu-toggle');
  var nav = document.querySelector('.main-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      toggle.setAttribute('aria-label', open ? 'Open navigation' : 'Close navigation');
      nav.classList.toggle('show');
    });
  }

  // Keep the "open the app" links honest even if the page is served from a subpath.
  document.querySelectorAll('a[href="' + APP_URL + '"]').forEach(function (anchor) {
    anchor.setAttribute('href', APP_URL);
  });

  renderOrder();
})();
