// Configuração do Gmail com timeouts
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
});

app.post('/send-email', async (req, res) => {
  try {
    const { to, subject, message } = req.body || {};

    // validações
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return res.status(500).json({
        error: 'Servidor sem EMAIL_USER/EMAIL_PASS no Render (Environment).',
      });
    }
    if (!to || !subject || !message) {
      return res.status(400).json({
        error: 'Campos obrigatórios: to, subject, message',
      });
    }

    const info = await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject,
      text: message,
    });

    return res.json({ success: true, messageId: info.messageId || null });
  } catch (error) {
    console.error('Erro nodemailer:', error);
    // devolve o erro real (ajuda MUITO)
    return res.status(500).json({
      success: false,
      error: error?.message || String(error),
      code: error?.code || null,
      response: error?.response || null,
    });
  }
});