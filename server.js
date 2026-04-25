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

// ==================== التحقق من متغيرات البيئة ====================
if (!process.env.DATABASE_URL) {
    console.error('❌ FATAL: DATABASE_URL environment variable is not set.');
    process.exit(1);
}
console.log('✅ DATABASE_URL found');

// ==================== إعداد قاعدة البيانات ====================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

async function connectWithRetry(retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const client = await pool.connect();
            console.log(`✅ Connected to Neon successfully (attempt ${i+1})`);
            client.release();
            return true;
        } catch (err) {
            console.log(`⚠️ Connection attempt ${i+1}/${retries} failed: ${err.message}`);
            if (i < retries - 1) await new Promise(r => setTimeout(r, 2000));
        }
    }
    throw new Error('❌ Failed to connect to Neon after multiple attempts');
}

// ==================== صلاحيات المستخدمين ====================
const adminPermissions = {
    manageUsers: true, manageRestrictions: true,
    viewOrders: true, addOrders: true, editOrders: true, deleteOrders: true,
    viewDistribution: true, manageDistribution: true,
    viewTrucks: true, manageTrucks: true,
    viewReports: true, exportReports: true,
    viewSettings: true, manageSettings: true,
    viewBackup: true, manageBackup: true
};

const userPermissions = {
    manageUsers: false, manageRestrictions: false,
    viewOrders: true, addOrders: true, editOrders: true, deleteOrders: true,
    viewDistribution: true, manageDistribution: true,
    viewTrucks: true, manageTrucks: true,
    viewReports: true, exportReports: true,
    viewSettings: false, manageSettings: false,
    viewBackup: false, manageBackup: false
};

const clientPermissions = {
    manageUsers: false, manageRestrictions: false,
    viewOrders: true, addOrders: true, editOrders: true, deleteOrders: false,
    viewDistribution: false, manageDistribution: false,
    viewTrucks: false, manageTrucks: false,
    viewReports: false, exportReports: false,
    viewSettings: false, manageSettings: false,
    viewBackup: false, manageBackup: false
};

// ==================== إنشاء الجداول ====================
async function initTables() {
    try {
        await connectWithRetry();

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
        await pool.query(`
            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY DEFAULT 1,
                factories JSONB NOT NULL DEFAULT '[]',
                materials JSONB NOT NULL DEFAULT '[]',
                trucks JSONB NOT NULL DEFAULT '[]'
            )
        `);
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
        await pool.query(`
            CREATE TABLE IF NOT EXISTS daily_data (
                date_key VARCHAR(10) PRIMARY KEY,
                orders JSONB NOT NULL DEFAULT '[]',
                distribution JSONB NOT NULL DEFAULT '[]',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS reports (
                id SERIAL PRIMARY KEY,
                filename VARCHAR(255) NOT NULL,
                report_date VARCHAR(50),
                data JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS uploaded_files (
                id SERIAL PRIMARY KEY,
                original_name VARCHAR(255) NOT NULL,
                file_data TEXT NOT NULL,
                uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                uploaded_by VARCHAR(100),
                report_name VARCHAR(255)
            )
        `);
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

        // المستخدمين الافتراضيين
        const defaultUsers = [
            { username: 'admin', password: 'admin', role: 'admin', permissions: adminPermissions },
            { username: 'user', password: 'user', role: 'user', permissions: userPermissions },
            { username: 'client', password: 'client', role: 'client', factory: 'مصنع الفهد', permissions: clientPermissions }
        ];
        for (const u of defaultUsers) {
            const exists = await pool.query('SELECT id FROM users WHERE username = $1', [u.username]);
            if (exists.rows.length === 0) {
                const hashed = await bcrypt.hash(u.password, 10);
                await pool.query(
                    `INSERT INTO users (username, password, role, factory, permissions) VALUES ($1, $2, $3, $4, $5)`,
                    [u.username, hashed, u.role, u.factory || null, JSON.stringify(u.permissions)]
                );
                console.log(`✅ تم إنشاء المستخدم ${u.username}`);
            }
        }

        // الإعدادات الافتراضية
        const settingsExist = await pool.query('SELECT id FROM settings WHERE id = 1');
        if (settingsExist.rows.length === 0) {
            const defaultFactories = [
                { name: 'SCCCL', location: 'الدمام' }, { name: 'الحارث للمنتجات الاسمنيه', location: 'الدمام' },
                { name: 'الحارثي القديم', location: 'الدمام' }, { name: 'المعجل لمنتجات الاسمنت', location: 'الدمام' },
                { name: 'الحارث العزيزية', location: 'الدمام' }, { name: 'سارمكس النظيم', location: 'الرياض' },
                { name: 'عبر الخليج', location: 'الرياض' }, { name: 'الكفاح للخرسانة الجاهزة', location: 'الدمام' },
                { name: 'القيشان 3', location: 'الدمام' }, { name: 'القيشان 2 - الأحجار الشرقية', location: 'الدمام' },
                { name: 'القيشان 1', location: 'الدمام' }, { name: 'الفهد للبلوك والخرسانة', location: 'الرياض' }
            ];
            const defaultMaterials = ['3/4', '3/8', '3/16'];
            await pool.query(
                `INSERT INTO settings (id, factories, materials, trucks) VALUES (1, $1, $2, $3)`,
                [JSON.stringify(defaultFactories), JSON.stringify(defaultMaterials), JSON.stringify([])]
            );
            console.log('✅ تم إنشاء الإعدادات الافتراضية');
        }

        console.log('✅ جميع الجداول جاهزة');
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
    secret: process.env.SESSION_SECRET || 'gravel-system-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' },
    name: 'gravel.sid',
    proxy: true
}));

// إعداد رفع الملفات
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, '/tmp'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// ==================== دوال مساعدة ====================
function requireAuth(req, res, next) {
    if (req.session?.user) return next();
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
    } catch (err) { console.error('فشل تسجيل السجل:', err); }
}

async function getUserByUsername(username) {
    const res = await pool.query(`SELECT * FROM users WHERE LOWER(username) = LOWER($1)`, [username]);
    return res.rows[0];
}

async function getUserById(id) {
    const res = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
    return res.rows[0];
}

// ==================== API Routes ====================
// تسجيل الدخول
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'مطلوب' });
    const user = await getUserByUsername(username);
    if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: 'بيانات غير صحيحة' });
    }
    req.session.user = {
        id: user.id,
        username: user.username,
        role: user.role,
        factory: user.factory,
        permissions: user.permissions
    };
    await logAction(req, 'تسجيل دخول', `تم تسجيل الدخول بنجاح`, null);
    res.json({ success: true, user: req.session.user });
});

app.post('/api/logout', async (req, res) => {
    if (req.session.user) await logAction(req, 'تسجيل خروج', '', null);
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', requireAuth, (req, res) => {
    res.json({ user: req.session.user });
});

// الإعدادات
app.get('/api/settings', requireAuth, async (req, res) => {
    const result = await pool.query(`SELECT factories, materials, trucks FROM settings WHERE id = 1`);
    let settings = result.rows[0] || { factories: [], materials: [], trucks: [] };
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
    await logAction(req, 'تحديث الإعدادات', 'تم تحديث إعدادات النظام', null);
    res.json({ success: true });
});

// البيانات اليومية
app.get('/api/day/:date', requireAuth, async (req, res) => {
    const date = req.params.date;
    const result = await pool.query(`SELECT orders, distribution FROM daily_data WHERE date_key = $1`, [date]);
    if (result.rows.length === 0) return res.json({ orders: [], distribution: [] });
    let orders = result.rows[0].orders || [];
    let distribution = result.rows[0].distribution || [];
    if (req.session.user.role === 'client' && req.session.user.factory) {
        orders = orders.filter(o => o.factory === req.session.user.factory);
        distribution = [];
    }
    res.json({ orders, distribution });
});

app.put('/api/day/:date', requireAuth, async (req, res) => {
    const date = req.params.date;
    let { orders, distribution } = req.body;
    if (req.session.user.role === 'client') {
        if (!orders.every(o => o.factory === req.session.user.factory))
            return res.status(403).json({ error: 'غير مصرح' });
        distribution = [];
    }
    await pool.query(
        `INSERT INTO daily_data (date_key, orders, distribution, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (date_key) DO UPDATE SET orders = $2, distribution = $3, updated_at = CURRENT_TIMESTAMP`,
        [date, JSON.stringify(orders || []), JSON.stringify(distribution || [])]
    );
    res.json({ success: true });
});

app.get('/api/range/:startDate/:endDate', requireAuth, async (req, res) => {
    const { startDate, endDate } = req.params;
    const result = await pool.query(
        `SELECT date_key, orders, distribution FROM daily_data WHERE date_key BETWEEN $1 AND $2 ORDER BY date_key`,
        [startDate, endDate]
    );
    const data = {};
    result.rows.forEach(row => {
        data[row.date_key] = { orders: row.orders, distribution: row.distribution };
    });
    res.json(data);
});

// المستخدمون
app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
    const result = await pool.query(`SELECT id, username, role, factory, permissions, created_at FROM users ORDER BY id`);
    res.json(result.rows);
});

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
    const { username, password, role, factory, permissions } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'مطلوب' });
    const exists = await pool.query(`SELECT id FROM users WHERE LOWER(username) = LOWER($1)`, [username]);
    if (exists.rows.length) return res.status(400).json({ error: 'موجود' });
    const hashed = bcrypt.hashSync(password, 10);
    const finalRole = role || 'user';
    const finalFactory = (finalRole === 'client' && factory) ? factory : null;
    const finalPermissions = permissions || {};
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
    if (permissions !== undefined) { updates.push(`permissions = $${updates.length+1}`); values.push(JSON.stringify(permissions)); }
    if (updates.length === 0) return res.json({ success: true });
    values.push(id);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
    res.json({ success: true });
});

app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const user = await pool.query(`SELECT username FROM users WHERE id = $1`, [id]);
    if (!user.rows.length) return res.status(404).json({ error: 'غير موجود' });
    if (user.rows[0].username === 'admin') return res.status(400).json({ error: 'لا يمكن حذف المدير' });
    await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    res.json({ success: true });
});

// القيود
app.get('/api/restrictions', requireAuth, async (req, res) => {
    const result = await pool.query(`SELECT * FROM restrictions ORDER BY created_at DESC`);
    res.json(result.rows);
});

app.post('/api/restrictions', requireAuth, async (req, res) => {
    if (!req.session.user.permissions?.manageRestrictions && req.session.user.role !== 'admin')
        return res.status(403).json({ error: 'غير مصرح' });
    const { truckNumber, driverName, restrictedFactories, reason } = req.body;
    if (!truckNumber || !restrictedFactories?.length) return res.status(400).json({ error: 'بيانات ناقصة' });
    const result = await pool.query(
        `INSERT INTO restrictions (truck_number, driver_name, restricted_factories, reason, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [truckNumber, driverName, JSON.stringify(restrictedFactories), reason, req.session.user.username]
    );
    res.status(201).json(result.rows[0]);
});

app.put('/api/restrictions/:id', requireAuth, async (req, res) => {
    if (!req.session.user.permissions?.manageRestrictions && req.session.user.role !== 'admin')
        return res.status(403).json({ error: 'غير مصرح' });
    const id = parseInt(req.params.id);
    const { active, restricted_factories, reason } = req.body;
    const updates = [];
    const values = [];
    if (active !== undefined) { updates.push(`active = $${updates.length+1}`); values.push(active); }
    if (restricted_factories !== undefined) { updates.push(`restricted_factories = $${updates.length+1}`); values.push(JSON.stringify(restricted_factories)); }
    if (reason !== undefined) { updates.push(`reason = $${updates.length+1}`); values.push(reason); }
    if (updates.length === 0) return res.json({ success: true });
    updates.push(`updated_at = NOW()`);
    values.push(id);
    await pool.query(`UPDATE restrictions SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
    res.json({ success: true });
});

app.delete('/api/restrictions/:id', requireAuth, async (req, res) => {
    if (!req.session.user.permissions?.manageRestrictions && req.session.user.role !== 'admin')
        return res.status(403).json({ error: 'غير مصرح' });
    const id = parseInt(req.params.id);
    await pool.query(`DELETE FROM restrictions WHERE id = $1`, [id]);
    res.json({ success: true });
});

// السجلات
app.get('/api/logs', requireAuth, requireAdmin, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const count = await pool.query(`SELECT COUNT(*) FROM logs`);
    const total = parseInt(count.rows[0].count);
    const result = await pool.query(
        `SELECT * FROM logs ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
    );
    res.json({ logs: result.rows, totalPages: Math.ceil(total / limit), currentPage: page, total });
});

app.get('/api/logs/all', requireAuth, requireAdmin, async (req, res) => {
    const result = await pool.query(`SELECT * FROM logs ORDER BY created_at DESC`);
    res.json(result.rows);
});

app.delete('/api/logs/clear', requireAuth, requireAdmin, async (req, res) => {
    await pool.query(`DELETE FROM logs`);
    await logAction(req, 'مسح السجلات', 'تم مسح جميع السجلات', null);
    res.json({ success: true });
});

// النسخ الاحتياطي والاستعادة
app.get('/api/backup', requireAuth, requireAdmin, async (req, res) => {
    const settings = await pool.query(`SELECT * FROM settings WHERE id = 1`);
    const users = await pool.query(`SELECT id, username, role, factory, permissions, created_at FROM users`);
    const restrictions = await pool.query(`SELECT * FROM restrictions`);
    const days = await pool.query(`SELECT date_key, orders, distribution FROM daily_data`);
    const daysObj = {};
    days.rows.forEach(row => { daysObj[row.date_key] = { orders: row.orders, distribution: row.distribution }; });
    res.json({
        settings: settings.rows[0] || { factories: [], materials: [], trucks: [] },
        users: users.rows,
        restrictions: restrictions.rows,
        days: daysObj,
        exportDate: new Date().toISOString()
    });
});

app.post('/api/restore', requireAuth, requireAdmin, async (req, res) => {
    const { settings, users, restrictions, days } = req.body;
    await pool.query('BEGIN');
    try {
        if (settings) {
            await pool.query(`UPDATE settings SET factories = $1, materials = $2, trucks = $3 WHERE id = 1`,
                [JSON.stringify(settings.factories || []), JSON.stringify(settings.materials || []), JSON.stringify(settings.trucks || [])]);
        }
        if (users) {
            for (const u of users) {
                if (u.username === 'admin') continue;
                await pool.query(
                    `INSERT INTO users (id, username, role, factory, permissions, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (username) DO UPDATE SET role = $3, factory = $4, permissions = $5`,
                    [u.id, u.username, u.role, u.factory, u.permissions, u.created_at]
                );
            }
        }
        if (restrictions) {
            await pool.query(`DELETE FROM restrictions`);
            for (const r of restrictions) {
                await pool.query(
                    `INSERT INTO restrictions (id, truck_number, driver_name, restricted_factories, reason, active, created_by, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                    [r.id, r.truck_number, r.driver_name, r.restricted_factories, r.reason, r.active, r.created_by, r.created_at, r.updated_at || new Date()]
                );
            }
        }
        if (days) {
            await pool.query(`DELETE FROM daily_data`);
            for (const [date, data] of Object.entries(days)) {
                await pool.query(
                    `INSERT INTO daily_data (date_key, orders, distribution) VALUES ($1, $2, $3)`,
                    [date, JSON.stringify(data.orders || []), JSON.stringify(data.distribution || [])]
                );
            }
        }
        await pool.query('COMMIT');
        await logAction(req, 'استعادة نسخة احتياطية', 'تم استعادة البيانات من ملف JSON', null);
        res.json({ success: true });
    } catch (err) {
        await pool.query('ROLLBACK');
        throw err;
    }
});

app.delete('/api/clear-all', requireAuth, requireAdmin, async (req, res) => {
    await pool.query('BEGIN');
    try {
        await pool.query(`DELETE FROM daily_data`);
        await pool.query(`DELETE FROM scale_reports`);
        await pool.query(`DELETE FROM restrictions`);
        await pool.query(`UPDATE settings SET factories = '[]', materials = '[]', trucks = '[]' WHERE id = 1`);
        await pool.query('COMMIT');
        await logAction(req, 'مسح جميع البيانات', 'تم مسح جميع بيانات النظام', null);
        res.json({ success: true });
    } catch (err) {
        await pool.query('ROLLBACK');
        throw err;
    }
});

// التقارير (رفع وتحليل)
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
    if (!result.rows.length) return res.status(404).json({ error: 'غير موجود' });
    res.json(result.rows[0]);
});

app.delete('/api/reports/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    await pool.query(`DELETE FROM reports WHERE id = $1`, [id]);
    res.json({ success: true });
});

// رفع ملفات Excel
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
    if (!result.rows.length) return res.status(404).json({ error: 'الملف غير موجود' });
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
    if (!result.rows.length) return res.status(404).json({ error: 'غير موجود' });
    res.json(result.rows[0]);
});

app.delete('/api/scale-reports/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = req.params.id;
    await pool.query(`DELETE FROM scale_reports WHERE report_id = $1`, [id]);
    res.json({ success: true });
});

// بيانات الميزان الشهرية
app.get('/api/scale/monthly/:year/:month', requireAuth, async (req, res) => {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    const result = await pool.query(`SELECT data FROM scale_data WHERE year = $1 AND month = $2`, [year, month]);
    res.json(result.rows.length ? result.rows[0].data : {});
});

app.put('/api/scale/monthly/:year/:month', requireAuth, requireAdmin, async (req, res) => {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    const data = req.body;
    await pool.query(
        `INSERT INTO scale_data (year, month, data) VALUES ($1, $2, $3) ON CONFLICT (year, month) DO UPDATE SET data = $3, updated_at = NOW()`,
        [year, month, JSON.stringify(data)]
    );
    res.json({ success: true });
});

// تقارير السيارات غير المستوفية
app.get('/api/truck-violations/report/:startDate/:endDate', requireAuth, async (req, res) => {
    const { startDate, endDate } = req.params;
    // تحليل افتراضي – يمكن توسيعه حسب الحاجة
    res.json([]);
});

app.get('/api/truck-violations/stats/:startDate/:endDate', requireAuth, async (req, res) => {
    res.json({ general: {}, topTrucks: [], topReasons: [] });
});

app.get('/api/truck-violations/:date', requireAuth, async (req, res) => {
    const result = await pool.query(`SELECT truck_number, reason, details FROM truck_violations WHERE date = $1`, [req.params.date]);
    res.json(result.rows);
});

app.post('/api/truck-violations/save', requireAuth, requireAdmin, async (req, res) => {
    const { date, violations } = req.body;
    await pool.query(`DELETE FROM truck_violations WHERE date = $1`, [date]);
    for (const v of violations) {
        if (v.truckNumber && v.trips !== undefined) {
            await pool.query(
                `INSERT INTO truck_violations (date, truck_number, driver, trips, reason, details) VALUES ($1, $2, $3, $4, $5, $6)`,
                [date, v.truckNumber, v.driver || '', v.trips, v.reason || '', v.detail || '']
            );
        }
    }
    res.json({ success: true });
});

// المنتجات (أنواع البحص)
app.get('/api/products', requireAuth, async (req, res) => {
    const result = await pool.query(`SELECT name FROM products ORDER BY id`);
    res.json(result.rows.map(r => r.name));
});

app.post('/api/products', requireAuth, requireAdmin, async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'اسم المنتج مطلوب' });
    await pool.query(`INSERT INTO products (name) VALUES ($1) ON CONFLICT DO NOTHING`, [name]);
    res.status(201).json({ success: true });
});

app.delete('/api/products/:name', requireAuth, requireAdmin, async (req, res) => {
    await pool.query(`DELETE FROM products WHERE name = $1`, [req.params.name]);
    res.json({ success: true });
});

// ==================== ملفات ثابتة وواجهة المستخدم ====================
app.use(express.static(path.join(__dirname)));

// مسارات الصحة والاختبار
app.get('/ping', (req, res) => res.send('pong'));
app.get('/health', (req, res) => res.status(200).send('OK'));

// الصفحة الرئيسية
app.get('/', (req, res) => {
    if (req.session?.user) {
        if (req.session.user.role === 'client') return res.redirect('/orders.html');
        return res.redirect('/index.html');
    }
    res.sendFile(path.join(__dirname, 'login.html'), (err) => {
        if (err) res.status(404).send('login.html not found – لكن الخادم يعمل');
    });
});

// حماية الصفحات المحمية
const protectedPages = ['index.html', 'orders.html', 'distribution.html', 'trucks.html', 'products.html', 'factories.html', 'reports.html', 'settings.html', 'restrictions.html', 'users.html', 'logs.html', 'upload-report.html', 'scale_report.html', 'expenses.html', 'cash_orders.html'];
protectedPages.forEach(page => {
    app.get(`/${page}`, (req, res) => {
        if (!req.session?.user) return res.redirect('/login.html');
        if (req.session.user.role === 'client' && page !== 'orders.html') return res.redirect('/orders.html');
        res.sendFile(path.join(__dirname, page));
    });
});

app.get('/login.html', (req, res) => {
    if (req.session?.user) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'login.html'), (err) => { if (err) res.status(404).send('login.html not found'); });
});

// معالجة 404
app.use((req, res) => {
    res.status(404).send('الصفحة غير موجودة 404');
});

// ==================== بدء الخادم ====================
async function start() {
    try {
        await initTables();
        // الأهم: الاستماع على 0.0.0.0
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
            console.log(`👤 admin/admin , user/user , client/client`);
        });
    } catch (err) {
        console.error('❌ فشل بدء الخادم', err);
        process.exit(1);
    }
}
start();
