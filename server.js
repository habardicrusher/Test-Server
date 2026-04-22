const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const { pool, addLog, getLogs, getLogsCount, saveReport, getReports } = require('./db');

// ==================== تصحيح الاستعلامات الخاطئة تلقائياً ====================
const originalQuery = pool.query.bind(pool);
pool.query = function(text, params, callback) {
    if (typeof text === 'string' && 
        text.includes('UPDATE users') && 
        text.includes('permissions = $3') && 
        text.includes('id = $3')) {
        
        console.warn('⚠️ تم اعتراض استعلام خاطئ وتصحيحه:', text);
        const corrected = text.replace(/permissions = \$3 WHERE id = \$3/, 'permissions = $2 WHERE id = $3');
        console.log('✅ الاستعلام بعد التصحيح:', corrected);
        text = corrected;
    }
    return originalQuery(text, params, callback);
};
// ==================== نهاية التصحيح ====================

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'gravel-system-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' },
    name: 'gravel.sid'
}));

// دوال مساعدة
function requireAuth(req, res, next) {
    if (req.session && req.session.user) return next();
    res.status(401).json({ error: 'غير مصرح' });
}
function requireAdmin(req, res, next) {
    if (req.session?.user?.role === 'admin') return next();
    res.status(403).json({ error: 'صلاحيات المدير مطلوبة' });
}

async function logAction(req, action, details, location) {
    const username = req.session?.user?.username || 'unknown';
    await addLog(username, action, details || null, location || null);
}

// ==================== دوال قاعدة البيانات الأساسية ====================
async function getDayData(date) {
    const res = await pool.query('SELECT orders, distribution FROM daily_data WHERE date = $1', [date]);
    if (res.rows.length === 0) return { orders: [], distribution: [] };
    return { orders: res.rows[0].orders, distribution: res.rows[0].distribution };
}
async function saveDayData(date, orders, distribution) {
    await pool.query(
        `INSERT INTO daily_data (date, orders, distribution) VALUES ($1, $2, $3)
         ON CONFLICT (date) DO UPDATE SET orders = $2, distribution = $3`,
        [date, JSON.stringify(orders), JSON.stringify(distribution)]
    );
}
async function getSettings() {
    const res = await pool.query('SELECT factories, materials, trucks FROM app_settings WHERE id = 1');
    if (res.rows.length === 0) {
        return {
            factories: [
                { name: 'SCCCL', location: 'الدمام' }, { name: 'الحارث للمنتجات الاسمنيه', location: 'الدمام' },
                { name: 'الحارثي القديم', location: 'الدمام' }, { name: 'المعجل لمنتجات الاسمنت', location: 'الدمام' },
                { name: 'الحارث العزيزية', location: 'الدمام' }, { name: 'سارمكس النظيم', location: 'الرياض' },
                { name: 'عبر الخليج', location: 'الرياض' }, { name: 'الكفاح للخرسانة الجاهزة', location: 'الدمام' },
                { name: 'القيشان 3', location: 'الدمام' }, { name: 'القيشان 2 - الأحجار الشرقية', location: 'الدمام' },
                { name: 'القيشان 1', location: 'الدمام' }, { name: 'الفهد للبلوك والخرسانة', location: 'الرياض' }
            ],
            materials: ['3/4', '3/8', '3/16'],
            trucks: []
        };
    }
    const row = res.rows[0];
    return { factories: row.factories, materials: row.materials, trucks: row.trucks };
}
async function saveSettings(factories, materials, trucks) {
    await pool.query(
        `UPDATE app_settings SET factories = $1, materials = $2, trucks = $3, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
        [JSON.stringify(factories), JSON.stringify(materials), JSON.stringify(trucks)]
    );
}
async function getUserByUsername(username) {
    const res = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    return res.rows[0];
}
async function getUsers() {
    const res = await pool.query('SELECT id, username, role, factory, permissions, created_at FROM users');
    return res.rows;
}
async function createUser(username, password, role, factory, permissions) {
    const hashed = await bcrypt.hash(password, 10);
    const res = await pool.query(
        `INSERT INTO users (username, password, role, factory, permissions) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [username, hashed, role, factory, permissions]
    );
    return res.rows[0];
}
async function updateUser(id, username, role, factory, permissions, newPassword = null) {
    let query = 'UPDATE users SET username = $1, role = $2, factory = $3, permissions = $4';
    let params = [username, role, factory, permissions];
    if (newPassword) {
        const hashed = await bcrypt.hash(newPassword, 10);
        query += ', password = $5';
        params.push(hashed);
    }
    query += ' WHERE id = $' + (params.length + 1);
    params.push(id);
    await pool.query(query, params);
}
async function deleteUser(id) {
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
}
async function getRestrictions() {
    const res = await pool.query('SELECT * FROM restrictions ORDER BY created_at DESC');
    return res.rows;
}
async function addRestriction(truckNumber, driverName, restrictedFactories, reason, createdBy) {
    const res = await pool.query(
        `INSERT INTO restrictions (truck_number, driver_name, restricted_factories, reason, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [truckNumber, driverName, JSON.stringify(restrictedFactories), reason, createdBy]
    );
    return res.rows[0];
}
async function updateRestriction(id, active) {
    await pool.query('UPDATE restrictions SET active = $1 WHERE id = $2', [active, id]);
}
async function deleteRestriction(id) {
    await pool.query('DELETE FROM restrictions WHERE id = $1', [id]);
}

// ==================== إنشاء جدول تقارير الميزان ====================
async function createScaleReportsTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS scale_reports (
                id SERIAL PRIMARY KEY,
                report_id VARCHAR(100) UNIQUE NOT NULL,
                report_name VARCHAR(500) NOT NULL DEFAULT 'تقرير بدون اسم',
                report_date DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by VARCHAR(100) DEFAULT 'unknown',
                total_rows INTEGER DEFAULT 0,
                matched_count INTEGER DEFAULT 0,
                not_matched_count INTEGER DEFAULT 0,
                total_weight_all NUMERIC DEFAULT 0,
                drivers_stats JSONB DEFAULT '[]'::jsonb,
                materials_stats JSONB DEFAULT '[]'::jsonb,
                top10_drivers JSONB DEFAULT '[]'::jsonb
            )
        `);
        console.log('✅ جدول scale_reports جاهز');
    } catch (e) {
        console.error('❌ خطأ في إنشاء جدول scale_reports:', e.message);
    }
}
createScaleReportsTable();

// ==================== API Routes ====================
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await getUserByUsername(username);
    if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }
    req.session.user = {
        id: user.id,
        username: user.username,
        role: user.role,
        factory: user.factory,
        permissions: user.permissions
    };
    await logAction(req, 'تسجيل دخول', `تسجيل دخول للمستخدم ${username}`, req.session.user.factory || 'المكتب الرئيسي');
    res.json({ success: true, user: req.session.user });
});
app.post('/api/logout', async (req, res) => {
    const username = req.session?.user?.username;
    if (username) await logAction(req, 'تسجيل خروج', `تسجيل خروج للمستخدم ${username}`, req.session.user?.factory || 'المكتب الرئيسي');
    req.session.destroy();
    res.json({ success: true });
});
app.get('/api/me', requireAuth, (req, res) => {
    res.json({ user: req.session.user });
});

app.get('/api/settings', requireAuth, async (req, res) => {
    const settings = await getSettings();
    if (req.session.user.role === 'client' && req.session.user.factory) {
        settings.factories = settings.factories.filter(f => f.name === req.session.user.factory);
    }
    res.json(settings);
});
app.put('/api/settings', requireAuth, async (req, res) => {
    if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const { factories, materials, trucks } = req.body;
    await saveSettings(factories, materials, trucks);
    await logAction(req, 'تحديث الإعدادات', `المصانع: ${factories.length}, المواد: ${materials.length}, السيارات: ${trucks.length}`, null);
    res.json({ success: true });
});

app.get('/api/day/:date', requireAuth, async (req, res) => {
    const data = await getDayData(req.params.date);
    res.json(data);
});
app.put('/api/day/:date', requireAuth, async (req, res) => {
    const { orders, distribution } = req.body;
    await saveDayData(req.params.date, orders, distribution);
    res.json({ success: true });
});

app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
    const users = await getUsers();
    res.json(users);
});
app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
    const { username, password, role, factory, permissions } = req.body;
    const existing = await getUserByUsername(username);
    if (existing) return res.status(400).json({ error: 'اسم المستخدم موجود' });
    await createUser(username, password, role, factory, permissions);
    await logAction(req, 'إضافة مستخدم', `المستخدم: ${username}, الدور: ${role}, المصنع: ${factory || 'لا يوجد'}`, null);
    res.json({ success: true });
});
app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const { username, role, factory, permissions, password } = req.body;
    await updateUser(id, username, role, factory, permissions, password);
    await logAction(req, 'تعديل مستخدم', `المستخدم: ${username}, الدور: ${role}`, null);
    res.json({ success: true });
});
app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const user = (await getUsers()).find(u => u.id === id);
    if (user?.username === 'Admin') return res.status(400).json({ error: 'لا يمكن حذف المدير الرئيسي' });
    await deleteUser(id);
    await logAction(req, 'حذف مستخدم', `المستخدم: ${user?.username}`, null);
    res.json({ success: true });
});

app.get('/api/restrictions', requireAuth, async (req, res) => {
    const restrictions = await getRestrictions();
    res.json(restrictions);
});
app.post('/api/restrictions', requireAuth, async (req, res) => {
    if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
    const { truckNumber, driverName, restrictedFactories, reason } = req.body;
    const newRestriction = await addRestriction(truckNumber, driverName, restrictedFactories, reason, req.session.user.username);
    await logAction(req, 'إضافة قيد حظر', `السيارة: ${truckNumber} (${driverName}) ممنوعة من المصانع: ${restrictedFactories.join(', ')}`, null);
    res.json(newRestriction);
});
app.put('/api/restrictions/:id', requireAuth, async (req, res) => {
    if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
    const id = parseInt(req.params.id);
    const { active } = req.body;
    await updateRestriction(id, active);
    await logAction(req, 'تعديل قيد حظر', `تغيير حالة القيد رقم ${id} إلى ${active ? 'نشط' : 'غير نشط'}`, null);
    res.json({ success: true });
});
app.delete('/api/restrictions/:id', requireAuth, async (req, res) => {
    if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
    const id = parseInt(req.params.id);
    await deleteRestriction(id);
    await logAction(req, 'حذف قيد حظر', `تم حذف القيد رقم ${id}`, null);
    res.json({ success: true });
});

app.get('/api/reports', requireAuth, async (req, res) => {
    const { startDate, endDate } = req.query;
    const start = new Date(startDate);
    const end = new Date(endDate);
    let allDistributions = [], dailyData = {}, driverStats = {}, factoryStats = {}, materialStats = {};
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        const dayData = await getDayData(dateStr);
        if (dayData.distribution?.length) {
            dailyData[dateStr] = dayData.distribution.length;
            dayData.distribution.forEach(dist => {
                dist.date = dateStr;
                allDistributions.push(dist);
                const key = dist.truck?.number;
                if (key) {
                    if (!driverStats[key]) driverStats[key] = { number: key, driver: dist.truck.driver, total: 0 };
                    driverStats[key].total++;
                }
                const factory = dist.factory;
                if (factory) {
                    if (!factoryStats[factory]) factoryStats[factory] = { name: factory, total: 0 };
                    factoryStats[factory].total++;
                }
                const material = dist.material;
                if (material) {
                    if (!materialStats[material]) materialStats[material] = { name: material, total: 0 };
                    materialStats[material].total++;
                }
            });
        }
    }
    res.json({ allDistributions, dailyData, driverStats: Object.values(driverStats), factoryStats: Object.values(factoryStats), materialStats: Object.values(materialStats), startDate, endDate });
});

app.get('/api/backup', requireAuth, requireAdmin, async (req, res) => {
    const settings = await getSettings();
    const users = await getUsers();
    const restrictions = await getRestrictions();
    await logAction(req, 'تصدير نسخة احتياطية', null, null);
    res.json({ settings, users, restrictions, exportDate: new Date().toISOString() });
});
app.post('/api/restore', requireAuth, requireAdmin, async (req, res) => {
    const data = req.body;
    if (data.settings) await saveSettings(data.settings.factories, data.settings.materials, data.settings.trucks);
    if (data.restrictions) {
        await pool.query('DELETE FROM restrictions');
        for (const r of data.restrictions) {
            await addRestriction(r.truck_number, r.driver_name, r.restricted_factories, r.reason, r.created_by);
        }
    }
    await logAction(req, 'استعادة نسخة احتياطية', null, null);
    res.json({ success: true });
});

app.delete('/api/clear-all', requireAuth, requireAdmin, async (req, res) => {
    await pool.query('DELETE FROM daily_data');
    await pool.query('DELETE FROM restrictions');
    await logAction(req, 'مسح جميع البيانات', null, null);
    res.json({ success: true });
});

app.get('/api/logs', requireAuth, async (req, res) => {
    if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const logs = await getLogs(limit, offset);
    const total = await getLogsCount();
    res.json({ logs: logs || [], currentPage: page, totalPages: Math.ceil(total / limit), total: total || 0 });
});
app.get('/api/logs/all', requireAuth, async (req, res) => {
    if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const logs = await getLogs(10000, 0);
    res.json(logs || []);
});
app.delete('/api/logs/clear', requireAuth, requireAdmin, async (req, res) => {
    await pool.query('DELETE FROM logs');
    await addLog(req.session.user.username, 'مسح السجلات', 'قام بحذف جميع سجلات النظام', null);
    res.json({ success: true });
});

// ==================== تقارير التحليل (Trip Summary) ====================
app.post('/api/upload-report', requireAuth, async (req, res) => {
    try {
        if (req.session.user.role !== 'admin') {
            return res.status(403).json({ error: 'غير مصرح' });
        }
        const reportData = req.body;
        if (!reportData.report_date || !reportData.filename) {
            return res.status(400).json({ error: 'بيانات ناقصة' });
        }
        const saved = await saveReport(reportData);
        await addLog(req.session.user.username, 'رفع تقرير', `تم رفع تقرير ${reportData.filename}`, null);
        res.json({ success: true, id: saved.id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'فشل في حفظ التقرير' });
    }
});

app.get('/api/reports-list', requireAuth, async (req, res) => {
    try {
        const { startDate, endDate, filename } = req.query;
        const filters = {};
        if (startDate) filters.startDate = startDate;
        if (endDate) filters.endDate = endDate;
        if (filename) filters.filename = filename;
        const reports = await getReports(filters);
        res.json(reports);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'فشل في جلب التقارير' });
    }
});

app.get('/api/reports/:id', requireAuth, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const result = await pool.query('SELECT * FROM reports WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'تقرير غير موجود' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'فشل في جلب التقرير' });
    }
});

// ==================== تقارير الميزان الشهرية (Scale Reports) ====================
app.post('/api/scale-reports', requireAuth, async (req, res) => {
    try {
        const { reportName, reportDate, data } = req.body;
        if (!data) return res.status(400).json({ error: 'لا توجد بيانات للحفظ' });
        const reportId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        await pool.query(
            `INSERT INTO scale_reports 
             (report_id, report_name, report_date, created_by, total_rows, matched_count, not_matched_count, total_weight_all, drivers_stats, materials_stats, top10_drivers)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
                reportId,
                reportName || 'تقرير بدون اسم',
                reportDate || new Date().toISOString().split('T')[0],
                req.session.user.username,
                data.totalRows || 0,
                data.matchedCount || 0,
                data.notMatchedCount || 0,
                data.totalWeightAll || 0,
                JSON.stringify(data.driversStats || []),
                JSON.stringify(data.materialsStats || []),
                JSON.stringify(data.top10Drivers || [])
            ]
        );
        await logAction(req, 'حفظ تقرير ميزان', `تم حفظ تقرير: ${reportName || 'بدون اسم'}`, null);
        res.json({ success: true, id: reportId, message: 'تم حفظ التقرير بنجاح' });
    } catch (e) {
        console.error('❌ خطأ في حفظ تقرير الميزان:', e);
        res.status(500).json({ error: 'خطأ في حفظ التقرير: ' + e.message });
    }
});

app.get('/api/scale-reports', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, report_id, report_name, report_date, created_at, created_by, 
                    total_rows, matched_count, not_matched_count, total_weight_all,
                    jsonb_array_length(COALESCE(drivers_stats, '[]'::jsonb)) as drivers_count
             FROM scale_reports 
             ORDER BY created_at DESC`
        );
        const summaries = result.rows.map(r => ({
            id: r.report_id,
            dbId: r.id,
            reportName: r.report_name,
            reportDate: r.report_date,
            createdAt: r.created_at,
            createdBy: r.created_by,
            totalRows: r.total_rows,
            matchedCount: r.matched_count,
            notMatchedCount: r.not_matched_count,
            totalWeight: r.total_weight_all,
            driversCount: r.drivers_count || 0
        }));
        res.json(summaries);
    } catch (e) {
        console.error('❌ خطأ في جلب تقارير الميزان:', e);
        res.status(500).json({ error: 'خطأ في جلب التقارير: ' + e.message });
    }
});

app.get('/api/scale-reports/:id', requireAuth, async (req, res) => {
    try {
        const reportId = req.params.id;
        const result = await pool.query('SELECT * FROM scale_reports WHERE report_id = $1', [reportId]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'التقرير غير موجود' });
        const r = result.rows[0];
        res.json({
            id: r.report_id,
            dbId: r.id,
            reportName: r.report_name,
            reportDate: r.report_date,
            createdAt: r.created_at,
            createdBy: r.created_by,
            data: {
                totalRows: r.total_rows,
                matchedCount: r.matched_count,
                notMatchedCount: r.not_matched_count,
                totalWeightAll: parseFloat(r.total_weight_all) || 0,
                driversStats: r.drivers_stats || [],
                materialsStats: r.materials_stats || [],
                top10Drivers: r.top10_drivers || []
            }
        });
    } catch (e) {
        console.error('❌ خطأ في جلب تقرير الميزان:', e);
        res.status(500).json({ error: 'خطأ في جلب التقرير: ' + e.message });
    }
});

app.delete('/api/scale-reports/:id', requireAuth, async (req, res) => {
    try {
        const reportId = req.params.id;
        const findResult = await pool.query('SELECT report_name FROM scale_reports WHERE report_id = $1', [reportId]);
        if (findResult.rows.length === 0) return res.status(404).json({ error: 'التقرير غير موجود' });
        const reportName = findResult.rows[0].report_name;
        await pool.query('DELETE FROM scale_reports WHERE report_id = $1', [reportId]);
        await logAction(req, 'حذف تقرير ميزان', `تم حذف تقرير: ${reportName}`, null);
        res.json({ success: true, message: 'تم حذف التقرير بنجاح' });
    } catch (e) {
        console.error('❌ خطأ في حذف تقرير الميزان:', e);
        res.status(500).json({ error: 'خطأ في حذف التقرير: ' + e.message });
    }
});

// ==================== صفحات HTML ====================
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});
app.get('/', (req, res) => {
    if (req.session && req.session.user) {
        if (req.session.user.role === 'client') res.redirect('/orders.html');
        else res.redirect('/index.html');
    } else {
        res.redirect('/login.html');
    }
});

const allProtectedPages = ['index.html', 'orders.html', 'distribution.html', 'trucks.html', 'products.html', 'factories.html', 'reports.html', 'settings.html', 'restrictions.html', 'users.html', 'logs.html', 'upload-report.html', 'scale_report.html'];
allProtectedPages.forEach(page => {
    app.get(`/${page}`, (req, res) => {
        if (!req.session || !req.session.user) return res.redirect('/login.html');
        const role = req.session.user.role;
        if (role === 'client' && page !== 'orders.html') return res.redirect('/orders.html');
        res.sendFile(path.join(__dirname, page));
    });
});

app.use(express.static(__dirname, {
    setHeaders: (res, filePath) => {
        const base = path.basename(filePath);
        if (allProtectedPages.includes(base) || base === 'login.html') res.status(404).end();
    }
}));

// ==================== تشغيل السيرفر ====================
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
