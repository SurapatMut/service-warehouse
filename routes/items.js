const express = require('express');
const router  = express.Router();
const db = require('../db/schema');

router.get('/', async (req, res) => {
  try {
    const { type, search, sort } = req.query;
    let sql = `
      SELECT i.*, STRING_AGG(CASE WHEN s.status='in_stock' THEN s.serial END, '||') AS serials_raw
      FROM items i LEFT JOIN serials s ON s.item_id = i.id WHERE 1=1`;
    const params = [];
    let p = 1;
    if (type && type !== 'all') {
      if (type === 'low') sql += ` AND i.qty <= 2`;
      else { sql += ` AND i.type = $${p++}`; params.push(type); }
    }
    if (search) {
      sql += ` AND (i.name ILIKE $${p} OR i.sku ILIKE $${p+1} OR EXISTS(
        SELECT 1 FROM serials sx WHERE sx.item_id=i.id AND sx.serial ILIKE $${p+2}))`;
      const q = `%${search}%`; params.push(q, q, q); p += 3;
    }
    sql += ` GROUP BY i.id, i.name, i.sku, i.type, i.category, i.qty, i.unit, i.created_at, i.updated_at`;
    if (sort === 'qty_asc') sql += ` ORDER BY i.qty ASC`;
    else if (sort === 'qty_desc') sql += ` ORDER BY i.qty DESC`;
    else sql += ` ORDER BY i.name ASC`;
    const { rows } = await db.query(sql, params);
    const items = rows.map(r => ({
      ...r,
      serials: r.serials_raw ? r.serials_raw.split('||').filter(Boolean) : [],
      serials_raw: undefined
    }));
    res.json({ success: true, data: items });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/stats', async (req, res) => {
  try {
    const { rows: [total] }  = await db.query(`SELECT COUNT(*) AS c, COALESCE(SUM(qty),0) AS q FROM items`);
    const { rows: byType }   = await db.query(`SELECT type, COUNT(*) AS c, COALESCE(SUM(qty),0) AS q FROM items GROUP BY type`);
    const { rows: [low] }    = await db.query(`SELECT COUNT(*) AS c FROM items WHERE qty <= 2`);
    const { rows: [used] }   = await db.query(`SELECT COUNT(*) AS c FROM usage_logs WHERE used_at::date = CURRENT_DATE`);
    res.json({ success: true, data: {
      total_items: parseInt(total.c), total_qty: parseInt(total.q),
      by_type: Object.fromEntries(byType.map(r => [r.type, { count: parseInt(r.c), qty: parseInt(r.q) }])),
      low_stock: parseInt(low.c), used_today: parseInt(used.c)
    }});
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/import-logs', async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM import_logs ORDER BY imported_at DESC LIMIT 200`);
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM items WHERE id=$1`, [req.params.id]);
    const item = rows[0];
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
    const { rows: serials } = await db.query(`SELECT * FROM serials WHERE item_id=$1 ORDER BY id`, [item.id]);
    res.json({ success: true, data: { ...item, serials } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, sku, type, category, qty, unit, serials = [] } = req.body;
    if (!name || !type) return res.status(400).json({ success: false, error: 'name and type are required' });
    const { rows: [newItem] } = await db.query(
      `INSERT INTO items (name,sku,type,category,qty,unit) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [name, sku||null, type, category||null, parseInt(qty)||0, unit||null]
    );
    const itemId = newItem.id;
    if (type !== 'free' && serials.length > 0) {
      for (const s of serials) {
        if (s.trim()) {
          const { rows: ex } = await db.query(
            `SELECT id FROM serials WHERE serial=$1 AND item_id=$2 AND status='in_stock'`,
            [s.trim(), itemId]
          );
          if (!ex.length) {
            await db.query(`INSERT INTO serials (item_id,serial) VALUES ($1,$2)`, [itemId, s.trim()]);
            await db.query(
              `INSERT INTO import_logs (item_id,item_name,item_type,qty,serial) VALUES ($1,$2,$3,$4,$5)`,
              [itemId, name, type, 1, s.trim()]
            );
          }
        }
      }
    } else if (type === 'free' && parseInt(qty) > 0) {
      await db.query(
        `INSERT INTO import_logs (item_id,item_name,item_type,qty,serial) VALUES ($1,$2,$3,$4,$5)`,
        [itemId, name, type, parseInt(qty), null]
      );
    }
    const { rows: [item] } = await db.query(`SELECT * FROM items WHERE id=$1`, [itemId]);
    const { rows: sn }     = await db.query(`SELECT * FROM serials WHERE item_id=$1`, [itemId]);
    res.status(201).json({ success: true, data: { ...item, serials: sn } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM items WHERE id=$1`, [req.params.id]);
    const ex = rows[0];
    if (!ex) return res.status(404).json({ success: false, error: 'Item not found' });
    const { name, sku, type, category, qty, unit } = req.body;
    await db.query(
      `UPDATE items SET name=$1,sku=$2,type=$3,category=$4,qty=$5,unit=$6,updated_at=NOW() WHERE id=$7`,
      [name??ex.name, sku??ex.sku, type??ex.type, category??ex.category,
       qty!==undefined?parseInt(qty):ex.qty, unit??ex.unit, req.params.id]
    );
    const { rows: [item] } = await db.query(`SELECT * FROM items WHERE id=$1`, [req.params.id]);
    const { rows: sn }     = await db.query(`SELECT * FROM serials WHERE item_id=$1 AND status='in_stock'`, [item.id]);
    res.json({ success: true, data: { ...item, serials: sn } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.patch('/:id/qty', async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM items WHERE id=$1`, [req.params.id]);
    const item = rows[0];
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
    const newQty = Math.max(0, item.qty + (parseInt(req.body.delta)||0));
    await db.query(`UPDATE items SET qty=$1,updated_at=NOW() WHERE id=$2`, [newQty, req.params.id]);
    res.json({ success: true, data: { qty: newQty } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM items WHERE id=$1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Item not found' });
    await db.query(`DELETE FROM serials WHERE item_id=$1`, [req.params.id]);
    await db.query(`DELETE FROM items WHERE id=$1`, [req.params.id]);
    res.json({ success: true, message: 'Deleted' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/:id/serials', async (req, res) => {
  try {
    const { serial } = req.body;
    if (!serial) return res.status(400).json({ success: false, error: 'serial is required' });
    const { rows } = await db.query(`SELECT * FROM items WHERE id=$1`, [req.params.id]);
    const item = rows[0];
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
    if (item.type === 'free') return res.status(400).json({ success: false, error: 'Free items do not use serial numbers' });
    const { rows: dup } = await db.query(
      `SELECT id FROM serials WHERE serial=$1 AND item_id=$2 AND status='in_stock'`,
      [serial.trim(), req.params.id]
    );
    if (dup.length) return res.status(400).json({ success: false, error: 'Serial นี้มีในระบบแล้ว' });
    const { rows: [sn] } = await db.query(
      `INSERT INTO serials (item_id,serial) VALUES ($1,$2) RETURNING id`,
      [req.params.id, serial.trim()]
    );
    await db.query(
      `INSERT INTO import_logs (item_id,item_name,item_type,qty,serial) VALUES ($1,$2,$3,$4,$5)`,
      [item.id, item.name, item.type, 1, serial.trim()]
    );
    res.status(201).json({ success: true, data: { id: sn.id, serial: serial.trim(), status: 'in_stock' } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/:id/serials/:snId', async (req, res) => {
  try {
    await db.query(`DELETE FROM serials WHERE id=$1 AND item_id=$2`, [req.params.snId, req.params.id]);
    res.json({ success: true, message: 'Serial deleted' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/:id/use', async (req, res) => {
  try {
    const { qty=1, serial_ids=[], note='' } = req.body;
    const { rows } = await db.query(`SELECT * FROM items WHERE id=$1`, [req.params.id]);
    const item = rows[0];
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
    if (item.qty < qty) return res.status(400).json({ success: false, error: 'Insufficient quantity' });
    const { rows: [log] } = await db.query(
      `INSERT INTO usage_logs (item_id,item_name,item_type,qty,note) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [item.id, item.name, item.type, parseInt(qty), note]
    );
    const logId = log.id;
    const usedSerials = [];
    for (const snId of serial_ids) {
      const { rows: snRows } = await db.query(
        `SELECT * FROM serials WHERE id=$1 AND item_id=$2`, [snId, item.id]
      );
      const sn = snRows[0];
      if (sn) {
        await db.query(`INSERT INTO usage_serials (log_id,serial) VALUES ($1,$2)`, [logId, sn.serial]);
        await db.query(`UPDATE serials SET status='used' WHERE id=$1`, [snId]);
        usedSerials.push(sn.serial);
      }
    }
    await db.query(`UPDATE items SET qty=qty-$1,updated_at=NOW() WHERE id=$2`, [parseInt(qty), item.id]);
    res.json({ success: true, data: { log_id: logId, qty_used: qty, serials_used: usedSerials } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
