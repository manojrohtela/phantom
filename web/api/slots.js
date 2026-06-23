// Same-origin proxy → reads the live Phantom offer count from the backend
// (server-side, so no browser CORS). The landing calls /api/slots.
export default async function handler(req, res) {
  try {
    const r = await fetch("https://api.heyagenthive.com/voxhire/api/v1/phantom/pricing");
    const d = await r.json();
    res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=60");
    res.status(200).json({
      total: d.offer_total ?? 200,
      left: d.offer_left_display ?? 100,
      claimed: d.offer_claimed_display ?? 100,
      price: d.price_inr ?? 200,
      regular: d.regular_price_inr ?? 1000,
    });
  } catch (e) {
    // Fallback so the counter always renders.
    res.status(200).json({ total: 200, left: 100, claimed: 100, price: 200, regular: 1000 });
  }
}
