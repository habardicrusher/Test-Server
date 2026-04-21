require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== Supabase Client ====================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ خطأ: متغيرات Supabase غير موجودة في ملف .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// اختبار الاتصال عند بدء التشغيل
(async () => {
    try {
        const { data, error } = await supabase.from('users').select('count', { count: 'exact', head: true });
        if (error) throw error;
        console.log('✅ الاتصال بـ Supabase ناجح');
    } catch (err) {
        console.error('❌ فشل الاتصال بـ Supabase:', err.message);
        console.error('تأكد من صحة SUPABASE_URL و SUPABASE_ANON_KEY في ملف .env');
    }
})();

// ==================== Middleware ====================
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

// ==================== Helper Functions ====================
function requireAuth(req, res, next) {
    if (req.session && req.session.user) return next();
    res.status(401).json({ error: 'غير مصرح' });
}

function requireAdmin(req, res, next) {
    if (req.session?.user?.role === 'admin') return next();
    res.status(403).json({ error: 'صلاحيات المدير مطلوبة' });
}

async function addLog(username, action, details, location) {
    try {
        await supabase.from('logs').insert({
            username,
            action,
            details: details || null,
            location: location || null,
            created_at: new Date().toISOString()
        });
    } catch (err) {
        console.error('خطأ في تسجيل السجل:', err.message);
    }
}

// ==================== Supabase Database Functions ====================

// ----- Users -----
async function getUserByUsername(username) {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('username', username)
        .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
}

async function getUsers() {
    const { data, error } = await supabase
        .from('users')
        .select('id, username, role, factory, permissions, created_at')
        .order('id', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
}

async function createUser(username, password, role, factory, permissions) {
    const hashed = await bcrypt.hash(password, 10);
    const { data, error } = await supabase
        .from('users')
        .insert({ username, password: hashed, role, factory, permissions })
        .select();
    if (error) throw new Error(error.message);
    return data[0];
}

async function updateUser(id, username, role, factory, permissions, newPassword = null) {
    let updateData = { username, role, factory, permissions };
    if (newPassword) {
        updateData.password = await bcrypt.hash(newPassword, 10);
    }
    const { error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', id);
    if (error) throw new Error(error.message);
}

async function deleteUser(id) {
    const { error } = await supabase
        .from('users')
        .delete()
        .eq('id', id);
    if (error) throw new Error(error.message);
}

// ----- Settings (app_settings) -----
async function getSettings() {
    const { data, error } = await supabase
        .from('app_settings')
        .select('factories, materials, trucks')
        .eq('id', 1)
        .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
        // بيانات افتراضية
        const defaultSettings = {
            factories: [
                { name: 'مصنع الفهد', location: 'الرياض' },
                { name: 'مصنع قوة معمارية', location: 'الدمام' }
            ],
            materials: ['3/4', '3/8', '3/16'],
            trucks: []
        };
        await supabase.from('app_settings').insert({ id: 1, ...defaultSettings });
        return defaultSettings;
    }
    return data;
}

async function saveSettings(factories, materials, trucks) {
    const { error } = await supabase
        .from('app_settings')
        .update({ factories, materials, trucks, updated_at: new Date().toISOString() })
        .eq('id', 1);
    if (error) throw new Error(error.message);
}

// ----- Daily Data (daily_data) -----
async function getDayData(date) {
    const { data, error } = await supabase
        .from('daily_data')
        .select('orders, distribution')
        .eq('date', date)
        .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { orders: [], distribution: [] };
    return { orders: data.orders || [], distribution: data.distribution || [] };
}

async function saveDayData(date, orders, distribution) {
    const { error } = await supabase
        .from('daily_data')
        .upsert({ date, orders, distribution }, { onConflict: 'date' });
    if (error) throw new Error(error.message);
}

// ----- Restrictions -----
async function getRestrictions() {
    const { data, error } = await supabase
        .from('restrictions')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
}

async function addRestriction(truckNumber, driverName, restrictedFactories, reason, createdBy) {
    const { data, error } = await supabase
        .from('restrictions')
        .insert({
            truck_number: truckNumber,
            driver_name: driverName,
            restricted_factories: restrictedFactories,
            reason,
            created_by: createdBy,
            active: true,
            created_at: new Date().toISOString()
        })
        .select();
    if (error) throw new Error(error.message);
    return data[0];
}

async function updateRestriction(id, active) {
    const { error } = await supabase
        .from('restrictions')
        .update({ active, updated_at: new Date().toISOString() })
        .eq('id', id);
    if (error) throw new Error(error.message);
}

async function deleteRestriction(id) {
    const { error } = await supabase
        .from('restrictions')
        .delete()
        .eq('id', id);
    if (error) throw new Error(error.message);
}

// ----- Logs -----
async function getLogs(limit, offset) {
    const { data, error } = await supabase
        .from('logs')
        .select('*')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return data || [];
}

async function getLogsCount() {
    const { count, error } = await supabase
        .from('logs')
        .select('*', { count: 'exact', head: true });
    if (error) return 0;
    return count;
}

// ----- Reports (analysis) -----
async function saveReport(reportData) {
    const { data, error } = await supabase
        .from('reports')
        .insert({
            report_name: reportData.filename,
            report_date: reportData.report_date,
            data: reportData.data,
            created_by: reportData.created_by || 'system',
            created_at: new Date().toISOString()
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
        .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
}

async function deleteReportById(id) {
    const { error } = await supabase
        .from('reports')
        .delete()
        .eq('id', id);
    if (error) throw new Error(error.message);
}

// ----- Scale Reports -----
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
        .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
}

async function deleteScaleReportById(reportId) {
    const { error } = await supabase
        .from('scale_reports')
        .delete()
        .eq('report_id', reportId);
    if (error) throw new Error(error.message);
}

// ==================== AUTH Routes ====================
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
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
        await addLog(username, 'تسجيل دخول', `تسجيل دخول للمستخدم ${username}`, req.session.user.factory || 'المكتب الرئيسي');
        res.json({ success: true, user: req.session.user });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/logout', async (req, res) => {
    const username = req.session?.user?.username;
    if (username) await addLog(username, 'تسجيل خروج', `تسجيل خروج للمستخدم ${username}`, req.session.user?.factory || 'المكتب الرئيسي');
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', requireAuth, (req, res) => {
    res.json({ user: req.session.user });
});

// ==================== Settings Routes ====================
app.get('/api/settings', requireAuth, async (req, res) => {
    try {
        const settings = await getSettings();
        if (req.session.user.role === 'client' && req.session.user.factory) {
            settings.factories = settings.factories.filter(f => f.name === req.session.user.factory);
        }
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/settings', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { factories, materials, trucks } = req.body;
        await saveSettings(factories, materials, trucks);
        await addLog(req.session.user.username, 'تحديث الإعدادات', `المصانع: ${factories.length}, المواد: ${materials.length}, السيارات: ${trucks.length}`, null);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== Daily Data Routes ====================
app.get('/api/day/:date', requireAuth, async (req, res) => {
    try {
        const data = await getDayData(req.params.date);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/day/:date', requireAuth, async (req, res) => {
    try {
        const { orders, distribution } = req.body;
        await saveDayData(req.params.date, orders, distribution);
        await addLog(req.session.user.username, 'تحديث الطلبات اليومية', `تاريخ: ${req.params.date} - عدد الطلبات: ${orders?.length || 0}`, null);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== Users Routes ====================
app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
    try {
        const users = await getUsers();
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { username, password, role, factory, permissions } = req.body;
        const existing = await getUserByUsername(username);
        if (existing) return res.status(400).json({ error: 'اسم المستخدم موجود' });
        await createUser(username, password, role, factory, permissions);
        await addLog(req.session.user.username, 'إضافة مستخدم', `المستخدم: ${username}, الدور: ${role}, المصنع: ${factory || 'لا يوجد'}`, null);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { username, role, factory, permissions, password } = req.body;
        await updateUser(id, username, role, factory, permissions, password);
        await addLog(req.session.user.username, 'تعديل مستخدم', `المستخدم: ${username}, الدور: ${role}`, null);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const users = await getUsers();
        const user = users.find(u => u.id === id);
        if (user?.username === 'Admin') return res.status(400).json({ error: 'لا يمكن حذف المدير الرئيسي' });
        await deleteUser(id);
        await addLog(req.session.user.username, 'حذف مستخدم', `المستخدم: ${user?.username}`, null);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== Restrictions Routes ====================
app.get('/api/restrictions', requireAuth, async (req, res) => {
    try {
        const restrictions = await getRestrictions();
        res.json(restrictions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/restrictions', requireAuth, async (req, res) => {
    try {
        if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
        const { truckNumber, driverName, restrictedFactories, reason } = req.body;
        const newRestriction = await addRestriction(truckNumber, driverName, restrictedFactories, reason, req.session.user.username);
        await addLog(req.session.user.username, 'إضافة قيد حظر', `السيارة: ${truckNumber} (${driverName}) ممنوعة من المصانع: ${restrictedFactories.join(', ')}`, null);
        res.json(newRestriction);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/restrictions/:id', requireAuth, async (req, res) => {
    try {
        if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
        const id = parseInt(req.params.id);
        const { active } = req.body;
        await updateRestriction(id, active);
        await addLog(req.session.user.username, 'تعديل قيد حظر', `تغيير حالة القيد رقم ${id} إلى ${active ? 'نشط' : 'غير نشط'}`, null);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/restrictions/:id', requireAuth, async (req, res) => {
    try {
        if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
        const id = parseInt(req.params.id);
        await deleteRestriction(id);
        await addLog(req.session.user.username, 'حذف قيد حظر', `تم حذف القيد رقم ${id}`, null);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== Logs Routes ====================
app.get('/api/logs', requireAuth, async (req, res) => {
    if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;
        const logs = await getLogs(limit, offset);
        const total = await getLogsCount();
        res.json({ logs: logs || [], currentPage: page, totalPages: Math.ceil(total / limit), total: total || 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/logs/all', requireAuth, async (req, res) => {
    if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    try {
        const logs = await getLogs(10000, 0);
        res.json(logs || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/logs/clear', requireAuth, requireAdmin, async (req, res) => {
    try {
        await supabase.from('logs').delete().neq('id', 0);
        await addLog(req.session.user.username, 'مسح السجلات', 'قام بحذف جميع سجلات النظام', null);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== Reports Routes ====================
app.post('/api/upload-report', requireAuth, async (req, res) => {
    try {
        if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
        const reportData = req.body;
        if (!reportData.report_date || !reportData.filename) return res.status(400).json({ error: 'بيانات ناقصة' });
        reportData.created_by = req.session.user.username;
        const saved = await saveReport(reportData);
        await addLog(req.session.user.username, 'رفع تقرير', `تم رفع تقرير ${reportData.filename}`, null);
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
        await addLog(req.session.user.username, 'حذف تقرير', `تم حذف تقرير ${report.report_name}`, null);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== Scale Reports Routes ====================
app.post('/api/scale-reports', requireAuth, async (req, res) => {
    try {
        const { reportName, reportDate, data } = req.body;
        if (!data) return res.status(400).json({ error: 'لا توجد بيانات للحفظ' });
        const reportId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const newReport = {
            report_id: reportId,
            report_name: reportName || 'تقرير بدون اسم',
            report_date: reportDate || new Date().toISOString().split('T')[0],
            created_by: req.session.user.username,
            created_at: new Date().toISOString(),
            total_rows: data.totalRows || 0,
            matched_count: data.matchedCount || 0,
            not_matched_count: data.notMatchedCount || 0,
            total_weight_all: data.totalWeightAll || 0,
            drivers_stats: data.driversStats || [],
            materials_stats: data.materialsStats || [],
            top10_drivers: data.top10Drivers || []
        };
        await saveScaleReport(newReport);
        await addLog(req.session.user.username, 'حفظ تقرير ميزان', `تم حفظ تقرير: ${reportName || 'بدون اسم'}`, null);
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
        await addLog(req.session.user.username, 'حذف تقرير ميزان', `تم حذف تقرير: ${report.report_name}`, null);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== Static Files ====================
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

const allProtectedPages = [
    'index.html', 'orders.html', 'distribution.html', 'trucks.html', 'products.html',
    'factories.html', 'reports.html', 'settings.html', 'restrictions.html', 'users.html',
    'logs.html', 'upload-report.html', 'scale_report.html', 'Expenses.html'
];

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
        if (allProtectedPages.includes(base) || base === 'login.html') {
            res.status(404).end();
        }
    }
}));

// ==================== Start Server ====================
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
