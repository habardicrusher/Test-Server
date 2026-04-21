const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

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

// ==================== تخزين مؤقت في الذاكرة (للتشغيل بدون قاعدة بيانات) ====================
let inMemory = {
    users: [],
    settings: {
        factories: [
            { name: 'مصنع الفهد', location: 'الرياض' },
            { name: 'مصنع قوة معمارية', location: 'الدمام' },
            { name: 'سارمكس النظيم', location: 'الرياض' }
        ],
        materials: ['3/4', '3/8', '3/16', 'بحص خشن', 'بحص ناعم'],
        trucks: []
    },
    dailyData: {},
    restrictions: [],
    logs: [],
    reports: [],
    scaleReports: []
};

// إضافة مستخدم Admin افتراضي
const defaultAdmin = {
    id: 1,
    username: 'Admin',
    password: bcrypt.hashSync('admin123', 10),
    role: 'admin',
    factory: null,
    permissions: {
        manageUsers: true, manageSettings: true, manageRestrictions: true,
        viewReports: true, viewOrders: true, addOrders: true, editOrders: true,
        deleteOrders: true, viewDistribution: true, manageDistribution: true,
        exportReports: true, viewTrucks: true, viewBackup: true
    }
};
if (!inMemory.users.find(u => u.username === 'Admin')) {
    inMemory.users.push(defaultAdmin);
}

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
    inMemory.logs.unshift({
        id: Date.now(),
        username,
        action,
        details,
        location,
        created_at: new Date().toISOString()
    });
    // الاحتفاظ بآخر 1000 سجل فقط
    if (inMemory.logs.length > 1000) inMemory.logs.pop();
}

// ==================== API Routes ====================

// Auth
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = inMemory.users.find(u => u.username === username);
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
    await addLog(username, 'تسجيل دخول', `تسجيل دخول ناجح`, user.factory || 'المكتب الرئيسي');
    res.json({ success: true, user: req.session.user });
});

app.post('/api/logout', async (req, res) => {
    const username = req.session?.user?.username;
    if (username) await addLog(username, 'تسجيل خروج', `تسجيل خروج`, null);
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', requireAuth, (req, res) => {
    res.json({ user: req.session.user });
});

// Settings
app.get('/api/settings', requireAuth, async (req, res) => {
    let factories = inMemory.settings.factories;
    if (req.session.user.role === 'client' && req.session.user.factory) {
        factories = factories.filter(f => f.name === req.session.user.factory);
    }
    res.json({
        factories,
        materials: inMemory.settings.materials,
        trucks: inMemory.settings.trucks
    });
});

app.put('/api/settings', requireAuth, requireAdmin, async (req, res) => {
    const { factories, materials, trucks } = req.body;
    if (factories) inMemory.settings.factories = factories;
    if (materials) inMemory.settings.materials = materials;
    if (trucks) inMemory.settings.trucks = trucks;
    await addLog(req.session.user.username, 'تحديث الإعدادات', `تم التحديث`, null);
    res.json({ success: true });
});

// Daily Data
app.get('/api/day/:date', requireAuth, async (req, res) => {
    const data = inMemory.dailyData[req.params.date] || { orders: [], distribution: [] };
    res.json(data);
});

app.put('/api/day/:date', requireAuth, async (req, res) => {
    const { orders, distribution } = req.body;
    inMemory.dailyData[req.params.date] = { orders: orders || [], distribution: distribution || [] };
    await addLog(req.session.user.username, 'تحديث الطلبات', `تاريخ: ${req.params.date} - عدد الطلبات: ${orders?.length || 0}`, null);
    res.json({ success: true });
});

// Users
app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
    const users = inMemory.users.map(u => ({
        id: u.id,
        username: u.username,
        role: u.role,
        factory: u.factory,
        permissions: u.permissions,
        created_at: u.created_at
    }));
    res.json(users);
});

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
    const { username, password, role, factory, permissions } = req.body;
    if (inMemory.users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'اسم المستخدم موجود' });
    }
    const newUser = {
        id: Date.now(),
        username,
        password: bcrypt.hashSync(password, 10),
        role,
        factory,
        permissions: permissions || {},
        created_at: new Date().toISOString()
    };
    inMemory.users.push(newUser);
    await addLog(req.session.user.username, 'إضافة مستخدم', `المستخدم: ${username}`, null);
    res.json({ success: true });
});

app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const { username, role, factory, permissions, password } = req.body;
    const userIndex = inMemory.users.findIndex(u => u.id === id);
    if (userIndex === -1) return res.status(404).json({ error: 'مستخدم غير موجود' });
    inMemory.users[userIndex].username = username;
    inMemory.users[userIndex].role = role;
    inMemory.users[userIndex].factory = factory;
    inMemory.users[userIndex].permissions = permissions;
    if (password) inMemory.users[userIndex].password = bcrypt.hashSync(password, 10);
    await addLog(req.session.user.username, 'تعديل مستخدم', `المستخدم: ${username}`, null);
    res.json({ success: true });
});

app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const user = inMemory.users.find(u => u.id === id);
    if (user?.username === 'Admin') return res.status(400).json({ error: 'لا يمكن حذف المدير الرئيسي' });
    inMemory.users = inMemory.users.filter(u => u.id !== id);
    await addLog(req.session.user.username, 'حذف مستخدم', `المستخدم: ${user?.username}`, null);
    res.json({ success: true });
});

// Restrictions
app.get('/api/restrictions', requireAuth, async (req, res) => {
    res.json(inMemory.restrictions);
});

app.post('/api/restrictions', requireAuth, async (req, res) => {
    if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
    const { truckNumber, driverName, restrictedFactories, reason } = req.body;
    const newRestriction = {
        id: Date.now(),
        truck_number: truckNumber,
        driver_name: driverName,
        restricted_factories: restrictedFactories,
        reason,
        created_by: req.session.user.username,
        active: true,
        created_at: new Date().toISOString()
    };
    inMemory.restrictions.unshift(newRestriction);
    await addLog(req.session.user.username, 'إضافة قيد حظر', `السيارة: ${truckNumber}`, null);
    res.json(newRestriction);
});

app.put('/api/restrictions/:id', requireAuth, async (req, res) => {
    if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
    const id = parseInt(req.params.id);
    const { active } = req.body;
    const restriction = inMemory.restrictions.find(r => r.id === id);
    if (restriction) restriction.active = active;
    await addLog(req.session.user.username, 'تعديل قيد حظر', `تغيير حالة القيد`, null);
    res.json({ success: true });
});

app.delete('/api/restrictions/:id', requireAuth, async (req, res) => {
    if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
    const id = parseInt(req.params.id);
    inMemory.restrictions = inMemory.restrictions.filter(r => r.id !== id);
    await addLog(req.session.user.username, 'حذف قيد حظر', `تم حذف القيد`, null);
    res.json({ success: true });
});

// Logs
app.get('/api/logs', requireAuth, async (req, res) => {
    if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const start = (page - 1) * limit;
    const logs = inMemory.logs.slice(start, start + limit);
    res.json({ logs, currentPage: page, totalPages: Math.ceil(inMemory.logs.length / limit), total: inMemory.logs.length });
});

app.get('/api/logs/all', requireAuth, async (req, res) => {
    if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    res.json(inMemory.logs);
});

app.delete('/api/logs/clear', requireAuth, requireAdmin, async (req, res) => {
    inMemory.logs = [];
    await addLog(req.session.user.username, 'مسح السجلات', 'قام بحذف جميع سجلات النظام', null);
    res.json({ success: true });
});

// Reports (تحليل البيانات)
app.post('/api/upload-report', requireAuth, async (req, res) => {
    if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const { filename, report_date, data } = req.body;
    if (!report_date || !filename) return res.status(400).json({ error: 'بيانات ناقصة' });
    const newReport = {
        id: Date.now(),
        report_name: filename,
        report_date,
        data,
        created_by: req.session.user.username,
        created_at: new Date().toISOString()
    };
    inMemory.reports.unshift(newReport);
    await addLog(req.session.user.username, 'رفع تقرير', `تم رفع تقرير ${filename}`, null);
    res.json({ success: true, id: newReport.id });
});

app.get('/api/reports-list', requireAuth, async (req, res) => {
    let reports = inMemory.reports;
    const { startDate, endDate, filename } = req.query;
    if (startDate) reports = reports.filter(r => r.report_date >= startDate);
    if (endDate) reports = reports.filter(r => r.report_date <= endDate);
    if (filename) reports = reports.filter(r => r.report_name.includes(filename));
    res.json(reports);
});

app.get('/api/reports/:id', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const report = inMemory.reports.find(r => r.id === id);
    if (!report) return res.status(404).json({ error: 'تقرير غير موجود' });
    res.json(report);
});

app.delete('/api/reports/:id', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const report = inMemory.reports.find(r => r.id === id);
    if (!report) return res.status(404).json({ error: 'تقرير غير موجود' });
    inMemory.reports = inMemory.reports.filter(r => r.id !== id);
    await addLog(req.session.user.username, 'حذف تقرير', `تم حذف تقرير ${report.report_name}`, null);
    res.json({ success: true });
});

// Scale Reports
app.post('/api/scale-reports', requireAuth, async (req, res) => {
    const { reportName, reportDate, data } = req.body;
    if (!data) return res.status(400).json({ error: 'لا توجد بيانات' });
    const reportId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const newReport = {
        id: Date.now(),
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
    inMemory.scaleReports.unshift(newReport);
    await addLog(req.session.user.username, 'حفظ تقرير ميزان', `تم حفظ تقرير: ${reportName}`, null);
    res.json({ success: true, id: reportId });
});

app.get('/api/scale-reports', requireAuth, async (req, res) => {
    const summaries = inMemory.scaleReports.map(r => ({
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
        driversCount: r.drivers_stats?.length || 0
    }));
    res.json(summaries);
});

app.get('/api/scale-reports/:id', requireAuth, async (req, res) => {
    const report = inMemory.scaleReports.find(r => r.report_id === req.params.id);
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
});

app.delete('/api/scale-reports/:id', requireAuth, async (req, res) => {
    const report = inMemory.scaleReports.find(r => r.report_id === req.params.id);
    if (!report) return res.status(404).json({ error: 'التقرير غير موجود' });
    inMemory.scaleReports = inMemory.scaleReports.filter(r => r.report_id !== req.params.id);
    await addLog(req.session.user.username, 'حذف تقرير ميزان', `تم حذف تقرير: ${report.report_name}`, null);
    res.json({ success: true });
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
    console.log(`✅ بيانات تسجيل الدخول الافتراضية: Admin / admin123`);
});
