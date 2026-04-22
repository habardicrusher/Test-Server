const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_HGwqC4TJaXD6@ep-dawn-king-a11873v3-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.connect((err, client, release) => {
    if (err) return console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err.stack);
    console.log('✅ تم الاتصال بقاعدة البيانات بنجاح');
    release();
});

// ==================== جداول الإعدادات ====================
async function initSettingsTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS app_settings (
                id INTEGER PRIMARY KEY DEFAULT 1,
                factories JSONB NOT NULL DEFAULT '[]',
                materials JSONB NOT NULL DEFAULT '[]',
                trucks JSONB NOT NULL DEFAULT '[]',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        const res = await pool.query('SELECT * FROM app_settings WHERE id = 1');
        if (res.rows.length === 0) {
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
                'INSERT INTO app_settings (id, factories, materials, trucks) VALUES (1, $1, $2, $3)',
                [JSON.stringify(defaultFactories), JSON.stringify(defaultMaterials), JSON.stringify([])]
            );
            console.log('✅ تم إنشاء جدول الإعدادات');
        }
    } catch (err) {
        console.error('❌ خطأ في إنشاء جدول الإعدادات:', err);
    }
}

// ==================== جداول السجلات ====================
async function initLogsTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS logs (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100),
                action VARCHAR(255),
                details TEXT,
                location VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        const checkColumn = await pool.query(`
            SELECT column_name FROM information_schema.columns WHERE table_name = 'logs' AND column_name = 'location'
        `);
        if (checkColumn.rows.length === 0) {
            await pool.query(`ALTER TABLE logs ADD COLUMN location VARCHAR(100);`);
            console.log('✅ تم إضافة عمود location إلى جدول السجلات');
        }
        console.log('✅ جدول السجلات جاهز');
    } catch (err) {
        console.error('❌ خطأ في إنشاء جدول السجلات:', err);
    }
}

async function addLog(username, action, details = null, location = null) {
    try {
        await pool.query(
            'INSERT INTO logs (username, action, details, location) VALUES ($1, $2, $3, $4)',
            [username, action, details, location]
        );
    } catch (err) {
        console.error('خطأ في حفظ السجل:', err);
    }
}

async function getLogs(limit = 500, offset = 0) {
    const res = await pool.query('SELECT * FROM logs ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
    return res.rows;
}

async function getLogsCount() {
    const res = await pool.query('SELECT COUNT(*) FROM logs');
    return parseInt(res.rows[0].count);
}

// ==================== جداول التقارير ====================
async function initReportsTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS reports (
                id SERIAL PRIMARY KEY,
                report_date DATE NOT NULL,
                filename VARCHAR(255),
                total_rows INTEGER,
                matched_count INTEGER,
                not_matched_count INTEGER,
                achievement_rate DECIMAL(5,2),
                details JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ جدول التقارير جاهز');
    } catch (err) {
        console.error('❌ خطأ في إنشاء جدول التقارير:', err);
    }
}

async function saveReport(reportData) {
    const { report_date, filename, total_rows, matched_count, not_matched_count, achievement_rate, details } = reportData;
    const res = await pool.query(
        `INSERT INTO reports (report_date, filename, total_rows, matched_count, not_matched_count, achievement_rate, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [report_date, filename, total_rows, matched_count, not_matched_count, achievement_rate, JSON.stringify(details)]
    );
    return res.rows[0];
}

async function getReports(filters = {}) {
    let query = `SELECT * FROM reports WHERE 1=1`;
    const params = [];
    let idx = 1;
    if (filters.startDate) {
        query += ` AND report_date >= $${idx++}`;
        params.push(filters.startDate);
    }
    if (filters.endDate) {
        query += ` AND report_date <= $${idx++}`;
        params.push(filters.endDate);
    }
    if (filters.filename) {
        query += ` AND filename ILIKE $${idx++}`;
        params.push(`%${filters.filename}%`);
    }
    query += ` ORDER BY report_date DESC, created_at DESC`;
    const res = await pool.query(query, params);
    return res.rows;
}

// تهيئة جميع الجداول
initSettingsTable();
initLogsTable();
initReportsTable();

module.exports = { pool, addLog, getLogs, getLogsCount, saveReport, getReports };
