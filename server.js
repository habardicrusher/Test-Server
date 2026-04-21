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

// ==================== دوال مساعدة Supabase ====================

// ---- تقارير التحليل (Reports) ----
async function saveReport(reportData) {
    const { data, error } = await supabase
        .from('reports')
        .insert({
            report_name: reportData.filename,
            report_date: reportData.report_date,
            data: reportData.data, // JSONB
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

// ---- تقارير الميزان (Scale Reports) ----
async function saveScaleReport(reportData) {
    const { data, error } = await supabase
        .from('scale_reports')
        .insert({
            report_id: reportData.report_id,
            report_name: reportData.report_name,
            report_date: reportData.report_date,
            created_by: reportData.created_by,
            total_rows: reportData.total_rows,
            matched_count: reportData.matched_count,
            not_matched_count: reportData.not_matched_count,
            total_weight_all: reportData.total_weight_all,
            drivers_stats: reportData.drivers_stats,
            materials_stats: reportData.materials_stats,
            top10_drivers: reportData.top10_drivers
        })
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
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    return data;
}

async function deleteScaleReportById(reportId) {
    const { error } = await supabase
        .from('scale_reports')
        .delete()
        .eq('report_id', reportId);
    if (error) throw new Error(error.message);
}

// ==================== باقي دوال قاعدة البيانات الأخرى (مثل logs, users, restrictions) ====================
// يمكن إما الاحتفاظ بـ pool المحلي لها، أو تحويلها أيضاً إلى Supabase.
// هنا سنفترض أنك ترغب في نقل كل شيء إلى Supabase، لذا سأكتب دوال بديلة لـ logs و users و restrictions.
// لكن إذا كنت تريد الاحتفاظ بقاعدة البيانات المحلية لهذه الجداول فقط، يمكنك ترك pool كما هو.

// مثال: دوال logs باستخدام Supabase (إذا كان الجدول موجوداً)
async function addLog(username, action, details, location) {
    const { error } = await supabase
        .from('logs')
        .insert({ username, action, details, location, created_at: new Date() });
    if (error) console.error('Log error:', error);
}

async function getLogs(limit, offset) {
    const { data, error } = await supabase
        .from('logs')
        .select('*')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
    if (error) return [];
    return data;
}

async function getLogsCount() {
    const { count, error } = await supabase
        .from('logs')
        .select('*', { count: 'exact', head: true });
    if (error) return 0;
    return count;
}

// ==================== التعديل على الـ endpoints ====================

// مثال: تعديل endpoint رفع التقرير
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
        await addLog(req.session.user.username, 'رفع تقرير', `تم رفع تقرير ${reportData.filename}`, null);
        res.json({ success: true, id: saved.id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'فشل في حفظ التقرير: ' + err.message });
    }
});

// تعديل endpoint جلب التقارير
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

// تعديل endpoint جلب تقرير محدد
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

// تعديل endpoint حذف تقرير
app.delete('/api/reports/:id', requireAuth, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const report = await getReportById(id);
        if (!report) return res.status(404).json({ error: 'تقرير غير موجود' });
        await deleteReportById(id);
        await addLog(req.session.user.username, 'حذف تقرير', `تم حذف تقرير ${report.report_name}`, null);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'فشل في حذف التقرير: ' + err.message });
    }
});

// ==== endpoints تقارير الميزان ====
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
        await addLog(req.session.user.username, 'حفظ تقرير ميزان', `تم حفظ تقرير: ${reportName}`, null);
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
        await addLog(req.session.user.username, 'حذف تقرير ميزان', `تم حذف تقرير: ${report.report_name}`, null);
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'خطأ في حذف التقرير: ' + e.message });
    }
});

// ملاحظة: يجب أيضاً تعديل دوال users, restrictions, settings, daily_data إذا أردت نقلها إلى Supabase.
// لكن بسؤالك الحالي، يكفي تعديل التقارير.
