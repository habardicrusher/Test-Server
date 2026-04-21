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
    secret: 'gravel-system-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' },
    name: 'gravel.sid'
}));

function requireAuth(req, res, next) {
    if (req.session && req.session.user) return next();
    res.status(401).json({ error: 'غير مصرح' });
}

// دوال Supabase للتقارير
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

// API Routes
app.post('/api/upload-report', requireAuth, async (req, res) => {
    try {
        if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
        const reportData = req.body;
        if (!reportData.report_date || !reportData.filename) return res.status(400).json({ error: 'بيانات ناقصة' });
        reportData.created_by = req.session.user.username;
        const saved = await saveReport(reportData);
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
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// صفحة تسجيل الدخول المؤقتة (للتجربة)
app.post('/api/login', async (req, res) => {
    // تجاوز المصادقة للتجربة - يمكنك تعديلها لاحقاً
    req.session.user = { id: 1, username: 'admin', role: 'admin', factory: null, permissions: {} };
    res.json({ success: true, user: req.session.user });
});

app.get('/api/me', requireAuth, (req, res) => {
    res.json({ user: req.session.user });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// صفحات الواجهة
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});
app.get('/', (req, res) => {
    if (req.session && req.session.user) {
        res.redirect('/index.html');
    } else {
        res.redirect('/login.html');
    }
});
const protectedPages = ['index.html', 'orders.html', 'distribution.html', 'trucks.html', 'products.html', 'factories.html', 'reports.html', 'settings.html', 'restrictions.html', 'users.html', 'logs.html', 'upload-report.html', 'scale_report.html', 'Expenses.html'];
protectedPages.forEach(page => {
    app.get(`/${page}`, (req, res) => {
        if (!req.session || !req.session.user) return res.redirect('/login.html');
        res.sendFile(path.join(__dirname, page));
    });
});
app.use(express.static(__dirname));

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
