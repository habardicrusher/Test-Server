const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase Client
const supabaseUrl = 'https://ybbxinhgwnnnvougrzwv.supabase.co';
const supabaseKey = 'EYR_EYJhbGciOiJIUzI1NiIsImR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InliYnhpbmhnd25ubnZvdWdyend2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU0MjQxMzEsImV4cCI6MjA2MTAwMDEzMX0.nMlWcY-bzrT0KjEoO_sWz7x8B-kHcX5nJ2QfWK7jQ_k';
const supabase = createClient(supabaseUrl, supabaseKey);

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
    // يمكن حفظ السجلات في Supabase أو تركها محلياً
    console.log(`[LOG] ${username} - ${action} - ${details}`);
}

// ==================== دوال Supabase للتقارير ====================
async function saveReport(reportData) {
    const { data, error } = await supabase
        .from('reports')
        .insert({
            report_name: reportData.filename,
            report_date: reportData.report_date,
            data: reportData.data,
            created_by: reportData.created_by || 'system'
        })
        .select();
    if (error) throw new Error(error.message);
    return data[0];
}

async function getReports(filters = {}) {
    let query = supabase.from('reports').select('*');
    if (filters.startDate) query = query.gte('report_date', filters.startDate);
    if (filters.endDate) query = query.lte('report_date', filters.endDate);
    if (filters.filename) query = query.ilike('report_name', `%${filters.filename}%`);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
}

async function getReportById(id) {
    const { data, error } = await supabase
        .from('reports')
        .select('*')
        .eq('id', id)
        .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    return data;
}

async function deleteReportById(id) {
    const { error } = await supabase
        .from('reports')
        .delete()
        .eq('id', id);
    if (error) throw new Error(error.message);
}

// دوال تقارير الميزان (scale_reports)
async function saveScaleReport(reportData) {
    const { data, error } = await supabase
        .from('scale_reports')
        .insert(reportData)
        .select();
    if (error) throw new Error(error.message);
    return data[0];
}

async function getScaleReports() {
    const { data, error } = await supabase
        .from('scale_reports')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
}

async function getScaleReportById(reportId) {
    const { data, error } = await supabase
        .from('scale_reports')
        .select('*')
        .eq('report_id', reportId)
        .single();
    if (error && error.code !== 'PGRST116') return null;
    return data;
}

async function deleteScaleReportById(reportId) {
    const { error } = await supabase
        .from('scale_reports')
        .delete()
        .eq('report_id', reportId);
    if (error) throw new Error(error.message);
}

// ==================== باقي الدوال (مؤقتة تعيد بيانات فارغة) ====================
// يمكنك استبدالها بالاتصال بقاعدة البيانات المحلية أو Supabase لاحقاً
async function getSettings() { return { factories: [], materials: [], trucks: [] }; }
async function saveSettings() {}
async function getUserByUsername(username) { return null; }
async function getUsers() { return []; }
async function createUser() {}
async function updateUser() {}
async function deleteUser() {}
async function getRestrictions() { return []; }
async function addRestriction() {}
async function updateRestriction() {}
async function deleteRestriction() {}
async function getDayData() { return { orders: [], distribution: [] }; }
async function saveDayData() {}

// ==================== API Routes (التقارير فقط) ====================
app.post('/api/upload-report', requireAuth, async (req, res) => {
    try {
        if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
        const reportData = req.body;
        if (!reportData.report_date || !reportData.filename) return res.status(400).json({ error: 'بيانات ناقصة' });
        reportData.created_by = req.session.user.username;
        const saved = await saveReport(reportData);
        await logAction(req, 'رفع تقرير', `تم رفع تقرير ${reportData.filename}`, null);
        res.json({ success: true, id: saved.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/reports-list', requireAuth, async (req, res) => {
    try {
        const { startDate, endDate, filename } = req.query;
        const reports = await getReports({ startDate, endDate, filename });
        res.json(reports);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/reports/:id', requireAuth, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const report = await getReportById(id);
        if (!report) return res.status(404).json({ error: 'تقرير غير موجود' });
        res.json(report);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/reports/:id', requireAuth, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const report = await getReportById(id);
        if (!report) return res.status(404).json({ error: 'تقرير غير موجود' });
        await deleteReportById(id);
        await logAction(req, 'حذف تقرير', `تم حذف تقرير ${report.report_name}`, null);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// تقارير الميزان
app.post('/api/scale-reports', requireAuth, async (req, res) => {
    try {
        const { reportName, reportDate, data } = req.body;
        if (!data) return res.status(400).json({ error: 'لا توجد بيانات' });
        const reportId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const newReport = {
            report_id: reportId,
            report_name: reportName || 'تقرير بدون اسم',
            report_date: reportDate || new Date().toISOString().split('T')[0],
            created_by: req.session.user.username,
            total_rows: data.totalRows || 0,
            matched_count: data.matchedCount || 0,
            not_matched_count: data.notMatchedCount || 0,
            total_weight_all: data.totalWeightAll || 0,
            drivers_stats: data.driversStats || [],
            materials_stats: data.materialsStats || [],
            top10_drivers: data.top10Drivers || []
        };
        await saveScaleReport(newReport);
        await logAction(req, 'حفظ تقرير ميزان', `تم حفظ تقرير: ${reportName}`, null);
        res.json({ success: true, id: reportId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/scale-reports', requireAuth, async (req, res) => {
    try {
        const reports = await getScaleReports();
        const summaries = reports.map(r => ({
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
            driversCount: Array.isArray(r.drivers_stats) ? r.drivers_stats.length : 0
        }));
        res.json(summaries);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/scale-reports/:id', requireAuth, async (req, res) => {
    try {
        const report = await getScaleReportById(req.params.id);
        if (!report) return res.status(404).json({ error: 'التقرير غير موجود' });
        res.json({
            id: report.report_id,
            dbId: report.id,
            reportName: report.report_name,
            reportDate: report.report_date,
            createdAt: report.created_at,
            createdBy: report.created_by,
            data: {
                totalRows: report.total_rows,
                matchedCount: report.matched_count,
                notMatchedCount: report.not_matched_count,
                totalWeightAll: report.total_weight_all,
                driversStats: report.drivers_stats,
                materialsStats: report.materials_stats,
                top10Drivers: report.top10_drivers
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/scale-reports/:id', requireAuth, async (req, res) => {
    try {
        const report = await getScaleReportById(req.params.id);
        if (!report) return res.status(404).json({ error: 'التقرير غير موجود' });
        await deleteScaleReportById(req.params.id);
        await logAction(req, 'حذف تقرير ميزان', `تم حذف تقرير: ${report.report_name}`, null);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== صفحات الواجهة ====================
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
const allProtectedPages = ['index.html', 'orders.html', 'distribution.html', 'trucks.html', 'products.html', 'factories.html', 'reports.html', 'settings.html', 'restrictions.html', 'users.html', 'logs.html', 'upload-report.html', 'scale_report.html', 'Expenses.html'];
allProtectedPages.forEach(page => {
    app.get(`/${page}`, (req, res) => {
        if (!req.session || !req.session.user) return res.redirect('/login.html');
        if (req.session.user.role === 'client' && page !== 'orders.html') return res.redirect('/orders.html');
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
