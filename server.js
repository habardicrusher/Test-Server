const multer = require('multer');
const fs = require('fs');
const path = require('path');

// التأكد من وجود مجلد uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// إعداد تخزين الملفات
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // حد أقصى 50MB

// جدول لحفظ بيانات الملفات المرفوعة (يمكنك إنشاؤه في Supabase)
async function createUploadsTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS uploaded_files (
            id SERIAL PRIMARY KEY,
            original_name TEXT NOT NULL,
            stored_name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            uploaded_by TEXT,
            uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            report_id INTEGER REFERENCES reports(id) ON DELETE SET NULL
        )
    `);
}
createUploadsTable().catch(console.error);

// endpoint جديد لرفع ملف Excel وحفظه وتحليله
app.post('/api/upload-excel-report', requireAuth, upload.single('excelFile'), async (req, res) => {
    try {
        if (req.session.user.role !== 'admin') {
            return res.status(403).json({ error: 'غير مصرح' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'لم يتم رفع أي ملف' });
        }

        const { originalname, filename, path: filePath } = req.file;
        const reportName = req.body.reportName || originalname;
        const reportDate = req.body.reportDate || new Date().toISOString().split('T')[0];

        // قراءة ملف Excel وتحليله (نفس معالجة الواجهة الأمامية)
        const workbook = XLSX.readFile(filePath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        // استخدم نفس دوال التحليل المستخدمة في الواجهة الأمامية
        // هنا نستخدم دوال منفصلة (يمكنك نقل دوال processExcelFile إلى الخادم)
        const vehicleData = await processExcelFileOnServer(rows); // يجب تعريف هذه الدالة

        // حفظ البيانات المستخلصة في جدول reports (كما كان سابقاً)
        const savedReport = await saveReport({
            filename: reportName,
            report_date: reportDate,
            data: JSON.stringify(vehicleData),
            created_by: req.session.user.username
        });

        // حفظ معلومات الملف الأصلي في جدول uploaded_files
        await pool.query(
            `INSERT INTO uploaded_files (original_name, stored_name, file_path, uploaded_by, report_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [originalname, filename, filePath, req.session.user.username, savedReport.id]
        );

        await addLog(req.session.user.username, 'رفع ملف Excel', `تم رفع ${originalname}`, null);
        res.json({ success: true, id: savedReport.id, fileId: savedReport.id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'فشل في رفع الملف: ' + err.message });
    }
});

// دالة لتحليل الملف على الخادم (مشابهة لدالة processExcelFile في الواجهة)
async function processExcelFileOnServer(rows) {
    // هنا يمكنك استخدام نفس الكود الموجود في processExcelFile في الـ frontend
    // لكن يجب تعديله ليعمل على الخادم (بدون DOM)
    // للاختصار، سنعيد استخدام منطق المعالجة الأصلي (يمكن نسخه من ملف expenses.html)
    // ...
    return vehicleList;
}

// endpoint لعرض قائمة الملفات المرفوعة
app.get('/api/uploaded-files', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT uf.id, uf.original_name, uf.uploaded_at, uf.uploaded_by, r.report_name
            FROM uploaded_files uf
            LEFT JOIN reports r ON uf.report_id = r.id
            ORDER BY uf.uploaded_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// endpoint لتنزيل الملف الأصلي
app.get('/api/download-file/:id', requireAuth, async (req, res) => {
    try {
        const id = req.params.id;
        const result = await pool.query('SELECT file_path, original_name FROM uploaded_files WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'الملف غير موجود' });
        const { file_path, original_name } = result.rows[0];
        res.download(file_path, original_name);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
