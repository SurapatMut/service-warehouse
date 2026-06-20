router.post('/', async (req, res) => {
  try {
    const { name, sku, type, category, qty, unit, serials = [] } = req.body;
    if (!name || !type) return res.status(400).json({ success: false, error: 'name and type are required' });
    const r = await db.run(`INSERT INTO items (name,sku,type,category,qty,unit) VALUES (?,?,?,?,?,?)`,
      [name, sku||null, type, category||null, parseInt(qty)||0, unit||null]);
    const itemId = r.lastID;
    if (type !== 'free' && serials.length > 0) {
      for (const s of serials) {
        if (s.trim()) {
          await db.run(`INSERT INTO serials (item_id,serial) VALUES (?,?)`, [itemId, s.trim()]);
          await db.run(`INSERT INTO import_logs (item_id,item_name,item_type,qty,serial) VALUES (?,?,?,?,?)`,
            [itemId, name, type, 1, s.trim()]);
        }
      }
    } else if (type === 'free' && parseInt(qty) > 0) {
      await db.run(`INSERT INTO import_logs (item_id,item_name,item_type,qty,serial) VALUES (?,?,?,?,?)`,
        [itemId, name, type, parseInt(qty), null]);
    }
    const item = await db.get(`SELECT * FROM items WHERE id=?`, [itemId]);
    const sn   = await db.all(`SELECT * FROM serials WHERE item_id=?`, [itemId]);
    res.status(201).json({ success: true, data: { ...item, serials: sn } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
