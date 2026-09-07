require("dotenv").config();

const express = require("express");
const path = require("path");
const multer = require("multer");
const { FedaPay, Transaction } = require("fedapay");
const { pool, init } = require("./database");

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const ADMIN_KEY = process.env.ADMIN_KEY || "CHANGE_ME";

FedaPay.setApiKey(process.env.FEDAPAY_API_KEY || "");
FedaPay.setEnvironment(process.env.FEDAPAY_ENV || "sandbox");

const PACK_PRICE = 100;
const PACK_SLOTS = 5;
const PACK_DURATION_HOURS = 48;
const BOOST_PRICES = { "72h": 500, "7d": 1000 };
const BOOST_DURATION_HOURS = { "72h": 72, "7d": 24 * 7 };
const COMMISSION_RATE = 0.08;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uploadDir = path.join(__dirname, "uploads");
const upload = multer({ dest: uploadDir });

app.use("/uploads", express.static(uploadDir));
app.use(express.static(path.join(__dirname, "public")));

function addHours(h) {
  return new Date(Date.now() + h * 3600 * 1000);
}

// ---------- PACKS (droit de publier 5 annonces / 48h — 1er gratuit) ----------

app.post("/api/packs", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "Téléphone requis." });

    const prev = await pool.query(
      "SELECT id FROM packs WHERE phone=$1 AND payment_status='paid' LIMIT 1",
      [phone]
    );
    const isFirstPack = prev.rows.length === 0;

    if (isFirstPack) {
      const insert = await pool.query(
        `INSERT INTO packs (phone, slots_total, slots_used, amount, payment_status, expires_at)
         VALUES ($1, $2, 0, 0, 'paid', $3) RETURNING id`,
        [phone, PACK_SLOTS, addHours(PACK_DURATION_HOURS)]
      );
      return res.json({ success: true, free: true, packId: insert.rows[0].id });
    }

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

    res.json({ success: true, free: false, packId, paymentUrl: token.url });
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

// ---------- ACHAT PROTÉGÉ (avec commission plateforme) ----------

app.post("/api/listings/:id/purchase", async (req, res) => {
  try {
    const { buyerPhone } = req.body;
    const lr = await pool.query("SELECT * FROM listings WHERE id=$1", [req.params.id]);
    const listing = lr.rows[0];
    if (!listing) return res.status(404).json({ error: "Annonce introuvable." });
    if (!buyerPhone) return res.status(400).json({ error: "Téléphone de l'acheteur requis." });
    if (!listing.price || listing.price <= 0) return res.status(400).json({ error: "Cette annonce n'a pas de prix fixe." });

    const amount = listing.price;
    const commission = Math.round(amount * COMMISSION_RATE);
    const sellerAmount = amount - commission;

    const insert = await pool.query(
      `INSERT INTO orders (listing_id, buyer_phone, amount, commission, seller_amount, status)
       VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING id`,
      [listing.id, buyerPhone, amount, commission, sellerAmount]
    );
    const orderId = insert.rows[0].id;

    const transaction = await Transaction.create({
      description: `BON PLAN 229 - Achat protégé : ${listing.title}`,
      amount,
      currency: { iso: "XOF" },
      callback_url: `${PUBLIC_URL}/?order=${orderId}`,
      customer: { phone_number: { number: buyerPhone, country: "bj" } }
    });
    const token = await transaction.generateToken();

    await pool.query("UPDATE orders SET fedapay_id=$1 WHERE id=$2", [String(transaction.id), orderId]);

    res.json({ success: true, orderId, paymentUrl: token.url });
  } catch (e) {
    res.status(500).json({ error: "Erreur de connexion au paiement FedaPay.", details: e.message });
  }
});

app.get("/api/orders/:id", async (req, res) => {
  const r = await pool.query("SELECT * FROM orders WHERE id=$1", [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ error: "Commande introuvable." });
  res.json(r.rows[0]);
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

    const or_ = await pool.query("SELECT * FROM orders WHERE fedapay_id=$1", [fedapayId]);
    if (or_.rows[0]) {
      await pool.query(
        "UPDATE orders SET status='paid', confirm_after=$1 WHERE id=$2",
        [addHours(48), or_.rows[0].id]
      );
    }
  }

  res.json({ received: true });
});

app.post("/api/orders/:id/dispute", async (req, res) => {
  const { reason } = req.body;
  const r = await pool.query("SELECT * FROM orders WHERE id=$1", [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ error: "Commande introuvable." });
  if (r.rows[0].status !== "paid") return res.status(400).json({ error: "Cette commande ne peut pas être signalée." });

  await pool.query(
    "UPDATE orders SET status='disputed', dispute_reason=$1 WHERE id=$2",
    [reason || "Non précisé", req.params.id]
  );
  res.json({ success: true });
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

// ---------- CGU ----------

app.get("/cgu", (req, res) => {
  res.send(`
    <html><head><meta charset="UTF-8"><title>Conditions Générales d'Utilisation — BON PLAN 229</title>
    <style>body{font-family:Arial;max-width:700px;margin:30px auto;padding:0 20px;line-height:1.6;color:#251F3D}
    h1{font-size:1.5rem}h2{font-size:1.1rem;margin-top:28px}</style></head>
    <body>
      <h1>Conditions Générales d'Utilisation — BON PLAN 229</h1>
      <p>En utilisant BON PLAN 229, vous acceptez les conditions suivantes.</p>

      <h2>1. Rôle de la plateforme</h2>
      <p>BON PLAN 229 est un espace de mise en relation entre vendeurs et acheteurs. La plateforme ne fabrique, ne possède, ni ne contrôle physiquement les articles publiés.</p>

      <h2>2. Frais de publication et mise en avant</h2>
      <p>La publication d'annonces et la mise en avant sont payantes selon les tarifs affichés au moment de l'action. Ces frais ne sont pas remboursables une fois le service rendu (annonce publiée ou mise en avant activée).</p>

      <h2>3. Achat protégé et commission</h2>
      <p>Pour les achats effectués via le parcours "Achat protégé", la plateforme prélève une commission de 8% sur le montant. Les fonds sont conservés pendant une période de confirmation de 48h après le paiement, durant laquelle l'acheteur peut signaler un problème (objet non reçu, non conforme). Passé ce délai sans signalement, la transaction est considérée comme finalisée et les fonds sont dus au vendeur.</p>
      <p>En cas de signalement, BON PLAN 229 examine la situation entre les deux parties mais n'est pas un tribunal et ne garantit pas de remboursement automatique.</p>

      <h2>4. Biens immobiliers et terrains</h2>
      <p><strong>BON PLAN 229 ne vérifie pas les titres de propriété, actes domaniaux, ou la légalité des biens immobiliers publiés dans les catégories "Terrains" et "Maisons".</strong> L'achat en ligne n'est pas disponible pour ces catégories. Tout acheteur intéressé doit impérativement vérifier les documents fonciers (titre foncier, certificat de propriété) et, si possible, consulter un notaire avant tout paiement ou engagement, effectué en dehors de la plateforme.</p>

      <h2>5. Responsabilité des utilisateurs</h2>
      <p>Chaque utilisateur est responsable de l'exactitude des informations qu'il publie. La plateforme se réserve le droit de retirer toute annonce frauduleuse ou trompeuse.</p>

      <h2>6. Données personnelles</h2>
      <p>Les numéros de téléphone collectés servent uniquement au fonctionnement de la plateforme (publication, paiement, mise en relation) et ne sont pas revendus à des tiers.</p>

      <h2>7. Limitation de responsabilité</h2>
      <p>BON PLAN 229 ne peut être tenu responsable des litiges entre acheteurs et vendeurs survenant en dehors du parcours d'achat protégé, ni des transactions réalisées en dehors de la plateforme.</p>

      <p style="margin-top:30px;color:#7A7290;font-size:.85rem">Dernière mise à jour : ${new Date().toLocaleDateString("fr-FR")}</p>
    </body></html>
  `);
});

// ---------- ADMINISTRATION (protégée par ADMIN_KEY) ----------

app.get("/admin", async (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(403).send("<h1>Accès refusé</h1><p>Clé admin manquante ou incorrecte. Ajoute ?key=TA_CLE à l'adresse.</p>");
  }

  const packsRevenue = await pool.query("SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS n FROM packs WHERE payment_status='paid' AND amount > 0");
  const boostsRevenue = await pool.query("SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS n FROM boosts WHERE payment_status='paid'");
  const ordersRevenue = await pool.query("SELECT COALESCE(SUM(commission),0) AS total, COALESCE(SUM(amount),0) AS volume, COUNT(*) AS n FROM orders WHERE status='paid'");
  const disputed = await pool.query("SELECT id, listing_id, buyer_phone, amount, dispute_reason, created_at FROM orders WHERE status='disputed' ORDER BY created_at DESC");
  const listingsCount = await pool.query("SELECT COUNT(*) AS n FROM listings WHERE status='active' AND (expires_at IS NULL OR expires_at > NOW())");
  const totalRevenue = Number(packsRevenue.rows[0].total) + Number(boostsRevenue.rows[0].total) + Number(ordersRevenue.rows[0].total);

  const disputesHtml = disputed.rows.length
    ? disputed.rows.map(d => `<div class="card" style="border:2px solid #E8542A"><div>⚠️ Litige commande #${d.id} — annonce #${d.listing_id}</div><div>Acheteur : ${d.buyer_phone} — ${d.amount} F CFA</div><div>Motif : ${d.dispute_reason}</div></div>`).join("")
    : `<p style="color:#7A7290">Aucun litige en cours.</p>`;

  res.send(`
    <html><head><meta charset="UTF-8"><title>Admin BON PLAN 229</title>
    <style>body{font-family:Arial;background:#221B3A;color:#FFF6E9;padding:30px}
    .card{background:#332A54;border-radius:12px;padding:20px;margin-bottom:14px}
    .num{font-size:2rem;font-weight:bold;color:#F2A93B}</style></head>
    <body>
      <h1>Tableau de bord — BON PLAN 229</h1>
      <div class="card"><div>Annonces actives en ce moment</div><div class="num">${listingsCount.rows[0].n}</div></div>
      <div class="card"><div>Revenu packs de publication (${packsRevenue.rows[0].n} payés)</div><div class="num">${packsRevenue.rows[0].total} F CFA</div></div>
      <div class="card"><div>Revenu mises en avant (${boostsRevenue.rows[0].n} payées)</div><div class="num">${boostsRevenue.rows[0].total} F CFA</div></div>
      <div class="card"><div>Commissions sur achats protégés (${ordersRevenue.rows[0].n} commandes, ${ordersRevenue.rows[0].volume} F CFA de volume)</div><div class="num">${ordersRevenue.rows[0].total} F CFA</div></div>
      <div class="card"><div>Revenu total cumulé</div><div class="num">${totalRevenue} F CFA</div></div>
      <h2>⚠️ Litiges signalés</h2>
      ${disputesHtml}
    </body></html>
  `);
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
