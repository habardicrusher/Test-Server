const express = require('express');
const app = express();

// ده اللي هيخلي السيرفر صاحي 24/7
app.get('/', (req, res) => {
  res.send('✅ Bot is running 24/7!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🟢 Server alive on port ${PORT}`);
});

// =============================
// شغل البوت بتاعك هنا تحت
// require('./bot.js');
// =============================
