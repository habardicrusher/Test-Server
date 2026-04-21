const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ==================== Supabase Client ====================
const supabaseUrl = 'https://ybbxinhgwnnnvougrzwv.supabase.co';
const supabaseKey = 'EYR_EYJhbGciOiJIUzI1NiIsImR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InliYnhpbmhnd25ubnZvdWdyend2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU0MjQxMzEsImV4cCI6MjA2MTAwMDEzMX0.nMlWcY-bzrT0KjEoO_sWz7x8B-kHcX5nJ2QfWK7jQ_k';
const supabase = createClient(supabaseUrl, supabaseKey);

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

// ==================== Helper Functions ====================
function requireAuth(req, res, next) {
    if (req.session && req.session.user) return next();
    res.status(401).json({ error: 'غير مصرح' });
}
function requireAdmin(req, res, next) {
    if (req.session?.user?.role === 'admin') return next();
    res.status(403).json({ error: 'صلاحيات المدير مطلوبة' });
}

// Supabase-based data functions
async function addLog(username, action, details, location) {
    const { error } = await supabase.from('logs').insert({ username, action, details, location, created_at: new Date() });
    if (error) console.error('Log error:', error);
}
async function getLogs(limit, offset) {
    const { data, error } = await supabase.from('logs').select('*').order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    if (error) return [];
    return data;
}
async function getLogsCount() {
    const { count, error } = await supabase.from('logs').select('*', { count: 'exact', head: true });
    if (error) return 0;
    return count;
}

async function getSettings() {
    const { data, error } = await supabase.from('app_settings').select('*').eq('id', 1).single();
    if (error || !data) {
        // Default settings
        const defaults = {
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
        return defaults;
    }
    return { factories: data.factories, materials: data.materials, trucks: data.trucks };
}
async function saveSettings(factories, materials, trucks) {
    const { error } = await supabase.from('app_settings').upsert({ id: 1, factories, materials, trucks, updated_at: new Date() });
    if (error) throw error;
}
async function getUserByUsername(username) {
    const { data, error } = await supabase.from('users').select('*').eq('username', username).single();
    if (error) return null;
    return data;
}
async function getUsers() {
    const { data, error } = await supabase.from('users').select('id, username, role, factory, permissions, created_at');
    if (error) return [];
    return data;
}
async function createUser(username, password, role, factory, permissions) {
    const hashed = await bcrypt.hash(password, 10);
    const { data, error } = await supabase.from('users').insert({ username, password: hashed, role, factory, permissions }).select();
    if (error) throw error;
    return data[0];
}
async function updateUser(id, username, role, factory, permissions, newPassword = null) {
    let updateData = { username, role, factory, permissions };
    if (newPassword) updateData.password = await bcrypt.hash(newPassword, 10);
    const { error } = await supabase.from('users').update(updateData).eq('id', id);
    if (error) throw error;
}
async function deleteUser(id) {
    const { error } = await supabase.from('users').delete().eq('id', id);
    if (error) throw error;
}
async function getRestrictions() {
    const { data, error } = await supabase.from('restrictions').select('*').order('created_at', { ascending: false });
    if (error) return [];
    return data;
}
async function addRestriction(truckNumber, driverName, restrictedFactories, reason, createdBy) {
    const { data, error } = await supabase.from('restrictions').insert({
        truck_number: truckNumber,
        driver_name: driverName,
        restricted_factories: restrictedFactories,
        reason,
        created_by: createdBy,
        active: true
    }).select();
    if (error) throw error;
    return data[0];
}
async function updateRestriction(id, active) {
    const { error } = await supabase.from('restrictions').update({ active }).eq('id', id);
    if (error) throw error;
}
async function deleteRestriction(id) {
    const { error } = await supabase.from('restrictions').delete().eq('id', id);
    if (error) throw error;
}
async function getDayData(date) {
    const { data, error } = await supabase.from('daily_data').select('orders, distribution').eq('date', date).single();
    if (error || !data) return { orders: [], distribution: [] };
    return { orders: data.orders, distribution: data.distribution };
}
async function saveDayData(date, orders, distribution) {
    const { error } = await supabase.from('daily_data').upsert({ date, orders, distribution }, { onConflict: 'date' });
    if (error) throw error;
}
async function saveReport(reportData) {
    const { data, error } = await supabase.from('reports').insert({
        report_name: reportData.filename,
        report_date: reportData.report_date,
        data: reportData.data,
        created_by: reportData.created_by || 'system'
    }).select();
    if (error) throw error;
    return data[0];
}
async function getReports(filters = {}) {
    let query = supabase.from('reports').select('*');
    if (filters.startDate) query = query.gte('report_date', filters.startDate);
    if (filters.endDate) query = query.lte('report_date', filters.endDate);
    if (filters.filename) query = query.ilike('report_name', `%${filters.filename}%`);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) return [];
    return data;
}
async function getReportById(id) {
    const { data, error } = await supabase.from('reports').select('*').eq('id', id).single();
    if (error) return null;
    return data;
}
async function deleteReportById(id) {
    const { error } = await supabase.from('reports').delete().eq('id', id);
    if (error) throw error;
}
// Scale reports functions
async function saveScaleReport(reportData) {
    const { data, error } = await supabase.from('scale_reports').insert(reportData).select();
    if (error) throw error;
    return data[0];
}
async function getScaleReports() {
    const { data, error } = await supabase.from('scale_reports').select('*').order('created_at', { ascending: false });
    if (error) return [];
    return data;
}
async function getScaleReportById(reportId) {
    const { data, error } = await supabase.from('scale_reports').select('*').eq('report_id', reportId).single();
    if (error) return null;
    return data;
}
async function deleteScaleReportById(reportId) {
    const { error } = await supabase.from('scale_reports').delete().eq('report_id', reportId);
    if (error) throw error;
}

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
    await addLog(req, 'تسجيل دخول', `تسجيل دخول للمستخدم ${username}`, req.session.user.factory || 'المكتب الرئيسي');
    res.json({ success: true, user: req.session.user });
});
app.post('/api/logout', async (req, res) => {
    const username = req.session?.user?.username;
    if (username) await addLog(req, 'تسجيل خروج', `تسجيل خروج للمستخدم ${username}`, req.session.user?.factory || 'المكتب الرئيسي');
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
    await addLog(req, 'تحديث الإعدادات', `المصانع: ${factories.length}, المواد: ${materials.length}, السيارات: ${trucks.length}`, null);
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
    await addLog(req, 'إضافة مستخدم', `المستخدم: ${username}, الدور: ${role}, المصنع: ${factory || 'لا يوجد'}`, null);
    res.json({ success: true });
});
app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const { username, role, factory, permissions, password } = req.body;
    await updateUser(id, username, role, factory, permissions, password);
    await addLog(req, 'تعديل مستخدم', `المستخدم: ${username}, الدور: ${role}`, null);
    res.json({ success: true });
});
app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const user = (await getUsers()).find(u => u.id === id);
    if (user?.username === 'Admin') return res.status(400).json({ error: 'لا يمكن حذف المدير الرئيسي' });
    await deleteUser(id);
    await addLog(req, 'حذف مستخدم', `المستخدم: ${user?.username}`, null);
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
    await addLog(req, 'إضافة قيد حظر', `السيارة: ${truckNumber} (${driverName}) ممنوعة من المصانع: ${restrictedFactories.join(', ')}`, null);
    res.json(newRestriction);
});
app.put('/api/restrictions/:id', requireAuth, async (req, res) => {
    if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
    const id = parseInt(req.params.id);
    const { active } = req.body;
    await updateRestriction(id, active);
    await addLog(req, 'تعديل قيد حظر', `تغيير حالة القيد رقم ${id} إلى ${active ? 'نشط' : 'غير نشط'}`, null);
    res.json({ success: true });
});
app.delete('/api/restrictions/:id', requireAuth, async (req, res) => {
    if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
    const id = parseInt(req.params.id);
    await deleteRestriction(id);
    await addLog(req, 'حذف قيد حظر', `تم حذف القيد رقم ${id}`, null);
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
    await addLog(req, 'تصدير نسخة احتياطية', null, null);
    res.json({ settings, users, restrictions, exportDate: new Date().toISOString() });
});
app.post('/api/restore', requireAuth, requireAdmin, async (req, res) => {
    const data = req.body;
    if (data.settings) await saveSettings(data.settings.factories, data.settings.materials, data.settings.trucks);
    if (data.restrictions) {
        await supabase.from('restrictions').delete().neq('id', 0);
        for (const r of data.restrictions) {
            await addRestriction(r.truck_number, r.driver_name, r.restricted_factories, r.reason, r.created_by);
        }
    }
    await addLog(req, 'استعادة نسخة احتياطية', null, null);
    res.json({ success: true });
});
app.delete('/api/clear-all', requireAuth, requireAdmin, async (req, res) => {
    await supabase.from('daily_data').delete().neq('id', 0);
    await supabase.from('restrictions').delete().neq('id', 0);
    await addLog(req, 'مسح جميع البيانات', null, null);
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
    await supabase.from('logs').delete().neq('id', 0);
    await addLog(req, 'مسح السجلات', 'قام بحذف جميع سجلات النظام', null);
    res.json({ success: true });
});
app.post('/api/upload-report', requireAuth, async (req, res) => {
    try {
        if (req.session.user.role !== 'admin') {
            return res.status(403).json({ error: 'غير مصرح' });
        }
        const reportData = req.body;
        if (!reportData.report_date || !reportData.filename) {
            return res.status(400).json({ error: 'بيانات ناقصة' });
        }
        reportData.created_by = req.session.user.username;
        const saved = await saveReport(reportData);
        await addLog(req, 'رفع تقرير', `تم رفع تقرير ${reportData.filename}`, null);
        res.json({ success: true, id: saved.id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'فشل في حفظ التقرير: ' + err.message });
    }
});
app.get('/api/reports-list', requireAuth, async (req, res) => {
    try {
        const { startDate, endDate, filename } = req.query;
        const reports = await getReports({ startDate, endDate, filename });
        res.json(reports);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'فشل في جلب التقارير: ' + err.message });
    }
});
app.get('/api/reports/:id', requireAuth, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const report = await getReportById(id);
        if (!report) return res.status(404).json({ error: 'تقرير غير موجود' });
        res.json(report);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'فشل في جلب التقرير: ' + err.message });
    }
});
app.delete('/api/reports/:id', requireAuth, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const report = await getReportById(id);
        if (!report) return res.status(404).json({ error: 'تقرير غير موجود' });
        await deleteReportById(id);
        await addLog(req, 'حذف تقرير', `تم حذف تقرير ${report.report_name}`, null);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'فشل في حذف التقرير: ' + err.message });
    }
});
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
            total_rows: data.totalRows || 0,
            matched_count: data.matchedCount || 0,
            not_matched_count: data.notMatchedCount || 0,
            total_weight_all: data.totalWeightAll || 0,
            drivers_stats: data.driversStats || [],
            materials_stats: data.materialsStats || [],
            top10_drivers: data.top10Drivers || []
        };
        await saveScaleReport(newReport);
        await addLog(req, 'حفظ تقرير ميزان', `تم حفظ تقرير: ${reportName}`, null);
        res.json({ success: true, id: reportId });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'خطأ في حفظ التقرير: ' + e.message });
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
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'خطأ في جلب التقارير: ' + e.message });
    }
});
app.get('/api/scale-reports/:id', requireAuth, async (req, res) => {
    try {
        const reportId = req.params.id;
        const report = await getScaleReportById(reportId);
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
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'خطأ في جلب التقرير: ' + e.message });
    }
});
app.delete('/api/scale-reports/:id', requireAuth, async (req, res) => {
    try {
        const reportId = req.params.id;
        const report = await getScaleReportById(reportId);
        if (!report) return res.status(404).json({ error: 'التقرير غير موجود' });
        await deleteScaleReportById(reportId);
        await addLog(req, 'حذف تقرير ميزان', `تم حذف تقرير: ${report.report_name}`, null);
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'خطأ في حذف التقرير: ' + e.message });
    }
});

// ==================== Static files ====================
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

// ==================== Start Server ====================
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
