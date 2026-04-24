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

// ==================== إعداد قاعدة البيانات ====================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,   // ← مهم جداً لـ Neon
    statement_timeout: 10000,
});

// دالة اتصال مع Retry
async function connectWithRetry(retries = 6) {
    for (let i = 0; i < retries; i++) {
        try {
            const client = await pool.connect();
            console.log(`✅ Connected to Neon successfully (attempt ${i+1})`);
            client.release();
            return true;
        } catch (err) {
            console.log(`⚠️ Connection attempt ${i+1}/${retries} failed: ${err.message}`);
            if (i < retries - 1) {
                await new Promise(r => setTimeout(r, 4000)); // 4 ثواني
            }
        }
    }
    throw new Error('❌ Failed to connect to Neon after multiple attempts');
}

// ==================== تعريف الأذونات ====================
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

// دالة إنشاء الجداول
async function initDatabaseTables() {
    try {
        await connectWithRetry();

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

        // باقي الجداول (كلها كما هي)
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

        console.log('✅ جميع الجداول جاهزة');

        // إدراج المستخدمين الافتراضيين
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

        // الإعدادات الافتراضية
        const settingsExist = await pool.query('SELECT id FROM settings WHERE id = 1');
        if (settingsExist.rows.length === 0) {
            const defaultFactories = [ /* ... كل الفactories اللي عندك ... */ ];
            const defaultMaterials = ['3/4', '3/8', '3/16'];
            await pool.query(
                `INSERT INTO settings (id, factories, materials, trucks) VALUES (1, $1, $2, $3)`,
                [JSON.stringify(defaultFactories), JSON.stringify(defaultMaterials), JSON.stringify([])]
            );
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

// Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, '/tmp'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// باقي الدوال (requireAuth, logAction, getUserByUsername ... كلها)
function requireAuth(req, res, next) {
    if (req.session && req.session.user) return next();
    res.status(401).json({ error: 'غير مصرح' });
}

function requireAdmin(req, res, next) {
    if (req.session?.user?.role === 'admin') return next();
    res.status(403).json({ error: 'صلاحيات المدير مطلوبة' });
}

// ... (انسخ كل الدوال والـ routes من كودك القديم: logAction, getUserByUsername, getUserById, getLogsPaginated ... إلخ)

async function startServer() {
    try {
        await initDatabaseTables();
        app.listen(PORT, () => {
            console.log(`🚀 Server running on http://localhost:${PORT}`);
            console.log(`👤 admin/admin , user/user , client/client`);
            console.log(`📦 Neon Database Connected`);
        });
    } catch (err) {
        console.error('❌ فشل بدء الخادم', err);
    }
}

startServer();
