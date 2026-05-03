// Netlify Function: tworzy sesję Stripe Checkout dla rejestracji.
// Wywoływana przez Astro form action="/.netlify/functions/checkout" (alternatywnie /api/checkout via _redirects).
//
// Status: STUB / TODO. Włączyć po:
// 1. Utworzeniu konta Stripe (Test mode)
// 2. Skonfigurowaniu produktów i cen w Stripe Dashboard:
//    - Standard Early: €490, Standard Regular: €590
//    - Business Early: €720, Business Regular: €820
// 3. Wprowadzeniu do Netlify env vars: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
// 4. npm install stripe
//
// Po aktywacji: zmień RegistrationForm.astro action z "/registration?sent=1" na "/.netlify/functions/checkout"

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_KEY) {
    return {
      statusCode: 503,
      body: JSON.stringify({
        error: 'Stripe not configured yet. Form submitted via Netlify Forms instead.',
      }),
    };
  }

  // TODO: po włączeniu Stripe odkomentować
  // const Stripe = require('stripe');
  // const stripe = new Stripe(STRIPE_KEY);
  //
  // const params = new URLSearchParams(event.body);
  // const pkg = params.get('package'); // standard | business | premium
  // const locale = params.get('locale') || 'en';
  // const email = params.get('email');
  //
  // const PRICE_MAP = {
  //   standard: 'price_xxx_standard',
  //   business: 'price_xxx_business',
  //   // premium: brak price → email do organizatora
  // };
  //
  // if (pkg === 'premium' || !PRICE_MAP[pkg]) {
  //   // Fallback do Netlify Forms (premium = cena na zapytanie)
  //   return { statusCode: 302, headers: { Location: `/${locale}/registration?sent=1` }, body: '' };
  // }
  //
  // const session = await stripe.checkout.sessions.create({
  //   mode: 'payment',
  //   line_items: [{ price: PRICE_MAP[pkg], quantity: 1 }],
  //   customer_email: email,
  //   success_url: `https://freshmarket.eu/${locale}/registration?paid=1`,
  //   cancel_url: `https://freshmarket.eu/${locale}/registration?cancelled=1`,
  //   locale: locale === 'pl' ? 'pl' : 'en',
  //   metadata: Object.fromEntries(params),
  // });
  //
  // return { statusCode: 302, headers: { Location: session.url }, body: '' };

  return {
    statusCode: 503,
    body: JSON.stringify({ error: 'Checkout function in stub mode.' }),
  };
};
