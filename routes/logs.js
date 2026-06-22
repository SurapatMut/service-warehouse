const express = require('express');
const router = express.Router();
const db = require('../db/schema');

router.get('/export/out', async (req, res) => {
  try {
    const { rows: logs } = await db.query(`
      SELECT l.*, STRING_AGG(us.serial, '||') AS serials_raw
      FROM usage_logs l LEFT JOIN usage_serials us ON us.log_id=l.id
      GROUP BY l.id ORDER BY l.used_at DESC
    `);
    const rows = [['ลำดับ','ชื่อสินค้า','ประเภท','จำนวน','Serial Numbers','หมายเหตุ','วันที่นำออก']];
    logs.forEach((l, i) => {
      rows.push([
        i+1, l.item_name, l.item_type, l.qty,
        l.serials_raw ? l.serials_raw.split('||').join(', ') : '',
        l.note || '', l.used_at
      ]);
    });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=history_out.csv');
    res.send('\uFEFF' + csv);
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/export/in', async (req, res) => {
  try {
    const { rows: logs } = await db.query(`SELECT * FROM import_logs ORDER BY imported_at DESC`);
    const rows = [['ลำดับ','ชื่อสินค้า','ประเภท','จำนวน','Serial Number','หมายเหตุ','วันที่นำเข้า']];
    logs.forEach((l, i) => {
      rows.push([i+1, l.item_name, l.item_type, l.qty, l.serial||'', l.note||'', l.imported_at]);
    });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=history_in.csv');
    res.send('\uFEFF' + csv);
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
