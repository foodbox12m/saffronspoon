// server/index.js - Express webhook backend for Twilio WhatsApp integration
// Supabase ORM (service_role) used to persist orders.

const express = require('express');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config(); // Load .env file if exists

const app = express();
app.use(bodyParser.json());

// Supabase client with service_role key
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Menu URL from Vercel frontend
const MENU_URL = process.env.MENU_URL;

// Zelle payment details
const ZELLE_PHONE = process.env.ZELLE_PHONE;

app.post('/webhook', (req, res) => {
  const { body } = req; // Twilio sends JSON with Text property

  if (!body || !body.Text) {
    return res.status(400).send('No message text received');
  }

  const text = String(body.Text).trim();

  // If user asks for menu
  if (text.toLowerCase().includes('menu')) {
    return res.json({ success: true, message: `Here is your menu: ${MENU_URL}` });
  }

  // Order confirmation handling (simple trigger)
  if (/confirm order/i.test(text)) {
    const total = Math.random() * 50 + 1; // placeholder calculation
    const userMessage = text.replace(/Confirm Order|confirm order/i, '').trim();

    supabase.from('orders')
      .insert([
        {
          user: userMessage,
          total,
          timestamp: new Date().toISOString()
        }
      ])
      .then(() => {
        return res.json({
          success: true,
          message: `Order recorded. Payment via Zelle: ${ZELLE_PHONE}. Total $${total} sent to your phone.`
        });
      })
      .catch(err => console.error('Supabase error', err));

    // Simulate sending reply
    return res.json({
      success: true,
      message: `Your order total is $${total}. Please send this amount via Zelle to ${ZELLE_PHONE}`
    });
  }

  // Default fallback
  res.status(400).send('Unrecognized message');
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Webhook server running on port ${PORT}`));