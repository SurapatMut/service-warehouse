const express = require('express');
const router  = express.Router();
const db = require('../db/schema');

router.get('/', async (req, res) => {
  try {
    const { type, search, sort } = req.query;
    let sql = `SELECT i.*, GROUP_CONCAT(CASE WHEN s.status='in_stock' THEN s.serial END,'||') AS serials_raw
               FROM items i LEFT JOIN serials s ON s.item_id = i.id WHERE 1=1`;
    const params = [];
    if (type && type !== 'all') {
      if (type === 'low') sql += ` AND i.qty <= 2`;
      else { sql += ` AND i.type = ?`; params.push(type); }
    }
    if (search) {
      sql += ` AND (i.name LIKE ? OR i.sku LIKE ? OR EXISTS(SELECT 1 FROM serials sx WHERE sx.item_id=i.id AND sx.serial LIKE ?))`;
      const q = `%${search}%`; params.push(q, q, q);
    }
    sql += ` GROUP BY i.id`;
    if (sort === 'qty_asc') sql += ` ORDER BY i.qty ASC`;
    else if (sort === 'qty_desc') sql += ` ORDER BY i.qty DESC`;
    else sql += ` ORDER BY i.name COLLATE NOCASE ASC`;
    const rows = await db.all(sql, params);
    const items = rows.map(r => ({ ...r, serials: r.serials_raw ? r.serials_raw.split('||').filter(Boolean) : [], serials_raw: undefined }));
    res.json({ success: true, data: items });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/stats', async (req, res) => {
  try {
    const total  = await db.get(`SELECT COUNT(*) AS c, COALESCE(SUM(qty),0) AS q FROM items`);
    const byType = await db.all(`SELECT type, COUNT(*) AS c, COALESCE(SUM(qty),0) AS q FROM items GROUP BY type`);
    const low    = await db.get(`SELECT COUNT(*) AS c FROM items WHERE qty <= 2`);
    const used   = await db.get(`SELECT COUNT(*) AS c FROM usage_logs WHERE date(used_at)=date('now','localtime')`);
    res.json({ success: true, data: {
      total_items: total.c, total_qty: total.q,
      by_type: Object.fromEntries(byType.map(r => [r.type, { count: r.c, qty: r.q }])),
      low_stock: low.c, used_today: used.c
    }});
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const item = await db.get(`SELECT * FROM items WHERE id=?`, [req.params.id]);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
    const serials = await db.all(`SELECT * FROM serials WHERE item_id=? ORDER BY id`, [item.id]);
    res.json({ success: true, data: { ...item, serials } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, sku, type, category, qty, unit, serials = [] } = req.body;
    if (!name || !type) return res.status(400).json({ success: false, error: 'name and type are required' });
    const r = await db.run(`INSERT INTO items (name,sku,type,category,qty,unit) VALUES (?,?,?,?,?,?)`,
      [name, sku||null, type, category||null, parseInt(qty)||0, unit||null]);
    const itemId = r.lastID;
    if (type !== 'free' && serials.length > 0)
      for (const s of serials) if (s.trim()) await db.run(`INSERT INTO serials (item_id,serial) VALUES (?,?)`, [itemId, s.trim()]);
    const item = await db.get(`SELECT * FROM items WHERE id=?`, [itemId]);
    const sn   = await db.all(`SELECT * FROM serials WHERE item_id=?`, [itemId]);
    res.status(201).json({ success: true, data: { ...item, serials: sn } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const ex = await db.get(`SELECT * FROM items WHERE id=?`, [req.params.id]);
    if (!ex) return res.status(404).json({ success: false, error: 'Item not found' });
    const { name, sku, type, category, qty, unit } = req.body;
    await db.run(`UPDATE items SET name=?,sku=?,type=?,category=?,qty=?,unit=?,updated_at=datetime('now','localtime') WHERE id=?`,
      [name??ex.name, sku??ex.sku, type??ex.type, category??ex.category,
       qty!==undefined?parseInt(qty):ex.qty, unit??ex.unit, req.params.id]);
    const item = await db.get(`SELECT * FROM items WHERE id=?`, [req.params.id]);
    const sn   = await db.all(`SELECT * FROM serials WHERE item_id=? AND status='in_stock'`, [item.id]);
    res.json({ success: true, data: { ...item, serials: sn } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.patch('/:id/qty', async (req, res) => {
  try {
    const item = await db.get(`SELECT * FROM items WHERE id=?`, [req.params.id]);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
    const newQty = Math.max(0, item.qty + (parseInt(req.body.delta)||0));
    await db.run(`UPDATE items SET qty=?,updated_at=datetime('now','localtime') WHERE id=?`, [newQty, req.params.id]);
    res.json({ success: true, data: { qty: newQty } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const item = await db.get(`SELECT * FROM items WHERE id=?`, [req.params.id]);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
    await db.run(`DELETE FROM serials WHERE item_id=?`, [req.params.id]);
    await db.run(`DELETE FROM items WHERE id=?`, [req.params.id]);
    res.json({ success: true, message: 'Deleted' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/:id/serials', async (req, res) => {
  try {
    const { serial } = req.body;
    if (!serial) return res.status(400).json({ success: false, error: 'serial is required' });
    const item = await db.get(`SELECT * FROM items WHERE id=?`, [req.params.id]);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
    if (item.type === 'free') return res.status(400).json({ success: false, error: 'Free items do not use serial numbers' });
    const r = await db.run(`INSERT INTO serials (item_id,serial) VALUES (?,?)`, [req.params.id, serial.trim()]);
    res.status(201).json({ success: true, data: { id: r.lastID, serial: serial.trim(), status: 'in_stock' } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/:id/serials/:snId', async (req, res) => {
  try {
    await db.run(`DELETE FROM serials WHERE id=? AND item_id=?`, [req.params.snId, req.params.id]);
    res.json({ success: true, message: 'Serial deleted' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/:id/use', async (req, res) => {
  try {
    const { qty=1, serial_ids=[], note='' } = req.body;
    const item = await db.get(`SELECT * FROM items WHERE id=?`, [req.params.id]);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
    if (item.qty < qty) return res.status(400).json({ success: false, error: 'Insufficient quantity' });
    const logR = await db.run(`INSERT INTO usage_logs (item_id,item_name,item_type,qty,note) VALUES (?,?,?,?,?)`,
      [item.id, item.name, item.type, parseInt(qty), note]);
    const logId = logR.lastID;
    const usedSerials = [];
    for (const snId of serial_ids) {
      const sn = await db.get(`SELECT * FROM serials WHERE id=? AND item_id=?`, [snId, item.id]);
      if (sn) {
        await db.run(`INSERT INTO usage_serials (log_id,serial) VALUES (?,?)`, [logId, sn.serial]);
        await db.run(`UPDATE serials SET status='used' WHERE id=?`, [snId]);
        usedSerials.push(sn.serial);
      }
    }
    await db.run(`UPDATE items SET qty=qty-?,updated_at=datetime('now','localtime') WHERE id=?`, [parseInt(qty), item.id]);
    res.json({ success: true, data: { log_id: logId, qty_used: qty, serials_used: usedSerials } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
