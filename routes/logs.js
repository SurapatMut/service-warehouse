const express = require('express');
const router  = express.Router();
const db = require('../db/schema');

router.get('/', async (req, res) => {
  try {
    const { type, date_from, date_to, limit=200, offset=0 } = req.query;
    let sql = `SELECT l.*, GROUP_CONCAT(us.serial,'||') AS serials_raw
               FROM usage_logs l LEFT JOIN usage_serials us ON us.log_id=l.id WHERE 1=1`;
    const params = [];
    if (type && type !== 'all') { sql += ` AND l.item_type=?`; params.push(type); }
    if (date_from) { sql += ` AND date(l.used_at)>=?`; params.push(date_from); }
    if (date_to)   { sql += ` AND date(l.used_at)<=?`; params.push(date_to); }
    sql += ` GROUP BY l.id ORDER BY l.used_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));
    const rows = await db.all(sql, params);
    const logs = rows.map(r => ({ ...r, serials: r.serials_raw ? r.serials_raw.split('||').filter(Boolean) : [], serials_raw: undefined }));
    const total = (await db.get(`SELECT COUNT(*) AS c FROM usage_logs`)).c;
    res.json({ success: true, data: logs, total });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
