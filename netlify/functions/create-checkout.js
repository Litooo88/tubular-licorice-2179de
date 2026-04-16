const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PRODUCTS = {
  // NAVEE
  'navee-ut5-ultra-x': { name: 'NAVEE UT5 Ultra X', price: 2349000 },
  'navee-xt5-ultra': { name: 'NAVEE XT5 Ultra', price: 1699000 },
  'navee-nt5-ultra-x': { name: 'NAVEE NT5 Ultra X', price: 1349000 },
  'navee-st3-pro': { name: 'NAVEE ST3 Pro SE', price: 1099000 },
  'navee-st3': { name: 'NAVEE ST3 SE', price: 899000 },
  'navee-n65i': { name: 'NAVEE N65i', price: 849900 },
  'navee-g5': { name: 'NAVEE G5', price: 549000 },
  'navee-v25i-pro-ii': { name: 'NAVEE V25i Pro II', price: 449000 },
  'navee-k100-max': { name: 'NAVEE K100 Max', price: 349900 },
  // TEVERUN
  'teverun-space-lite': { name: 'Teverun Space Lite', price: 1299000 },
  'teverun-blade-mini-ultra': { name: 'Teverun Blade Mini Ultra', price: 1799000 },
  'teverun-blade-gt-ii': { name: 'Teverun Blade GT II', price: 2499000 },
  'teverun-fighter-mini-pro-ekfv': { name: 'Teverun Fighter Mini Pro eKFV', price: 2799000 },
  'teverun-fighter-eleven-plus': { name: 'Teverun Fighter Eleven+', price: 3999000 },
  'teverun-supreme-7260r': { name: 'Teverun Supreme 7260R', price: 5499000 },
  // KUKIRIN
  'kukirin-s1-max': { name: 'KuKirin S1 Max', price: 499000 },
  'kukirin-g2': { name: 'KuKirin G2', price: 799000 },
  'kukirin-m4-max': { name: 'KuKirin M4 Max', price: 749000 },
  'kukirin-g4-special': { name: 'KuKirin G4 Special Edition', price: 995000 },
  'kukirin-g3': { name: 'KuKirin G3', price: 1049000 },
  'kukirin-g2-max': { name: 'KuKirin G2 Max', price: 1099000 },
  'kukirin-g3-pro': { name: 'KuKirin G3 Pro', price: 1899000 },
  'kukirin-g4-max': { name: 'KuKirin G4 Max', price: 2699000 },
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { productId } = JSON.parse(event.body);
    const product = PRODUCTS[productId];

    if (!product) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Ogiltig produkt' }) };
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'sek',
          product_data: {
            name: product.name,
            description: 'Elscooter — Nordic E-Mobility AB, Örebro',
          },
          unit_amount: product.price,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${event.headers.origin || 'https://www.nordicemobility.se'}/?purchase=success`,
      cancel_url: `${event.headers.origin || 'https://www.nordicemobility.se'}/#produkter`,
      shipping_address_collection: {
        allowed_countries: ['SE'],
      },
      phone_number_collection: { enabled: true },
      custom_text: {
        submit: { message: 'Nordic E-Mobility AB — Pistolvägen 6, 702 21 Örebro. Vi kontaktar dig om leverans.' },
      },
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error('Stripe error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Kunde inte skapa betalningssession. Försök igen.' }),
    };
  }
};
