const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');

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

// ==================== تخزين البيانات في الذاكرة ====================
// المستخدمون
let users = [];
// الإعدادات
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
// البيانات اليومية (key: date string)
let dailyDataStore = {};
// القيود
let restrictions = [];
// السجلات (logs)
let logs = [];
// التقارير المرفوعة (reports)
let reports = [];
// تقارير الميزان (scale_reports)
let scaleReports = [];
// عداد IDs
let nextUserId = 1;
let nextRestrictionId = 1;
let nextLogId = 1;
let nextReportId = 1;
let nextScaleReportId = 1;

// ==================== دوال مساعدة للتخزين ====================
function getUserByUsername(username) {
    return users.find(u => u.username.toLowerCase() === username.toLowerCase());
}
function getUserById(id) {
    return users.find(u => u.id === id);
}
function addLogEntry(username, action, details, location) {
    const log = {
        id: nextLogId++,
        username: username || 'unknown',
        action,
        details: details || null,
        location: location || null,
        created_at: new Date().toISOString()
    };
    logs.unshift(log); // الأحدث أولاً
    // الاحتفاظ بآخر 1000 سجل فقط
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
        const hashed = await bcrypt.hash('admin', 10);
        users.push({
            id: nextUserId++,
            username: 'admin',
            password: hashed,
            role: 'admin',
            factory: null,
            permissions: adminPermissions,
            created_at: new Date().toISOString()
        });
        console.log('✅ تم إنشاء المستخدم admin/admin');
    } else {
        // تحديث الصلاحيات
        const adminUser = getUserByUsername('admin');
        adminUser.permissions = adminPermissions;
    }

    if (!getUserByUsername('user')) {
        const hashed = await bcrypt.hash('user', 10);
        users.push({
            id: nextUserId++,
            username: 'user',
            password: hashed,
            role: 'user',
            factory: null,
            permissions: userPermissions,
            created_at: new Date().toISOString()
        });
        console.log('✅ تم إنشاء المستخدم user/user');
    } else {
        getUserByUsername('user').permissions = userPermissions;
    }

    if (!getUserByUsername('client')) {
        const hashed = await bcrypt.hash('client', 10);
        users.push({
            id: nextUserId++,
            username: 'client',
            password: hashed,
            role: 'client',
            factory: null,
            permissions: clientPermissions,
            created_at: new Date().toISOString()
        });
        console.log('✅ تم إنشاء المستخدم client/client');
    } else {
        getUserByUsername('client').permissions = clientPermissions;
    }
    console.log('✅ المستخدمون الافتراضيون جاهزون');
}

// ==================== دوال API الأساسية (محاكاة قاعدة البيانات) ====================
function getDayData(date) {
    return dailyDataStore[date] || { orders: [], distribution: [] };
}
function saveDayData(date, orders, distribution) {
    dailyDataStore[date] = { orders, distribution };
}
function getSettings() {
    return { factories: appSettings.factories, materials: appSettings.materials, trucks: appSettings.trucks };
}
function saveSettings(factories, materials, trucks) {
    appSettings.factories = factories;
    appSettings.materials = materials;
    appSettings.trucks = trucks;
}
function createUserInMemory(username, password, role, factory, permissions) {
    const hashed = bcrypt.hashSync(password, 10);
    const newUser = {
        id: nextUserId++,
        username: username.toLowerCase(),
        password: hashed,
        role,
        factory,
        permissions,
        created_at: new Date().toISOString()
    };
    users.push(newUser);
    return newUser;
}
function updateUserInMemory(id, username, role, factory, permissions, newPassword) {
    const user = users.find(u => u.id === id);
    if (!user) throw new Error('مستخدم غير موجود');
    user.username = username.toLowerCase();
    user.role = role;
    user.factory = factory;
    user.permissions = permissions;
    if (newPassword) {
        user.password = bcrypt.hashSync(newPassword, 10);
    }
}
function deleteUserInMemory(id) {
    const index = users.findIndex(u => u.id === id);
    if (index !== -1) users.splice(index, 1);
}
function getRestrictions() {
    return [...restrictions];
}
function addRestrictionInMemory(truckNumber, driverName, restrictedFactories, reason, createdBy) {
    const newRestriction = {
        id: nextRestrictionId++,
        truck_number: truckNumber,
        driver_name: driverName,
        restricted_factories: restrictedFactories,
        reason,
        active: true,
        created_by: createdBy,
        created_at: new Date().toISOString()
    };
    restrictions.push(newRestriction);
    return newRestriction;
}
function updateRestrictionInMemory(id, active) {
    const r = restrictions.find(r => r.id === id);
    if (r) r.active = active;
}
function deleteRestrictionInMemory(id) {
    const index = restrictions.findIndex(r => r.id === id);
    if (index !== -1) restrictions.splice(index, 1);
}
function saveReportInMemory(reportData) {
    const { filename, report_date, data } = reportData;
    const newReport = {
        id: nextReportId++,
        filename,
        report_date,
        data: data || {},
        created_at: new Date().toISOString()
    };
    reports.push(newReport);
    return { id: newReport.id };
}
function getReportsFromMemory(filters) {
    let filtered = [...reports];
    if (filters.filename) {
        filtered = filtered.filter(r => r.filename && r.filename.toLowerCase().includes(filters.filename.toLowerCase()));
    }
    // ترتيب تنازلي حسب التاريخ
    filtered.sort((a,b) => new Date(b.report_date) - new Date(a.report_date));
    return filtered;
}
function saveScaleReportInMemory(reportName, reportDate, data, createdBy) {
    const reportId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const newReport = {
        id: nextScaleReportId++,
        report_id: reportId,
        report_name: reportName || 'تقرير بدون اسم',
        report_date: reportDate || new Date().toISOString().split('T')[0],
        created_at: new Date().toISOString(),
        created_by: createdBy,
        total_rows: data.totalRows || 0,
        matched_count: data.matchedCount || 0,
        not_matched_count: data.notMatchedCount || 0,
        total_weight_all: data.totalWeightAll || 0,
        drivers_stats: data.driversStats || [],
        materials_stats: data.materialsStats || [],
        top10_drivers: data.top10Drivers || []
    };
    scaleReports.push(newReport);
    return reportId;
}
function getScaleReportsFromMemory() {
    return scaleReports.map(r => ({
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
        driversCount: r.drivers_stats.length
    })).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
}
function getScaleReportById(reportId) {
    return scaleReports.find(r => r.report_id === reportId);
}
function deleteScaleReportById(reportId) {
    const index = scaleReports.findIndex(r => r.report_id === reportId);
    if (index !== -1) scaleReports.splice(index, 1);
}

// ==================== دوال مساعدة للتطبيق ====================
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
    addLogEntry(username, action, details, location);
}

// ==================== تهيئة البيانات ====================
initDefaultUsers().catch(console.error);

// ==================== API Routes ====================
// تسجيل الدخول
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
    const username = req.session?.user?.username;
    if (username) await logAction(req, 'تسجيل خروج', `تسجيل خروج للمستخدم ${username}`, req.session.user?.factory || 'المكتب الرئيسي');
    req.session.destroy();
    res.json({ success: true });
});
app.get('/api/me', requireAuth, (req, res) => {
    res.json({ user: req.session.user });
});

// الإعدادات
app.get('/api/settings', requireAuth, (req, res) => {
    let settings = getSettings();
    if (req.session.user.role === 'client' && req.session.user.factory) {
        settings.factories = settings.factories.filter(f => f.name === req.session.user.factory);
    }
    res.json(settings);
});
app.put('/api/settings', requireAuth, async (req, res) => {
    if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const { factories, materials, trucks } = req.body;
    saveSettings(factories, materials, trucks);
    await logAction(req, 'تحديث الإعدادات', `المصانع: ${factories.length}, المواد: ${materials.length}, السيارات: ${trucks.length}`, null);
    res.json({ success: true });
});

// البيانات اليومية
app.get('/api/day/:date', requireAuth, (req, res) => {
    const data = getDayData(req.params.date);
    res.json(data);
});
app.put('/api/day/:date', requireAuth, (req, res) => {
    const { orders, distribution } = req.body;
    saveDayData(req.params.date, orders, distribution);
    res.json({ success: true });
});

// إدارة المستخدمين
app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
    const usersList = users.map(u => ({
        id: u.id,
        username: u.username,
        role: u.role,
        factory: u.factory,
        permissions: u.permissions,
        created_at: u.created_at
    }));
    res.json(usersList);
});
app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
    const { username, password, role, factory, permissions } = req.body;
    if (getUserByUsername(username)) return res.status(400).json({ error: 'اسم المستخدم موجود' });
    createUserInMemory(username, password, role, factory, permissions);
    await logAction(req, 'إضافة مستخدم', `المستخدم: ${username}, الدور: ${role}, المصنع: ${factory || 'لا يوجد'}`, null);
    res.json({ success: true });
});
app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const { username, role, factory, permissions, password } = req.body;
    try {
        updateUserInMemory(id, username, role, factory, permissions, password);
        await logAction(req, 'تعديل مستخدم', `المستخدم: ${username}, الدور: ${role}`, null);
        res.json({ success: true });
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});
app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const user = users.find(u => u.id === id);
    if (user?.username === 'admin') return res.status(400).json({ error: 'لا يمكن حذف المدير الرئيسي' });
    deleteUserInMemory(id);
    await logAction(req, 'حذف مستخدم', `المستخدم: ${user?.username}`, null);
    res.json({ success: true });
});

// القيود
app.get('/api/restrictions', requireAuth, (req, res) => {
    res.json(getRestrictions());
});
app.post('/api/restrictions', requireAuth, async (req, res) => {
    if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
    const { truckNumber, driverName, restrictedFactories, reason } = req.body;
    const newRestriction = addRestrictionInMemory(truckNumber, driverName, restrictedFactories, reason, req.session.user.username);
    await logAction(req, 'إضافة قيد حظر', `السيارة: ${truckNumber} (${driverName}) ممنوعة من المصانع: ${restrictedFactories.join(', ')}`, null);
    res.json(newRestriction);
});
app.put('/api/restrictions/:id', requireAuth, async (req, res) => {
    if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
    const id = parseInt(req.params.id);
    const { active } = req.body;
    updateRestrictionInMemory(id, active);
    await logAction(req, 'تعديل قيد حظر', `تغيير حالة القيد رقم ${id} إلى ${active ? 'نشط' : 'غير نشط'}`, null);
    res.json({ success: true });
});
app.delete('/api/restrictions/:id', requireAuth, async (req, res) => {
    if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
    const id = parseInt(req.params.id);
    deleteRestrictionInMemory(id);
    await logAction(req, 'حذف قيد حظر', `تم حذف القيد رقم ${id}`, null);
    res.json({ success: true });
});

// تقارير التحليل (old reports)
app.get('/api/reports', requireAuth, (req, res) => {
    const { startDate, endDate } = req.query;
    const start = new Date(startDate);
    const end = new Date(endDate);
    let allDistributions = [], dailyData = {}, driverStats = {}, factoryStats = {}, materialStats = {};
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        const dayData = getDayData(dateStr);
        if (dayData.distribution && dayData.distribution.length) {
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

// النسخ الاحتياطي
app.get('/api/backup', requireAuth, requireAdmin, async (req, res) => {
    const backup = {
        settings: getSettings(),
        users: users.map(u => ({ id: u.id, username: u.username, role: u.role, factory: u.factory, permissions: u.permissions })),
        restrictions: getRestrictions(),
        exportDate: new Date().toISOString()
    };
    await logAction(req, 'تصدير نسخة احتياطية', null, null);
    res.json(backup);
});
app.post('/api/restore', requireAuth, requireAdmin, async (req, res) => {
    const data = req.body;
    if (data.settings) saveSettings(data.settings.factories, data.settings.materials, data.settings.trucks);
    if (data.restrictions) {
        restrictions = [];
        for (const r of data.restrictions) {
            addRestrictionInMemory(r.truck_number, r.driver_name, r.restricted_factories, r.reason, r.created_by);
        }
    }
    await logAction(req, 'استعادة نسخة احتياطية', null, null);
    res.json({ success: true });
});

// مسح كل البيانات
app.delete('/api/clear-all', requireAuth, requireAdmin, async (req, res) => {
    dailyDataStore = {};
    restrictions = [];
    await logAction(req, 'مسح جميع البيانات', null, null);
    res.json({ success: true });
});

// السجلات (logs)
app.get('/api/logs', requireAuth, (req, res) => {
    if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const logsPage = getLogsPaginated(limit, offset);
    const total = getLogsCount();
    res.json({ logs: logsPage, currentPage: page, totalPages: Math.ceil(total / limit), total });
});
app.get('/api/logs/all', requireAuth, (req, res) => {
    if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    res.json(logs);
});
app.delete('/api/logs/clear', requireAuth, requireAdmin, async (req, res) => {
    logs = [];
    addLogEntry(req.session.user.username, 'مسح السجلات', 'قام بحذف جميع سجلات النظام', null);
    res.json({ success: true });
});

// تقارير التحليل (رفع ملفات)
app.post('/api/upload-report', requireAuth, async (req, res) => {
    try {
        if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
        const reportData = req.body;
        if (!reportData.report_date || !reportData.filename) {
            return res.status(400).json({ error: 'بيانات ناقصة' });
        }
        const saved = saveReportInMemory(reportData);
        await addLogEntry(req.session.user.username, 'رفع تقرير', `تم رفع تقرير ${reportData.filename}`, null);
        res.json({ success: true, id: saved.id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'فشل في حفظ التقرير' });
    }
});
app.get('/api/reports-list', requireAuth, (req, res) => {
    try {
        const { filename } = req.query;
        const filters = {};
        if (filename) filters.filename = filename;
        const reportsList = getReportsFromMemory(filters);
        res.json(reportsList);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'فشل في جلب التقارير' });
    }
});
app.get('/api/reports/:id', requireAuth, (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const report = reports.find(r => r.id === id);
        if (!report) return res.status(404).json({ error: 'تقرير غير موجود' });
        res.json(report);
    } catch (err) {
        res.status(500).json({ error: 'فشل في جلب التقرير' });
    }
});

// تقارير الميزان (Scale Reports)
app.post('/api/scale-reports', requireAuth, (req, res) => {
    try {
        const { reportName, reportDate, data } = req.body;
        if (!data) return res.status(400).json({ error: 'لا توجد بيانات للحفظ' });
        const reportId = saveScaleReportInMemory(reportName, reportDate, data, req.session.user.username);
        addLogEntry(req.session.user.username, 'حفظ تقرير ميزان', `تم حفظ تقرير: ${reportName || 'بدون اسم'}`, null);
        res.json({ success: true, id: reportId, message: 'تم حفظ التقرير بنجاح' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'خطأ في حفظ التقرير: ' + e.message });
    }
});
app.get('/api/scale-reports', requireAuth, (req, res) => {
    try {
        const summaries = getScaleReportsFromMemory();
        res.json(summaries);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'خطأ في جلب التقارير: ' + e.message });
    }
});
app.get('/api/scale-reports/:id', requireAuth, (req, res) => {
    try {
        const reportId = req.params.id;
        const report = getScaleReportById(reportId);
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
app.delete('/api/scale-reports/:id', requireAuth, (req, res) => {
    try {
        const reportId = req.params.id;
        const report = getScaleReportById(reportId);
        if (!report) return res.status(404).json({ error: 'التقرير غير موجود' });
        deleteScaleReportById(reportId);
        addLogEntry(req.session.user.username, 'حذف تقرير ميزان', `تم حذف تقرير: ${report.report_name}`, null);
        res.json({ success: true, message: 'تم حذف التقرير بنجاح' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'خطأ في حذف التقرير: ' + e.message });
    }
});

// ==================== صفحات HTML ====================
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

// ==================== تشغيل السيرفر ====================
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📝 تخزين مؤقت في الذاكرة - سيتم فقدان البيانات عند إعادة التشغيل`);
    console.log(`👤 بيانات الدخول: admin/admin , user/user , client/client`);
});
