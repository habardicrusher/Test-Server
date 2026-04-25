const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// مسار صحي لفحص الاتصال
app.get('/health', (req, res) => {
    res.send('OK');
});

// مسار رئيسي بسيط
app.get('/', (req, res) => {
    res.send('🚀 Server is running on Railway!');
});

// استمع على جميع الواجهات (0.0.0.0)
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
});
