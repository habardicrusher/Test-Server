// ... (نفس الكود السابق حتى middleware) ...

// تأكد من أن static middleware يأتي قبل أي شيء
app.use(express.static(path.join(__dirname)));

// مسار اختبار بسيط
app.get('/ping', (req, res) => res.send('pong'));

// المسار الرئيسي - استخدم sendFile مع مسار مطلق
app.get('/', (req, res) => {
    const filePath = path.join(__dirname, 'login.html');
    console.log(`Serving file: ${filePath}`);
    res.sendFile(filePath, (err) => {
        if (err) {
            console.error(`Error sending file: ${err}`);
            res.status(404).send('login.html not found. Check if file exists.');
        }
    });
});

// باقي المسارات...
