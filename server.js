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

// ==================== التحقق من متغيرات البيئة الأساسية ====================
if (!process.env.DATABASE_URL) {
    console.error('❌ FATAL: DATABASE_URL environment variable is not set.');
    console.error('   Please add it in Railway -> Variables -> DATABASE_URL');
    process.exit(1);
}
console.log('✅ DATABASE_URL found (value hidden for security)');

// ==================== إعداد قاعدة البيانات ====================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // ضروري لـ Neon
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

// دالة اتصال مع Retry بسيطة
async function connectWithRetry(retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const client = await pool.connect();
            console.log(`✅ Connected to Neon successfully (attempt ${i+1})`);
            client.release();
            return true;
        } catch (err) {
            console.log(`⚠️ Connection attempt ${i+1}/${retries} failed: ${err.message}`);
            if (i < retries - 1) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }
    throw new Error('❌ Failed to connect to Neon after multiple attempts');
}

// ==================== تعريف الأذونات (نفس الأصل) ====================
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

// ==================== إنشاء الجداول ====================
async function initDatabaseTables() {
    try {
        await connectWithRetry();

        await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username VARCHAR(100) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL, role VARCHAR(50) NOT NULL, factory VARCHAR(255), permissions JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY DEFAULT 1, factories JSONB NOT NULL DEFAULT '[]', materials JSONB NOT NULL DEFAULT '[]', trucks JSONB NOT NULL DEFAULT '[]')`);
        await pool.query(`CREATE TABLE IF NOT EXISTS restrictions (id SERIAL PRIMARY KEY, truck_number VARCHAR(100) NOT NULL, driver_name VARCHAR(100) NOT NULL, restricted_factories JSONB NOT NULL DEFAULT '[]', reason TEXT, active BOOLEAN DEFAULT true, created_by VARCHAR(100), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS logs (id SERIAL PRIMARY KEY, username VARCHAR(100) NOT NULL, action VARCHAR(255) NOT NULL, details TEXT, location VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS daily_data (date_key VARCHAR(10) PRIMARY KEY, orders JSONB NOT NULL DEFAULT '[]', distribution JSONB NOT NULL DEFAULT '[]', updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS reports (id SERIAL PRIMARY KEY, filename VARCHAR(255) NOT NULL, report_date VARCHAR(50), data JSONB NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS uploaded_files (id SERIAL PRIMARY KEY, original_name VARCHAR(255) NOT NULL, file_data TEXT NOT NULL, uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, uploaded_by VARCHAR(100), report_name VARCHAR(255))`);
        await pool.query(`CREATE TABLE IF NOT EXISTS scale_reports (id SERIAL PRIMARY KEY, report_id VARCHAR(100) UNIQUE NOT NULL, report_name VARCHAR(255) NOT NULL, report_date VARCHAR(50), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, created_by VARCHAR(100), total_rows INTEGER, matched_count INTEGER, not_matched_count INTEGER, total_weight_all NUMERIC, drivers_stats JSONB, materials_stats JSONB, top10_drivers JSONB)`);

        console.log('✅ جميع الجداول جاهزة');

        // المستخدمين الافتراضيين
        const defaultUsers = [
            { username: 'admin', password: 'admin', role: 'admin', factory: null, permissions: adminPermissionsDef },
            { username: 'user', password: 'user', role: 'user', factory: null, permissions: userPermissionsDef },
            { username: 'client', password: 'client', role: 'client', factory: null, permissions: clientPermissionsDef }
        ];

        for (const u of defaultUsers) {
            const exists = await pool.query('SELECT id FROM users WHERE username = $1', [u.username]);
            if (exists.rows.length === 0) {
                const hashed = await bcrypt.hash(u.password, 10);
                await pool.query(`INSERT INTO users (username, password, role, factory, permissions) VALUES ($1, $2, $3, $4, $5)`,
                    [u.username, hashed, u.role, u.factory, JSON.stringify(u.permissions)]);
                console.log(`✅ تم إنشاء المستخدم ${u.username}`);
            }
        }

        // الإعدادات الافتراضية
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
            await pool.query(`INSERT INTO settings (id, factories, materials, trucks) VALUES (1, $1, $2, $3)`,
                [JSON.stringify(defaultFactories), JSON.stringify(defaultMaterials), JSON.stringify([])]);
            console.log('✅ تم إنشاء الإعدادات الافتراضية');
        }

    } catch (err) {
        console.error('❌ خطأ في إنشاء الجداول', err);
        throw err;
    }
}

// ==================== Middleware ====================
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'gravel-system-super-secret-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' },
    name: 'gravel.sid',
    proxy: true
}));

// إعداد multer
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
        await pool.query(`INSERT INTO logs (username, action, details, location) VALUES ($1, $2, $3, $4)`,
            [username, action, details || null, location || null]);
    } catch (err) {
        console.error('خطأ في تسجيل الحدث', err);
    }
}

async function getUserByUsername(username) {
    const res = await pool.query(`SELECT * FROM users WHERE username = $1`, [username.toLowerCase()]);
    return res.rows[0];
}

async function getUserById(id) {
    const res = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
    return res.rows[0];
}

// ==================== Routes (API) ====================
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
    if (req.session.user) await logAction(req, 'تسجيل خروج', 'تم تسجيل الخروج', null);
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', requireAuth, (req, res) => {
    res.json({ user: req.session.user });
});

app.get('/api/settings', requireAuth, async (req, res) => {
    const result = await pool.query(`SELECT factories, materials, trucks FROM settings WHERE id = 1`);
    res.json(result.rows[0] || { factories: [], materials: [], trucks: [] });
});

app.put('/api/settings', requireAuth, requireAdmin, async (req, res) => {
    const { factories, materials, trucks } = req.body;
    await pool.query(`UPDATE settings SET factories = $1, materials = $2, trucks = $3 WHERE id = 1`,
        [JSON.stringify(factories), JSON.stringify(materials), JSON.stringify(trucks)]);
    res.json({ success: true });
});

app.get('/api/day/:date', requireAuth, async (req, res) => {
    const date = req.params.date;
    const result = await pool.query(`SELECT * FROM daily_data WHERE date_key = $1`, [date]);
    if (result.rows.length === 0) return res.json({ orders: [], distribution: [] });
    res.json({ orders: result.rows[0].orders || [], distribution: result.rows[0].distribution || [] });
});

app.put('/api/day/:date', requireAuth, async (req, res) => {
    const date = req.params.date;
    const { orders, distribution } = req.body;
    await pool.query(`
        INSERT INTO daily_data (date_key, orders, distribution, updated_at) 
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        ON CONFLICT (date_key) DO UPDATE 
        SET orders = $2, distribution = $3, updated_at = CURRENT_TIMESTAMP`,
        [date, JSON.stringify(orders || []), JSON.stringify(distribution || [])]);
    res.json({ success: true });
});

// ==================== إدارة المستخدمين (API) ====================
app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
    const result = await pool.query(`SELECT id, username, role, factory, permissions, created_at FROM users ORDER BY id`);
    res.json(result.rows);
});

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
    const { username, password, role, factory, permissions } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'مطلوب' });
    const exists = await pool.query(`SELECT id FROM users WHERE LOWER(username) = LOWER($1)`, [username]);
    if (exists.rows.length) return res.status(400).json({ error: 'اسم المستخدم موجود' });
    const hashed = bcrypt.hashSync(password, 10);
    const finalRole = role || 'user';
    const finalFactory = (finalRole === 'client' && factory) ? factory : null;
    const finalPermissions = permissions && typeof permissions === 'object' ? permissions : {};
    await pool.query(
        `INSERT INTO users (username, password, role, factory, permissions) VALUES ($1, $2, $3, $4, $5)`,
        [username, hashed, finalRole, finalFactory, JSON.stringify(finalPermissions)]
    );
    res.status(201).json({ success: true });
});

app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const { role, password, factory, permissions } = req.body;
    const updates = [];
    const values = [];
    if (role) { updates.push(`role = $${updates.length+1}`); values.push(role); }
    if (password) { updates.push(`password = $${updates.length+1}`); values.push(bcrypt.hashSync(password, 10)); }
    if (role === 'client' && factory !== undefined) { updates.push(`factory = $${updates.length+1}`); values.push(factory); }
    else if (role !== 'client') { updates.push(`factory = NULL`); }
    if (permissions !== undefined && typeof permissions === 'object') {
        updates.push(`permissions = $${updates.length+1}`);
        values.push(JSON.stringify(permissions));
    }
    if (updates.length === 0) return res.json({ success: true });
    values.push(id);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
    res.json({ success: true });
});

app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const user = await pool.query(`SELECT username FROM users WHERE id = $1`, [id]);
    if (!user.rows.length) return res.status(404).json({ error: 'غير موجود' });
    if (user.rows[0].username.toLowerCase() === 'admin') return res.status(400).json({ error: 'لا يمكن حذف المدير الرئيسي' });
    await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    res.json({ success: true });
});

// ==================== القيود (Restrictions) API ====================
app.get('/api/restrictions', requireAuth, async (req, res) => {
    const result = await pool.query(`SELECT * FROM restrictions ORDER BY created_at DESC`);
    res.json(result.rows);
});

app.post('/api/restrictions', requireAuth, async (req, res) => {
    const { truckNumber, driverName, restrictedFactories, reason } = req.body;
    if (!truckNumber || !restrictedFactories || !restrictedFactories.length) return res.status(400).json({ error: 'بيانات ناقصة' });
    const result = await pool.query(
        `INSERT INTO restrictions (truck_number, driver_name, restricted_factories, reason, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [truckNumber, driverName, JSON.stringify(restrictedFactories), reason, req.session.user.username || 'system']
    );
    res.status(201).json(result.rows[0]);
});

app.put('/api/restrictions/:id', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const { active } = req.body;
    await pool.query(`UPDATE restrictions SET active = $1 WHERE id = $2`, [active, id]);
    res.json({ success: true });
});

app.delete('/api/restrictions/:id', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    await pool.query(`DELETE FROM restrictions WHERE id = $1`, [id]);
    res.json({ success: true });
});

// ==================== السجلات (Logs) API ====================
app.get('/api/logs', requireAuth, requireAdmin, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const countResult = await pool.query(`SELECT COUNT(*) FROM logs`);
    const total = parseInt(countResult.rows[0].count);
    const result = await pool.query(`SELECT * FROM logs ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
    res.json({ logs: result.rows, totalPages: Math.ceil(total / limit), currentPage: page, total });
});

app.get('/api/logs/all', requireAuth, requireAdmin, async (req, res) => {
    const result = await pool.query(`SELECT * FROM logs ORDER BY created_at DESC`);
    res.json(result.rows);
});

app.delete('/api/logs/clear', requireAuth, requireAdmin, async (req, res) => {
    await pool.query(`DELETE FROM logs`);
    res.json({ success: true });
});

// ==================== النسخ الاحتياطي (Backup) API ====================
app.get('/api/backup', requireAuth, requireAdmin, async (req, res) => {
    const settings = await pool.query(`SELECT * FROM settings WHERE id = 1`);
    const users = await pool.query(`SELECT id, username, role, factory, permissions, created_at FROM users`);
    const restrictions = await pool.query(`SELECT * FROM restrictions`);
    res.json({
        settings: settings.rows[0] || { factories: [], materials: [], trucks: [] },
        users: users.rows,
        restrictions: restrictions.rows,
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
        await pool.query(`DELETE FROM restrictions`);
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
    await pool.query(`DELETE FROM daily_data`);
    await pool.query(`DELETE FROM restrictions`);
    res.json({ success: true });
});

// ==================== التقارير (Reports) API ====================
app.post('/api/upload-report', requireAuth, async (req, res) => {
    const { filename, report_date, data } = req.body;
    const result = await pool.query(
        `INSERT INTO reports (filename, report_date, data) VALUES ($1, $2, $3) RETURNING id`,
        [filename, report_date, JSON.stringify(data)]
    );
    res.json({ success: true, id: result.rows[0].id });
});

app.get('/api/reports-list', requireAuth, async (req, res) => {
    const { filename } = req.query;
    if (filename) {
        const result = await pool.query(`SELECT * FROM reports WHERE filename ILIKE $1 ORDER BY id DESC`, [`%${filename}%`]);
        return res.json(result.rows);
    }
    const result = await pool.query(`SELECT * FROM reports ORDER BY id DESC`);
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

// ==================== رفع الملفات (File Upload) API ====================
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

// ==================== تقارير الميزان (Scale Reports) API ====================
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

// ==================== ملفات ثابتة وخدمة HTML ====================
// تقديم الملفات الثابتة من المجلد الحالي
app.use(express.static(path.join(__dirname)));

// مسار اختبار بسيط للتأكد من أن الخادم يستجيب
app.get('/ping', (req, res) => {
    res.send('pong');
});

// المسار الرئيسي (الجذر) - يعرض login.html مباشرة
app.get('/', (req, res) => {
    // إذا كان المستخدم مسجلاً دخوله، وجه إلى الصفحة الرئيسية (index.html)
    if (req.session && req.session.user) {
        if (req.session.user.role === 'client') {
            return res.redirect('/orders.html');
        }
        return res.redirect('/index.html');
    }
    // وإلا أظهر صفحة تسجيل الدخول
    res.sendFile(path.join(__dirname, 'login.html'));
});

// حماية الصفحات المحمية (يمكن الوصول إليها فقط بعد تسجيل الدخول)
const protectedPages = ['index.html', 'orders.html', 'distribution.html', 'trucks.html', 'products.html', 'factories.html', 'reports.html', 'settings.html', 'restrictions.html', 'users.html', 'logs.html', 'upload-report.html', 'scale_report.html', 'expenses.html', 'cash_orders.html'];

protectedPages.forEach(page => {
    app.get(`/${page}`, (req, res) => {
        if (!req.session?.user) return res.redirect('/login.html');
        if (req.session.user.role === 'client' && page !== 'orders.html') return res.redirect('/orders.html');
        res.sendFile(path.join(__dirname, page));
    });
});

// صفحة تسجيل الدخول (عرض مباشر)
app.get('/login.html', (req, res) => {
    if (req.session?.user) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'login.html'));
});

// معالجة 404
app.use((req, res) => {
    res.status(404).send('الصفحة غير موجودة 404');
});

// ==================== بدء التشغيل ====================
async function startServer() {
    try {
        await initDatabaseTables();
        app.listen(PORT, () => {
            console.log(`🚀 Server running on http://localhost:${PORT}`);
            console.log(`👤 admin/admin , user/user , client/client`);
        });
    } catch (err) {
        console.error('❌ فشل بدء الخادم', err);
        process.exit(1);
    }
}

startServer();
