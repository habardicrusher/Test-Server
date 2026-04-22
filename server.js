const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const multer = require('multer'); // لإدارة رفع الملفات
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// إعداد multer لحفظ الملفات المرفوعة مؤقتاً
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, '/tmp'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'gravel-system-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,   // نجبره على false حتى يعمل على HTTP (داخل Render يكون HTTPS لكننا نجرب)
        httpOnly: true, 
        maxAge: 7 * 24 * 60 * 60 * 1000, 
        sameSite: 'lax' 
    },
    name: 'gravel.sid',
    proxy: false
}));

// ==================== تخزين البيانات في الذاكرة ====================
let users = [];
let appSettings = {
    id: 1,
    factories: [
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
    ],
    materials: ['3/4', '3/8', '3/16'],
    trucks: []
};
let dailyDataStore = {};
let restrictions = [];
let logs = [];
let reports = [];
let scaleReports = [];
let uploadedFiles = []; // تخزين الملفات المرفوعة

let nextUserId = 1;
let nextRestrictionId = 1;
let nextLogId = 1;
let nextReportId = 1;
let nextScaleReportId = 1;
let nextFileId = 1;

// ==================== دوال مساعدة ====================
function getUserByUsername(username) {
    return users.find(u => u.username.toLowerCase() === username.toLowerCase());
}
function getUserById(id) {
    return users.find(u => u.id === id);
}
function addLogEntry(username, action, details, location) {
    logs.unshift({
        id: nextLogId++,
        username: username || 'unknown',
        action,
        details: details || null,
        location: location || null,
        created_at: new Date().toISOString()
    });
    if (logs.length > 1000) logs.pop();
}
function getLogsPaginated(limit, offset) {
    return logs.slice(offset, offset + limit);
}
function getLogsCount() {
    return logs.length;
}

// ==================== تهيئة المستخدمين الافتراضيين ====================
async function initDefaultUsers() {
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

    if (!getUserByUsername('admin')) {
        users.push({
            id: nextUserId++,
            username: 'admin',
            password: await bcrypt.hash('admin', 10),
            role: 'admin',
            factory: null,
            permissions: adminPermissions,
            created_at: new Date().toISOString()
        });
        console.log('✅ تم إنشاء المستخدم admin/admin');
    }
    if (!getUserByUsername('user')) {
        users.push({
            id: nextUserId++,
            username: 'user',
            password: await bcrypt.hash('user', 10),
            role: 'user',
            factory: null,
            permissions: userPermissions,
            created_at: new Date().toISOString()
        });
        console.log('✅ تم إنشاء المستخدم user/user');
    }
    if (!getUserByUsername('client')) {
        users.push({
            id: nextUserId++,
            username: 'client',
            password: await bcrypt.hash('client', 10),
            role: 'client',
            factory: null,
            permissions: clientPermissions,
            created_at: new Date().toISOString()
        });
        console.log('✅ تم إنشاء المستخدم client/client');
    }
    console.log('✅ جميع المستخدمين جاهزون');
}

// ==================== دوال API ====================
function requireAuth(req, res, next) {
    if (req.session && req.session.user) return next();
    res.status(401).json({ error: 'غير مصرح' });
}
function requireAdmin(req, res, next) {
    if (req.session?.user?.role === 'admin') return next();
    res.status(403).json({ error: 'صلاحيات المدير مطلوبة' });
}
async function logAction(req, action, details, location) {
    addLogEntry(req.session?.user?.username || 'unknown', action, details, location);
}

// مسارات المصادقة
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = getUserByUsername(username);
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
app.get('/api/settings', requireAuth, (req, res) => {
    let settings = { factories: appSettings.factories, materials: appSettings.materials, trucks: appSettings.trucks };
    if (req.session.user.role === 'client' && req.session.user.factory) {
        settings.factories = settings.factories.filter(f => f.name === req.session.user.factory);
    }
    res.json(settings);
});
app.put('/api/settings', requireAuth, requireAdmin, (req, res) => {
    const { factories, materials, trucks } = req.body;
    appSettings.factories = factories;
    appSettings.materials = materials;
    appSettings.trucks = trucks;
    res.json({ success: true });
});

// البيانات اليومية (اختصار)
app.get('/api/day/:date', requireAuth, (req, res) => {
    res.json(dailyDataStore[req.params.date] || { orders: [], distribution: [] });
});
app.put('/api/day/:date', requireAuth, (req, res) => {
    dailyDataStore[req.params.date] = req.body;
    res.json({ success: true });
});

// المستخدمون
app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
    res.json(users.map(u => ({ id: u.id, username: u.username, role: u.role, factory: u.factory, permissions: u.permissions, created_at: u.created_at })));
});
app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
    const { username, password, role, factory, permissions } = req.body;
    if (getUserByUsername(username)) return res.status(400).json({ error: 'موجود' });
    const hashed = await bcrypt.hash(password, 10);
    users.push({ id: nextUserId++, username: username.toLowerCase(), password: hashed, role, factory, permissions, created_at: new Date().toISOString() });
    res.json({ success: true });
});
app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const { username, role, factory, permissions, password } = req.body;
    const user = users.find(u => u.id === id);
    if (!user) return res.status(404).json({ error: 'غير موجود' });
    user.username = username.toLowerCase();
    user.role = role;
    user.factory = factory;
    user.permissions = permissions;
    if (password) user.password = await bcrypt.hash(password, 10);
    res.json({ success: true });
});
app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    const idx = users.findIndex(u => u.id === id);
    if (idx !== -1 && users[idx].username !== 'admin') users.splice(idx, 1);
    res.json({ success: true });
});

// القيود
app.get('/api/restrictions', requireAuth, (req, res) => res.json(restrictions));
app.post('/api/restrictions', requireAuth, (req, res) => {
    if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
    const { truckNumber, driverName, restrictedFactories, reason } = req.body;
    restrictions.push({ id: nextRestrictionId++, truck_number: truckNumber, driver_name: driverName, restricted_factories: restrictedFactories, reason, active: true, created_by: req.session.user.username, created_at: new Date().toISOString() });
    res.json({ success: true });
});
app.put('/api/restrictions/:id', requireAuth, (req, res) => {
    if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
    const r = restrictions.find(r => r.id === parseInt(req.params.id));
    if (r) r.active = req.body.active;
    res.json({ success: true });
});
app.delete('/api/restrictions/:id', requireAuth, (req, res) => {
    if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
    const idx = restrictions.findIndex(r => r.id === parseInt(req.params.id));
    if (idx !== -1) restrictions.splice(idx, 1);
    res.json({ success: true });
});

// التقارير الأساسية
app.get('/api/reports', requireAuth, (req, res) => {
    // إرجاع بيانات فارغة أو حقيقية حسب الحاجة
    res.json({ allDistributions: [], dailyData: {}, driverStats: [], factoryStats: [], materialStats: [] });
});

// النسخ الاحتياطي
app.get('/api/backup', requireAuth, requireAdmin, (req, res) => {
    res.json({ settings: appSettings, users: users.map(u => ({ id: u.id, username: u.username, role: u.role, factory: u.factory, permissions: u.permissions })), restrictions, exportDate: new Date().toISOString() });
});
app.post('/api/restore', requireAuth, requireAdmin, (req, res) => {
    const data = req.body;
    if (data.settings) appSettings = data.settings;
    if (data.restrictions) restrictions = data.restrictions;
    res.json({ success: true });
});
app.delete('/api/clear-all', requireAuth, requireAdmin, (req, res) => {
    dailyDataStore = {};
    restrictions = [];
    res.json({ success: true });
});

// السجلات
app.get('/api/logs', requireAuth, (req, res) => {
    if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    res.json({ logs: getLogsPaginated(limit, offset), currentPage: page, totalPages: Math.ceil(getLogsCount() / limit), total: getLogsCount() });
});
app.get('/api/logs/all', requireAuth, (req, res) => {
    if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    res.json(logs);
});
app.delete('/api/logs/clear', requireAuth, requireAdmin, (req, res) => {
    logs = [];
    res.json({ success: true });
});

// تقارير التحليل (رفع ملفات Excel)
app.post('/api/upload-report', requireAuth, (req, res) => {
    const { filename, report_date, data } = req.body;
    reports.push({ id: nextReportId++, filename, report_date, data: typeof data === 'string' ? JSON.parse(data) : data, created_at: new Date().toISOString() });
    res.json({ success: true, id: nextReportId - 1 });
});
app.get('/api/reports-list', requireAuth, (req, res) => {
    let filtered = [...reports];
    if (req.query.filename) filtered = filtered.filter(r => r.filename && r.filename.toLowerCase().includes(req.query.filename.toLowerCase()));
    res.json(filtered);
});
app.get('/api/reports/:id', requireAuth, (req, res) => {
    const report = reports.find(r => r.id === parseInt(req.params.id));
    if (!report) return res.status(404).json({ error: 'غير موجود' });
    res.json(report);
});
app.delete('/api/reports/:id', requireAuth, requireAdmin, (req, res) => {
    const idx = reports.findIndex(r => r.id === parseInt(req.params.id));
    if (idx !== -1) reports.splice(idx, 1);
    res.json({ success: true });
});

// رفع ملف Excel مع حفظه
app.post('/api/upload-excel-report', upload.single('excelFile'), async (req, res) => {
    try {
        const { reportName, reportDate, vehicleData } = req.body;
        const file = req.file;
        if (!file) return res.status(400).json({ error: 'لم يتم رفع الملف' });
        // حفظ الملف في الذاكرة
        const fileData = fs.readFileSync(file.path);
        uploadedFiles.push({
            id: nextFileId++,
            original_name: file.originalname,
            file_data: fileData.toString('base64'),
            uploaded_at: new Date().toISOString(),
            uploaded_by: req.session.user.username,
            report_name: reportName
        });
        // حفظ التقرير
        reports.push({
            id: nextReportId++,
            filename: reportName,
            report_date: reportDate,
            data: JSON.parse(vehicleData),
            created_at: new Date().toISOString()
        });
        fs.unlinkSync(file.path); // حذف الملف المؤقت
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// تحميل الملفات الأصلية
app.get('/api/uploaded-files', requireAuth, (req, res) => {
    res.json(uploadedFiles.map(f => ({ id: f.id, original_name: f.original_name, uploaded_at: f.uploaded_at, uploaded_by: f.uploaded_by, report_name: f.report_name })));
});
app.get('/api/download-file/:id', requireAuth, (req, res) => {
    const file = uploadedFiles.find(f => f.id === parseInt(req.params.id));
    if (!file) return res.status(404).json({ error: 'الملف غير موجود' });
    const buffer = Buffer.from(file.file_data, 'base64');
    res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
});

// تقارير الميزان (اختصار)
app.post('/api/scale-reports', requireAuth, (req, res) => {
    const { reportName, reportDate, data } = req.body;
    const reportId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    scaleReports.push({
        id: nextScaleReportId++,
        report_id: reportId,
        report_name: reportName,
        report_date: reportDate,
        created_at: new Date().toISOString(),
        created_by: req.session.user.username,
        total_rows: data.totalRows,
        matched_count: data.matchedCount,
        not_matched_count: data.notMatchedCount,
        total_weight_all: data.totalWeightAll,
        drivers_stats: data.driversStats,
        materials_stats: data.materialsStats,
        top10_drivers: data.top10Drivers
    });
    res.json({ success: true, id: reportId });
});
app.get('/api/scale-reports', requireAuth, (req, res) => {
    res.json(scaleReports.map(r => ({ id: r.report_id, reportName: r.report_name, reportDate: r.report_date, createdAt: r.created_at, createdBy: r.created_by, totalRows: r.total_rows })));
});
app.get('/api/scale-reports/:id', requireAuth, (req, res) => {
    const r = scaleReports.find(r => r.report_id === req.params.id);
    if (!r) return res.status(404).json({ error: 'غير موجود' });
    res.json(r);
});
app.delete('/api/scale-reports/:id', requireAuth, requireAdmin, (req, res) => {
    const idx = scaleReports.findIndex(r => r.report_id === req.params.id);
    if (idx !== -1) scaleReports.splice(idx, 1);
    res.json({ success: true });
});

// ==================== صفحات HTML ====================
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
initDefaultUsers().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
        console.log(`👤 بيانات الدخول: admin/admin , user/user , client/client`);
    });
});
