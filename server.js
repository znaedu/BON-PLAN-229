require("dotenv").config();

const express = require("express");
const path = require("path");
const multer = require("multer");
const { FedaPay, Transaction } = require("fedapay");
const { pool, init } = require("./database");

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

FedaPay.setApiKey(process.env.FEDAPAY_API_KEY || "");
FedaPay.setEnvironment(process.env.FEDAPAY_ENV || "sandbox");

const PACK_PRICE = 100;
const PACK_SLOTS = 5;
const PACK_DURATION_HOURS = 48;
const BOOST_PRICES = { "72h": 500, "7d": 1000 };
const BOOST_DURATION_HOURS = { "72h": 72, "7d": 24 * 7 };

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uploadDir = path.join(__dirname, "uploads");
const upload = multer({ dest: uploadDir });

app.use("/uploads", express.static(uploadDir));
app.use(express.static(path.join(__dirname, "public")));

function addHours(h) {
  return new Date(Date.now() + h * 3600 * 1000);
}

// ---------- PACKS (droit de publier 5 annonces / 48h) ----------

app.post("/api/packs", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "Téléphone requis." });

    const insert = await pool.query(
      `INSERT INTO packs (phone, slots_total, slots_used, amount, payment_status)
       VALUES ($1, $2, 0, $3, 'pending') RETURNING id`,
      [phone, PACK_SLOTS, PACK_PRICE]
    );
    const packId = insert.rows[0].id;

    const transaction = await Transaction.create({
      description: `BON PLAN 229 - Pack ${PACK_SLOTS} annonces`,
      amount: PACK_PRICE,
      currency: { iso: "XOF" },
      callback_url: `${PUBLIC_URL}/?pack=${packId}`,
      customer: { phone_number: { number: phone, country: "bj" } }
    });
    const token = await transaction.generateToken();

    await pool.query("UPDATE packs SET fedapay_id=$1 WHERE id=$2", [String(transaction.id), packId]);

    res.json({ success: true, packId, paymentUrl: token.url });
  } catch (e) {
    res.status(500).json({ error: "Erreur de connexion au paiement FedaPay.", details: e.message });
  }
});

app.get("/api/packs/:id", async (req, res) => {
  const r = await pool.query("SELECT * FROM packs WHERE id=$1", [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ error: "Pack introuvable." });
  res.json(r.rows[0]);
});

app.get("/api/packs/active", async (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: "Téléphone requis." });

  const r = await pool.query(
    `SELECT * FROM packs
     WHERE phone=$1 AND payment_status='paid'
       AND slots_used < slots_total AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [phone]
  );

  res.json(r.rows[0] || null);
});

// ---------- BOOSTS (mise en avant d'une annonce) ----------

app.post("/api/listings/:id/boost", async (req, res) => {
  try {
    const { tier } = req.body;
    const lr = await pool.query("SELECT * FROM listings WHERE id=$1", [req.params.id]);
    const listing = lr.rows[0];
    if (!listing) return res.status(404).json({ error: "Annonce introuvable." });
    if (!BOOST_PRICES[tier]) return res.status(400).json({ error: "Formule de mise en avant invalide." });

    const amount = BOOST_PRICES[tier];
    const insert = await pool.query(
      `INSERT INTO boosts (listing_id, tier, amount, payment_status)
       VALUES ($1, $2, $3, 'pending') RETURNING id`,
      [listing.id, tier, amount]
    );
    const boostId = insert.rows[0].id;

    const transaction = await Transaction.create({
      description: `BON PLAN 229 - Mise en avant ${tier}`,
      amount,
      currency: { iso: "XOF" },
      callback_url: `${PUBLIC_URL}/?boost=${boostId}`,
      customer: { phone_number: { number: listing.phone, country: "bj" } }
    });
    const token = await transaction.generateToken();

    await pool.query("UPDATE boosts SET fedapay_id=$1 WHERE id=$2", [String(transaction.id), boostId]);

    res.json({ success: true, boostId, paymentUrl: token.url });
  } catch (e) {
    res.status(500).json({ error: "Erreur de connexion au paiement FedaPay.", details: e.message });
  }
});

// ---------- WEBHOOK FedaPay (confirmation des paiements) ----------

app.post("/api/webhook/fedapay", async (req, res) => {
  const event = req.body;
  const status = event?.data?.status;
  const fedapayId = String(event?.data?.id || "");

  if (status === "approved") {
    const pr = await pool.query("SELECT * FROM packs WHERE fedapay_id=$1", [fedapayId]);
    if (pr.rows[0]) {
      await pool.query(
        "UPDATE packs SET payment_status='paid', expires_at=$1 WHERE id=$2",
        [addHours(PACK_DURATION_HOURS), pr.rows[0].id]
      );
    }

    const br = await pool.query("SELECT * FROM boosts WHERE fedapay_id=$1", [fedapayId]);
    if (br.rows[0]) {
      const boost = br.rows[0];
      await pool.query("UPDATE boosts SET payment_status='paid' WHERE id=$1", [boost.id]);
      await pool.query(
        "UPDATE listings SET featured=1, boost_tier=$1, boost_until=$2 WHERE id=$3",
        [boost.tier, addHours(BOOST_DURATION_HOURS[boost.tier]), boost.listing_id]
      );
    }
  }

  res.json({ received: true });
});

// ---------- ANNONCES ----------

app.get("/api/listings", async (req, res) => {
  const { search = "", category = "", zone = "" } = req.query;

  let sql = `SELECT * FROM listings WHERE status='active' AND (expires_at IS NULL OR expires_at > NOW())`;
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    sql += ` AND (title ILIKE $${params.length} OR description ILIKE $${params.length} OR category ILIKE $${params.length})`;
  }
  if (category) {
    params.push(category);
    sql += ` AND category=$${params.length}`;
  }
  if (zone) {
    params.push(zone);
    sql += ` AND zone=$${params.length}`;
  }

  sql += `
    ORDER BY
      CASE WHEN boost_until IS NOT NULL AND boost_until > NOW() THEN 1 ELSE 0 END DESC,
      created_at DESC
  `;

  const r = await pool.query(sql, params);
  res.json(r.rows.map(row => ({ ...row, images: JSON.parse(row.images || "[]") })));
});

app.get("/api/listings/mine", async (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: "Téléphone requis." });

  const r = await pool.query("SELECT * FROM listings WHERE phone=$1 ORDER BY created_at DESC", [phone]);
  res.json(r.rows.map(row => ({ ...row, images: JSON.parse(row.images || "[]") })));
});

app.post("/api/listings", upload.array("images", 3), async (req, res) => {
  const { title, category, price, zone, phone, description = "", packId } = req.body;

  if (!title || !category || !price || !zone || !phone || !packId) {
    return res.status(400).json({ error: "Informations obligatoires manquantes." });
  }

  const pr = await pool.query("SELECT * FROM packs WHERE id=$1", [packId]);
  const pack = pr.rows[0];
  if (!pack || pack.payment_status !== "paid") {
    return res.status(402).json({ error: "Aucun pack payé valide. Veuillez payer avant de publier." });
  }
  if (pack.slots_used >= pack.slots_total) {
    return res.status(402).json({ error: "Toutes les annonces de ce pack ont été utilisées." });
  }
  if (new Date(pack.expires_at) < new Date()) {
    return res.status(402).json({ error: "Ce pack a expiré (48h dépassées)." });
  }

  const images = (req.files || []).map(f => `/uploads/${f.filename}`);

  const insert = await pool.query(
    `INSERT INTO listings (pack_id, title, category, price, zone, phone, description, images, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [packId, title, category, Number(price), zone, phone, description, JSON.stringify(images), pack.expires_at]
  );

  await pool.query("UPDATE packs SET slots_used = slots_used + 1 WHERE id=$1", [packId]);

  res.json({ success: true, id: insert.rows[0].id });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "BON PLAN 229" });
});

init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`BON PLAN 229 : http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error("Erreur d'initialisation de la base de données :", err);
    process.exit(1);
  });
