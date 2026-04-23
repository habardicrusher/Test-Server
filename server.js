const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== إعداد قاعدة البيانات PostgreSQL ====================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    // يمكن إضافة عدد الاتصالات القصوى حسب الحاجة
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// دالة إنشاء الجداول إذا لم تكن موجودة
async function initDatabaseTables() {
    try {
        // جدول المستخدمين
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(50) NOT NULL,
                factory VARCHAR(255),
                permissions JSONB NOT NULL DEFAULT '{}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        // جدول إعدادات النظام (صف واحد فقط)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY DEFAULT 1,
                factories JSONB NOT NULL DEFAULT '[]',
                materials JSONB NOT NULL DEFAULT '[]',
                trucks JSONB NOT NULL DEFAULT '[]'
            )
        `);
        // جدول القيود / الحظر
        await pool.query(`
            CREATE TABLE IF NOT EXISTS restrictions (
                id SERIAL PRIMARY KEY,
                truck_number VARCHAR(100) NOT NULL,
                driver_name VARCHAR(100) NOT NULL,
                restricted_factories JSONB NOT NULL DEFAULT '[]',
                reason TEXT,
                active BOOLEAN DEFAULT true,
                created_by VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        // جدول السجلات
        await pool.query(`
            CREATE TABLE IF NOT EXISTS logs (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) NOT NULL,
                action VARCHAR(255) NOT NULL,
                details TEXT,
                location VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        // جدول البيانات اليومية (الطلبات والتوزيع) – سنخزنها كـ JSON
        await pool.query(`
            CREATE TABLE IF NOT EXISTS daily_data (
                date_key VARCHAR(10) PRIMARY KEY,
                orders JSONB NOT NULL DEFAULT '[]',
                distribution JSONB NOT NULL DEFAULT '[]',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        // جدول التقارير المرسلة من الواجهة (التحليلات)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS reports (
                id SERIAL PRIMARY KEY,
                filename VARCHAR(255) NOT NULL,
                report_date VARCHAR(50),
                data JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        // جدول الملفات المرفوعة (Excel)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS uploaded_files (
                id SERIAL PRIMARY KEY,
                original_name VARCHAR(255) NOT NULL,
                file_data TEXT NOT NULL,  -- base64
                uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                uploaded_by VARCHAR(100),
                report_name VARCHAR(255)
            )
        `);
        // جدول تقارير الميزان المتقدمة
        await pool.query(`
            CREATE TABLE IF NOT EXISTS scale_reports (
                id SERIAL PRIMARY KEY,
                report_id VARCHAR(100) UNIQUE NOT NULL,
                report_name VARCHAR(255) NOT NULL,
                report_date VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by VARCHAR(100),
                total_rows INTEGER,
                matched_count INTEGER,
                not_matched_count INTEGER,
                total_weight_all NUMERIC,
                drivers_stats JSONB,
                materials_stats JSONB,
                top10_drivers JSONB
            )
        `);
        console.log('✅ جميع الجداول جاهزة');

        // إدراج المستخدمين الافتراضيين إذا لم يكونوا موجودين
        const defaultUsers = [
            { username: 'admin', password: 'admin', role: 'admin', factory: null, permissions: adminPermissionsDef },
            { username: 'user', password: 'user', role: 'user', factory: null, permissions: userPermissionsDef },
            { username: 'client', password: 'client', role: 'client', factory: null, permissions: clientPermissionsDef }
        ];
        for (const u of defaultUsers) {
            const exists = await pool.query('SELECT id FROM users WHERE username = $1', [u.username]);
            if (exists.rows.length === 0) {
                const hashed = await bcrypt.hash(u.password, 10);
                await pool.query(
                    `INSERT INTO users (username, password, role, factory, permissions) VALUES ($1, $2, $3, $4, $5)`,
                    [u.username, hashed, u.role, u.factory, JSON.stringify(u.permissions)]
                );
                console.log(`✅ تم إنشاء المستخدم ${u.username}`);
            }
        }

        // إدراج الإعدادات الافتراضية إذا لم توجد
        const settingsExist = await pool.query('SELECT id FROM settings WHERE id = 1');
        if (settingsExist.rows.length === 0) {
            const defaultFactories = [
                { name: 'SCCCL', location: 'الدمام' },
                { name: 'الحارث للمنتجات الاسمنيه', location: 'الدمام' },
                { name: 'الحارثي القديم', location: 'الدمام' },
                { name: 'المعجل لمنتجات الاسمنت', location: 'الدمام' },
                { name: 'الحارث العزيزية', location: 'الدمام' },
                { name: 'سارمكس النظيم', location: 'الرياض' },
                { name: 'عبر الخليج', location: 'الرياض' },
                { name: 'الكفاح للخرسانة الجاهزة', location: 'الدمام' },
                { name: 'القيشان 3', location: 'الدمام' },
                { name: 'القيشان 2 - الأحجار الشرقية', location: 'الدمام' },
                { name: 'القيشان 1', location: 'الدمام' },
                { name: 'الفهد للبلوك والخرسانة', location: 'الرياض' }
            ];
            const defaultMaterials = ['3/4', '3/8', '3/16'];
            await pool.query(
                `INSERT INTO settings (id, factories, materials, trucks) VALUES (1, $1, $2, $3)`,
                [JSON.stringify(defaultFactories), JSON.stringify(defaultMaterials), JSON.stringify([])]
            );
            console.log('✅ تم إنشاء الإعدادات الافتراضية');
        }
    } catch (err) {
        console.error('❌ خطأ في إنشاء الجداول', err);
    }
}

// تعريف الأذونات المبدئية
const adminPermissionsDef = {
    manageUsers: true, manageRestrictions: true,
    viewOrders: true, addOrders: true, editOrders: true, deleteOrders: true,
    viewDistribution: true, manageDistribution: true,
    viewTrucks: true, manageTrucks: true,
    viewReports: true, exportReports: true,
    viewSettings: true, manageSettings: true,
    viewBackup: true, manageBackup: true
};
const userPermissionsDef = {
    manageUsers: false, manageRestrictions: false,
    viewOrders: true, addOrders: true, editOrders: true, deleteOrders: true,
    viewDistribution: true, manageDistribution: true,
    viewTrucks: true, manageTrucks: true,
    viewReports: true, exportReports: true,
    viewSettings: false, manageSettings: false,
    viewBackup: false, manageBackup: false
};
const clientPermissionsDef = {
    manageUsers: false, manageRestrictions: false,
    viewOrders: true, addOrders: true, editOrders: true, deleteOrders: false,
    viewDistribution: false, manageDistribution: false,
    viewTrucks: false, manageTrucks: false,
    viewReports: false, exportReports: false,
    viewSettings: false, manageSettings: false,
    viewBackup: false, manageBackup: false
};

// إعداد middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'gravel-system-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' },
    name: 'gravel.sid',
    proxy: false
}));

// تخزين multer مؤقت
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, '/tmp'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// ==================== دوال مساعدة ====================
function requireAuth(req, res, next) {
    if (req.session && req.session.user) return next();
    res.status(401).json({ error: 'غير مصرح' });
}
function requireAdmin(req, res, next) {
    if (req.session?.user?.role === 'admin') return next();
    res.status(403).json({ error: 'صلاحيات المدير مطلوبة' });
}
async function logAction(req, action, details, location) {
    try {
        const username = req.session?.user?.username || 'unknown';
        await pool.query(
            `INSERT INTO logs (username, action, details, location) VALUES ($1, $2, $3, $4)`,
            [username, action, details || null, location || null]
        );
    } catch (err) {
        console.error('خطأ في تسجيل الحدث', err);
    }
}
// دالة لجلب المستخدم حسب اسم المستخدم
async function getUserByUsername(username) {
    const res = await pool.query(`SELECT * FROM users WHERE username = $1`, [username.toLowerCase()]);
    return res.rows[0];
}
// دالة لجلب المستخدم حسب id
async function getUserById(id) {
    const res = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
    return res.rows[0];
}
// دالة لجلب السجلات مع pagination
async function getLogsPaginated(limit, offset) {
    const res = await pool.query(
        `SELECT * FROM logs ORDER BY id DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
    );
    return res.rows;
}
async function getLogsCount() {
    const res = await pool.query(`SELECT COUNT(*) FROM logs`);
    return parseInt(res.rows[0].count);
}

// ==================== مسارات API ====================
// تسجيل الدخول
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
    await logAction(req, 'تسجيل خروج', `تسجيل خروج`, null);
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', requireAuth, (req, res) => {
    res.json({ user: req.session.user });
});

// الإعدادات
app.get('/api/settings', requireAuth, async (req, res) => {
    const result = await pool.query(`SELECT factories, materials, trucks FROM settings WHERE id = 1`);
    if (result.rows.length === 0) return res.json({ factories: [], materials: [], trucks: [] });
    let settings = result.rows[0];
    if (req.session.user.role === 'client' && req.session.user.factory) {
        settings.factories = settings.factories.filter(f => f.name === req.session.user.factory);
    }
    res.json(settings);
});

app.put('/api/settings', requireAuth, requireAdmin, async (req, res) => {
    const { factories, materials, trucks } = req.body;
    await pool.query(
        `UPDATE settings SET factories = $1, materials = $2, trucks = $3 WHERE id = 1`,
        [JSON.stringify(factories), JSON.stringify(materials), JSON.stringify(trucks)]
    );
    res.json({ success: true });
});

// البيانات اليومية
app.get('/api/day/:date', requireAuth, async (req, res) => {
    const date = req.params.date;
    const result = await pool.query(`SELECT * FROM daily_data WHERE date_key = $1`, [date]);
    if (result.rows.length === 0) return res.json({ orders: [], distribution: [] });
    res.json({ orders: result.rows[0].orders || [], distribution: result.rows[0].distribution || [] });
});

app.put('/api/day/:date', requireAuth, async (req, res) => {
    const date = req.params.date;
    const { orders, distribution } = req.body;
    await pool.query(
        `INSERT INTO daily_data (date_key, orders, distribution, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (date_key) DO UPDATE SET orders = $2, distribution = $3, updated_at = CURRENT_TIMESTAMP`,
        [date, JSON.stringify(orders || []), JSON.stringify(distribution || [])]
    );
    res.json({ success: true });
});

// المستخدمون
app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
    const result = await pool.query(`SELECT id, username, role, factory, permissions, created_at FROM users ORDER BY id`);
    res.json(result.rows);
});

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
    const { username, password, role, factory, permissions } = req.body;
    const existing = await getUserByUsername(username);
    if (existing) return res.status(400).json({ error: 'اسم المستخدم موجود بالفعل' });
    const hashed = await bcrypt.hash(password, 10);
    await pool.query(
        `INSERT INTO users (username, password, role, factory, permissions) VALUES ($1, $2, $3, $4, $5)`,
        [username.toLowerCase(), hashed, role, factory, JSON.stringify(permissions)]
    );
    res.json({ success: true });
});

app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const { username, role, factory, permissions, password } = req.body;
    let updateQuery = `UPDATE users SET username = $1, role = $2, factory = $3, permissions = $4 WHERE id = $5`;
    let params = [username.toLowerCase(), role, factory, JSON.stringify(permissions), id];
    if (password) {
        const hashed = await bcrypt.hash(password, 10);
        updateQuery = `UPDATE users SET username = $1, role = $2, factory = $3, permissions = $4, password = $5 WHERE id = $6`;
        params = [username.toLowerCase(), role, factory, JSON.stringify(permissions), hashed, id];
    }
    await pool.query(updateQuery, params);
    res.json({ success: true });
});

app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const user = await getUserById(id);
    if (user && user.username !== 'admin') {
        await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    }
    res.json({ success: true });
});

// القيود
app.get('/api/restrictions', requireAuth, async (req, res) => {
    const result = await pool.query(`SELECT * FROM restrictions ORDER BY id DESC`);
    res.json(result.rows);
});

app.post('/api/restrictions', requireAuth, async (req, res) => {
    if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
    const { truckNumber, driverName, restrictedFactories, reason } = req.body;
    await pool.query(
        `INSERT INTO restrictions (truck_number, driver_name, restricted_factories, reason, created_by) VALUES ($1, $2, $3, $4, $5)`,
        [truckNumber, driverName, JSON.stringify(restrictedFactories || []), reason || '', req.session.user.username]
    );
    res.json({ success: true });
});

app.put('/api/restrictions/:id', requireAuth, async (req, res) => {
    if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
    const id = parseInt(req.params.id);
    const { active } = req.body;
    await pool.query(`UPDATE restrictions SET active = $1 WHERE id = $2`, [active, id]);
    res.json({ success: true });
});

app.delete('/api/restrictions/:id', requireAuth, async (req, res) => {
    if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
    const id = parseInt(req.params.id);
    await pool.query(`DELETE FROM restrictions WHERE id = $1`, [id]);
    res.json({ success: true });
});

// التقارير
app.get('/api/reports', requireAuth, (req, res) => {
    res.json({ allDistributions: [], dailyData: {}, driverStats: [], factoryStats: [], materialStats: [] });
});

// السجلات
app.get('/api/logs', requireAuth, async (req, res) => {
    if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const logsList = await getLogsPaginated(limit, offset);
    const total = await getLogsCount();
    res.json({ logs: logsList, currentPage: page, totalPages: Math.ceil(total / limit), total });
});

app.get('/api/logs/all', requireAuth, async (req, res) => {
    if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const result = await pool.query(`SELECT * FROM logs ORDER BY id DESC`);
    res.json(result.rows);
});

app.delete('/api/logs/clear', requireAuth, requireAdmin, async (req, res) => {
    await pool.query(`TRUNCATE logs`);
    res.json({ success: true });
});

// النسخ الاحتياطي
app.get('/api/backup', requireAuth, requireAdmin, async (req, res) => {
    const settingsRes = await pool.query(`SELECT * FROM settings WHERE id = 1`);
    const usersRes = await pool.query(`SELECT id, username, role, factory, permissions FROM users`);
    const restrictionsRes = await pool.query(`SELECT * FROM restrictions`);
    res.json({
        settings: settingsRes.rows[0] || { factories: [], materials: [], trucks: [] },
        users: usersRes.rows,
        restrictions: restrictionsRes.rows,
        exportDate: new Date().toISOString()
    });
});

app.post('/api/restore', requireAuth, requireAdmin, async (req, res) => {
    const { settings, restrictions } = req.body;
    if (settings) {
        await pool.query(`UPDATE settings SET factories = $1, materials = $2, trucks = $3 WHERE id = 1`,
            [JSON.stringify(settings.factories || []), JSON.stringify(settings.materials || []), JSON.stringify(settings.trucks || [])]);
    }
    if (restrictions && Array.isArray(restrictions)) {
        await pool.query(`TRUNCATE restrictions`);
        for (const r of restrictions) {
            await pool.query(
                `INSERT INTO restrictions (id, truck_number, driver_name, restricted_factories, reason, active, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [r.id, r.truck_number, r.driver_name, JSON.stringify(r.restricted_factories || []), r.reason, r.active, r.created_by, r.created_at]
            );
        }
    }
    res.json({ success: true });
});

app.delete('/api/clear-all', requireAuth, requireAdmin, async (req, res) => {
    await pool.query(`TRUNCATE daily_data, restrictions`);
    res.json({ success: true });
});

// التقارير المرفوعة (التحليل)
app.post('/api/upload-report', requireAuth, async (req, res) => {
    const { filename, report_date, data } = req.body;
    const result = await pool.query(
        `INSERT INTO reports (filename, report_date, data) VALUES ($1, $2, $3) RETURNING id`,
        [filename, report_date, JSON.stringify(data)]
    );
    res.json({ success: true, id: result.rows[0].id });
});

app.get('/api/reports-list', requireAuth, async (req, res) => {
    let query = `SELECT * FROM reports ORDER BY id DESC`;
    if (req.query.filename) {
        query = `SELECT * FROM reports WHERE filename ILIKE $1 ORDER BY id DESC`;
        const result = await pool.query(query, [`%${req.query.filename}%`]);
        return res.json(result.rows);
    }
    const result = await pool.query(query);
    res.json(result.rows);
});

app.get('/api/reports/:id', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const result = await pool.query(`SELECT * FROM reports WHERE id = $1`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'غير موجود' });
    res.json(result.rows[0]);
});

app.delete('/api/reports/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    await pool.query(`DELETE FROM reports WHERE id = $1`, [id]);
    res.json({ success: true });
});

// رفع ملف Excel
app.post('/api/upload-excel-report', upload.single('excelFile'), async (req, res) => {
    try {
        const { reportName, reportDate, vehicleData } = req.body;
        const file = req.file;
        if (!file) return res.status(400).json({ error: 'لم يتم رفع الملف' });
        const fileData = fs.readFileSync(file.path);
        await pool.query(
            `INSERT INTO uploaded_files (original_name, file_data, uploaded_by, report_name) VALUES ($1, $2, $3, $4)`,
            [file.originalname, fileData.toString('base64'), req.session.user.username, reportName]
        );
        await pool.query(
            `INSERT INTO reports (filename, report_date, data) VALUES ($1, $2, $3)`,
            [reportName, reportDate, JSON.stringify(JSON.parse(vehicleData))]
        );
        fs.unlinkSync(file.path);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// تحميل الملفات
app.get('/api/uploaded-files', requireAuth, async (req, res) => {
    const result = await pool.query(`SELECT id, original_name, uploaded_at, uploaded_by, report_name FROM uploaded_files ORDER BY id DESC`);
    res.json(result.rows);
});

app.get('/api/download-file/:id', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const result = await pool.query(`SELECT original_name, file_data FROM uploaded_files WHERE id = $1`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'الملف غير موجود' });
    const file = result.rows[0];
    const buffer = Buffer.from(file.file_data, 'base64');
    res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
});

// تقارير الميزان
app.post('/api/scale-reports', requireAuth, async (req, res) => {
    const { reportName, reportDate, data } = req.body;
    const reportId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    await pool.query(
        `INSERT INTO scale_reports (report_id, report_name, report_date, created_by, total_rows, matched_count, not_matched_count, total_weight_all, drivers_stats, materials_stats, top10_drivers)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [reportId, reportName, reportDate, req.session.user.username, data.totalRows, data.matchedCount, data.notMatchedCount, data.totalWeightAll,
         JSON.stringify(data.driversStats || []), JSON.stringify(data.materialsStats || []), JSON.stringify(data.top10Drivers || [])]
    );
    res.json({ success: true, id: reportId });
});

app.get('/api/scale-reports', requireAuth, async (req, res) => {
    const result = await pool.query(`SELECT report_id as id, report_name as "reportName", report_date as "reportDate", created_at as "createdAt", created_by as "createdBy", total_rows as "totalRows" FROM scale_reports ORDER BY id DESC`);
    res.json(result.rows);
});

app.get('/api/scale-reports/:id', requireAuth, async (req, res) => {
    const id = req.params.id;
    const result = await pool.query(`SELECT * FROM scale_reports WHERE report_id = $1`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'غير موجود' });
    res.json(result.rows[0]);
});

app.delete('/api/scale-reports/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = req.params.id;
    await pool.query(`DELETE FROM scale_reports WHERE report_id = $1`, [id]);
    res.json({ success: true });
});

// ==================== ملفات HTML وخدمة الملفات الثابتة ====================
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/', (req, res) => {
    if (req.session?.user) {
        if (req.session.user.role === 'client') res.redirect('/orders.html');
        else res.redirect('/index.html');
    } else {
        res.redirect('/login.html');
    }
});

const protectedPages = ['index.html', 'orders.html', 'distribution.html', 'trucks.html', 'products.html', 'factories.html', 'reports.html', 'settings.html', 'restrictions.html', 'users.html', 'logs.html', 'upload-report.html', 'scale_report.html', 'expenses.html', 'cash_orders.html'];
protectedPages.forEach(page => {
    app.get(`/${page}`, (req, res) => {
        if (!req.session?.user) return res.redirect('/login.html');
        if (req.session.user.role === 'client' && page !== 'orders.html') return res.redirect('/orders.html');
        res.sendFile(path.join(__dirname, page));
    });
});

app.use(express.static(__dirname, {
    setHeaders: (res, filePath) => {
        const base = path.basename(filePath);
        if (protectedPages.includes(base) || base === 'login.html') res.status(404).end();
    }
}));

// ==================== بدء التشغيل ====================
async function startServer() {
    await initDatabaseTables();
    app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
        console.log(`👤 بيانات الدخول: admin/admin , user/user , client/client`);
        console.log(`📦 قاعدة البيانات: ${process.env.DATABASE_URL ? 'Neon/PostgreSQL متصلة' : 'غير متصلة (DATABASE_URL مفقودة)'}`);
    });
}

startServer().catch(err => {
    console.error('❌ فشل بدء الخادم', err);
});
