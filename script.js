const drawer = document.querySelector('.order-drawer');
const backdrop = document.querySelector('.drawer-backdrop');
const items = [];
const itemList = document.querySelector('.order-items');
const total = document.querySelector('.order-total');
const count = document.querySelector('.order-count');
const paymentModal = document.querySelector('.payment-modal');
const paymentTotal = document.querySelector('.payment-total');
const requestButton = document.querySelector('.request-button');
const confirmPayment = document.querySelector('.confirm-payment');
const paymentComplete = document.querySelector('.payment-complete');
let paymentConfirmed = false;

const renderOrder = () => {
  itemList.textContent = '';
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-order';
    empty.textContent = 'Your table is waiting. Add a dish to get started.';
    itemList.append(empty);
  } else {
    items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'order-item';
      row.innerHTML = `<span>${item.name}</span><strong>$${item.price}</strong><button type="button" data-remove="${index}" aria-label="Remove ${item.name}">&times;</button>`;
      itemList.append(row);
    });
  }
  total.textContent = `$${items.reduce((sum, item) => sum + item.price, 0)}`;
  count.textContent = items.length;
  paymentTotal.textContent = total.textContent;
  requestButton.disabled = !paymentConfirmed || !items.length;
  requestButton.textContent = paymentConfirmed ? 'Send order request' : 'Pay with Zelle first';
};

const openDrawer = () => {
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  backdrop.classList.add('visible');
};

const closeDrawer = () => {
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  backdrop.classList.remove('visible');
};

const openPayment = () => {
  paymentTotal.textContent = total.textContent;
  paymentModal.classList.add('open');
  paymentModal.setAttribute('aria-hidden', 'false');
};

const closePayment = () => {
  paymentModal.classList.remove('open');
  paymentModal.setAttribute('aria-hidden', 'true');
};

document.querySelectorAll('[data-open-order]').forEach(button => button.addEventListener('click', openDrawer));
document.querySelectorAll('[data-open-payment]').forEach(button => button.addEventListener('click', openPayment));
document.querySelectorAll('[data-close-payment]').forEach(button => button.addEventListener('click', closePayment));
confirmPayment.addEventListener('click', () => {
  paymentConfirmed = true;
  confirmPayment.hidden = true;
  paymentComplete.hidden = false;
  renderOrder();
});
requestButton.addEventListener('click', () => {
  if (!paymentConfirmed || !items.length) return;
  const orderSummary = items.map(item => `${item.name} - $${item.price}`).join(', ');
  window.location.href = `mailto:hello@saffronandstone.com?subject=New%20order%20request&body=${encodeURIComponent(orderSummary)}`;
});
document.querySelectorAll('[data-close-order]').forEach(button => button.addEventListener('click', closeDrawer));
document.querySelectorAll('.add-button').forEach(button => button.addEventListener('click', () => {
  const selector = button.closest('.tray-action')?.querySelector('.tray-select');
  const size = selector ? selector.value : '';
  const price = selector ? Number(button.dataset[size]) : Number(button.dataset.price);
  const name = selector ? `${button.dataset.name} (${size} tray)` : button.dataset.name;
  items.push({ name, price });
  renderOrder();
  openDrawer();
  openPayment();
}));
itemList.addEventListener('click', event => {
  if (event.target.dataset.remove !== undefined) {
    items.splice(Number(event.target.dataset.remove), 1);
    renderOrder();
  }
});
document.querySelectorAll('.filter').forEach(filter => filter.addEventListener('click', () => {
  document.querySelector('.filter.active').classList.remove('active');
  filter.classList.add('active');
  document.querySelectorAll('.dish-card').forEach(card => {
    card.hidden = filter.dataset.filter !== 'all' && card.dataset.category !== filter.dataset.filter;
  });
}));
const toggle = document.querySelector('.menu-toggle');
toggle.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') === 'true';
  toggle.setAttribute('aria-expanded', String(!open));
  document.querySelector('.main-nav').classList.toggle('show');
});