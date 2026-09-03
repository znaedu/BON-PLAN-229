require("dotenv").config();

const express = require("express");
const path = require("path");
const multer = require("multer");
const db = require("./database");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uploadDir = path.join(__dirname, "uploads");
const upload = multer({ dest: uploadDir });

app.use("/uploads", express.static(uploadDir));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/listings", (req, res) => {
  const { search = "", category = "", zone = "" } = req.query;

  let sql = "SELECT * FROM listings WHERE status='active'";
  const params = {};

  if (search) {
    sql += " AND (title LIKE @search OR description LIKE @search OR category LIKE @search)";
    params.search = `%${search}%`;
  }

  if (category) {
    sql += " AND category=@category";
    params.category = category;
  }

  if (zone) {
    sql += " AND zone=@zone";
    params.zone = zone;
  }

  sql += " ORDER BY featured DESC, created_at DESC";

  res.json(db.prepare(sql).all(params));
});

app.post("/api/listings", upload.single("image"), (req, res) => {
  const { title, category, price, zone, phone, description = "" } = req.body;

  if (!title || !category || !price || !zone || !phone) {
    return res.status(400).json({ error: "Informations obligatoires manquantes." });
  }

  const image = req.file ? `/uploads/${req.file.filename}` : null;

  const result = db.prepare(`
    INSERT INTO listings
    (title, category, price, zone, phone, description, image)
    VALUES (@title, @category, @price, @zone, @phone, @description, @image)
  `).run({
    title,
    category,
    price: Number(price),
    zone,
    phone,
    description,
    image
  });

  res.json({ success: true, id: result.lastInsertRowid });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "BON PLAN 229" });
});

app.listen(PORT, () => {
  console.log(`BON PLAN 229 : http://localhost:${PORT}`);
});
