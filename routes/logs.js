const express = require('express');
const router = express.Router();
const db = require('../db/schema');

// ---- helper สร้าง Excel buffer ด้วย exceljs ----
async function buildExcel(sheets) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Service Warehouse';
  wb.created = new Date();

  for (const { name, headers, rows, dotCol } of sheets) {
    const ws = wb.addWorksheet(name);

    // Header row
    ws.addRow(headers.map(h => h.label));
    const headerRow = ws.getRow(1);
    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2A5CFF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FF4A9EFF' } },
      };
    });
    headerRow.height = 22;

    // Data rows
    rows.forEach((r, i) => {
      const rowData = headers.map(h => r[h.key] ?? '');
      const row = ws.addRow(rowData);
      row.eachCell(cell => {
        cell.fill = {
          type: 'pattern', pattern: 'solid',
          fgColor: { argb: i % 2 === 0 ? 'FF181C27' : 'FF1F2435' },
        };
        cell.font = { color: { argb: 'FFE8EAF0' } };
        cell.alignment = { vertical: 'middle' };
      });
    });

    // Column widths
    headers.forEach((h, i) => {
      ws.getColumn(i + 1).width = h.width || 16;
    });

    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }

  return wb.xlsx.writeBuffer();
}

// ---- GET /api/logs — ประวัตินำออก (JSON) ----
router.get('/', async (req, res) => {
  try {
    const { type, date_from, date_to, limit = 200, offset = 0 } = req.query;
    let sql = `SELECT l.*, GROUP_CONCAT(us.serial,'||') AS serials_raw
      FROM usage_logs l LEFT JOIN usage_serials us ON us.log_id=l.id WHERE 1=1`;
    const params = [];
    if (type && type !== 'all') { sql += ` AND l.item_type=?`; params.push(type); }
    if (date_from) { sql += ` AND date(l.used_at)>=?`; params.push(date_from); }
    if (date_to)   { sql += ` AND date(l.used_at)<=?`; params.push(date_to); }
    sql += ` GROUP BY l.id ORDER BY l.used_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));
    const rows = await db.all(sql, params);
    const logs = rows.map(r => ({
      ...r,
      serials: r.serials_raw ? r.serials_raw.split('||').filter(Boolean) : [],
      serials_raw: undefined,
    }));
    const total = (await db.get(`SELECT COUNT(*) AS c FROM usage_logs`)).c;
    res.json({ success: true, data: logs, total });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ---- GET /api/logs/export/out — Export Excel ประวัตินำออก ----
// รองรับ query: ?type=install|service|free  &date_from=YYYY-MM-DD  &date_to=YYYY-MM-DD
router.get('/export/out', async (req, res) => {
  try {
    const { type, date_from, date_to } = req.query;
    let sql = `SELECT l.*, GROUP_CONCAT(us.serial,'||') AS serials_raw
      FROM usage_logs l LEFT JOIN usage_serials us ON us.log_id=l.id WHERE 1=1`;
    const params = [];
    if (type && type !== 'all') { sql += ` AND l.item_type=?`; params.push(type); }
    if (date_from) { sql += ` AND date(l.used_at)>=?`; params.push(date_from); }
    if (date_to)   { sql += ` AND date(l.used_at)<=?`; params.push(date_to); }
    sql += ` GROUP BY l.id ORDER BY l.used_at DESC`;
    const rows = await db.all(sql, params);

    const data = rows.map((r, i) => ({
      no: i + 1,
      item_name: r.item_name || '',
      sku: r.sku || '',
      item_type: r.item_type === 'install' ? 'Install' : r.item_type === 'service' ? 'Service' : 'Free',
      category: r.category || '',
      qty: r.qty ?? '',
      unit: r.unit || '',
      serials: r.serials_raw ? r.serials_raw.split('||').filter(Boolean).join(', ') : '',
      note: r.note || '',
      used_at: r.used_at || '',
    }));

    const headers = [
      { key: 'no',        label: 'ลำดับ',          width: 7  },
      { key: 'item_name', label: 'ชื่อสินค้า',      width: 36 },
      { key: 'sku',       label: 'SKU',             width: 14 },
      { key: 'item_type', label: 'ประเภท',          width: 10 },
      { key: 'category',  label: 'หมวดหมู่',        width: 16 },
      { key: 'qty',       label: 'จำนวน',           width: 8  },
      { key: 'unit',      label: 'หน่วย',           width: 8  },
      { key: 'serials',   label: 'Serial Numbers',  width: 32 },
      { key: 'note',      label: 'หมายเหตุ',        width: 26 },
      { key: 'used_at',   label: 'วันที่/เวลา',     width: 20 },
    ];

    const buf = await buildExcel([{ name: 'ประวัตินำออก', headers, rows: data }]);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="export_history_${date}.xlsx"`);
    res.send(buf);
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ---- GET /api/logs/export/in — Export Excel ประวัตินำเข้า ----
// รองรับ query: ?type=install|service|free  &date_from=YYYY-MM-DD  &date_to=YYYY-MM-DD
router.get('/export/in', async (req, res) => {
  try {
    const { type, date_from, date_to } = req.query;

    // พยายามดึงจาก item_logs ก่อน
    let rows;
    let fallback = false;
    try {
      let sql = `SELECT il.*, i.name AS item_name, i.sku, i.type AS item_type,
                        i.category, i.unit,
                        GROUP_CONCAT(ils.serial,'||') AS serials_raw
                 FROM item_logs il
                 LEFT JOIN items i ON i.id = il.item_id
                 LEFT JOIN item_log_serials ils ON ils.log_id = il.id
                 WHERE 1=1`;
      const params = [];
      if (type && type !== 'all') { sql += ` AND i.type=?`; params.push(type); }
      if (date_from) { sql += ` AND date(il.logged_at)>=?`; params.push(date_from); }
      if (date_to)   { sql += ` AND date(il.logged_at)<=?`; params.push(date_to); }
      sql += ` GROUP BY il.id ORDER BY il.logged_at DESC`;
      rows = await db.all(sql, params);
    } catch (_) {
      // Fallback: ใช้ items.created_at แทน
      fallback = true;
      let sql = `SELECT i.id, i.name AS item_name, i.sku, i.type AS item_type,
                        i.category, i.unit, i.qty, i.created_at AS logged_at, '' AS note, '' AS serials_raw
                 FROM items i WHERE 1=1`;
      const params = [];
      if (type && type !== 'all') { sql += ` AND i.type=?`; params.push(type); }
      if (date_from) { sql += ` AND date(i.created_at)>=?`; params.push(date_from); }
      if (date_to)   { sql += ` AND date(i.created_at)<=?`; params.push(date_to); }
      sql += ` ORDER BY i.created_at DESC`;
      rows = await db.all(sql, params);
    }

    const data = rows.map((r, i) => ({
      no: i + 1,
      item_name: r.item_name || '',
      sku: r.sku || '',
      item_type: r.item_type === 'install' ? 'Install' : r.item_type === 'service' ? 'Service' : 'Free',
      category: r.category || '',
      qty: r.qty ?? '',
      unit: r.unit || '',
      serials: r.serials_raw ? r.serials_raw.split('||').filter(Boolean).join(', ') : '',
      note: r.note || '',
      logged_at: r.logged_at || '',
    }));

    const headers = [
      { key: 'no',        label: 'ลำดับ',          width: 7  },
      { key: 'item_name', label: 'ชื่อสินค้า',      width: 36 },
      { key: 'sku',       label: 'SKU',             width: 14 },
      { key: 'item_type', label: 'ประเภท',          width: 10 },
      { key: 'category',  label: 'หมวดหมู่',        width: 16 },
      { key: 'qty',       label: 'จำนวน',           width: 8  },
      { key: 'unit',      label: 'หน่วย',           width: 8  },
      { key: 'serials',   label: 'Serial Numbers',  width: 32 },
      { key: 'note',      label: 'หมายเหตุ',        width: 26 },
      { key: 'logged_at', label: 'วันที่/เวลา',     width: 20 },
    ];

    const sheetName = fallback ? 'ประวัตินำเข้า (สินค้าในระบบ)' : 'ประวัตินำเข้า';
    const buf = await buildExcel([{ name: sheetName, headers, rows: data }]);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="import_history_${date}.xlsx"`);
    res.send(buf);
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
